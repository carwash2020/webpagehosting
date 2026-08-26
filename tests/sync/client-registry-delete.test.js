// Tests for the Client Registry delete button (2026-08-21), requested
// directly: the registry had a ton of duplicates and no way to remove
// one. thDeleteClient() removes only the registry record itself --
// never the underlying jobs/invoices/quotes, which are separate, real
// records matched by name independently of any specific registry
// entry, so nothing else is affected by removing a duplicate.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
const DEV_TOOLS_PATH = path.join(TOOLS_DIR, 'dev-tools.html');

function loadDevTools(clients) {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const dataLayerSrc = fs.readFileSync(path.join(TOOLS_DIR, 'data-layer.js'), 'utf8');
  const dialogsSrc = fs.readFileSync(path.join(TOOLS_DIR, 'tools-dialogs.js'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.localStorage.setItem('th_clients', JSON.stringify(clients));
      w.localStorage.setItem('th_tracker_jobs', '[]');
    },
  });
  const { window } = dom;
  for (const src of [dataLayerSrc, dialogsSrc]) {
    const s = window.document.createElement('script');
    s.textContent = src;
    window.document.head.appendChild(s);
  }
  window.showToast = () => {};
  return window;
}

test('thDeleteClient removes only the matching record by id, leaving every other record untouched', () => {
  const window = loadDevTools([
    { id: 'c1', name: 'Bob Smith' },
    { id: 'c2', name: 'bob smith' },
    { id: 'c3', name: 'Carla Diaz' },
  ]);
  const remaining = window.thDeleteClient('c1');
  assert.equal(JSON.stringify(remaining.map(c => c.id)), JSON.stringify(['c2', 'c3']));
  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_clients')).map(c => c.id), ['c2', 'c3']);
});

test('thDeleteClient calls thSaveClients (which calls thWrite internally, already handling the sync push) rather than a direct localStorage call -- avoiding the exact "cleared locally but never pushed" mistake already found and fixed on the Client Errors log', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'data-layer.js'), 'utf8');
  const fnMatch = src.match(/function thDeleteClient\(id\)[\s\S]*?\n}/);
  assert.ok(fnMatch, 'thDeleteClient not found');
  assert.doesNotMatch(fnMatch[0], /localStorage\.(setItem|removeItem)/, 'should go through thSaveClients, not touch localStorage directly');
  assert.match(fnMatch[0], /thSaveClients/);
});

test('the Client Registry UI shows a real Delete button per client, and clicking it (after confirming) genuinely removes that client and re-renders the list', async () => {
  const window = loadDevTools([
    { id: 'c1', name: 'Bob Smith' },
    { id: 'c2', name: 'bob smith' },
  ]);
  window.showConfirm = async () => true;

  window.renderClientRegistry();
  assert.equal(window.document.querySelectorAll('[data-client-id]').length, 2);

  await window.deleteClientFromRegistry('c1');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_clients')).map(c => c.id), ['c2']);
  assert.equal(window.document.querySelectorAll('[data-client-id]').length, 1);
});

test('declining the confirmation dialog does NOT delete anything -- a destructive action should never proceed without a real yes', async () => {
  const window = loadDevTools([{ id: 'c1', name: 'Bob Smith' }]);
  window.showConfirm = async () => false; // simulates the user clicking Cancel

  await window.deleteClientFromRegistry('c1');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_clients')).map(c => c.id), ['c1'], 'should not have deleted anything after a declined confirmation');
});

