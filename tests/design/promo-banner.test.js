// Tests for the first-time-visitor discount banner (promo-banner.js),
// which populates the #siteBanner1 scaffold every public page already
// declared in its markup from the start but that no script ever wrote
// into or styled until now, and for the lead-form "speed to lead" note
// on index.html's contact form.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const PROMO_JS = fs.readFileSync(repo('promo-banner.js'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const PAGES_WITH_BANNER = [
  'index.html',
  'assembly-installation.html',
  'drywall-painting.html',
  'plumbing-repairs.html',
  'washer-dryer-repair.html',
  'handyman-repairs.html',
  'handyman-washington-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-leeds-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-cedar-city-ut.html',
  'handyman-mesquite-nv.html',
];

for (const page of PAGES_WITH_BANNER) {
  test(`${page} loads promo-banner.js`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    assert.match(html, /<script src="\/promo-banner\.js\?v=[a-f0-9]+" defer><\/script>/);
    assert.match(html, /<div id="siteBanner1" class="site-banner" style="display:none;"><\/div>/);
  });
}

test('.site-banner has real CSS now (was declared on every page but never styled or written into)', () => {
  assert.match(STYLES, /\.site-banner\{/);
  assert.match(STYLES, /\.site-banner-inner\{/);
  assert.match(STYLES, /\.site-banner-close\{/);
});

test('promo-banner.js writes the 15% first-time-customer offer into #siteBanner1 and shows it', () => {
  assert.match(PROMO_JS, /getElementById\('siteBanner1'\)/);
  assert.match(PROMO_JS, /WELCOME15/);
  assert.match(PROMO_JS, /15% off/);
  assert.match(PROMO_JS, /banner\.style\.display\s*=\s*'flex'/);
});

test('dismissing the banner persists to localStorage so it does not reappear on the next page', () => {
  assert.match(PROMO_JS, /site-banner-close/);
  assert.match(PROMO_JS, /localStorage\.setItem\(DISMISS_KEY, '1'\)/);
});

test('a real run: with no prior dismissal, the banner is populated and shown; once dismissed, it is not shown again', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><div id="siteBanner1" class="site-banner" style="display:none;"></div></body>',
    { runScripts: 'outside-only', url: 'https://example.com/' }
  );
  const { window } = dom;
  window.eval(PROMO_JS);

  const banner = window.document.getElementById('siteBanner1');
  assert.equal(banner.style.display, 'flex');
  assert.match(banner.innerHTML, /WELCOME15/);

  const closeBtn = banner.querySelector('.site-banner-close');
  assert.ok(closeBtn, 'expected a dismiss button');
  closeBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(banner.style.display, 'none');
  assert.equal(window.localStorage.getItem('th-promo-welcome15-dismissed'), '1');
});

test('a second run with the dismissal already recorded does not repopulate or reshow the banner', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><div id="siteBanner1" class="site-banner" style="display:none;"></div></body>',
    { runScripts: 'outside-only', url: 'https://example.com/' }
  );
  const { window } = dom;
  window.localStorage.setItem('th-promo-welcome15-dismissed', '1');
  window.eval(PROMO_JS);

  const banner = window.document.getElementById('siteBanner1');
  assert.equal(banner.style.display, 'none');
  assert.equal(banner.innerHTML, '');
});

test("index.html's lead form tells visitors roughly when to expect a reply (speed-to-lead)", () => {
  const html = fs.readFileSync(repo('index.html'), 'utf8');
  assert.match(html, /We'll follow up by phone or email to confirm, usually within a few hours\./);
});

test('scripts/check-consistency.js tracks promo-banner.js as a global shared file (cache-bust freshness across root/tools/portal/blog)', () => {
  const script = fs.readFileSync(repo('scripts/check-consistency.js'), 'utf8');
  assert.match(script, /GLOBAL_SHARED_FILES\s*=\s*\[[^\]]*'promo-banner\.js'/);
});
