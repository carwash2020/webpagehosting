// Tests for pull-to-refresh and the offline indicator (2026-09-04),
// requested directly: "pull-to-refresh + offline indicator." Pull-to-
// refresh built with an explicit constraint in mind: "Make swiping
// feel good, but don't over do it" -- one restrained gesture, not a
// gesture library.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JS = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const CSS = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
const SW = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

const ALL_PAGES = ['home', 'dashboard', 'jobs', 'quotes', 'work-orders', 'settings', 'login', 'set-password'];
const LIST_PAGES = { home: 'init', dashboard: 'renderInvoices', jobs: null, quotes: 'renderQuotes', 'work-orders': 'renderMyRequests' };

// ---- offline indicator ----

test('the offline indicator checks navigator.onLine on init, not just future online/offline events', () => {
  const fnMatch = JS.match(/function initOfflinePortalIndicator\(\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate initOfflinePortalIndicator()');
  assert.match(fnMatch[0], /navigator\.onLine/);
  assert.match(fnMatch[0], /updateBanner\(\);\s*\n\}/, 'expected an initial check, not just event listeners');
});

test('the offline indicator self-initializes rather than requiring an explicit call on every differently-structured page', () => {
  assert.match(JS, /document\.addEventListener\('DOMContentLoaded', initOfflinePortalIndicator\)/);
  for (const page of ALL_PAGES) {
    const html = fs.readFileSync(repo('portal', `${page}.html`), 'utf8');
    assert.match(html, /portal-app\.js/, `${page}.html: expected to load the shared script, which self-inits the banner`);
  }
});

test('the offline banner is informational, not blocking -- fixed position, never covering content with a modal', () => {
  const block = CSS.match(/\.offline-banner \{[\s\S]*?\}/);
  assert.ok(block);
  assert.match(block[0], /position: fixed;/);
  assert.doesNotMatch(CSS, /\.offline-banner[\s\S]{0,300}display: none[\s\S]*?content/);
});

test('the offline banner clears the iPhone notch/status bar area', () => {
  const block = CSS.match(/\.offline-banner \{[\s\S]*?\}/);
  assert.match(block[0], /env\(safe-area-inset-top\)/);
});

// ---- pull-to-refresh ----

test('pull-to-refresh only arms when already scrolled to the top -- pulling mid-scroll should scroll normally, not hijack the gesture', () => {
  const fnMatch = JS.match(/function initPortalPullToRefresh\(onRefresh\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate initPortalPullToRefresh()');
  assert.match(fnMatch[0], /if \(window\.scrollY > 0 \|\| refreshing\) return;/);
});

test('the indicator tracks the finger with zero lag while dragging -- no CSS transition applied until release', () => {
  const cssBlock = CSS.match(/\.ptr-indicator \{[\s\S]*?\}/);
  assert.ok(cssBlock);
  assert.doesNotMatch(cssBlock[0], /transition:/, 'the base indicator style must not animate transform, or dragging would visibly lag behind the finger');
  assert.match(CSS, /\.ptr-indicator\.is-snapping \{[\s\S]*?transition: transform/, 'the snap-back animation should be a separate, deliberately-applied class');
});

test('touch listeners are passive except touchend, which needs to read final state synchronously', () => {
  const fnMatch = JS.match(/function initPortalPullToRefresh\(onRefresh\)[\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /addEventListener\('touchstart', [\s\S]*?\{ passive: true \}/);
  assert.match(fnMatch[0], /addEventListener\('touchmove', [\s\S]*?\{ passive: true \}/);
});

test('refreshing state prevents re-arming the gesture mid-refresh', () => {
  const fnMatch = JS.match(/function initPortalPullToRefresh\(onRefresh\)[\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /if \(window\.scrollY > 0 \|\| refreshing\) return;/);
  assert.match(fnMatch[0], /if \(pulledPast && !refreshing\)/);
});

test('the refresh callback is awaited, resetting the indicator only once it genuinely completes', () => {
  const fnMatch = JS.match(/function initPortalPullToRefresh\(onRefresh\)[\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /Promise\.resolve\(onRefresh\(\)\)\.finally\(/);
});

test('every list page wires up pull-to-refresh to its own real reload function, not a placeholder', () => {
  assert.match(fs.readFileSync(repo('portal', 'home.html'), 'utf8'), /initPortalPullToRefresh\(init\);/);
  assert.match(fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8'), /initPortalPullToRefresh\(renderInvoices\);/);
  assert.match(fs.readFileSync(repo('portal', 'jobs.html'), 'utf8'), /initPortalPullToRefresh\(\(\) => renderJobs\(\)\.then\(renderCheckups\)\);/);
  assert.match(fs.readFileSync(repo('portal', 'quotes.html'), 'utf8'), /initPortalPullToRefresh\(renderQuotes\);/);
  assert.match(fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8'), /initPortalPullToRefresh\(renderMyRequests\);/);
});

test('pull-to-refresh is deliberately NOT wired to settings/login/set-password -- they are not refreshable lists', () => {
  for (const page of ['settings.html', 'login.html', 'set-password.html']) {
    const html = fs.readFileSync(repo('portal', page), 'utf8');
    assert.doesNotMatch(html, /initPortalPullToRefresh\(/, `${page}: not a list page, should not have this wired up`);
  }
});

test('motion respects prefers-reduced-motion for both new features', () => {
  const reducedBlocks = [...CSS.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g)];
  assert.ok(reducedBlocks.some((b) => /offline-banner/.test(b[0])), 'expected offline banner covered');
  assert.ok(reducedBlocks.some((b) => /ptr-indicator/.test(b[0])), 'expected pull-to-refresh spinner covered');
});

test('both new shared files are precached and CACHE_NAME was bumped again for this change', () => {
  assert.match(SW, /const CACHE_NAME = 'th-portal-v5';/);
  assert.match(SW, /'\/portal\/portal-app\.js'/);
  assert.match(SW, /'\/portal\/portal-app\.css'/);
});
