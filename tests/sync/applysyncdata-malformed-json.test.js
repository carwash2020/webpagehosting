// Tests for fixing applySyncData()'s unguarded/mishandled JSON.parse
// (audit item #12). remoteArr and localArr used to be parsed inside
// one shared try, whose catch fell back to
// `localStorage.setItem(k, obj[k])` no matter which side actually
// failed to parse. That fallback silently corrupted a device's local
// copy whenever the REMOTE payload was the malformed one (a truncated
// push, a corrupted network response, a bug on whichever device sent
// it): it took the exact string that had just thrown a SyntaxError
// and wrote it into localStorage anyway. The next thing on this
// device to call JSON.parse(localStorage.getItem(k)) -- which is
// nearly everything in this app -- would then throw too, spreading a
// single bad remote push into a broken local app.
//
// The fix parses remote and local separately: a malformed remote
// value is logged and the key is skipped entirely (local storage left
// exactly as it was, no other key's processing is affected); a
// malformed LOCAL value (the remote side parsed fine) is treated as
// an empty array, letting the merge below replace it with the good
// remote data.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
const SYNC_JS = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');

function loadSyncModule() {
  const dom = new JSDOM('', { runScripts: 'dangerously', url: 'https://example.com/tools/x.html' });
  const { window } = dom;
  const syncDataKeysMatch = SYNC_JS.match(/const SYNC_DATA_KEYS = \[[\s\S]*?\n\];/);
  const mergeKeyFieldMatch = SYNC_JS.match(/const MERGE_KEY_FIELD = \{[\s\S]*?\n\};/);
  const deepEqualValueMatch = SYNC_JS.match(/function deepEqualValue[\s\S]*?\n\}/);
  const mergeRecordArraysMatch = SYNC_JS.match(/function mergeRecordArrays[\s\S]*?\n\}/);
  const mergePartsMatch = SYNC_JS.match(/function mergePartsReferenceUnits[\s\S]*?\n\}/);
  const mergeClientErrorLogMatch = SYNC_JS.match(/const CLIENT_ERROR_LOG_MAX_AFTER_MERGE[\s\S]*?function mergeClientErrorLog[\s\S]*?\n\}/);
  const mergeGraveyardMatch = SYNC_JS.match(/function mergeGraveyard[\s\S]*?\n\}/);
  const syncBaseKeyMatch = SYNC_JS.match(/const SYNC_BASE_KEY = '[^']+';/);
  const loadSyncBaseMatch = SYNC_JS.match(/function loadSyncBase\(\)[\s\S]*?\n\}/);
  const saveSyncBaseForKeyMatch = SYNC_JS.match(/function saveSyncBaseForKey[\s\S]*?\n\}/);
  const syncConflictLogMaxMatch = SYNC_JS.match(/const SYNC_CONFLICT_LOG_MAX = \d+;/);
  const mergeSyncConflictsMatch = SYNC_JS.match(/function mergeSyncConflicts[\s\S]*?\n\}/);
  const applySyncDataMatch = SYNC_JS.match(/function applySyncData[\s\S]*?\n\}/);
  const deriveInvoicePaidMatch = SYNC_JS.match(/function deriveInvoicePaid[\s\S]*?\n\}/);
  assert.ok(
    syncDataKeysMatch && mergeKeyFieldMatch && deepEqualValueMatch && mergeRecordArraysMatch &&
    mergePartsMatch && mergeClientErrorLogMatch && mergeGraveyardMatch && syncBaseKeyMatch &&
    loadSyncBaseMatch && saveSyncBaseForKeyMatch && syncConflictLogMaxMatch && mergeSyncConflictsMatch && applySyncDataMatch && deriveInvoicePaidMatch,
    'one or more required sync.js pieces not found'
  );
  const combined = [
    syncDataKeysMatch[0], mergeKeyFieldMatch[0], deepEqualValueMatch[0], mergeRecordArraysMatch[0],
    mergePartsMatch[0], mergeClientErrorLogMatch[0], mergeGraveyardMatch[0], syncBaseKeyMatch[0],
    loadSyncBaseMatch[0], saveSyncBaseForKeyMatch[0], syncConflictLogMaxMatch[0], mergeSyncConflictsMatch[0],
    applySyncDataMatch[0], deriveInvoicePaidMatch[0],
  ].join('\n');
  window.eval(combined);
  return window;
}

