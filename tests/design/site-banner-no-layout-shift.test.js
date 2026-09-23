// Site banners without a layout shift (2026-09-23). promo-banner.js and
// hiring-banner.js used to load with defer at the end of <body>, so they
// filled #siteBanner1/#siteBanner2 AFTER the first paint and pushed the
// header and hero down 85px on desktop (CLS 0.059 on every first visit).
// They now run synchronously, straight after the two empty divs and before
// <header>, so the banners are already full-size in the first frame that
// paints the header. These tests lock in that placement, the stamps the
// service worker needs to serve them from cache, the parse-time behaviour
// they depend on, the one-row banner CSS, and the Tools > Site Content
// override that must keep winning.

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

const PAGES = ['index.html'];
for (const dir of ['locations', 'services']) {
  for (const f of fs.readdirSync(repo(dir)).sort()) {
    if (f.endsWith('.html') && read(`${dir}/${f}`).includes('/js/promo-banner.js')) PAGES.push(`${dir}/${f}`);
  }
}

test('the banner pages are the 16 we expect (index + 7 city + 8 service pages)', () => {
  assert.equal(PAGES.length, 16, PAGES.join(', '));
});

for (const page of PAGES) {
  test(`${page}: both banner scripts run synchronously, right after the divs and before <header>, with fresh stamps`, () => {
    const html = read(page);
    const block =
      '<div id="siteBanner1" class="site-banner" style="display:none;"></div>\n' +
      '<div id="siteBanner2" class="site-banner" style="display:none;"></div>\n' +
      `<script src="/js/promo-banner.js?v=${hash('js/promo-banner.js')}"></script>\n` +
      `<script src="/js/hiring-banner.js?v=${hash('js/hiring-banner.js')}"></script>\n` +
      '\n<header>';
    assert.ok(html.includes(block), `${page} should have the two divs, then both stamped sync scripts, then <header>`);
    for (const name of ['promo-banner', 'hiring-banner']) {
      const tags = html.match(new RegExp(`<script[^>]*\\/js\\/${name}\\.js[^>]*>`, 'g'));
      assert.equal(tags.length, 1, `${page} should load ${name}.js exactly once`);
      assert.doesNotMatch(tags[0], /\b(defer|async)\b/, `${page}: ${name}.js must not be deferred -- that's what caused the shift`);
    }
  });
}

test('check-consistency tracks hiring-banner.js, so fix-versions keeps its stamp fresh', () => {
  const src = read('scripts/check-consistency.js');
  const list = src.match(/const GLOBAL_SHARED_FILES = \[([^\]]*)\]/)[1];
  assert.match(list, /'js\/hiring-banner\.js'/);
  assert.match(list, /'js\/promo-banner\.js'/);
});

// Rebuild the real top of <body> from plumbing-repairs.html with both
// banner scripts inlined where their <script src> tags sit, plus a probe
// script where <header> starts. The probe runs at parse time, exactly
// where the browser would run it, so it sees what the first frame with a
// header in it would show.
function parseTopOfBody(presetKeys) {
  const html = read('services/plumbing-repairs.html');
  const top = html.slice(html.indexOf('<body'), html.indexOf('<header>'))
    .replace(/<script src="\/js\/promo-banner\.js\?v=[a-f0-9]+"><\/script>/, () => `<script>${read('js/promo-banner.js')}</script>`)
    .replace(/<script src="\/js\/hiring-banner\.js\?v=[a-f0-9]+"><\/script>/, () => `<script>${read('js/hiring-banner.js')}</script>`);
  assert.ok(!/<script src="\/js\/(promo|hiring)-banner/.test(top), 'both banner scripts should have been inlined');
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

// The Tools > Site Content override: the page's own site_content fetch
// writes plain text into the banner div. It always arrives after the sync
// script now, so it always wins -- and it still shows for a visitor who
// dismissed the promo (unchanged behaviour).
async function loadWithSiteContent(rows, presetKeys) {
  let html = read('services/plumbing-repairs.html')
    .replace(/<script src="\/js\/promo-banner\.js\?v=[a-f0-9]+"><\/script>/, () => `<script>${read('js/promo-banner.js')}</script>`)
    .replace(/<script src="\/js\/hiring-banner\.js\?v=[a-f0-9]+"><\/script>/, () => `<script>${read('js/hiring-banner.js')}</script>`);
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

test('a Site Content banner1 replaces the promo, shows as plain text, and ignores a past dismissal', async () => {
  for (const preset of [[], ['th-promo-welcome15-dismissed']]) {
    const doc = await loadWithSiteContent([{ key: 'banner1', value: 'Closed Monday -- back Tuesday.' }], preset);
    const b1 = doc.getElementById('siteBanner1');
    assert.equal(b1.textContent, 'Closed Monday -- back Tuesday.', `preset=${preset}`);
    assert.equal(b1.style.display, 'block');
    assert.equal(b1.querySelector('.site-banner-inner'), null, 'plain text, so the one-row :has() padding no longer applies');
    assert.equal(doc.getElementById('siteBanner2').style.display, 'flex', 'the hiring banner is untouched');
  }
});

test('with no Site Content banners set, the scripted banners stay as they are', async () => {
  const doc = await loadWithSiteContent([], []);
  assert.match(doc.getElementById('siteBanner1').innerHTML, /WELCOME15/);
  assert.match(doc.getElementById('siteBanner2').innerHTML, /careers/);
});

function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp(`(?:^|[\\s}])${esc}\\{([^}]*)\\}`));
  assert.ok(m, `missing rule ${selector}`);
  return m[1];
}

test('one-row banner CSS: no wrapping, a 44x44 close button, and :has() padding that the Site Content text path skips', () => {
  assert.match(rule('.site-banner-inner'), /flex-wrap:nowrap;/);
  const close = rule('.site-banner-close');
  assert.match(close, /width:44px;/);
  assert.match(close, /height:44px;/);
  assert.match(close, /flex:0 0 44px;/);
  assert.match(rule('.site-banner:has(> .site-banner-inner)'), /padding:0 4px 0 20px;/);
  assert.match(rule('.site-banner'), /padding:10px 20px;/, 'the base padding stays for Site Content plain text');
  assert.match(CSS, /@media \(max-width:600px\)\{\s*\.site-banner\{padding:7px 14px;\}\s*\.site-banner:has\(> \.site-banner-inner\)\{padding:0 0 0 14px;\}/);
  assert.match(rule('.site-banner-close:focus-visible'), /outline-offset:-2px;/);
  assert.match(rule('.site-banner-keep'), /white-space:nowrap;/);
});
