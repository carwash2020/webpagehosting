// Tests for the "we're hiring" banner (hiring-banner.js until 2026-09-23,
// now the second slot of js/site-banners.js), which populates the
// #siteBanner2 scaffold every public page already declared in its markup
// (alongside #siteBanner1, from the start). Same dismissible pattern as
// the WELCOME15 banner in #siteBanner1, kept fully independent (own key,
// own element) so dismissing one doesn't dismiss the other.
//
// With nothing set in Tools > Site Content it must behave exactly as
// hiring-banner.js did, which is what this file checks. The editable side
// is covered in tests/site-content/site-banners-public.test.js.

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
  test(`${page} loads site-banners.js and has the #siteBanner2 slot`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    // Synchronous and stamped -- see site-banner-no-layout-shift.test.js.
    assert.match(html, /<script src="\/js\/site-banners\.js\?v=[a-f0-9]{10}"><\/script>/);
    assert.match(html, /<div id="siteBanner2" class="site-banner" style="display:none;"><\/div>/);
  });
}

test('.site-banner-text a has real CSS now (the hiring banner is the first one to link somewhere)', () => {
  assert.match(STYLES, /\.site-banner-text a\{/);
});

test('site-banners.js carries the careers pitch as the second banner\'s built-in wording, linking to /careers.html', () => {
  assert.match(BANNERS_JS, /href="\/careers\.html"/);
  assert.match(BANNERS_JS, /We\\'re hiring/);
  assert.match(BANNERS_JS, /dismissKey: 'th-hiring-banner-dismissed'/);
});

function run(presetKeys, url) {
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div id="siteBanner1" class="site-banner" style="display:none;"></div>
      <div id="siteBanner2" class="site-banner" style="display:none;"></div>
    </body>`,
    { runScripts: 'outside-only', url: url || 'https://example.com/' }
  );
  for (const k of presetKeys) dom.window.localStorage.setItem(k, '1');
  dom.window.eval(BANNERS_JS);
  return dom.window;
}

test('a real run: with no prior dismissal, the hiring banner is populated and shown; once dismissed, it is not shown again', () => {
  const window = run([]);
  const banner = window.document.getElementById('siteBanner2');
  assert.equal(banner.style.display, 'flex');
  assert.match(banner.innerHTML, /careers\.html/);
  // The exact markup hiring-banner.js wrote, so nothing looks different.
  assert.equal(banner.innerHTML,
    '<div class="site-banner-inner"><p class="site-banner-text"><strong>We\'re hiring.</strong> Part-time handyman helper, flexible hours, <span class="site-banner-keep">$35–$100+</span> per job. ' +
    '<a href="/careers.html">See the posting &amp; apply →</a></p>' +
    '<button type="button" class="site-banner-close" aria-label="Dismiss this notice">×</button></div>');

  const closeBtn = banner.querySelector('.site-banner-close');
  assert.ok(closeBtn, 'expected a dismiss button');
  closeBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(banner.style.display, 'none');
  assert.equal(window.localStorage.getItem('th-hiring-banner-dismissed'), '1');
});

test('a second run with the dismissal already recorded does not repopulate or reshow the banner', () => {
  const window = run(['th-hiring-banner-dismissed']);
  const banner = window.document.getElementById('siteBanner2');
  assert.equal(banner.style.display, 'none');
  assert.equal(banner.innerHTML, '');
});

test('dismissing the WELCOME15 banner does not also dismiss the hiring banner (separate keys, separate elements)', () => {
  const window = run(['th-promo-welcome15-dismissed']);
  assert.equal(window.document.getElementById('siteBanner1').style.display, 'none');
  assert.equal(window.document.getElementById('siteBanner2').style.display, 'flex');
});

test('the hiring banner does not show on the Careers page it links to', () => {
  for (const url of ['https://example.com/careers.html', 'https://example.com/careers']) {
    const window = run([], url);
    assert.equal(window.document.getElementById('siteBanner2').style.display, 'none', url);
    assert.equal(window.document.getElementById('siteBanner1').style.display, 'flex', url);
  }
});