test('a malformed remote payload for one key does not overwrite this device\'s valid local copy of that key', () => {
  const window = loadSyncModule();
  const goodLocalData = JSON.stringify([{ id: 'j1', title: 'Fix washer' }]);
  window.localStorage.setItem('th_tracker_jobs', goodLocalData);

  let loggedCalls = [];
  window.logClientError = (...args) => { loggedCalls.push(args); };

  // Deliberately truncated/invalid JSON, as a corrupted push or a
  // network glitch might produce.
  window.applySyncData({ th_tracker_jobs: '[{"id":"j2","title":' });

  assert.equal(window.localStorage.getItem('th_tracker_jobs'), goodLocalData, 'local data must be untouched, not overwritten with the malformed remote string');
  assert.ok(loggedCalls.length >= 1, 'the anomaly should be logged, not silently swallowed');
  assert.match(loggedCalls[0][0], /malformed remote JSON for key "th_tracker_jobs"/);
});

test('a malformed remote payload for one key does not stop every OTHER key in the same payload from applying correctly', () => {
  const window = loadSyncModule();
  window.logClientError = () => {};

  window.applySyncData({
    th_tracker_jobs: 'not valid json at all {{{',
    th_clients: JSON.stringify([{ id: 'c1', name: 'Jane Doe' }]),
  });

  const clients = JSON.parse(window.localStorage.getItem('th_clients'));
  assert.equal(clients.length, 1);
  assert.equal(clients[0].name, 'Jane Doe');
});

test('a malformed LOCAL copy (remote parses fine) is treated as empty, letting the valid remote data win instead of throwing', () => {
  const window = loadSyncModule();
  window.localStorage.setItem('th_tracker_jobs', 'this was never valid JSON');

  window.applySyncData({ th_tracker_jobs: JSON.stringify([{ id: 'j1', title: 'Fix washer' }]) });

  const jobs = JSON.parse(window.localStorage.getItem('th_tracker_jobs'));
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'j1');
});

test('applySyncData() no longer contains the old shared-catch fallback that wrote obj[k] back on any parse failure', () => {
  const applySyncDataMatch = SYNC_JS.match(/function applySyncData[\s\S]*?\n\}/);
  assert.ok(applySyncDataMatch);
  assert.doesNotMatch(applySyncDataMatch[0], /malformed JSON on either side -- fall back to the old behavior rather than throw/);
});

test('a per-field merge conflict between `paid` and `paidAmount` cannot leave the merged invoice internally inconsistent', () => {
  // Real bug, 2026-09-16 (docs/specialist-logs/bugfix.md): mergeRecordArrays
  // resolves each field's own conflict independently. If device A's edit
  // only touched paidAmount (raising it to match total) and device B's
  // (stale) edit only touched `paid` (leaving it false), the field-level
  // merge can legitimately keep A's paidAmount and B's paid -- producing
  // an invoice that's fully paid by amount but still flagged unpaid, which
  // fed a real false "invoice overdue" push. applySyncData() must recompute
  // `paid` from paidAmount/total after merging th_invoices, not trust
  // whichever side's raw `paid` boolean survived the merge.
  const window = loadSyncModule();
  const base = [{ id: 'inv1', total: 125.0025, paid: false, paidAmount: 0 }];
  const local = [{ id: 'inv1', total: 125.0025, paid: false, paidAmount: 125 }]; // this device: recorded the payment
  const remote = [{ id: 'inv1', total: 125.0025, paid: false, paidAmount: 0 }]; // stale device: never saw the payment, re-pushed its old copy

  window.localStorage.setItem('th_sync_base', JSON.stringify({ th_invoices: base }));
  window.localStorage.setItem('th_invoices', JSON.stringify(local));
  window.applySyncData({ th_invoices: JSON.stringify(remote) });

  const merged = JSON.parse(window.localStorage.getItem('th_invoices'));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].paidAmount, 125, 'the recorded payment amount must survive the merge');
  assert.equal(merged[0].paid, true, 'paid must be derived from paidAmount vs total, not left as a stale false');
});

test('remote and local JSON are parsed in their own separate try/catch blocks', () => {
  const applySyncDataMatch = SYNC_JS.match(/function applySyncData[\s\S]*?\n\}/);
  const body = applySyncDataMatch[0];
  const remoteParseIdx = body.indexOf('remoteArr = JSON.parse(obj[k]);');
  const localParseIdx = body.indexOf("localArr = JSON.parse(localStorage.getItem(k) || '[]');");
  assert.ok(remoteParseIdx !== -1 && localParseIdx !== -1);
  assert.ok(remoteParseIdx < localParseIdx);
});
