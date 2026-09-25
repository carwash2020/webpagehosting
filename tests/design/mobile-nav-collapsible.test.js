// The mobile menu's "Services" (5 links) and "Areas" (8 links) sublists
// used to be always visible under the mobile menu -- together they
// pushed everything below them (Gallery, Blog, Reviews, Schedule,
// Contact, Call) off the bottom of the menu on most phones. This makes
// both sublists collapsed by default behind a caret toggle button
// (mobile-nav-collapsible.js), on all 39 pages that carry this same
// mobile menu.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const NAV_JS = fs.readFileSync(repo('js/mobile-nav-collapsible.js'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const PAGES = [
  'index.html', 'about.html', 'our-work.html', 'careers.html', 'privacy.html', 'terms.html',
  'services/assembly-installation.html', 'services/drywall-painting.html', 'services/plumbing-repairs.html',
  'services/handyman-repairs.html', 'services/washer-dryer-repair.html',
  'services/washer-dryer-repair-st-george-ut.html', 'services/refrigerator-repair-st-george-ut.html',
  'services/dishwasher-repair-st-george-ut.html',
  'locations/handyman-st-george-ut.html', 'locations/handyman-washington-city-ut.html',
  'locations/handyman-hurricane-ut.html', 'locations/handyman-santa-clara-ivins-ut.html',
  'locations/handyman-leeds-ut.html', 'locations/handyman-la-verkin-ut.html',
  'locations/handyman-cedar-city-ut.html', 'locations/handyman-mesquite-nv.html',
  'blog/index.html', 'blog/dryer-not-heating.html', 'blog/handyman-to-do-list.html',
  'blog/appliance-repair-or-replace.html', 'blog/washer-wont-drain.html',
  'blog/dishwasher-not-cleaning.html', 'blog/fridge-not-cooling.html',
  'blog/toilet-running-flapper-valve.html', 'blog/drywall-crack-above-door.html',
  'blog/tv-mount-drywall-anchors.html', 'blog/oven-not-heating-right.html',
  'blog/washer-leaking-water.html', 'blog/dryer-wont-turn-on.html',
  'blog/dishwasher-not-draining.html', 'blog/washer-wont-spin.html',
  'blog/dishwasher-leaking.html', 'blog/ice-maker-not-working.html',
];

for (const page of PAGES) {
  test(`${page}: loads mobile-nav-collapsible.js and both sublists start collapsed with a caret toggle`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    assert.match(html, /<script src="\/js\/mobile-nav-collapsible\.js" defer><\/script>/);
    assert.match(html, /<ul class="mobile-services-sublist" id="mobileServicesSublist" hidden>/);
    assert.match(html, /<ul class="mobile-areas-sublist" id="mobileAreasSublist" hidden>/);
    assert.match(html, /<button type="button" class="mobile-nav-caret" aria-expanded="false" aria-controls="mobileServicesSublist"/);
    assert.match(html, /<button type="button" class="mobile-nav-caret" aria-expanded="false" aria-controls="mobileAreasSublist"/);
  });
}

test('.mobile-nav-caret / [hidden] have real CSS (rotate the chevron open, and actually hide the collapsed list)', () => {
  assert.match(STYLES, /\.mobile-services-sublist\[hidden\],\s*\n\s*\.mobile-areas-sublist\[hidden\]\{\s*\n\s*display:none;/);
  assert.match(STYLES, /\.mobile-nav-caret\{/);
  assert.match(STYLES, /\.mobile-nav-caret\[aria-expanded="true"\] svg\{\s*\n\s*transform:rotate\(180deg\);/);
});

test('a real run: clicking a caret un-hides its sublist and flips aria-expanded; clicking again re-collapses it', () => {
  const dom = new JSDOM(
    `<!DOCTYPE html><body>
      <div class="mobile-nav-row">
        <a href="/#services">Services</a>
        <button type="button" class="mobile-nav-caret" aria-expanded="false" aria-controls="mobileServicesSublist" aria-label="Toggle Services links"></button>
      </div>
      <ul class="mobile-services-sublist" id="mobileServicesSublist" hidden><li><a href="/services/washer-dryer-repair.html">Washer &amp; Dryer Repair</a></li></ul>
    </body>`,
    { runScripts: 'outside-only', url: 'https://example.com/' }
  );
  const { window } = dom;
  window.eval(NAV_JS);

  const btn = window.document.querySelector('.mobile-nav-caret');
  const list = window.document.getElementById('mobileServicesSublist');
  assert.equal(list.hidden, true);

  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(list.hidden, false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');

  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(list.hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
});

test('scripts/check-consistency.js does NOT need to track mobile-nav-collapsible.js as a global shared file (it carries no ?v= cache-bust param, same precedent as js/cookie-consent.js)', () => {
  for (const page of ['index.html', 'about.html']) {
    const html = fs.readFileSync(repo(page), 'utf8');
    assert.match(html, /<script src="\/js\/mobile-nav-collapsible\.js" defer><\/script>/);
    assert.doesNotMatch(html, /\/js\/mobile-nav-collapsible\.js\?v=/);
  }
});
