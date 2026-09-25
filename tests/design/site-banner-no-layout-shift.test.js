// Site banners without a layout shift (2026-09-23). promo-banner.js and
// hiring-banner.js used to load with defer at the end of <body>, so they
// filled #siteBanner1/#siteBanner2 AFTER the first paint and pushed the
// header and hero down 85px on desktop (CLS 0.059 on every first visit).
// They then ran synchronously, straight after the two empty divs and
// before <header>, so the banners are already full-size in the first
// frame that paints the header. Later the same day both became one file,
// js/site-banners.js (so Tools > Site Content can change or turn off
// either banner), on every page that has the two divs. These tests lock
// in that placement, the stamp the service worker needs to serve it from
// cache, the parse-time behaviour it depends on, the one-row banner CSS,
// and the Tools > Site Content settings arriving from the page's fetch.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (p) => fs.readFileSync(repo(p), 'utf8');
const hash = (p) => crypto.createHash('sha256').update(read(p)).digest('hex').slice(0, 10);
// Comments stripped: the CSS explains the old values in prose.
const CSS = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

// Every public page that has the two banner divs.
const PAGES = [];
for (const dir of ['', 'blog', 'locations', 'services']) {
  for (const f of fs.readdirSync(repo(dir)).sort()) {
    const page = dir ? `${dir}/${f}` : f;
    if (f.endsWith('.html') && read(page).includes('id="siteBanner1"')) PAGES.push(page);
  }
}

test('the banner pages are the 39 we expect (index, about, our-work, careers, terms, privacy + 17 blog + 8 city + 8 service pages)', () => {
  assert.equal(PAGES.length, 39, PAGES.join(', '));
  for (const p of ['index.html', 'about.html', 'our-work.html', 'careers.html', 'terms.html', 'privacy.html', 'blog/index.html', 'locations/handyman-st-george-ut.html']) {
    assert.ok(PAGES.includes(p), p);
  }
});

for (const page of PAGES) {
  test(`${page}: site-banners.js runs synchronously, right after the divs and before <header>, with a fresh stamp`, () => {
    const html = read(page);
    const block =
      '<div id="siteBanner1" class="site-banner" style="display:none;"></div>\n' +
      '<div id="siteBanner2" class="site-banner" style="display:none;"></div>\n' +
      `<script src="/js/site-banners.js?v=${hash('js/site-banners.js')}"></script>\n` +
      '\n<header>';
    assert.ok(html.includes(block), `${page} should have the two divs, then the stamped sync script, then <header>`);
    const tags = html.match(/<script[^>]*\/js\/site-banners\.js[^>]*>/g);
    assert.equal(tags.length, 1, `${page} should load site-banners.js exactly once`);
    assert.doesNotMatch(tags[0], /\b(defer|async)\b/, `${page}: site-banners.js must not be deferred -- that's what caused the shift`);
    assert.doesNotMatch(html, /\/js\/(promo|hiring)-banner\.js/, `${page} still loads a removed banner script`);
  });
}

test('check-consistency tracks site-banners.js, so fix-versions keeps its stamp fresh', () => {
  const src = read('scripts/check-consistency.js');
  const list = src.match(/const GLOBAL_SHARED_FILES = \[([^\]]*)\]/)[1];
  assert.match(list, /'js\/site-banners\.js'/);
  assert.doesNotMatch(list, /(promo|hiring)-banner/);
});

