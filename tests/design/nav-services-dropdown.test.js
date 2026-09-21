// 2026-09-10: the 5 service pages were previously reachable only from a
// homepage modal link and cross-links between the pages themselves --
// no main nav link anywhere. This adds a "Services" dropdown (desktop
// hover/focus) and an always-visible sublist under the mobile menu's
// "Services" link, on every public marketing page, so all 5 pages are
// reachable from the nav on the whole site.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const SERVICE_LINKS = [
  '/services/washer-dryer-repair.html',
  '/services/plumbing-repairs.html',
  '/services/drywall-painting.html',
  '/services/handyman-repairs.html',
  '/services/assembly-installation.html',
];

const PAGES = [
  'index.html',
  'handyman-hurricane-ut.html', 'handyman-washington-city-ut.html',
  'handyman-santa-clara-ivins-ut.html', 'handyman-cedar-city-ut.html',
  'handyman-mesquite-nv.html', 'handyman-la-verkin-ut.html', 'handyman-leeds-ut.html',
  'handyman-st-george-ut.html',
  'services/washer-dryer-repair.html', 'services/plumbing-repairs.html', 'services/drywall-painting.html',
  'services/handyman-repairs.html', 'services/assembly-installation.html',
  'services/washer-dryer-repair-st-george-ut.html',
  'services/refrigerator-repair-st-george-ut.html',
  'services/dishwasher-repair-st-george-ut.html',
  'about.html', 'our-work.html', 'terms.html',
  'blog/index.html', 'blog/dryer-not-heating.html', 'blog/handyman-to-do-list.html',
  'blog/appliance-repair-or-replace.html', 'blog/washer-wont-drain.html',
  'blog/dishwasher-not-cleaning.html', 'blog/fridge-not-cooling.html',
  'blog/toilet-running-flapper-valve.html', 'blog/drywall-crack-above-door.html',
  'blog/tv-mount-drywall-anchors.html',
];

test('every public marketing page has a nav-dropdown listing all 5 service pages', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(repo(page), 'utf8');
    const navAt = html.indexOf('<ul class="nav-links">');
    const mobileAt = html.indexOf('class="mobile-menu"');
    assert.ok(navAt > 0 && mobileAt > 0, `${page} should have a nav-links list and a mobile-menu`);
    const navSection = html.slice(navAt, mobileAt);
    assert.match(navSection, /<li class="nav-dropdown">/, `${page} nav should have a nav-dropdown`);
    assert.match(navSection, /<ul class="nav-dropdown-menu">/, `${page} nav should have a nav-dropdown-menu`);
    for (const link of SERVICE_LINKS) {
      assert.ok(navSection.includes(`href="${link}"`), `${page} nav-dropdown-menu should link to ${link}`);
    }
  }
});

test('every public marketing page has a mobile-services-sublist under the mobile menu Services link, listing all 5 service pages', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(repo(page), 'utf8');
    const mobileAt = html.indexOf('class="mobile-menu"');
    assert.ok(mobileAt > 0, `${page} should have a mobile-menu`);
    const mobileSection = html.slice(mobileAt, mobileAt + 2000);
    // Collapsed by default behind a caret button (2026-09-19) -- the
    // sublist itself now carries an id (for the caret's aria-controls)
    // and a hidden attribute (collapsed state), rather than the bare
    // class it used to be the whole tag.
    assert.match(mobileSection, /<ul class="mobile-services-sublist" id="mobileServicesSublist" hidden>/, `${page} mobile menu should have a mobile-services-sublist`);
    assert.match(mobileSection, /<button type="button" class="mobile-nav-caret" aria-expanded="false" aria-controls="mobileServicesSublist"/, `${page} mobile menu should have a caret toggle for Services`);
    for (const link of SERVICE_LINKS) {
      assert.ok(mobileSection.includes(`href="${link}"`), `${page} mobile-services-sublist should link to ${link}`);
    }
  }
});

test('the nav-dropdown-menu CSS uses the theme-aware shadow token, not a hardcoded rgba', () => {
  const styles = fs.readFileSync(repo('styles.css'), 'utf8');
  const rule = styles.match(/\.nav-dropdown-menu\{([\s\S]*?)\}/)[1];
  assert.match(rule, /box-shadow:var\(--shadow-hover\)/);
});
