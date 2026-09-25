// our-work.html gallery lazy-load (2026-09-25). The page used to fetch all
// 61 photos (4.1MB) on first load. The first category's 4 photos keep a
// plain src; the other 57 carry a viewBox-only SVG placeholder in src (so
// each masonry tile is its final height before the photo arrives) and
// the real file in data-src, swapped in by an IntersectionObserver once
// the tile is within 800px of the viewport.
//
// Guards the two ways this can go wrong in this CSS-column masonry:
//   - native loading="lazy" coming back (removed 2026-09-16; see
//     docs/specialist-logs/visual.md);
//   - a placeholder whose ratio differs from the photo's, which would
//     move every tile below it when the photo loads.
// The real-browser checks (61/61 render after a scroll-through, bytes
// on first load) are in the 2026-09-25 visual log entry.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('our-work.html'), 'utf8');
const GRID = HTML.slice(HTML.indexOf('id="galleryGrid"'), HTML.indexOf('</main>'));
const IMGS = [...GRID.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1] : null; };
const EAGER = 4; // the first category, flooring-before-demo
const PLACEHOLDER = /^data:image\/svg\+xml,%3Csvg%20xmlns='http:\/\/www\.w3\.org\/2000\/svg'%20viewBox='0%200%20(\d+)%20(\d+)'%3E%3C\/svg%3E$/;

// Lossy WebP ('VP8 ' chunk): the frame size sits at bytes 26-29.
function webpSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 12, 16), 'VP8 ', `${file}: expected a lossy WebP`);
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

const LOADER = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("'#galleryGrid img[data-src]'"));

test('the gallery still has 61 photos and none of them uses native loading="lazy"', () => {
  assert.equal(IMGS.length, 61);
  for (const tag of IMGS) assert.doesNotMatch(tag, /loading=/, tag);
});

test('the first category loads normally: a real src and no data-src', () => {
  for (const tag of IMGS.slice(0, EAGER)) {
    assert.match(attr(tag, 'src'), /^images\/gallery\/[a-z0-9-]+\.webp$/, tag);
    assert.equal(attr(tag, 'data-src'), null, tag);
  }
  assert.match(GRID, /data-index="3" data-category="flooring-before-demo"/);
  assert.match(GRID, /data-index="4" data-category="flooring-installation"/);
});

test('every deferred photo has a placeholder with the same ratio, and width/height match the real file', () => {
  for (const [i, tag] of IMGS.entries()) {
    const file = i < EAGER ? attr(tag, 'src') : attr(tag, 'data-src');
    assert.ok(fs.existsSync(repo(file)), `${file} is missing`);
    const [w, h] = webpSize(repo(file));
    assert.deepEqual([+attr(tag, 'width'), +attr(tag, 'height')], [w, h], `${file}: width/height must be the real ${w}x${h}`);
    if (i < EAGER) continue;
    const m = attr(tag, 'src').match(PLACEHOLDER);
    assert.ok(m, `${file}: src should be the viewBox SVG placeholder`);
    assert.deepEqual([+m[1], +m[2]], [w, h], `${file}: placeholder viewBox must be 0 0 ${w} ${h}`);
    assert.ok(attr(tag, 'alt'), `${file}: alt text`);
  }
});

test('the lightbox list still names each tile\'s own photo, in order', () => {
  const items = [...HTML.matchAll(/\{src:"(images\/gallery\/[^"]+)", caption:/g)].map((m) => m[1]);
  const tiles = IMGS.map((tag, i) => (i < EAGER ? attr(tag, 'src') : attr(tag, 'data-src')));
  assert.deepEqual(items, tiles);
});

function runLoader({ withIO }) {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="galleryGrid">${IMGS.join('\n')}</div></body>`, { runScripts: 'outside-only' });
  const { window } = dom;
  const observers = [];
  if (withIO) {
    window.IntersectionObserver = class {
      constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); observers.push(this); }
      observe(el) { this.targets.add(el); }
      unobserve(el) { this.targets.delete(el); }
      disconnect() { this.targets.clear(); }
      fire(el, isIntersecting) { this.cb([{ target: el, isIntersecting }], this); }
    };
  }
  window.eval(LOADER);
  return { doc: window.document, observers };
}

test('a real run: only a tile that reaches the viewport margin swaps in its photo', () => {
  const { doc, observers } = runLoader({ withIO: true });
  assert.equal(observers.length, 1);
  const io = observers[0];
  assert.equal(io.opts.rootMargin, '800px 0px');
  const deferred = [...doc.querySelectorAll('#galleryGrid img[data-src]')];
  assert.equal(deferred.length, 61 - EAGER);
  assert.equal(io.targets.size, deferred.length);

  const last = deferred[deferred.length - 1];
  const file = last.dataset.src;
  io.fire(last, false);
  assert.match(last.getAttribute('src'), /^data:image\/svg\+xml,/, 'not intersecting: still the placeholder');
  io.fire(last, true);
  assert.equal(last.getAttribute('src'), file);
  assert.equal(last.hasAttribute('data-src'), false);
  assert.equal(io.targets.has(last), false, 'unobserved once loaded');
  assert.equal(doc.querySelectorAll('#galleryGrid img[data-src]').length, deferred.length - 1);
});

test('a browser without IntersectionObserver gets every photo straight away', () => {
  const { doc } = runLoader({ withIO: false });
  assert.equal(doc.querySelectorAll('#galleryGrid img[data-src]').length, 0);
  for (const img of doc.querySelectorAll('#galleryGrid img')) assert.match(img.getAttribute('src'), /^images\/gallery\//);
});
