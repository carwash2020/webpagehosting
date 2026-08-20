// Tests for the public site's light/dark theme toggle (2026-08-20).
//
// Direct report: "the website darkmode lightmode button looks dumb and
// isnt working." Investigated and found the real cause: the JS toggle
// logic was already correct and had been the whole time -- it set
// data-theme, saved the preference, and updated the label -- but the
// actual CSS that should respond to that attribute (a light theme
// override, and any styling at all for the toggle button and mobile
// switch) had never been written. One existing comment elsewhere in
// styles.css already anticipated a [data-theme="light"] override
// existing (mentioning --white/--text-dim "flip to near-black/dark-
// gray in light mode"), confirming this was a planned, unfinished
// feature rather than a misunderstanding on our part.
//
// Fixed by adding the missing override block, styling the previously
// unstyled toggle button and mobile switch, and adding icon show/hide
// logic (both the sun and moon rendered simultaneously before, since
// nothing ever hid either one).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');
const STYLES_CSS_PATH = path.join(__dirname, '..', 'styles.css');

function loadThemeToggleDOM() {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const css = fs.readFileSync(STYLES_CSS_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true });
  const { window } = dom;
  // jsdom won't fetch the linked stylesheet without a real network
  // request; injecting the real CSS content directly instead.
  const styleEl = window.document.createElement('style');
  styleEl.textContent = css;
  window.document.head.appendChild(styleEl);
  // A few of index.html's other, unrelated scripts reference APIs
  // jsdom doesn't implement (matchMedia, fetch) -- stubbing them so
  // those unrelated errors don't obscure anything in these tests.
  window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  return window;
}

