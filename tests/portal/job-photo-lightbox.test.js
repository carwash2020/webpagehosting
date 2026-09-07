// Job photos used to just open the raw signed image URL in a new
// browser tab -- no way to see a job's other photos without going
// back to the app and clicking each thumbnail individually. This
// reuses the exact .lightbox-overlay markup/classes already built and
// styled for the public site's own Gallery (shared styles.css),
// scoped per-job rather than one sitewide gallery list.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

test('the lightbox markup is present, reusing the exact same classes/ids pattern as the public-site Gallery', () => {
  assert.match(JOBS, /<div class="lightbox-overlay" id="lightboxOverlay">/);
  assert.match(JOBS, /<img id="lightboxImg" src="" alt="">/);
  assert.match(JOBS, /id="lightboxPrev"/);
  assert.match(JOBS, /id="lightboxNext"/);
  assert.match(JOBS, /id="lightboxCaption"/);
});

test('a job photo link no longer opens in a new tab -- it is intercepted and opens the lightbox instead', () => {
  assert.doesNotMatch(JOBS, /<a href="\$\{url\}" target="_blank"/);
  assert.match(JOBS, /<a href="\$\{url\}" data-idx="\$\{i\}">/);
  assert.match(JOBS, /a\.addEventListener\('click', \(e\) => \{\s*e\.preventDefault\(\);\s*openLightbox\(result\.urls, Number\(a\.dataset\.idx\)\)/);
});

// Build a minimal sandbox exercising the real openLightbox/showNext
// logic exactly as extracted from the page, against a fake DOM.
function makeLightboxSandbox() {
  function makeEl() {
    const el = {
      style: {}, classList: { list: new Set(),
        add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); }, contains(c) { return this.list.has(c); } },
      _src: '', _alt: '', _text: '',
      set src(v) { this._src = v; }, get src() { return this._src; },
      set alt(v) { this._alt = v; }, get alt() { return this._alt; },
      set textContent(v) { this._text = v; }, get textContent() { return this._text; },
      addEventListener() {},
    };
    return el;
  }
  const els = {
    lightboxOverlay: makeEl(), lightboxImg: makeEl(), lightboxCaption: makeEl(),
    lightboxClose: makeEl(), lightboxPrev: makeEl(), lightboxNext: makeEl(),
  };
  const sandbox = {
    document: {
      getElementById: (id) => els[id],
      addEventListener() {},
      querySelectorAll: () => [],
    },
  };
  vm.createContext(sandbox);
  const openFn = extractFn(JOBS, 'openLightbox');
  const closeFn = extractFn(JOBS, 'closeLightbox');
  const nextFn = extractFn(JOBS, 'showNextLightboxPhoto');
  vm.runInContext(`
    const lightbox = document.getElementById('lightboxOverlay');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxCaption = document.getElementById('lightboxCaption');
    let lightboxUrls = [];
    let lightboxIndex = 0;
    ${openFn}
    ${closeFn}
    ${nextFn}
  `, sandbox);
  return { sandbox, els };
}

test('opening a photo sets the image, shows a real "Photo N of M" caption for multi-photo jobs, and shows nav controls', () => {
  const { sandbox, els } = makeLightboxSandbox();
  sandbox.openLightbox(['url-a', 'url-b', 'url-c'], 1);
  assert.equal(els.lightboxImg._src, 'url-b');
  assert.equal(els.lightboxCaption._text, 'Photo 2 of 3');
  assert.equal(els.lightboxPrev.style.display, '');
  assert.equal(els.lightboxNext.style.display, '');
  assert.ok(els.lightboxOverlay.classList.contains('is-visible'));
});

test('a single-photo job hides the caption and the prev/next controls instead of showing "Photo 1 of 1"', () => {
  const { sandbox, els } = makeLightboxSandbox();
  sandbox.openLightbox(['only-url'], 0);
  assert.equal(els.lightboxCaption._text, '');
  assert.equal(els.lightboxPrev.style.display, 'none');
  assert.equal(els.lightboxNext.style.display, 'none');
});

test('next/prev wrap around both ends of that job\'s own photo list', () => {
  const { sandbox, els } = makeLightboxSandbox();
  sandbox.openLightbox(['a', 'b', 'c'], 2);
  sandbox.showNextLightboxPhoto(1);
  assert.equal(els.lightboxImg._src, 'a', 'expected wrap-around from the last photo to the first');
  sandbox.showNextLightboxPhoto(-1);
  assert.equal(els.lightboxImg._src, 'c', 'expected wrap-around backwards from the first photo to the last');
});

test('closing the lightbox removes is-visible', () => {
  const { sandbox, els } = makeLightboxSandbox();
  sandbox.openLightbox(['a'], 0);
  sandbox.closeLightbox();
  assert.ok(!els.lightboxOverlay.classList.contains('is-visible'));
});

test('Escape and arrow keys are wired up, gated on the lightbox actually being open', () => {
  assert.match(JOBS, /if \(!lightbox\.classList\.contains\('is-visible'\)\) return;/);
  assert.match(JOBS, /if \(e\.key === 'Escape'\) closeLightbox\(\);/);
  assert.match(JOBS, /if \(e\.key === 'ArrowRight'\) showNextLightboxPhoto\(1\);/);
  assert.match(JOBS, /if \(e\.key === 'ArrowLeft'\) showNextLightboxPhoto\(-1\);/);
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 28, `expected v28 or later, got v${versionMatch[1]}`);
});
