// Claude Design next pass, Package D (2026-09-29): public site. Applied
// only where it made the site better (owner, 2026-09-30: "don't change
// anything that would make the site look worse"). D13 the service address
// in the booking summary (the hold countdown was left out: nothing holds a
// slot, so it would say something untrue). D14 a share card per page,
// orange-only ("we don't use the blue we use orange"). D12 and D15 were
// left for the owner; see docs/ACTION-ITEMS.md.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const SITE = 'https://www.triplehenterprisesllc.biz';
const { cards } = JSON.parse(read('scripts', 'og-cards', 'cards.json'));
const TEMPLATE = read('scripts', 'og-cards', 'template.html');
const BOOKING = read('booking.html');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// Width and height from a baseline/progressive JPEG's SOF marker.
function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'starts like a JPEG');
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('no SOF marker');
}

function htmlPages(dir = repo()) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'tests' || e.name === 'scripts') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlPages(full));
    else if (e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('D13: the booking summary has a service address row, after date & time', () => {
  const doc = new JSDOM(BOOKING).window.document;
  const item = doc.getElementById('sidebarAddress');
  assert.ok(item, '#sidebarAddress exists');
  assert.equal(item.previousElementSibling.id, 'sidebarDateTime');
  assert.ok(item.classList.contains('is-pending'));
  assert.equal(item.querySelector('.si-label').textContent, 'Service address');
  assert.equal(item.querySelector('.si-value').textContent, 'Not entered yet');
  assert.match(BOOKING, /\n    updateSidebarAddress\(\);\n    updateMobileSummary\(currentStep\);\n  \}/, 'refreshed with the rest of the summary');
  assert.match(BOOKING, /document\.getElementById\('bAddress'\)\.addEventListener\('input', updateSidebarAddress\);/);
  // Body text, not the 20px display face the other filled rows use.
  assert.match(BOOKING, /\.booking-sidebar #sidebarAddress:not\(\.is-pending\) \.si-value\{font-family:var\(--font-app\); font-size:15px;[^}]*overflow-wrap:anywhere;\}/);
});

test('D13: the row shows what was typed, as text, and empties back to its prompt', () => {
  const dom = new JSDOM(BOOKING.slice(BOOKING.indexOf('<body'), BOOKING.lastIndexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, ''), { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(extractFn(BOOKING, 'updateSidebarAddress'));
  const input = w.document.getElementById('bAddress');
  const item = w.document.getElementById('sidebarAddress');
  input.value = '  12 Red Rock Rd <b>St. George</b>  ';
  w.updateSidebarAddress();
  assert.ok(!item.classList.contains('is-pending'));
  assert.equal(item.querySelector('.si-value').textContent, '12 Red Rock Rd <b>St. George</b>');
  assert.equal(item.querySelector('b'), null, 'never parsed as HTML');
  input.value = '   ';
  w.updateSidebarAddress();
  assert.ok(item.classList.contains('is-pending'));
  assert.equal(item.querySelector('.si-value').textContent, 'Not entered yet');
});

test('D13: no slot-hold countdown (nothing holds a slot, so it would be untrue)', () => {
  assert.doesNotMatch(BOOKING, /holding this time for you|Still yours for/i);
});

test('D14: one card per page, unique slugs, and every card page exists', () => {
  const slugs = cards.map((c) => c.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(new Set(cards.map((c) => c.page)).size, cards.length);
  for (const c of cards) {
    assert.ok(fs.existsSync(repo(c.page)), c.page);
    assert.match(c.slug, /^[a-z0-9-]+$/);
    assert.ok(c.eyebrow && c.title, c.slug);
    if (c.badge) assert.ok(['standard', 'request'].includes(c.badge), c.slug);
    if (c.art) assert.ok(fs.existsSync(repo('scripts', 'og-cards', 'art', c.art)), c.art);
    assert.equal(c.rating, undefined, 'no baked-in rating: it is edited live and would go stale');
  }
});

test('D14: every page with a share image points at its own card, and the card is a 1200x630 JPEG', () => {
  const bySlugPage = new Map(cards.map((c) => [path.normalize(c.page), c]));
  const pages = htmlPages().filter((f) => /property="og:image"/.test(fs.readFileSync(f, 'utf8')));
  assert.equal(pages.length, cards.length, 'no page with an og:image is missing from cards.json');
  for (const file of pages) {
    const rel = path.relative(repo(), file);
    const card = bySlugPage.get(path.normalize(rel));
    assert.ok(card, `${rel} has a card`);
    const url = `${SITE}/images/og/${card.slug}.jpg`;
    const doc = new JSDOM(fs.readFileSync(file, 'utf8')).window.document;
    const meta = (sel) => { const el = doc.querySelector(sel); return el && el.getAttribute('content'); };
    assert.equal(meta('meta[property="og:image"]'), url, rel);
    const tw = meta('meta[name="twitter:image"]');
    if (tw !== null) assert.equal(tw, url, `${rel} twitter:image`);
    assert.equal(meta('meta[property="og:image:width"]'), '1200', rel);
    assert.equal(meta('meta[property="og:image:height"]'), '630', rel);
    assert.ok((meta('meta[property="og:image:alt"]') || '').startsWith('Triple H Enterprises: '), `${rel} alt`);
    const img = repo('images', 'og', card.slug + '.jpg');
    assert.ok(fs.existsSync(img), `images/og/${card.slug}.jpg is built`);
    assert.deepEqual(jpegSize(fs.readFileSync(img)), { width: 1200, height: 630 }, card.slug);
  }
  assert.deepEqual(fs.readdirSync(repo('images', 'og')).sort(), cards.map((c) => c.slug + '.jpg').sort(), 'no stray cards');
});

test('D14: the old shared image is retired -- no page links it, and its URL now carries the homepage card', () => {
  for (const file of htmlPages()) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /images\/og-image\.jpg/, path.relative(repo(), file));
  }
  assert.ok(fs.readFileSync(repo('images', 'og-image.jpg')).equals(fs.readFileSync(repo('images', 'og', 'home.jpg'))));
  // Business structured data uses the homepage card too.
  for (const f of ['index.html', ...fs.readdirSync(repo('locations')).map((n) => path.join('locations', n))]) {
    const m = read(f).match(/"image": "([^"]+)"/);
    if (m) assert.equal(m[1], `${SITE}/images/og/home.jpg`, f);
  }
});

test('D14: the card is orange-only, Anton in capitals, and the fonts ship with their licence', () => {
  const css = TEMPLATE.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /58, ?160, ?255|#7ec4ff|#3aa0ff|--blue/i, 'no blue anywhere on the cards');
  assert.match(css, /linear-gradient\(rgba\(255,128,0,\.06\) 1px, transparent 1px\)/, 'orange grid');
  assert.match(css, /\.badge\.standard \{ color: #140900; background: #ff8000;/);
  assert.match(css, /\.badge\.request \{ color: #ffb347; border-color: #ff8000; \}/);
  assert.match(css, /--il-water: rgba\(255,255,255,\.07\); --il-waterline: #9a9a9a;/, 'the drawing\'s water is neutral, not blue');
  assert.match(css, /\.title \{[^}]*font-family: Anton;[^}]*text-transform: uppercase;[^}]*text-wrap: balance;/);
  assert.match(css, /\.brand-name \{[^}]*text-transform: uppercase;/);
  assert.match(TEMPLATE, /src="\.\.\/\.\.\/images\/logo-signature-orange-176\.webp"/, 'the orange logo');
  for (const f of ['anton.woff2', 'oswald.woff2', 'OFL-Anton.txt', 'OFL-Oswald.txt']) {
    assert.ok(fs.existsSync(repo('scripts', 'og-cards', 'fonts', f)), f);
  }
  assert.match(read('scripts', 'og-cards', 'fonts', 'OFL-Anton.txt'), /SIL Open Font License, Version 1\.1/);
});

test('D15: the blog keeps its photos (one drawn post among 16 photo posts would be the odd one out)', () => {
  assert.match(read('blog', 'washer-wont-drain.html'), /<img class="blog-diagram" src="https:\/\/images\.unsplash\.com\//);
});
