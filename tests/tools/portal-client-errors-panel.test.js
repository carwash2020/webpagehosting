// Tests for the Portal client errors viewer panel in Dev Tools
// (2026-09-05), the companion piece to portal/portal-app.js's own
// capture mechanism -- this is where Connor actually sees what got
// caught.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const CLIENTS = fs.readFileSync(repo('tools', 'clients.html'), 'utf8');
const DEV_SHARED = fs.readFileSync(repo('tools', 'dev-tools-shared.js'), 'utf8');

test('the panel uses the correct dev-panel class, matching every other panel on this page', () => {
  const block = CLIENTS.match(/<div class="dev-panel">\s*<div class="dev-panel-heading">\s*<h2>Portal client errors<\/h2>/);
  assert.ok(block, 'expected the Portal client errors panel to use class="dev-panel", not something else');
});

test('the render function is read-only -- no resolve action, unlike Portal bug reports', () => {
  const fnMatch = CLIENTS.match(/async function renderPortalClientErrors\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderPortalClientErrors()');
  assert.doesNotMatch(fnMatch[0], /resolve/i);
});

test('the panel is actually initialized alongside the other Portal panels, not just defined and never called', () => {
  assert.match(CLIENTS, /renderPortalBugReports\(\);\s*\n\s*renderPortalClientErrors\(\);/);
});

test('the info bubble has a real, matching DEV_INFO entry -- a missing one would make the ? button silently do nothing', () => {
  assert.match(CLIENTS, /onclick="openDevInfo\('portalclienterrors'\)"/);
  assert.match(DEV_SHARED, /portalclienterrors: \{/);
});