// Rebuild the real top of <body> from plumbing-repairs.html with the
// banner script inlined where its <script src> tag sits, plus a probe
// script where <header> starts. The probe runs at parse time, exactly
// where the browser would run it, so it sees what the first frame with a
// header in it would show.
function parseTopOfBody(presetKeys) {
  const html = read('services/plumbing-repairs.html');
  const top = html.slice(html.indexOf('<body'), html.indexOf('<header>'))
    .replace(/<script src="\/js\/site-banners\.js\?v=[a-f0-9]+"><\/script>/, () => `<script>${read('js/site-banners.js')}</script>`);
  assert.ok(!/<script src="\/js\/site-banners/.test(top), 'the banner script should have been inlined');
  const probe = `<script>
    window.__probe = ['siteBanner1', 'siteBanner2'].map(function (id) {
      var el = document.getElementById(id);
      return { display: el.style.display, html: el.innerHTML, headerExists: !!document.querySelector('header') };
    });
  </script>`;
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head>${top}${probe}<header></header></body></html>`, {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/services/plumbing-repairs.html',
    beforeParse(window) { for (const k of presetKeys) window.localStorage.setItem(k, '1'); },
  });
  return dom.window.__probe;
}

test('first visit: both banners are filled and visible before <header> is even parsed', () => {
  const [promo, hiring] = parseTopOfBody([]);
  for (const b of [promo, hiring]) {
    assert.equal(b.headerExists, false);
    assert.equal(b.display, 'flex');
    assert.match(b.html, /site-banner-close/);
  }
  assert.match(promo.html, /WELCOME15/);
  assert.match(hiring.html, /\/careers\.html/);
});

test('returning visitor who dismissed both: the divs never leave display:none, so nothing flashes', () => {
  const probe = parseTopOfBody(['th-promo-welcome15-dismissed', 'th-hiring-banner-dismissed']);
  for (const b of probe) {
    assert.equal(b.display, 'none');
    assert.equal(b.html, '');
  }
});

test('dismissing one banner leaves the other showing', () => {
  const [promo, hiring] = parseTopOfBody(['th-promo-welcome15-dismissed']);
  assert.equal(promo.display, 'none');
  assert.equal(hiring.display, 'flex');
});

// The Tools > Site Content settings: the page's own site_content fetch
// hands its rows to applySiteBanners(). jsdom has no layout (every height
// is 0), so a change always applies here; the "would it move the page"
// check is covered in tests/site-content/site-banners-public.test.js.
async function loadWithSiteContent(rows, presetKeys) {
  let html = read('services/plumbing-repairs.html')
    .replace(/<script src="\/js\/site-banners\.js\?v=[a-f0-9]+"><\/script>/, () => `<script>${read('js/site-banners.js')}</script>`);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/services/plumbing-repairs.html',
    beforeParse(window) {
      for (const k of presetKeys) window.localStorage.setItem(k, '1');
      window.fetch = (url) => Promise.resolve(/site_content/.test(url)
        ? { ok: true, json: () => Promise.resolve(rows) }
        : { ok: false, json: () => Promise.resolve([]) });
    },
  });
  await new Promise((r) => setTimeout(r, 20));
  return dom.window.document;
}

test('a Site Content banner1 message replaces the promo, in the same one-row banner with a close button, and ignores a past dismissal of the promo', async () => {
  const cases = [
    [{ key: 'banner1', value: 'Closed Monday -- back Tuesday.' }], // saved before modes existed
    [{ key: 'banner1Mode', value: 'custom' }, { key: 'banner1', value: 'Closed Monday -- back Tuesday.' }, { key: 'banner2Mode', value: 'builtin' }],
  ];
  for (const rows of cases) {
    for (const preset of [[], ['th-promo-welcome15-dismissed']]) {
      const doc = await loadWithSiteContent(rows, preset);
      const b1 = doc.getElementById('siteBanner1');
      assert.equal(b1.querySelector('.site-banner-text').textContent, 'Closed Monday -- back Tuesday.', `preset=${preset}`);
      assert.equal(b1.style.display, 'flex');
      assert.ok(b1.querySelector('.site-banner-inner > .site-banner-close'), 'same banner layout as the built-in ones');
      assert.equal(doc.getElementById('siteBanner2').style.display, 'flex', 'the hiring banner is untouched');
    }
  }
});

test('banner2Mode off removes the hiring banner; the promo stays', async () => {
  const doc = await loadWithSiteContent([{ key: 'banner2Mode', value: 'off' }, { key: 'banner1Mode', value: 'builtin' }], []);
  assert.equal(doc.getElementById('siteBanner2').style.display, 'none');
  assert.match(doc.getElementById('siteBanner1').innerHTML, /WELCOME15/);
});

test('with no Site Content banners set (or a failed fetch), the built-in banners stay as they are', async () => {
  for (const rows of [[], [{ key: 'phone', value: '(435) 414-1667' }], [{ key: 'banner1Mode', value: 'builtin' }, { key: 'banner2Mode', value: 'builtin' }]]) {
    const doc = await loadWithSiteContent(rows, []);
    assert.match(doc.getElementById('siteBanner1').innerHTML, /WELCOME15/);
    assert.match(doc.getElementById('siteBanner2').innerHTML, /careers/);
  }
});

function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp(`(?:^|[\\s}])${esc}\\{([^}]*)\\}`));
  assert.ok(m, `missing rule ${selector}`);
  return m[1];
}

test('one-row banner CSS: no wrapping, a 44x44 close button, and :has() padding for the banner row', () => {
  assert.match(rule('.site-banner-inner'), /flex-wrap:nowrap;/);
  const close = rule('.site-banner-close');
  assert.match(close, /width:44px;/);
  assert.match(close, /height:44px;/);
  assert.match(close, /flex:0 0 44px;/);
  assert.match(rule('.site-banner:has(> .site-banner-inner)'), /padding:0 4px 0 20px;/);
  assert.match(rule('.site-banner'), /padding:10px 20px;/, 'the base padding is unchanged');
  assert.match(CSS, /@media \(max-width:600px\)\{\s*\.site-banner\{padding:7px 14px;\}\s*\.site-banner:has\(> \.site-banner-inner\)\{padding:0 0 0 14px;\}/);
  assert.match(rule('.site-banner-close:focus-visible'), /outline-offset:-2px;/);
  assert.match(rule('.site-banner-keep'), /white-space:nowrap;/);
});
