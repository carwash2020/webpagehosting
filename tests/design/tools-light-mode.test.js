// Tests for light mode in the internal tools app (site audit
// improvement #6, 2026-08-20), tucked into Settings as requested.
// A separate preference (th_tools_theme) from the public site's own
// theme toggle, since these are different audiences on different
// devices.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
const STYLES_CSS_PATH = path.join(__dirname, '..', '..', 'styles.css');
const STYLES_TOOLS_CSS_PATH = path.join(TOOLS_DIR, 'styles-tools.css');

// Every real tool page that should carry the anti-flash snippet --
// the 3 retired redirect stubs (contact-card, expense-logger,
// job-cost-lookup) are deliberately excluded, since they have no real
// UI to theme.
const PAGES_LOADING_SHARED_CSS = [
  'calendar.html', 'client-detail.html', 'contract-generator.html', 'dev-tools.html',
  'finance.html', 'invoice-generator.html', 'job-detail.html', 'job-tracker.html',
  'login.html', 'parts-reference.html', 'reset-password.html', 'review-request.html',
  'route-planner.html', 'settings.html', 'site-content.html', 'workspace.html',
];

test('every real tool page (except the 3 retired redirect stubs) has the anti-flash theme snippet, positioned before any stylesheet loads', () => {
  for (const page of PAGES_LOADING_SHARED_CSS) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    const snippetIndex = src.indexOf("localStorage.getItem('th_tools_theme')");
    const stylesheetIndex = src.indexOf('<link rel="stylesheet" href="/styles.css');
    assert.notEqual(snippetIndex, -1, page + ' is missing the anti-flash theme snippet');
    assert.ok(snippetIndex < stylesheetIndex, page + ': the theme snippet must come before the stylesheet link, to avoid a flash of the wrong theme');
  }
});

test('runway-dashboard.html, which never loads the shared stylesheet, has its own separate anti-flash snippet and its own light-mode CSS override', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  assert.match(src, /localStorage\.getItem\('th_tools_theme'\)/);
  assert.match(src, /\[data-theme="light"\]\{/);
  // Should not link the shared stylesheet at all -- this page is
  // deliberately self-contained, confirmed multiple times this
  // session already.
  assert.doesNotMatch(src, /<link[^>]*\/styles\.css/);
});

test('runway-dashboard.html\'s light override defines every neutral variable its own :root does, and deliberately leaves the brand colors (orange/blue/green/red) untouched', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  const lightBlock = src.match(/\[data-theme="light"\]\{([^}]*)\}/)[1];
  for (const neutralVar of ['--bg', '--bg-card', '--bg-elevated', '--bg-hover', '--border-soft', '--text', '--text-dim', '--text-faint', '--bg-panel-2', '--bg-panel-3', '--border', '--white']) {
    assert.match(lightBlock, new RegExp(neutralVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':'), neutralVar + ' should be overridden for light mode');
  }
  // Brand colors should NOT appear in the light override at all --
  // they stay the same in both themes, matching the established
  // pattern used everywhere else this session.
  for (const brandVar of ['--orange:', '--orange-dark:', '--orange-light:', '--blue:', '--green:', '--red:']) {
    assert.doesNotMatch(lightBlock, new RegExp(brandVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), brandVar + ' should NOT be overridden -- brand colors stay the same in both themes');
  }
});

test('every CSS variable styles-tools.css actually uses is defined somewhere in styles.css (both the dark default and the light override) -- confirms the shared 21-page mechanism has no gaps', () => {
  const rootVars = new Set([...fs.readFileSync(STYLES_CSS_PATH, 'utf8').matchAll(/--([a-zA-Z0-9-]+):/g)].map(m => m[1]));
  const usedInTools = new Set([...fs.readFileSync(STYLES_TOOLS_CSS_PATH, 'utf8').matchAll(/var\(--([a-zA-Z0-9-]+)/g)].map(m => m[1]));
  const missing = [...usedInTools].filter(v => !rootVars.has(v));
  assert.deepEqual(missing, [], 'styles-tools.css references variables not defined anywhere in styles.css: ' + missing.join(', '));
});

function loadSettingsPage(savedTheme) {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'settings.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/settings.html',
    beforeParse(window) {
      window.requireAuth = () => {};
      window.pushNotificationsSupported = () => false;
      window.isPushEnabled = async () => false;
      if (savedTheme) window.localStorage.setItem('th_tools_theme', savedTheme);
    },
  });
  return dom.window;
}

test('the theme toggle button in Settings defaults to dark (no preference saved), showing "Light mode" as the action to switch to', () => {
  const window = loadSettingsPage(null);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.equal(window.document.documentElement.getAttribute('data-theme'), null);
  const btn = window.document.getElementById('toolsThemeToggleBtn');
  assert.equal(btn.textContent, 'Light mode');
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
});

test('clicking the toggle switches to light mode, persists the choice, and updates the button to show "Dark mode" as the next action', () => {
  const window = loadSettingsPage(null);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const btn = window.document.getElementById('toolsThemeToggleBtn');
  btn.click();
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(btn.textContent, 'Dark mode');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(window.localStorage.getItem('th_tools_theme'), 'light');
});

test('clicking the toggle a second time flips back to dark and persists that too', () => {
  const window = loadSettingsPage(null);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const btn = window.document.getElementById('toolsThemeToggleBtn');
  btn.click();
  btn.click();
  assert.equal(window.document.documentElement.getAttribute('data-theme'), null);
  assert.equal(btn.textContent, 'Light mode');
  assert.equal(window.localStorage.getItem('th_tools_theme'), 'dark');
});

test('a previously-saved light preference is applied before DOMContentLoaded even fires (the anti-flash snippet), and the button correctly reflects it once the page finishes loading', () => {
  const window = loadSettingsPage('light');
  // Confirmed BEFORE dispatching DOMContentLoaded -- this is the whole
  // point of the anti-flash snippet running at the top of <head>.
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'light');
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const btn = window.document.getElementById('toolsThemeToggleBtn');
  assert.equal(btn.textContent, 'Dark mode');
});

test('the saved preference is a separate key from the public site\'s own theme toggle, so switching one never affects the other', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'settings.html'), 'utf8');
  assert.match(src, /th_tools_theme/);
  assert.doesNotMatch(src, /'th-theme'/, 'should not reuse the public site\'s own localStorage key');
});
