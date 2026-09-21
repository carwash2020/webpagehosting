// Persistent app shell via cross-document view transitions (2026-09-21).
// Same fix already proven in portal/*.html (tests/portal/view-transitions.test.js)
// for the identical "flash between pages" complaint, applied here to the
// tools/ suite: every tool page opts in with its own
// `@view-transition { navigation: auto; }`, and since tools-nav-pwa.js
// injects byte-identical sidebar/bottom-nav markup on every page, giving
// those elements a shared view-transition-name (in styles-tools.css, and
// runway-dashboard.html's own copy since that page doesn't load
// styles-tools.css) makes the shell itself read as staying in place
// instead of crossfading -- not a real SPA rewrite (no persisted DOM, no
// client router), just a native-browser visual smoothing layer over
// ordinary navigation. Unsupported browsers no-op to today's exact
// hard-cut nav, so this is pure progressive enhancement.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

// Every page tools-nav-pwa.js actually wires up (excludes the thin
// redirect stubs -- contact-card.html, job-cost-lookup.html,
// expense-logger.html, calendar.html (retired 2026-09-21), index.html
// -- which have no real content to transition between).
const TOOL_PAGES = [
  'client-detail', 'clients', 'contract-generator', 'dev-tools',
  'finance', 'invoice-generator', 'job-detail', 'job-tracker', 'login',
  'parts-reference', 'pos', 'reset-password', 'review-request',
  'route-planner', 'runway-dashboard', 'settings', 'site-content', 'workspace',
];

test('every tool page opts into cross-document view transitions -- both origin and destination must opt in for a transition to happen at all', () => {
  for (const page of TOOL_PAGES) {
    const html = fs.readFileSync(repo('tools', `${page}.html`), 'utf8');
    assert.match(html, /@view-transition\s*\{\s*navigation:\s*auto;\s*\}/, `expected ${page}.html to opt in`);
  }
});

test('the opt-in is scoped to the tool pages themselves, not the shared stylesheet also used by the public marketing site', () => {
  const sharedCss = fs.readFileSync(repo('styles.css'), 'utf8');
  assert.doesNotMatch(sharedCss, /@view-transition/, 'expected this to stay tools-specific, not added to the public site\'s shared stylesheet');
});

test('the shared sidebar and bottom-nav carry a view-transition-name, so the shell reads as persisting instead of crossfading', () => {
  const sharedCss = fs.readFileSync(repo('tools', 'styles-tools.css'), 'utf8');
  assert.match(sharedCss, /\.th-desktop-sidebar\s*\{\s*view-transition-name:\s*th-app-sidebar;\s*\}/);
  assert.match(sharedCss, /\.th-bottom-nav\s*\{\s*view-transition-name:\s*th-app-bottomnav;\s*\}/);

  // runway-dashboard.html deliberately keeps its own copy of this CSS
  // instead of loading styles-tools.css (see that page's own comments) --
  // same reasoning as the sidebar-icon fix earlier this session: every
  // shared rule that page depends on has to be copied there too, or it
  // silently doesn't apply on that one page while working everywhere else.
  const runway = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');
  assert.match(runway, /\.th-desktop-sidebar\s*\{\s*view-transition-name:\s*th-app-sidebar;\s*\}/);
  assert.match(runway, /\.th-bottom-nav\s*\{\s*view-transition-name:\s*th-app-bottomnav;\s*\}/);
});

test('the view-transition-name assignments are scoped inside the sidebar/bottom-nav\'s own display breakpoints, so the two names are never live at the same viewport width', () => {
  const sharedCss = fs.readFileSync(repo('tools', 'styles-tools.css'), 'utf8');
  assert.match(sharedCss, /@media \(min-width: 1024px\) \{ \.th-desktop-sidebar \{ view-transition-name: th-app-sidebar; \} \}/, 'expected the sidebar name scoped to its own min-width:1024px block');
  assert.match(sharedCss, /@media \(max-width: 720px\) \{ \.th-bottom-nav \{ view-transition-name: th-app-bottomnav; \} \}/, 'expected the bottom-nav name scoped to its own max-width:720px block');

  const runway = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');
  assert.match(runway, /@media \(min-width: 1024px\) \{ \.th-desktop-sidebar \{ view-transition-name: th-app-sidebar; \} \}/);
  assert.match(runway, /@media \(max-width: 720px\) \{ \.th-bottom-nav \{ view-transition-name: th-app-bottomnav; \} \}/);
});

test('a prefers-reduced-motion override skips the transition animation without skipping the DOM update', () => {
  const sharedCss = fs.readFileSync(repo('tools', 'styles-tools.css'), 'utf8');
  assert.match(
    sharedCss,
    /@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\), ::view-transition-old\(\*\), ::view-transition-new\(\*\) \{\s*animation-duration: 0\.001ms !important;/
  );

  const runway = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');
  assert.match(
    runway,
    /@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\), ::view-transition-old\(\*\), ::view-transition-new\(\*\) \{\s*animation-duration: 0\.001ms !important;/
  );
});

test('tools-nav-pwa.js injects the exact class names the view-transition-name rules target, so the shell CSS actually has something to attach to', () => {
  const nav = fs.readFileSync(repo('tools', 'tools-nav-pwa.js'), 'utf8');
  assert.match(nav, /sidebar\.className = 'th-desktop-sidebar'/);
  assert.match(nav, /nav\.className = 'th-bottom-nav'/);
});
