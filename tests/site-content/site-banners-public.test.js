// js/site-banners.js on the public pages (2026-09-23): the two banners
// above the header, now set from Tools > Site Content.
//
// What must hold:
//   - The first frame shows what this browser saw last (no network in a
//     render-blocking script), so a returning visitor sees the current
//     banner with no jump. A first visit shows the built-in wording.
//   - When the page's own site_content fetch brings something different,
//     it's saved for the next page and applied now ONLY if that can't move
//     the page: nothing painted yet, or the banner keeps its exact height.
//     Otherwise the old banner stays exactly as it was (same nodes, its
//     close button still works).
//   - A failed fetch never changes anything.
//   - The owner's message is text, never HTML; a link can only be one of
//     the listed pages.
//   - A custom message is dismissed by its own text, so a new message
//     shows again; the built-in banners keep their original keys.
//   - Every page with the two banner slots loads the script right after
//     them and hands it its site_content rows.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (p) => fs.readFileSync(repo(p), 'utf8');
const BANNERS_JS = read('js/site-banners.js');
const STORE_KEY = 'th-site-banners';

// A page with just the two slots. `layout` fakes what jsdom doesn't have:
// whether anything has been painted, and each banner's rendered height
// (0 when hidden, else 45px, or 90px for text longer than 120
// characters -- enough to tell "same height" from "taller"; both built-in
// banners are under 120).
function page({ url = 'https://www.triplehenterprisesllc.biz/services/plumbing-repairs.html', store = null, preset = {}, painted = false } = {}) {
  const dom = new JSDOM(
    '<!DOCTYPE html><body>' +
    '<div id="siteBanner1" class="site-banner" style="display:none;"></div>' +
    '<div id="siteBanner2" class="site-banner" style="display:none;"></div>' +
    '<header></header></body>',
    { runScripts: 'outside-only', url }
  );
  const w = dom.window;
  const layout = { painted };
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.style.display === 'none' || !this.firstChild) return 0;
      return this.textContent.length > 120 ? 90 : 45;
    },
  });
  w.performance.getEntriesByType = (type) => (type === 'paint' && layout.painted ? [{ name: 'first-contentful-paint' }] : []);
  if (store) w.localStorage.setItem(STORE_KEY, typeof store === 'string' ? store : JSON.stringify(store));
  for (const [k, v] of Object.entries(preset)) w.localStorage.setItem(k, v);
  w.eval(BANNERS_JS);
  return { w, layout, b1: w.document.getElementById('siteBanner1'), b2: w.document.getElementById('siteBanner2') };
}
const shown = (el) => el.style.display === 'flex';
const text = (el) => (el.querySelector('.site-banner-text') || { textContent: '' }).textContent;
const rowsOf = (obj) => Object.entries(obj).map(([key, value]) => ({ key, value }));

// ---------------------------------------------------------------------------
// The first frame
// ---------------------------------------------------------------------------

