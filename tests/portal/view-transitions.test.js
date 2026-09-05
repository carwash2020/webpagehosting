// Tests for the white-flash fix (2026-09-04), reported directly:
// "when switching between pages it still sometimes has a white
// flash." The existing <html style="background"> inline fix and
// theme-color/color-scheme meta tags already solved the CSS-level
// flash-of-white-before-styles-load problem on every page -- but
// this is a multi-page app, and the browser can still show a blank
// interstitial while waiting for the next page's bytes to arrive,
// especially on a slower connection (matching "sometimes"). Opting
// into cross-document view transitions keeps the old page's visual
// snapshot on screen during that wait instead.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PORTAL_PAGES = ['home', 'dashboard', 'jobs', 'quotes', 'work-orders', 'settings', 'login', 'set-password'];
const repo = (...p) => path.join(__dirname, '..', '..', ...p);

test('every portal page opts into cross-document view transitions -- both origin and destination must opt in for a transition to happen at all', () => {
  for (const page of PORTAL_PAGES) {
    const html = fs.readFileSync(repo('portal', `${page}.html`), 'utf8');
    assert.match(html, /@view-transition\s*\{\s*navigation:\s*auto;\s*\}/, `expected ${page}.html to opt in`);
  }
});

test('no page has malformed apostrophes from the fix itself -- a real mistake made and caught during this exact change', () => {
  for (const page of PORTAL_PAGES) {
    const html = fs.readFileSync(repo('portal', `${page}.html`), 'utf8');
    assert.doesNotMatch(html, /'''s/, `${page}.html should not contain the malformed triple-apostrophe artifact`);
  }
});

test('the opt-in is scoped to the portal pages themselves, not the shared stylesheet that also serves the public marketing site', () => {
  const sharedCss = fs.readFileSync(repo('styles.css'), 'utf8');
  assert.doesNotMatch(sharedCss, /@view-transition/, 'expected this to stay portal-specific, not added to the shared stylesheet');
});
