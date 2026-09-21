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

test('finance.html has an Inventory tab wired into the shared tab system', () => {
  assert.match(financeHtml, /<button class="tab-btn" data-tab="inventory">Inventory<\/button>/);
  assert.match(financeHtml, /<div class="tab-panel" id="tab-inventory">/);
  assert.match(financeHtml, /inventory: 'inventory'/);
});

test('th_inventory is registered in sync.js -- the exact bug class already found once for th_parts_reference_units', () => {
  assert.match(syncSrc, /'th_inventory_tombstones',\s*\n\s*'th_inventory',/);
  assert.match(syncSrc, /th_inventory_tombstones:\s*'id',/);
  assert.match(syncSrc, /th_inventory:\s*'id',/);
});

test('th_inventory is included in the Backup/Restore key list (on settings.html since 2026-09-21, when Backup & Restore moved there from the dashboard)', () => {
  const settingsHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'settings.html'), 'utf8');
  assert.match(settingsHtml, /ALL_SYNCED_KEYS = \[[\s\S]*?'th_inventory'[\s\S]*?\];/);
  assert.doesNotMatch(workspaceHtml, /ALL_SYNCED_KEYS/, 'the dashboard no longer owns the backup key list');
});

test('a deleted inventory item gets a tombstone, same pattern as every other deletable record type', () => {
  assert.match(dataLayerSrc, /function thAddInventoryTombstone\(id\)/);
  assert.match(financeHtml, /if \(typeof thAddInventoryTombstone === 'function'\) thAddInventoryTombstone\(id\);/);
});

test('low-stock parts (qty at or below reorderAt) sort first and get a visible warning badge', () => {
  const fnMatch = financeHtml.match(/function renderInventory\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderInventory()');
  assert.match(fnMatch[0], /const aLow = a\.qty <= a\.reorderAt \? 0 : 1;/);
  assert.match(fnMatch[0], /Reorder/);
});

test('inventory writes go through the same localStorage + scheduleSync pattern as every other tab', () => {
  assert.match(financeHtml, /function saveInventory\(list\) \{ localStorage\.setItem\(INVENTORY_STORAGE_KEY, JSON\.stringify\(list\)\); if \(typeof scheduleSync === 'function'\) scheduleSync\(\); \}/);
});

test('the inventory table gets the same mobile card-stacking treatment as the Income/Expenses tables, not a sideways scroll', () => {
  const mediaMatch = financeHtml.match(/@media \(max-width: 1023px\) \{[\s\S]*?\n  \}/);
  assert.ok(mediaMatch, 'expected to isolate the mobile responsive-table block');
  assert.match(mediaMatch[0], /#inventoryTable/);
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
