// UI audit findings F19, F20, F21, F22 (7 September 2026) -- Tier 3,
// "Mobile, the primary device": these tools are used one-handed on a
// phone at a job site.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const STYLES_TOOLS = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');

test('F19: the invoice/quote line-items editor stacks into labeled cards below 760px, with a data-label on every cell the row builders emit', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'invoice-generator.html'), 'utf8');
  assert.match(src, /@media \(max-width: 760px\) \{[\s\S]*?\.table-scroll \.line-items-table \{ min-width: 0; \}/);
  assert.match(src, /\.line-items-table td\[data-label\]::before/);
  // Both row-builder functions (invoice tab + quote tab) must carry
  // the labels, not just one.
  const dataLabelCount = [...src.matchAll(/data-label="/g)].length;
  assert.ok(dataLabelCount >= 12, `expected at least 12 data-label attributes (6 columns x 2 tabs), found ${dataLabelCount}`);
});

test('F20: Finance\'s Income and Expense logs get the same responsive card treatment below 1024px, scoped only to their own containers', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  assert.match(src, /@media \(max-width: 1023px\) \{[\s\S]*?#incomeTable table, #entriesTable table \{ min-width: 0; \}/);
  assert.match(src, /#incomeTable td\[data-label\]::before, #entriesTable td\[data-label\]::before/);
  const incomeLabels = [...src.matchAll(/data-label="(?:Date|Source|Job|Description|Payment|Origin|Amount)"/g)].length;
  const expenseLabels = [...src.matchAll(/data-label="(?:Type|Vendor|Miles|Receipt)"/g)].length;
  assert.ok(incomeLabels >= 7, 'expected the income row builder to label every column');
  assert.ok(expenseLabels >= 4, 'expected the expense row builder to label every column');
});

test('F21: no double-scroll -- the min-width:0 override for these two tables prevents the outer .table-scroll from ever needing to scroll horizontally too', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  // The shared .table-scroll table{min-width:640px} rule is what
  // originally forced both the inner (#incomeTable/#entriesTable,
  // max-height:60vh;overflow-y:auto) and outer (.table-scroll) surfaces
  // to scroll horizontally -- confirmed fixed by direct measurement
  // (both scrollWidth === clientWidth at both a phone and a desktop
  // width, with real seeded data) rather than assumed from the CSS.
  assert.match(STYLES_TOOLS, /#incomeTable, #entriesTable \{\s*max-height: 60vh;\s*overflow-y: auto;\s*\}/);
  assert.match(src, /#incomeTable table, #entriesTable table \{ min-width: 0; \}/);
});

test('F22: touch targets bumped to real sizes across the suite, verified where a tight layout risked overlap or overflow', () => {
  // The shared .help-btn (help modals, back-to-workspace, settings --
  // used across every tool page) was still 36px on phone.
  assert.match(STYLES_TOOLS, /body \.help-btn \{ width: 44px; height: 44px; \}/);

  // Finance's Miles info button and workspace's refresh-sync button
  // were both shrunk below the shared size via an inline style.
  const finance = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  assert.doesNotMatch(finance, /class="help-btn" onclick="openCardInfo\('mileageRate'\)"[^>]*style="width:22px/);
  const workspace = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.doesNotMatch(workspace, /id="refreshSyncLink"[^>]*style="width:26px/);

  // Runway Dashboard: row actions (~21px), category add (~26px), and
  // tabs (~37px) were all below any reasonable touch minimum.
  const runway = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  assert.match(runway, /@media \(max-width: 720px\) \{[\s\S]*?\.icon-btn \{ min-width: 44px; min-height: 44px; padding: 10px; \}/);
  assert.match(runway, /\.cat-add-btn \{ width: 44px; height: 44px; \}/);
  assert.match(runway, /\.rw-tab-btn \{ min-height: 44px; \}/);

  // Job Tracker's photo overlay buttons (26x26) -- verified they still
  // fit a 110px-wide thumbnail without overlapping each other.
  const jobTracker = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  assert.match(jobTracker, /\.photo-thumb-delete \{[\s\S]*?width: 44px; height: 44px;/);
  assert.match(jobTracker, /\.photo-thumb-star \{[\s\S]*?width: 44px; height: 44px;/);

  // Appliance Wiki's per-issue edit/delete/copy/pin row (24x24),
  // "used one-handed at a job site" -- phone-scoped since up to 4 sit
  // in one row, with flex-wrap added as a safety net.
  const partsRef = fs.readFileSync(path.join(TOOLS_DIR, 'parts-reference.html'), 'utf8');
  assert.match(partsRef, /\.pr-issue-actions \{ display: flex; gap: 10px; margin-top: 10px; align-items: center; flex-wrap: wrap; \}/);
  assert.match(partsRef, /@media \(max-width: 720px\) \{\s*\.pr-row-icon-btn \{ width: 44px; height: 44px; \}/);

  // Workspace's period filters (~31px).
  assert.match(workspace, /@media \(max-width: 720px\) \{ \.period-btn \{ min-height: 44px; \} \}/);

  // The public homepage's review carousel dots (the touch-target concern
  // this originally fixed) no longer exist at all -- U03 (High-Impact
  // Upgrades, 2026-09-07) replaced the carousel with a static two-column
  // wall showing all 7 reviews at once, retiring .carousel-dot entirely
  // rather than leaving it to fix.
  assert.doesNotMatch(STYLES, /\.carousel-dot/);
});