test('first visit (nothing saved): both built-in banners show', () => {
  const { b1, b2 } = page();
  assert.ok(shown(b1) && shown(b2));
  assert.match(text(b1), /WELCOME15/);
  assert.match(text(b2), /We're hiring/);
});

test('returning visitor: the first frame already shows the saved custom message, with its link', () => {
  const { b1, b2 } = page({ store: { banner1Mode: 'custom', banner1: 'Closed Thanksgiving Day -- back Friday.', banner1Link: '/booking.html', banner2Mode: 'off' } });
  assert.ok(shown(b1));
  assert.equal(text(b1), 'Closed Thanksgiving Day -- back Friday. Book online →');
  assert.equal(b1.querySelector('a').getAttribute('href'), '/booking.html');
  assert.ok(b1.querySelector('.site-banner-inner > .site-banner-close'), 'same one-row layout and close button as the built-in banners');
  assert.equal(b1.querySelector('.site-banner-close').getAttribute('aria-label'), 'Dismiss this notice');
  assert.ok(!shown(b2), 'off means nothing at all');
  assert.equal(b2.innerHTML, '');
});

test('a message saved before modes existed still replaces the built-in banner (that is what it did before)', () => {
  const { b1, b2 } = page({ store: { banner1: 'Closed Monday.' } });
  assert.equal(text(b1), 'Closed Monday.');
  assert.match(text(b2), /We're hiring/);
});

test('custom with no message falls back to the built-in wording, never an empty bar', () => {
  const { b1 } = page({ store: { banner1Mode: 'custom' } });
  assert.match(text(b1), /WELCOME15/);
});

test('a broken or tampered saved copy is ignored safely', () => {
  for (const store of ['{not json', '[1,2]', '"x"', 'null']) {
    const { b1, b2 } = page({ store });
    assert.match(text(b1), /WELCOME15/, store);
    assert.match(text(b2), /We're hiring/, store);
  }
  const { b1, b2, w } = page({ store: { banner1Mode: 'custom', banner1: '<img src=x onerror="window.pwned=1">', banner1Link: 'javascript:alert(1)', banner2Mode: 'sideways' } });
  assert.equal(text(b1), '<img src=x onerror="window.pwned=1">', 'shown as text');
  assert.equal(b1.querySelector('img'), null);
  assert.equal(b1.querySelector('a'), null, 'a link that is not on the list is dropped');
  assert.equal(w.pwned, undefined);
  assert.match(text(b2), /We're hiring/, 'an unknown mode falls back to the built-in wording');
  for (const bad of ['  padded  ', 'two\nlines', 'x'.repeat(201)]) {
    const r = page({ store: { banner1Mode: 'custom', banner1: bad } });
    assert.match(text(r.b1), /WELCOME15/, JSON.stringify(bad).slice(0, 20));
  }
});

// ---------------------------------------------------------------------------
// The page's fetch: save for next time, apply now only if nothing moves
// ---------------------------------------------------------------------------

test('the rows are saved for the next page -- only the six banner keys, only real values', () => {
  const { w } = page();
  w.applySiteBanners([
    { key: 'banner1Mode', value: 'custom' }, { key: 'banner1', value: 'Hello' }, { key: 'banner1Link', value: null },
    { key: 'banner2Mode', value: 'off' }, { key: 'phone', value: '(435) 414-1667' }, { key: 'googleRating', value: '5.0' },
  ]);
  assert.deepEqual(JSON.parse(w.localStorage.getItem(STORE_KEY)), { banner1Mode: 'custom', banner1: 'Hello', banner2Mode: 'off' });
});

test('a failed or empty fetch changes nothing -- not the banners, not the saved copy', () => {
  const store = { banner1Mode: 'custom', banner1: 'Saved message' };
  for (const rows of [[], null, undefined, 'x', {}]) {
    const { w, b1 } = page({ store, painted: true });
    const before = b1.innerHTML;
    w.applySiteBanners(rows === undefined ? [] : rows);
    assert.equal(b1.innerHTML, before);
    assert.deepEqual(JSON.parse(w.localStorage.getItem(STORE_KEY)), store);
  }
});

test('nothing painted yet: any change applies right away (it cannot move what was never drawn)', () => {
  const { w, b1, b2 } = page({ painted: false });
  w.applySiteBanners(rowsOf({ banner1Mode: 'custom', banner1: 'A much longer custom message that will certainly wrap onto a second line on a phone screen, and on a narrow laptop screen too, so it is taller', banner2Mode: 'off' }));
  assert.match(text(b1), /much longer custom message/);
  assert.ok(!shown(b2));
});

test('after the first paint, a change that keeps the banner the same height applies right away', () => {
  const { w, b1 } = page({ painted: true });
  assert.match(text(b1), /WELCOME15/);
  w.applySiteBanners(rowsOf({ banner1Mode: 'custom', banner1: 'Closed Monday -- back Tuesday.' }));
  assert.equal(text(b1), 'Closed Monday -- back Tuesday.');
});

test('after the first paint, a change that would move the page waits for the next page -- the old banner stays exactly as it was', () => {
  const { w, b1, b2 } = page({ painted: true });
  const oldInner1 = b1.firstChild;
  const oldHtml2 = b2.innerHTML;
  // Hiding the hiring banner, and a message tall enough to change height.
  const rows = rowsOf({ banner1Mode: 'custom', banner1: 'A much longer custom message that will certainly wrap onto a second line on a phone screen, and on a narrow laptop screen too, so it is taller', banner2Mode: 'off' });
  w.applySiteBanners(rows);
  assert.equal(b1.firstChild, oldInner1, 'the very same nodes, not a copy');
  assert.match(text(b1), /WELCOME15/);
  assert.ok(shown(b2));
  assert.equal(b2.innerHTML, oldHtml2);
  // The old close button still works.
  b2.querySelector('.site-banner-close').click();
  assert.ok(!shown(b2));
  assert.equal(w.localStorage.getItem('th-hiring-banner-dismissed'), '1');

  // The next page this visitor opens shows the new settings from the first frame.
  const next = page({ painted: false, store: w.localStorage.getItem(STORE_KEY) });
  assert.match(text(next.b1), /much longer custom message/);
  assert.ok(!shown(next.b2));
});

test('a banner appearing where there was none also waits for the next page once something is painted', () => {
  const { w, b2 } = page({ painted: true, store: { banner2Mode: 'off' } });
  assert.ok(!shown(b2));
  w.applySiteBanners(rowsOf({ banner2Mode: 'builtin' }));
  assert.ok(!shown(b2));
  const next = page({ store: w.localStorage.getItem(STORE_KEY) });
  assert.ok(shown(next.b2));
});

test('the same settings as already shown do nothing (no re-render, the nodes stay)', () => {
  const { w, b1 } = page({ painted: true, store: { banner1Mode: 'custom', banner1: 'Same' } });
  const node = b1.firstChild;
  w.applySiteBanners(rowsOf({ banner1Mode: 'custom', banner1: 'Same', banner2Mode: 'builtin' }));
  assert.equal(b1.firstChild, node);
});

// ---------------------------------------------------------------------------
// Dismissing
// ---------------------------------------------------------------------------

test('closing a custom message hides that message on later pages, but a new message shows again', () => {
  const store = { banner1Mode: 'custom', banner1: 'Closed Monday.' };
  const first = page({ store });
  first.b1.querySelector('.site-banner-close').click();
  assert.ok(!shown(first.b1));
  const saved = {};
  // Everything this visitor's browser remembers except the saved settings,
  // which each page below sets for itself.
  for (let i = 0; i < first.w.localStorage.length; i++) {
    const k = first.w.localStorage.key(i);
    if (k !== STORE_KEY) saved[k] = first.w.localStorage.getItem(k);
  }
  assert.equal(saved['th-promo-welcome15-dismissed'], undefined, 'closing a custom message is not closing the WELCOME15 offer');

  const again = page({ store, preset: saved });
  assert.ok(!shown(again.b1), 'the same message stays closed');

  const changed = page({ store: { banner1Mode: 'custom', banner1: 'Closed Tuesday.' }, preset: saved });
  assert.equal(text(changed.b1), 'Closed Tuesday.', 'a new message shows even to someone who closed the old one');

  const builtin = page({ store: { banner1Mode: 'builtin' }, preset: saved });
  assert.match(text(builtin.b1), /WELCOME15/, 'switching back to the built-in offer shows it to someone who never closed it');
});

test('someone who closed the WELCOME15 offer still sees a custom message in that spot', () => {
  const { b1 } = page({ store: { banner1Mode: 'custom', banner1: 'New: 20% off gutter cleaning.' }, preset: { 'th-promo-welcome15-dismissed': '1' } });
  assert.equal(text(b1), 'New: 20% off gutter cleaning.');
});

test('a banner linking to the page you are on is not shown there', () => {
  const { b1 } = page({ url: 'https://www.triplehenterprisesllc.biz/our-work.html', store: { banner1Mode: 'custom', banner1: 'See the latest', banner1Link: '/our-work.html' } });
  assert.ok(!shown(b1));
  const elsewhere = page({ url: 'https://www.triplehenterprisesllc.biz/about.html', store: { banner1Mode: 'custom', banner1: 'See the latest', banner1Link: '/our-work.html' } });
  assert.ok(shown(elsewhere.b1));
});

// ---------------------------------------------------------------------------
// Wiring on every page
// ---------------------------------------------------------------------------

const PAGES = [];
for (const dir of ['', 'blog', 'locations', 'services']) {
  for (const f of fs.readdirSync(repo(dir)).sort()) {
    const p = dir ? `${dir}/${f}` : f;
    if (f.endsWith('.html') && read(p).includes('id="siteBanner1"')) PAGES.push(p);
  }
}

test('33 public pages have the banner slots', () => {
  assert.equal(PAGES.length, 33);
});

for (const p of PAGES) {
  test(`${p}: hands its site_content rows to applySiteBanners() and no longer writes banner text itself`, () => {
    const html = read(p);
    assert.match(html,
      /\(Array\.isArray\(rows\) \? rows : \[\]\)\.forEach\(r => \{ if \(r\.value\) map\[r\.key\] = r\.value; \}\);\n\s*if \(typeof applySiteBanners === 'function'\) applySiteBanners\(rows\);\n/);
    assert.doesNotMatch(html, /\['banner1', 'banner2'\]/);
    assert.doesNotMatch(html, /getElementById\('siteBanner/);
  });
}

// The real page, end to end: services/plumbing-repairs.html with the
// script inlined where its tag sits and site_content answered by a fake
// fetch. First visit with the hiring banner turned off: it stays for this
// page (it was painted), and the next page never shows it.
test('end to end on a real page: a first visit keeps what it painted, the next page follows Site Content from its first frame', async () => {
  const html = read('services/plumbing-repairs.html')
    .replace(/<script src="\/js\/site-banners\.js\?v=[a-f0-9]+"><\/script>/, () => `<script>${BANNERS_JS}</script>`);
  const rows = rowsOf({ banner1Mode: 'builtin', banner2Mode: 'off', banner1: null, banner2: null, banner1Link: null, banner2Link: null, phone: null });
  async function load(store) {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'https://www.triplehenterprisesllc.biz/services/plumbing-repairs.html',
      beforeParse(w) {
        if (store) w.localStorage.setItem(STORE_KEY, store);
        Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', {
          configurable: true,
          get() { return this.style.display === 'none' || !this.firstChild ? 0 : 45; },
        });
        w.performance.getEntriesByType = () => [{ name: 'first-contentful-paint' }];
        w.fetch = (url) => Promise.resolve(/site_content/.test(url)
          ? { ok: true, json: () => Promise.resolve(rows) }
          : { ok: false, json: () => Promise.resolve([]) });
      },
    });
    const w = dom.window;
    const atParse = w.document.getElementById('siteBanner2').style.display;
    await new Promise((r) => setTimeout(r, 30));
    return { w, atParse, b2: w.document.getElementById('siteBanner2') };
  }
  const first = await load(null);
  assert.equal(first.atParse, 'flex');
  assert.equal(first.b2.style.display, 'flex', 'already painted, so it stays for this page');
  const saved = first.w.localStorage.getItem(STORE_KEY);
  assert.deepEqual(JSON.parse(saved), { banner1Mode: 'builtin', banner2Mode: 'off' });

  const second = await load(saved);
  assert.equal(second.atParse, 'none', 'the next page never draws it at all');
  assert.equal(second.b2.style.display, 'none');
});
