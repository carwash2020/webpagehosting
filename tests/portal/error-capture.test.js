// Tests for automatic portal error capture (2026-09-05), requested
// directly: "future proof this... what other layers can we add."
// Internal tools already catch every JS error automatically
// (th_client_errors); the portal only had a client-INITIATED
// "Report a problem" button. A silent bug could go unnoticed
// indefinitely unless a client happened to notice and bothered
// reporting it themselves.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JS = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');

test('the capture is self-contained -- it never depends on the page\u2019s own SUPABASE_URL/ANON_KEY globals, since this file loads before those are defined further down each page', () => {
  const block = JS.match(/const PORTAL_ERROR_LOG_SUPABASE_URL[\s\S]*?const PORTAL_ERROR_LOG_ANON_KEY = '[^']+';/);
  assert.ok(block, 'expected dedicated, self-contained constants');
  assert.match(block[0], /https:\/\/csvfqdjuobylgafgolho\.supabase\.co/);
});

test('both window.error and unhandledrejection are captured, not just one', () => {
  assert.match(JS, /window\.addEventListener\('error', \(event\) => \{/);
  assert.match(JS, /window\.addEventListener\('unhandledrejection', \(event\) => \{/);
});

test('a per-page-load cap exists, since a genuine error inside a loop could otherwise flood the table with identical rows', () => {
  assert.match(JS, /const PORTAL_ERROR_LOG_MAX_PER_PAGE = 10;/);
  const fnMatch = JS.match(/function logPortalClientError\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate logPortalClientError()');
  assert.match(fnMatch[0], /if \(portalErrorLogCount >= PORTAL_ERROR_LOG_MAX_PER_PAGE\) return;/);
});

test('a thrown lookup while trying to attach the client email never prevents the actual error report from going out', () => {
  const fnMatch = JS.match(/function logPortalClientError\([\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /catch \(e\) \{ \/\* fall through to sending without an email below \*\/ \}/);
});

test('sending itself never throws back into the caller -- a failed report must not become a second error', () => {
  const fnMatch = JS.match(/function sendPortalErrorReport\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate sendPortalErrorReport()');
  assert.match(fnMatch[0], /\.catch\(\(\) => \{ \/\* best-effort; a failed report is not itself worth reporting \*\/ \}\)/);
});

test('every portal page loads portal-app.js, so capture applies everywhere including pre-auth pages', () => {
  for (const page of ['home', 'dashboard', 'jobs', 'quotes', 'work-orders', 'settings', 'login', 'set-password']) {
    const html = fs.readFileSync(repo('portal', `${page}.html`), 'utf8');
    assert.match(html, /portal-app\.js/, `${page}.html should load portal-app.js`);
  }
});

test('both service workers were bumped since portal-app.js (portal) and data-layer.js/dev-tools-shared.js (tools) changed, and each is precached under a bare path with no ?v=', () => {
  const portalSW = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');
  assert.match(portalSW, /const CACHE_NAME = 'th-portal-v8';/);
  const toolsSW = fs.readFileSync(repo('service-worker.js'), 'utf8');
  assert.match(toolsSW, /const CACHE_NAME = 'th-workspace-v55';/);
});
