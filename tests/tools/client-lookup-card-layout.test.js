// Test for a real reported bug (2026-09-05): "the clients page on
// computer does not fit or work right." Traced to a genuine CSS bug
// in the Client Lookup card built earlier the same day:
// flex-direction: column was set inline, but justify-content:
// space-between from the base .dev-check-row class was never
// overridden alongside it -- combined, this pushed the "Download for
// Dispute" button far away from the client's info above it, most
// visible on a wider/taller desktop panel where the gap is obvious.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'clients.html'), 'utf8');

test('the base .dev-check-row class really does default to justify-content: space-between, confirming why an override was needed', () => {
  const baseMatch = HTML.match(/\.dev-check-row \{[^}]*\}/);
  assert.ok(baseMatch, 'expected to find the base .dev-check-row rule');
  assert.match(baseMatch[0], /justify-content: space-between/);
});

test('renderClientLookupCard\u2019s own flex-direction: column override also overrides justify-content, so the button sits right below the content instead of being pushed away by the base class\u2019s space-between', () => {
  const fnMatch = HTML.match(/function renderClientLookupCard\(p\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderClientLookupCard()');
  assert.match(fnMatch[0], /flex-direction:column/);
  assert.match(fnMatch[0], /justify-content:flex-start/);
});
