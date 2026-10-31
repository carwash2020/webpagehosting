// Tests for the Portal client errors viewer panel in Dev Tools
// (2026-09-05), the companion piece to portal/portal-app.js's own
// capture mechanism -- this is where Connor actually sees what got
// caught.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
// The panel moved from Clients -> Portal to Dev Tools -> Health in the
// redundancy pass (2026-10-31); these follow it there, unchanged.
const CLIENTS = fs.readFileSync(repo('tools', 'clients.html'), 'utf8');
const DEV_TOOLS = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');
const DEV_SHARED = fs.readFileSync(repo('tools', 'dev-tools-shared.js'), 'utf8');

test('the panel uses the correct dev-panel class, matching every other panel on this page', () => {
  const block = DEV_TOOLS.match(/<div class="dev-panel">\s*<div class="dev-panel-heading">\s*<h2>Portal client errors<\/h2>/);
  assert.doesNotMatch(CLIENTS, /<h2>Portal client errors<\/h2>|id="portalClientErrors"|function renderPortalClientErrors/, 'moved, not copied');
  assert.ok(block, 'expected the Portal client errors panel to use class="dev-panel", not something else');
});

test('the render function is read-only -- no resolve action, unlike Portal bug reports', () => {
  const fnMatch = DEV_TOOLS.match(/async function renderPortalClientErrors\(\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch ? fnMatch[0] : '', /portal_client_errors\?select=\*&order=created_at\.desc&limit=50/, 'the same table, read the same way');
  assert.ok(fnMatch, 'expected to isolate renderPortalClientErrors()');
  assert.doesNotMatch(fnMatch[0], /resolve/i);
});

test('the panel is actually initialized with Dev Tools\' other live-status panels, not just defined and never called', () => {
  assert.match(DEV_TOOLS, /renderPortalBugReports\(\);\s*\n\s*renderPortalClientErrors\(\);/);
  // Inside Health -> Live status, beside the internal tools' Client errors.
  const health = DEV_TOOLS.slice(DEV_TOOLS.indexOf('id="devSecHealthLive"'), DEV_TOOLS.indexOf('id="devSecHealthChecks"'));
  assert.ok(health.indexOf('<h2>Client errors</h2>') > -1 && health.indexOf('id="portalBugReports"') > health.indexOf('<h2>Client errors</h2>') && health.indexOf('id="portalClientErrors"') > -1);
});

test('the info bubble has a real, matching DEV_INFO entry -- a missing one would make the ? button silently do nothing', () => {
  assert.match(DEV_TOOLS, /onclick="openDevInfo\('portalclienterrors'\)"/);
  assert.match(DEV_SHARED, /portalclienterrors: \{/);
});
