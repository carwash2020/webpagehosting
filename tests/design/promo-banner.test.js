// Tests for the first-time-visitor discount banner, which populates the
// #siteBanner1 scaffold every public page already declared in its markup
// from the start but that no script ever wrote into or styled until
// promo-banner.js (2026-09-15), and for the lead-form "speed to lead"
// note on index.html's contact form.
//
// Since 2026-09-23 the banner comes from js/site-banners.js, which owns
// both banner slots and lets Tools > Site Content swap the wording or turn
// it off. With nothing set there it must behave exactly as promo-banner.js
// did -- same wording, same markup, same dismissal key -- which is what
// this file checks. The editable side is covered in
// tests/site-content/site-banners-public.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const BANNERS_JS = fs.readFileSync(repo('js/site-banners.js'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const PAGES_WITH_BANNER = [
  'index.html',
  'services/assembly-installation.html',
  'services/drywall-painting.html',
  'services/plumbing-repairs.html',
  'services/washer-dryer-repair.html',
  'services/washer-dryer-repair-st-george-ut.html',
  'services/refrigerator-repair-st-george-ut.html',
  'services/dishwasher-repair-st-george-ut.html',
  'services/handyman-repairs.html',
  'locations/handyman-washington-city-ut.html',
  'locations/handyman-hurricane-ut.html',
  'locations/handyman-santa-clara-ivins-ut.html',
  'locations/handyman-leeds-ut.html',
  'locations/handyman-la-verkin-ut.html',
  'locations/handyman-cedar-city-ut.html',
  'locations/handyman-mesquite-nv.html',
];

for (const page of PAGES_WITH_BANNER) {
  test(`${page} loads site-banners.js`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    // Synchronous (no defer) -- see site-banner-no-layout-shift.test.js.
    assert.match(html, /<script src="\/js\/site-banners\.js\?v=[a-f0-9]{10}"><\/script>/);
    assert.match(html, /<div id="siteBanner1" class="site-banner" style="display:none;"><\/div>/);
  });
}

test('.site-banner has real CSS now (was declared on every page but never styled or written into)', () => {
  assert.match(STYLES, /\.site-banner\{/);
  assert.match(STYLES, /\.site-banner-inner\{/);
  assert.match(STYLES, /\.site-banner-close\{/);
});

test('site-banners.js carries the 15% first-time-customer offer as the top banner\'s built-in wording', () => {
  assert.match(BANNERS_JS, /WELCOME15/);
  assert.match(BANNERS_JS, /15% off/);
  assert.match(BANNERS_JS, /dismissKey: 'th-promo-welcome15-dismissed'/);
});

function run(presetKeys) {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><div id="siteBanner1" class="site-banner" style="display:none;"></div></body>',
    { runScripts: 'outside-only', url: 'https://example.com/' }
  );
  for (const k of presetKeys) dom.window.localStorage.setItem(k, '1');
  dom.window.eval(BANNERS_JS);
  return dom.window;
}

test('a real run: with no prior dismissal, the banner is populated and shown; once dismissed, it is not shown again', () => {
  const window = run([]);
  const banner = window.document.getElementById('siteBanner1');
  assert.equal(banner.style.display, 'flex');
  assert.match(banner.innerHTML, /WELCOME15/);
  // The exact markup promo-banner.js wrote, so nothing looks different.
  assert.equal(banner.innerHTML,
    '<div class="site-banner-inner"><p class="site-banner-text"><strong>New customer?</strong> Mention code <b>WELCOME15</b> when you book and get 15% off your first service call.</p>' +
    '<button type="button" class="site-banner-close" aria-label="Dismiss this offer">×</button></div>');

  const closeBtn = banner.querySelector('.site-banner-close');
  assert.ok(closeBtn, 'expected a dismiss button');
  closeBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(banner.style.display, 'none');
  assert.equal(window.localStorage.getItem('th-promo-welcome15-dismissed'), '1');
});

test('a second run with the dismissal already recorded does not repopulate or reshow the banner', () => {
  const window = run(['th-promo-welcome15-dismissed']);
  const banner = window.document.getElementById('siteBanner1');
  assert.equal(banner.style.display, 'none');
  assert.equal(banner.innerHTML, '');
});

test("index.html's lead form tells visitors roughly when to expect a reply (speed-to-lead)", () => {
  const html = fs.readFileSync(repo('index.html'), 'utf8');
  assert.match(html, /We'll follow up by phone or email to confirm, usually within a few hours\./);
});

test('scripts/check-consistency.js tracks site-banners.js as a global shared file (cache-bust freshness across root/tools/portal/blog)', () => {
  const script = fs.readFileSync(repo('scripts/check-consistency.js'), 'utf8');
  assert.match(script, /GLOBAL_SHARED_FILES\s*=\s*\[[^\]]*'js\/site-banners\.js'/);
});
