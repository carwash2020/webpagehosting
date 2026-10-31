// Tests for three real audit-flagged gaps closed together: parts
// inventory tracking, job-duration ($/hr) tracking, and a Part Cost
// Trend lookup -- Appliance Wiki only ever tracked WHAT part fixes what
// (reference data), never what's actually on hand or how prices moved
// over time, and there was no way to sanity-check a quoted job's hours
// against how long it actually took. Source-inspection style, same
// reasoning as other tool-page tests in this suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FINANCE_PATH = path.join(__dirname, '..', '..', 'tools', 'finance.html');
const financeHtml = fs.readFileSync(FINANCE_PATH, 'utf8');
const JOB_TRACKER_PATH = path.join(__dirname, '..', '..', 'tools', 'job-tracker.html');
const jobTrackerHtml = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
const SYNC_PATH = path.join(__dirname, '..', '..', 'tools', 'sync.js');
const syncSrc = fs.readFileSync(SYNC_PATH, 'utf8');
const DATA_LAYER_PATH = path.join(__dirname, '..', '..', 'tools', 'data-layer.js');
const dataLayerSrc = fs.readFileSync(DATA_LAYER_PATH, 'utf8');
const WORKSPACE_PATH = path.join(__dirname, '..', '..', 'tools', 'workspace.html');
const workspaceHtml = fs.readFileSync(WORKSPACE_PATH, 'utf8');

// ---------- Inventory ----------

// Finance's Inventory tab left in the redundancy pass (2026-10-31): nothing
// else read th_inventory and it saw little use. Only its screen went --
// the stored list keeps syncing, backing up and taking tombstones, and
// Dev Tools still restores a deleted part (see the tests below and
// tests/sync/tombstone-coverage.test.js).

test('finance.html no longer has an Inventory tab, and no page renders th_inventory -- the data itself is untouched', () => {
  assert.doesNotMatch(financeHtml, /data-tab="inventory"|id="tab-inventory"|id="inventoryTable"|function renderInventory|function saveInventory/);
  assert.doesNotMatch(financeHtml, /inventory: 'inventory'/);
  assert.match(financeHtml, /Inventory \(th_inventory\) left with its tab/);
});

test('th_inventory is registered in sync.js -- the exact bug class already found once for th_parts_reference_units', () => {
  assert.match(syncSrc, /'th_inventory_tombstones',\s*\n\s*'th_inventory',/);
  assert.match(syncSrc, /th_inventory_tombstones:\s*'id',/);
  assert.match(syncSrc, /th_inventory:\s*'id',/);
});

test('th_inventory is included in the Backup/Restore key list (on dev-tools.html since 2026-09-22, when Backup & Restore moved there from Settings)', () => {
  const devToolsHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools.html'), 'utf8');
  const settingsHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'settings.html'), 'utf8');
  // Since 2026-10-01 the backup reads sync.js's own key list, so th_inventory
  // is backed up because it syncs (tests/tools/full-backup-keys.test.js).
  const syncJs = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'sync.js'), 'utf8');
  assert.match(syncJs, /const SYNC_DATA_KEYS = \[[\s\S]*?'th_inventory',[\s\S]*?\n\];/);
  assert.match(devToolsHtml, /function fullBackupKeys\(\) \{[\s\S]*?SYNC_DATA_KEYS\.concat\(WIKI_SYNC_KEYS/);
  assert.doesNotMatch(workspaceHtml, /ALL_SYNCED_KEYS|fullBackupKeys/, 'the dashboard no longer owns the backup key list');
  assert.doesNotMatch(settingsHtml, /ALL_SYNCED_KEYS|fullBackupKeys/, 'Settings no longer owns the backup key list either');
});

test('inventory tombstones are still kept and honoured by sync, so a part deleted before the tab left stays deleted', () => {
  assert.match(dataLayerSrc, /function thAddInventoryTombstone\(id\)/);
  assert.match(syncSrc, /th_inventory_tombstones/);
});

// ---------- Part Cost Trend ----------

test('Part Cost Trend matches by Part Number first, falling back to a Description substring match', () => {
  const fnMatch = financeHtml.match(/function renderPartCostTrend\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderPartCostTrend()');
  const body = fnMatch[0];
  const partNumberIdx = body.indexOf('e.partNumber || \'\').toLowerCase() === term');
  const descIdx = body.indexOf('(e.desc || \'\').toLowerCase().includes(term)');
  assert.ok(partNumberIdx !== -1 && descIdx !== -1 && partNumberIdx < descIdx,
    'part number matching must be attempted before falling back to description matching');
});

test('Part Cost Trend excludes mileage entries -- there is no "cost" of a mileage log line to trend', () => {
  const fnMatch = financeHtml.match(/function renderPartCostTrend\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /loadExpenses\(\)\.filter\(e => e\.type !== 'mileage'\)/);
});

test('renderExpenses() always keeps the Part Cost Trend results in sync, rather than needing every add/edit/delete call site updated individually', () => {
  const fnMatch = financeHtml.match(/function renderExpenses\(\) \{[\s\S]*?\n\s*let entries/);
  assert.ok(fnMatch, 'expected to isolate the start of renderExpenses()');
  assert.match(fnMatch[0], /renderPartCostTrend\(\);/);
});

// ---------- Job duration ($/hr) ----------

test('a job can record actual hours worked, wired through add/edit/reset like every other job field', () => {
  assert.match(jobTrackerHtml, /<input type="number" id="jobHoursWorked"/);
  assert.match(jobTrackerHtml, /hoursWorked: parseFloat\(document\.getElementById\('jobHoursWorked'\)\.value\) \|\| null,/);
  assert.match(jobTrackerHtml, /document\.getElementById\('jobHoursWorked'\)\.value = job\.hoursWorked \|\| '';/);
});

test('$/hr is only shown when both a real margin AND hoursWorked exist -- never a divide-by-zero or misleading rate on incomplete data', () => {
  const fnMatch = jobTrackerHtml.match(/const effectiveRateHtml = \(margin && margin\.hasInvoice && job\.hoursWorked\)[\s\S]*?;\n/);
  assert.ok(fnMatch, 'expected to find the $/hr computation gated on margin.hasInvoice && job.hoursWorked');
});

test('finance.html\'s Job Profitability tab shows the same $/hr figure, computed the same way (revenue / hoursWorked)', () => {
  const fnMatch = financeHtml.match(/function renderJobProfitability\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderJobProfitability()');
  assert.match(fnMatch[0], /revenue \/ job\.hoursWorked/);
});
