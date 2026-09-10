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
  '/washer-dryer-repair.html',
  '/plumbing-repairs.html',
  '/drywall-painting.html',
  '/handyman-repairs.html',
  '/assembly-installation.html',
];

const PAGES = [
  'index.html',
  'handyman-hurricane-ut.html', 'handyman-washington-city-ut.html',
  'handyman-santa-clara-ivins-ut.html', 'handyman-cedar-city-ut.html',
  'handyman-mesquite-nv.html',
  'washer-dryer-repair.html', 'plumbing-repairs.html', 'drywall-painting.html',
  'handyman-repairs.html', 'assembly-installation.html',
  'about.html', 'our-work.html', 'terms.html',
  'blog/index.html', 'blog/dryer-not-heating.html', 'blog/handyman-to-do-list.html',
  'blog/appliance-repair-or-replace.html', 'blog/washer-wont-drain.html',
  'blog/dishwasher-not-cleaning.html', 'blog/fridge-not-cooling.html',
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
    assert.match(mobileSection, /<ul class="mobile-services-sublist">/, `${page} mobile menu should have a mobile-services-sublist`);
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
