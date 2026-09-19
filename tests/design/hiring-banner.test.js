// Tests for the "we're hiring" banner (hiring-banner.js), which
// populates the #siteBanner2 scaffold every public page already
// declared in its markup (alongside #siteBanner1, from the start) but
// that no script ever wrote into or styled until now. Same dismissible
// pattern as promo-banner.js's WELCOME15 banner in #siteBanner1, on the
// same set of pages, kept fully independent (own key, own element) so
// dismissing one doesn't dismiss the other.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HIRING_JS = fs.readFileSync(repo('js/hiring-banner.js'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const PAGES_WITH_BANNER = [
  'index.html',
  'assembly-installation.html',
  'drywall-painting.html',
  'plumbing-repairs.html',
  'washer-dryer-repair.html',
  'washer-dryer-repair-st-george-ut.html',
  'refrigerator-repair-st-george-ut.html',
  'dishwasher-repair-st-george-ut.html',
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
  test(`${page} loads hiring-banner.js`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    assert.match(html, /<script src="\/js\/hiring-banner\.js" defer><\/script>/);
    assert.match(html, /<div id="siteBanner2" class="site-banner" style="display:none;"><\/div>/);
  });
}

test('.site-banner-text a has real CSS now (the hiring banner is the first one to link somewhere)', () => {
  assert.match(STYLES, /\.site-banner-text a\{/);
});

test('hiring-banner.js writes the careers pitch into #siteBanner2, links to /careers.html, and shows it', () => {
  assert.match(HIRING_JS, /getElementById\('siteBanner2'\)/);
  assert.match(HIRING_JS, /href="\/careers\.html"/);
  assert.match(HIRING_JS, /We\\'re hiring/);
  assert.match(HIRING_JS, /banner\.style\.display\s*=\s*'flex'/);
});

test('dismissing the hiring banner persists to localStorage under its own key (independent of the WELCOME15 banner)', () => {
  assert.match(HIRING_JS, /site-banner-close/);
  assert.match(HIRING_JS, /DISMISS_KEY\s*=\s*'th-hiring-banner-dismissed'/);
  assert.match(HIRING_JS, /localStorage\.setItem\(DISMISS_KEY, '1'\)/);
});

test('a real run: with no prior dismissal, the hiring banner is populated and shown; once dismissed, it is not shown again', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><div id="siteBanner2" class="site-banner" style="display:none;"></div></body>',
    { runScripts: 'outside-only', url: 'https://example.com/' }
  );
  const { window } = dom;
  window.eval(HIRING_JS);

  const banner = window.document.getElementById('siteBanner2');
  assert.equal(banner.style.display, 'flex');
  assert.match(banner.innerHTML, /careers\.html/);

  const closeBtn = banner.querySelector('.site-banner-close');
  assert.ok(closeBtn, 'expected a dismiss button');
  closeBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(banner.style.display, 'none');
  assert.equal(window.localStorage.getItem('th-hiring-banner-dismissed'), '1');
});

test('a second run with the dismissal already recorded does not repopulate or reshow the banner', () => {
  const dom = new JSDOM(
    '<!DOCTYPE html><body><div id="siteBanner2" class="site-banner" style="display:none;"></div></body>',
    { runScripts: 'outside-only', url: 'https://example.com/' }
  );
  const { window } = dom;
  window.localStorage.setItem('th-hiring-banner-dismissed', '1');
  window.eval(HIRING_JS);

  const banner = window.document.getElementById('siteBanner2');
  assert.equal(banner.style.display, 'none');
  assert.equal(banner.innerHTML, '');
});

test('dismissing the WELCOME15 banner does not also dismiss the hiring banner (separate keys, separate elements)', () => {
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div id="siteBanner1" class="site-banner" style="display:none;"></div>
      <div id="siteBanner2" class="site-banner" style="display:none;"></div>
    </body>`,
    { runScripts: 'outside-only', url: 'https://example.com/' }
  );
  const { window } = dom;
  window.localStorage.setItem('th-promo-welcome15-dismissed', '1');
  window.eval(HIRING_JS);

  const hiringBanner = window.document.getElementById('siteBanner2');
  assert.equal(hiringBanner.style.display, 'flex');
});
