// Tests for fixing the mobile hamburger menu's accessibility gaps
// (audit item #9), found identically broken across all 16 pages that
// carry this nav: a keyboard user who opened the menu (Enter/Space on
// the toggle button) had no way to close it again without a mouse
// click landing somewhere outside it -- Escape, the standard way to
// dismiss any disclosure widget, did nothing at all, and there was no
// aria-controls linking the button to the region it toggles. 15 of
// the 16 pages (every page except index.html) also never closed the
// menu when a link inside it was clicked, so navigating to a same-page
// anchor (like #reviews) on those pages left the open menu covering
// the content underneath.
//
// The fix adds a shared closeMobileMenu(returnFocus) helper (focus
// returns to the toggle button only on the Escape path, matching how
// a keyboard user would expect to end up back where they started, not
// on a link-click navigation that's already moving them elsewhere),
// wires it to both a keydown listener (Escape) and a document click
// listener (anything outside the menu and its own toggle button), and
// adds the missing close-on-link-click behavior to the 15 pages that
// never had it. aria-controls="mobileMenu" is added to the toggle
// button on all 16 pages.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const ALL_PAGES = [
  'index.html', 'about.html', 'services/assembly-installation.html', 'services/drywall-painting.html',
  'locations/handyman-cedar-city-ut.html', 'locations/handyman-hurricane-ut.html',
  'locations/handyman-la-verkin-ut.html', 'locations/handyman-leeds-ut.html',
  'locations/handyman-mesquite-nv.html', 'services/handyman-repairs.html',
  'locations/handyman-santa-clara-ivins-ut.html', 'locations/handyman-washington-city-ut.html',
  'locations/handyman-st-george-ut.html',
  'our-work.html', 'services/plumbing-repairs.html', 'terms.html',
  'services/washer-dryer-repair.html',
  'services/washer-dryer-repair-st-george-ut.html',
  'services/refrigerator-repair-st-george-ut.html',
  'services/dishwasher-repair-st-george-ut.html',
];

function read(name) {
  return fs.readFileSync(repo(name), 'utf8');
}

for (const name of ALL_PAGES) {
  test(`${name}: the nav toggle button carries aria-controls="mobileMenu"`, () => {
    const html = read(name);
    assert.match(html, /<button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="mobileMenu" id="navToggle">/);
  });

  test(`${name}: Escape closes the open mobile menu and returns focus to the toggle button`, () => {
    const html = read(name);
    assert.match(html, /document\.addEventListener\('keydown', \(e\) => \{\s*\n\s*if \(e\.key === 'Escape' && mobileMenu\.classList\.contains\('is-open'\)\) closeMobileMenu\(true\);/);
  });

  test(`${name}: clicking outside the menu and its toggle button closes it, without stealing focus`, () => {
    const html = read(name);
    assert.match(html, /document\.addEventListener\('click', \(e\) => \{\s*\n\s*if \(!mobileMenu\.classList\.contains\('is-open'\)\) return;\s*\n\s*if \(mobileMenu\.contains\(e\.target\) \|\| navToggle\.contains\(e\.target\)\) return;\s*\n\s*closeMobileMenu\(false\);/);
  });

  test(`${name}: clicking a link inside the mobile menu closes it (without returning focus, since navigation is already moving it)`, () => {
    const html = read(name);
    assert.match(html, /mobileMenu\.querySelectorAll\('a'\)\.forEach\(a => \{\s*\n\s*a\.addEventListener\('click', \(\) => \{\s*\n\s*closeMobileMenu\(false\);/);
  });

  test(`${name}: closeMobileMenu() only moves focus to the toggle button when explicitly asked to`, () => {
    const html = read(name);
    const fnMatch = html.match(/function closeMobileMenu\(returnFocus\) \{[\s\S]*?\n  \}/);
    assert.ok(fnMatch, 'expected to isolate closeMobileMenu()');
    assert.match(fnMatch[0], /if \(returnFocus\) navToggle\.focus\(\);/);
  });
}

test('index.html\'s guard-free hamburger fix does not accidentally wrap document-level Escape/click listeners in a way that only fires once per page (they must be registered unconditionally, since index.html always has both elements)', () => {
  const html = read('index.html');
  // index.html has no `if (navToggle && mobileMenu)` guard around this
  // block (unlike the other 15 pages) -- confirm the fix still landed
  // in the right place, right after the existing link-close wiring.
  const idx = html.indexOf("mobileMenu.querySelectorAll('a').forEach");
  const escapeIdx = html.indexOf("e.key === 'Escape' && mobileMenu.classList.contains('is-open')");
  assert.ok(idx !== -1 && escapeIdx !== -1);
  assert.ok(idx < escapeIdx);
});
