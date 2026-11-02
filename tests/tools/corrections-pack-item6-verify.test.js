// Item 6 of the corrections pack (2026-11-01) is verify-only, per Connor:
// "leave Inventory data screenless, bug reports under Dev Tools > Health,
// Gallery under Site Content permission -- verify, don't move." These pin
// down what was found true at the time of verification, so a later session
// doesn't have to re-derive it from scratch, and so a real regression (one
// of these three quietly becoming untrue) gets caught.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');

test('(a) Inventory has no dedicated screen/tab anywhere in the Workspace tools -- th_inventory data stays screenless', () => {
  for (const f of fs.readdirSync(TOOLS)) {
    if (!f.endsWith('.html')) continue;
    const src = read(f);
    // A tab button or nav entry literally labelled Inventory would be the
    // screen this item says must not exist. th_inventory the storage key,
    // and prose mentioning the Inventory tab's past removal, are fine.
    assert.doesNotMatch(src, /data-tab="inventory"|<button[^>]*>Inventory<\/button>|dev-tab-btn[^>]*inventory/i,
      `${f} appears to have an Inventory tab/screen`);
  }
});

test('(b) Portal bug reports live under Dev Tools > Health, gated the same as every other Health panel', () => {
  const devTools = read('dev-tools.html');
  const healthTabIdx = devTools.indexOf('data-tab="health"');
  assert.ok(healthTabIdx >= 0, 'expected a Health tab in Dev Tools');
  const bugReportsIdx = devTools.indexOf('Portal bug reports');
  assert.ok(bugReportsIdx >= 0, 'expected a "Portal bug reports" section');
  // "Health" tab button appears before the "Portal bug reports" heading,
  // and the comment right above it says it's full-technical-access gated
  // like the rest of Health.
  assert.ok(healthTabIdx < bugReportsIdx, 'expected Portal bug reports to come after the Health tab definition, i.e. to live inside it');
  assert.match(devTools, /Health is technical except for the\s*\n\s*client portal's bug reports[\s\S]{0,200}full technical access only, as every other Health panel/);
});

test('(c) Gallery is gated under Site Content\'s own can_manage_site_content permission, not a separate one', () => {
  const siteContent = read('site-content.html');
  assert.match(siteContent, /id="section-gallery"/);
  assert.match(siteContent, /canManageSiteContent/);
  assert.match(siteContent, /retryRoleCheck\(this, canManageSiteContent\)/);
});