test('deleteClientFromRegistry uses showConfirm (the app\'s shared custom modal), not a plain window.confirm(), matching the established pattern used elsewhere (e.g. deleteJob on job-tracker.html)', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const fnMatch = src.match(/async function deleteClientFromRegistry\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteClientFromRegistry not found');
  assert.match(fnMatch[0], /showConfirm\(/);
  assert.doesNotMatch(fnMatch[0], /window\.confirm\(/);
});

// Bug fix (2026-08-25), reported directly: "when i delete people out of
// the client registry it readds them on its own." Root cause: deleting
// a client only ever removed the registry entry, by design leaving the
// underlying jobs/invoices untouched -- so thBackfillClients, seeing
// that name still referenced with no matching registry record, would
// recreate it on its very next run. Fixed with a real tombstone.

test('thDeleteClient records a tombstone (by id and by normalized name) alongside removing the registry entry', () => {
  const window = loadDevTools([{ id: 'c1', name: 'Sarah Miller' }]);
  window.thDeleteClient('c1');

  const tombstones = JSON.parse(window.localStorage.getItem('th_client_tombstones') || '[]');
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, 'c1');
  assert.equal(tombstones[0].normalizedName, 'sarah miller');
});

test('thBackfillClients does not recreate a deleted client, even though their job still references that exact name (deletion deliberately never touches jobs/invoices)', () => {
  const window = loadDevTools([{ id: 'c1', name: 'Sarah Miller' }]);
  window.localStorage.setItem('th_tracker_jobs', JSON.stringify([{ id: 'j1', client: 'Sarah Miller', date: '2026-08-01' }]));

  window.thDeleteClient('c1');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_clients')), [], 'client should be gone immediately after delete');

  const result = window.thBackfillClients();
  assert.equal(result.created, 0, 'backfill should not have created anything -- the name is tombstoned');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_clients')), [], 'client should still be gone after a backfill run');
});

test('a stale device pushing back its old copy of a deleted client does not resurrect it on pull, since the tombstone (already merged first) is consulted when merging th_clients', () => {
  const syncJs = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
  const syncDataKeysMatch = syncJs.match(/const SYNC_DATA_KEYS = \[[\s\S]*?\n\];/);
  const mergeKeyFieldMatch = syncJs.match(/const MERGE_KEY_FIELD = \{[\s\S]*?\n\};/);
  const mergeRecordArraysMatch = syncJs.match(/function mergeRecordArrays[\s\S]*?\n\}/);
  const mergePartsMatch = syncJs.match(/function mergePartsReferenceUnits[\s\S]*?\n\}/);
  const mergeClientErrorLogMatch = syncJs.match(/const CLIENT_ERROR_LOG_MAX_AFTER_MERGE[\s\S]*?function mergeClientErrorLog[\s\S]*?\n\}/);
  const applySyncDataMatch = syncJs.match(/function applySyncData[\s\S]*?\n\}/);
  assert.ok(syncDataKeysMatch && mergeKeyFieldMatch && mergeRecordArraysMatch && mergePartsMatch && mergeClientErrorLogMatch && applySyncDataMatch, 'one or more required sync.js functions not found');
  assert.match(syncDataKeysMatch[0], /th_client_tombstones/, 'th_client_tombstones should be a synced key');

  const window = loadDevTools([{ id: 'c1', name: 'Sarah Miller' }]);
  window.thDeleteClient('c1'); // local delete + local tombstone

  const combined = [
    syncDataKeysMatch[0], mergeKeyFieldMatch[0], mergeRecordArraysMatch[0],
    mergePartsMatch[0], mergeClientErrorLogMatch[0], applySyncDataMatch[0],
  ].join('\n');
  window.eval(combined);

  // A stale device that never pulled the deletion, pushing its old copy back.
  window.applySyncData({
    th_clients: JSON.stringify([{ id: 'c1', name: 'Sarah Miller' }]),
    th_client_tombstones: JSON.stringify([]),
  });

  const finalClients = JSON.parse(window.localStorage.getItem('th_clients'));
  assert.deepEqual(finalClients, [], 'the resurrected client from the stale push should have been filtered back out by the tombstone');
});

// Same bug class, found for jobs (2026-08-26) while adding live sync to
// job-detail.html and directly testing "job deleted by someone else
// while this page is open": deleteJob() removed the job locally but
// recorded nothing, unlike thDeleteClient right above. Fixed with the
// identical tombstone mechanism, extended to jobs.

test('thAddJobTombstone records a tombstone by id, readable back via thLoadJobTombstones', () => {
  const window = loadDevTools([]);
  window.thAddJobTombstone('j1');
  const tombstones = window.thLoadJobTombstones();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, 'j1');
  assert.ok(tombstones[0].deletedAt, 'should record when the deletion happened');
});

test('deleteJob (job-tracker.html) actually calls thAddJobTombstone when the deletion finalizes, not just removing the job locally', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  const fnMatch = src.match(/async function deleteJob\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteJob not found');
  assert.match(fnMatch[0], /thAddJobTombstone\(/, 'deleteJob should record a tombstone, the same fix already applied to thDeleteClient');
});

test('a stale device pushing back its old copy of a deleted job does not resurrect it on pull, since the tombstone (already merged first) is consulted when merging th_tracker_jobs -- the exact same scenario already fixed for clients, extended to jobs', () => {
  const syncJs = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
  const syncDataKeysMatch = syncJs.match(/const SYNC_DATA_KEYS = \[[\s\S]*?\n\];/);
  const mergeKeyFieldMatch = syncJs.match(/const MERGE_KEY_FIELD = \{[\s\S]*?\n\};/);
  const mergeRecordArraysMatch = syncJs.match(/function mergeRecordArrays[\s\S]*?\n\}/);
  const mergePartsMatch = syncJs.match(/function mergePartsReferenceUnits[\s\S]*?\n\}/);
  const mergeClientErrorLogMatch = syncJs.match(/const CLIENT_ERROR_LOG_MAX_AFTER_MERGE[\s\S]*?function mergeClientErrorLog[\s\S]*?\n\}/);
  const applySyncDataMatch = syncJs.match(/function applySyncData[\s\S]*?\n\}/);
  assert.ok(syncDataKeysMatch && mergeKeyFieldMatch && mergeRecordArraysMatch && mergePartsMatch && mergeClientErrorLogMatch && applySyncDataMatch, 'one or more required sync.js functions not found');
  assert.match(syncDataKeysMatch[0], /th_job_tombstones/, 'th_job_tombstones should be a synced key');

  const window = loadDevTools([]);
  window.thAddJobTombstone('j1'); // simulates deleteJob's own tombstone-recording step

  const combined = [
    syncDataKeysMatch[0], mergeKeyFieldMatch[0], mergeRecordArraysMatch[0],
    mergePartsMatch[0], mergeClientErrorLogMatch[0], applySyncDataMatch[0],
  ].join('\n');
  window.eval(combined);

  // A stale device that never pulled the deletion, pushing its old copy back.
  window.applySyncData({
    th_tracker_jobs: JSON.stringify([{ id: 'j1', title: 'Old Job' }]),
    th_job_tombstones: JSON.stringify([]),
  });

  const finalJobs = JSON.parse(window.localStorage.getItem('th_tracker_jobs'));
  assert.deepEqual(finalJobs, [], 'the resurrected job from the stale push should have been filtered back out by the tombstone');
});