test('a [data-theme="light"] CSS override block exists in styles.css -- this was the actual missing piece', () => {
  const css = fs.readFileSync(STYLES_CSS_PATH, 'utf8');
  assert.match(css, /\[data-theme="light"\]\s*\{/);
});

test('clicking the desktop theme toggle button correctly sets data-theme, updates the label, and swaps which icon is visible', async () => {
  const window = loadThemeToggleDOM();
  await new Promise(resolve => setTimeout(resolve, 100));

  const moon = window.document.querySelector('.theme-icon-dark');
  const sun = window.document.querySelector('.theme-icon-light');
  assert.equal(window.getComputedStyle(sun).display, 'none', 'sun icon should be hidden while in dark mode');
  assert.notEqual(window.getComputedStyle(moon).display, 'none', 'moon icon should be visible while in dark mode');

  window.document.getElementById('themeToggle').click();

  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(window.document.querySelector('.theme-toggle-label').textContent, 'Light Mode');
  assert.equal(window.getComputedStyle(moon).display, 'none', 'moon icon should hide once switched to light mode');
  assert.notEqual(window.getComputedStyle(sun).display, 'none', 'sun icon should show once switched to light mode');
});

test('switching to light mode actually changes the real CSS variables the rest of the page uses, not just the attribute', async () => {
  const window = loadThemeToggleDOM();
  await new Promise(resolve => setTimeout(resolve, 100));

  const darkBg = window.getComputedStyle(window.document.documentElement).getPropertyValue('--bg').trim();
  window.document.getElementById('themeToggle').click();
  const lightBg = window.getComputedStyle(window.document.documentElement).getPropertyValue('--bg').trim();

  assert.notEqual(darkBg, lightBg, '--bg should have a genuinely different value once in light mode');
  assert.equal(darkBg, '#0a0a0a');
  assert.match(lightBg, /^#[0-9a-f]{6}$/i);
});

test('the mobile theme switch and the desktop button stay in sync, and toggling the mobile switch also updates the real theme', async () => {
  const window = loadThemeToggleDOM();
  await new Promise(resolve => setTimeout(resolve, 100));

  const mobileSwitch = window.document.getElementById('themeSwitchMobile');
  assert.equal(mobileSwitch.checked, true, 'mobile switch should start checked, matching the default dark theme');

  mobileSwitch.checked = false;
  mobileSwitch.dispatchEvent(new window.Event('change'));

  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'light');
  assert.equal(window.document.querySelector('.theme-toggle-label').textContent, 'Light Mode', 'the desktop button should reflect the change made via the mobile switch');
});

test('the theme preference persists to localStorage under the expected key', async () => {
  const window = loadThemeToggleDOM();
  await new Promise(resolve => setTimeout(resolve, 100));

  window.document.getElementById('themeToggle').click();
  assert.equal(window.localStorage.getItem('th-theme'), 'light');

  window.document.getElementById('themeToggle').click();
  assert.equal(window.localStorage.getItem('th-theme'), 'dark');
});

test('the theme toggle button and mobile switch both have real, non-empty CSS styling now -- neither had any before this fix', () => {
  const css = fs.readFileSync(STYLES_CSS_PATH, 'utf8');
  for (const selector of ['.theme-toggle{', '.theme-switch{', '.theme-switch-track{', '.theme-switch-thumb{']) {
    assert.ok(css.includes(selector), selector + ' should have a real CSS rule');
  }
});

test('elements sitting on a permanently dark photo backdrop (.hero h1, .gallery-caption) use hardcoded colors, not theme variables that would flip and become illegible', () => {
  const css = fs.readFileSync(STYLES_CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments first
  const heroRule = css.match(/\.hero h1\{[^}]*\}/);
  const captionRule = css.match(/\.gallery-caption\{[^}]*\}/);
  assert.ok(heroRule && /#[0-9a-f]{3,6}/i.test(heroRule[0]), '.hero h1 should use a hardcoded color');
  assert.ok(captionRule && /#[0-9a-f]{3,6}/i.test(captionRule[0]), '.gallery-caption should use a hardcoded color, not var(--white)');
  assert.doesNotMatch(captionRule[0], /var\(--white\)/);
});

// CRITICAL BUG FIX (2026-08-20), found from a direct screenshot
// showing the logo overlapping with nav text. Confirmed the public
// site's header had the exact same WebKit ghosting-bug pattern fixed
// earlier this session on the internal tools app (a sticky element
// carrying backdrop-filter directly on itself), which that earlier
// fix never checked for here. Moved the blur/background onto a
// ::before pseudo-element, matching the exact same proven fix.

test('the public site\'s sticky header no longer carries backdrop-filter directly on itself -- it lives on a ::before child instead, matching the fix already applied to the internal tools app', () => {
  const css = fs.readFileSync(STYLES_CSS_PATH, 'utf8');
  const headerRule = css.match(/(?<!:)header\{[^}]*\}/);
  assert.ok(headerRule, 'header rule not found');
  assert.doesNotMatch(headerRule[0], /backdrop-filter/, 'backdrop-filter should not be directly on the sticky header element');
  assert.match(css, /header::before\{[^}]*backdrop-filter/s);
});

test('no other position:sticky element in the public site\'s stylesheet has this same vulnerable pattern', () => {
  const css = fs.readFileSync(STYLES_CSS_PATH, 'utf8');
  const stickyBlocks = [...css.matchAll(/([a-zA-Z0-9_.:-]+)\{[^}]*position:\s*sticky[^}]*\}/g)];
  for (const [block, selector] of stickyBlocks) {
    assert.doesNotMatch(block, /backdrop-filter/, selector + ' combines position:sticky with backdrop-filter directly -- same vulnerable pattern');
  }
});

// Bug fix (2026-08-20), found from a direct screenshot showing
// "Mon7:00 AM" with zero space between the day and time. Confirmed
// .hours-grid/.hours-row/.hours-day/.hours-value had no CSS at all
// anywhere -- matching the exact same "feature built without styling"
// pattern as the earlier theme-toggle bug.

test('the hours list has real CSS now, with a visible separation between the day and the time value', () => {
  const css = fs.readFileSync(STYLES_CSS_PATH, 'utf8');
  for (const selector of ['.hours-grid{', '.hours-row{', '.hours-day{', '.hours-value{']) {
    assert.ok(css.includes(selector), selector + ' should have a real CSS rule now');
  }
  const rowRule = css.match(/\.hours-row\{([^}]*)\}/)[1];
  assert.match(rowRule, /display:\s*flex/, '.hours-row should be a flex container so its children have real layout, not plain inline default spacing');
  assert.match(rowRule, /gap:\s*\d/, '.hours-row should have a real gap between the day and the time value');
});

test('the hours list actually renders with visible separation end to end, verified against the real page', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const css = fs.readFileSync(STYLES_CSS_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  const styleEl = window.document.createElement('style');
  styleEl.textContent = css;
  window.document.head.appendChild(styleEl);
  await new Promise(resolve => setTimeout(resolve, 100));

  const row = window.document.querySelector('.hours-row');
  assert.equal(window.getComputedStyle(row).display, 'flex');
  const gap = parseFloat(window.getComputedStyle(row).gap);
  assert.ok(gap > 0, 'the day and time value should have a real, non-zero gap between them');
});
