// Tests for two changes requested directly (2026-09-02): the settings
// gear icon reading as a sun/asterisk at real size, and an "Add to
// Home Screen" feature in Settings for repeat clients.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const PAGES_WITH_SETTINGS_BUTTON = ['home.html', 'work-orders.html', 'quotes.html', 'dashboard.html', 'jobs.html'];
const ALL_PORTAL_PAGES = ['home.html', 'settings.html', 'work-orders.html', 'quotes.html', 'dashboard.html', 'jobs.html', 'login.html', 'set-password.html'];

// ---- gear icon fix ----

test('the settings icon is a real filled cog, not the old circle-with-radiating-lines shape', () => {
  // Reported directly: it read as a sun or asterisk at the small size
  // a header icon button actually renders at.
  for (const page of PAGES_WITH_SETTINGS_BUTTON) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    assert.doesNotMatch(src, /circle cx="12" cy="12" r="3\.2"/,
      `${page}: the old ray-pattern icon should be gone`);
    assert.match(src, /fill="currentColor" aria-hidden="true"><path d="M19\.14 12\.94/,
      `${page}: expected the new filled cog icon`);
  }
});

test('the new icon is consistent across every page that has a settings button', () => {
  const iconBlocks = PAGES_WITH_SETTINGS_BUTTON.map(page => {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    const m = src.match(/<svg viewBox="0 0 24 24" fill="currentColor"[\s\S]*?<\/svg>/);
    return m ? m[0] : null;
  });
  assert.ok(iconBlocks.every(Boolean), 'every page should have the icon');
  const unique = new Set(iconBlocks);
  assert.equal(unique.size, 1, 'all pages should use the exact same icon markup');
});

// ---- Add to Home Screen ----

test('a dedicated portal PWA manifest exists, scoped to /portal/ so it never collides with the tools or marketing-site manifests', () => {
  const manifestPath = repo('portal', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'expected portal/manifest.json to exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.scope, '/portal/');
  assert.equal(manifest.start_url, '/portal/home.html');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
});

test('every portal page links the portal-specific manifest, not the tools or site one', () => {
  for (const page of ALL_PORTAL_PAGES) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    assert.match(src, /<link rel="manifest" href="\/portal\/manifest\.json">/,
      `${page}: missing or wrong manifest link`);
  }
});

test('every portal page has the apple-mobile-web-app meta tags needed for a clean installed icon/title', () => {
  for (const page of ALL_PORTAL_PAGES) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    assert.match(src, /apple-mobile-web-app-capable" content="yes"/, `${page}`);
    assert.match(src, /apple-mobile-web-app-title" content="Triple H"/, `${page}`);
  }
});

test('settings.html detects an already-installed app on either platform before showing any prompt', () => {
  const src = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
  const fnMatch = src.match(/function renderAddToHomeScreen\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderAddToHomeScreen()');
  const body = fnMatch[0];
  assert.match(body, /display-mode: standalone/, 'should check the cross-platform standalone media query');
  assert.match(body, /navigator\.standalone === true/, 'should also check the iOS-specific standalone flag');
});

test('Android/Chrome gets a real one-tap install button using the captured beforeinstallprompt event', () => {
  const src = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
  assert.match(src, /window\.addEventListener\('beforeinstallprompt', \(e\) => \{/);
  assert.match(src, /e\.preventDefault\(\);/, 'should suppress the browser\'s own mini-infobar');
  const fnMatch = src.match(/function renderAddToHomeScreen\(\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /promptEvent\.prompt\(\);/);
});

test('iOS gets real step-by-step instructions, never a button that would silently do nothing', () => {
  // Apple deliberately provides no programmatic install trigger --
  // a button here would be a dead click, not a shortcut.
  const src = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
  const fnMatch = src.match(/function renderAddToHomeScreen\(\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.match(body, /isIOS/);
  assert.match(body, /Add to Home Screen<\/strong>/);
  // The iOS branch must render an ordered list of steps, not a button.
  const iosBranchMatch = body.match(/if \(isIOS\) \{[\s\S]*?\n    \}/);
  assert.ok(iosBranchMatch);
  assert.doesNotMatch(iosBranchMatch[0], /<button/);
});

test('renderAddToHomeScreen runs on page load, not only when beforeinstallprompt fires', () => {
  // That event never fires on iOS at all -- relying on it alone would
  // leave iOS clients seeing a permanently empty card.
  const src = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
  const initMatch = src.match(/async function init\(\)[\s\S]*?\n  \}\n/);
  assert.ok(initMatch, 'expected to isolate init()');
  assert.match(initMatch[0], /renderAddToHomeScreen\(\);/);
});
