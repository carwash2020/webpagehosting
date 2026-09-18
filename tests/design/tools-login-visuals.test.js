// Tools login / reset-password visual pass (2026-09-18): the portal
// login already had a real card, a dark color-scheme, and a body
// background so the first paint never flashes white. The internal
// workspace login was still logo + fields on bare black, and most
// tool pages never declared color-scheme at all -- the same FOUC
// portal-design-fixes.test.js already locked for /portal/.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');
const STYLES_TOOLS = fs.readFileSync(repo('tools', 'styles-tools.css'), 'utf8');

const TOOL_PAGES = fs.readdirSync(TOOLS_DIR).filter((n) => n.endsWith('.html'));

test('every tools HTML page declares a dark color-scheme so the first paint is not white', () => {
  for (const page of TOOL_PAGES) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.match(
      src,
      /<meta name="color-scheme" content="dark">/,
      `${page}: missing the dark color-scheme meta`
    );
  }
});

test('the tools theme snippet flips color-scheme to light when that preference is saved', () => {
  const pagesWithTheme = TOOL_PAGES.filter((page) => {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    return src.includes("localStorage.getItem('th_tools_theme')");
  });
  assert.ok(pagesWithTheme.length >= 16, 'expected the real tool pages to carry the theme snippet');
  for (const page of pagesWithTheme) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.match(
      src,
      /document\.documentElement\.style\.colorScheme = saved === 'light' \? 'light' : 'dark'/,
      `${page}: theme snippet must set color-scheme for both themes`
    );
  }
});

test('tools login and reset-password paint a dark body before CSS, matching the portal login contract', () => {
  for (const page of ['login.html', 'reset-password.html']) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.match(src, /body \{ background: #0a0a0a;/, `${page}: body should set its own background`);
    assert.match(src, /class="login-box"/, `${page}: expected the login card`);
  }
});

test('styles-tools.css gives .login-box the same card chrome portal-polish already gives the client login', () => {
  const rule = STYLES_TOOLS.match(/\.login-box\{([^}]*)\}/);
  assert.ok(rule, 'expected a .login-box rule');
  assert.match(rule[1], /border-radius:16px/);
  assert.match(rule[1], /padding:38px 34px/);
  assert.match(STYLES_TOOLS, /body:has\(\.login-box\)\{ background-color:#0a0a0a; \}/);
  assert.match(STYLES_TOOLS, /@media \(max-width:480px\)\{\s*\.login-box\{ padding:28px 22px; \}/);
});

test('checkbox-row labels stay sentence case instead of inheriting the public site\'s uppercase field labels', () => {
  const rule = STYLES_TOOLS.match(/\.checkbox-row label\{([^}]*)\}/);
  assert.ok(rule, 'expected .checkbox-row label');
  assert.match(rule[1], /text-transform:none/);
  assert.match(rule[1], /letter-spacing:normal/);
});

test('Settings theme toggle updates color-scheme immediately, not only on the next page load', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'settings.html'), 'utf8');
  assert.match(src, /document\.documentElement\.style\.colorScheme = theme;/);
});
