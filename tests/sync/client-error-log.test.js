// Tests for the client error log's Clear button (2026-08-21), reported
// directly: clicking Clear removed the errors from view, but they
// returned as soon as the page was reopened.
//
// Root cause: th_client_errors is part of the synced data blob, merged
// with a union-style merge (mergeClientErrorLog) that combines local
// and remote arrays by id -- deliberately designed so normal data
// (jobs, contacts, etc.) never gets lost just because one device
// hasn't synced yet. But the Clear button cleared local storage
// without ever pushing that change to the server, so the next page
// load pulled the still-populated remote copy back in and merged it
// with the now-empty local array -- union of empty + old is just old,
// silently resurrecting everything the clear had just removed.
//
// Second, separate root cause of the SAME symptom, reported again
// 2026-09-22 after the fix above already shipped: the 2026-08-21 fix
// only closed the single-device race (a fast reopen beating the old
// debounced push). It did nothing for a genuinely STALE device -- a
// rarely-opened tab, or a device nobody has opened dev-tools.html on
// since before the clear -- that still has old entries sitting in its
// own localStorage. th_client_errors had no delete-tracking at all,
// unlike every real record type in this sync system (clients, jobs,
// invoices, etc. all have a `*_tombstones` array). A plain union merge
// can't tell "genuinely new" apart from "an old local copy nobody ever
// cleared on this device", so that stale device would resurrect its
// old entries on every sync, forever, no matter how many times the log
// was cleared elsewhere. Fixed with `th_client_errors_cleared_at`, a
// synced cutoff timestamp mergeClientErrorLog() now filters against.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DEV_TOOLS_PATH = path.join(__dirname, '..', '..', 'tools', 'dev-tools.html');
const SYNC_JS_PATH = path.join(__dirname, '..', '..', 'tools', 'sync.js');

test('mergeClientErrorLog demonstrates the exact mechanism of the original bug: an empty local array merged with a still-populated remote one resurrects every entry (union of empty + old is just old)', () => {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const constMatch = src.match(/const CLIENT_ERROR_LOG_MAX_AFTER_MERGE = \d+;/);
  const mergeRecordArraysFn = src.match(/function mergeRecordArrays[\s\S]*?\n}\n/);
  const mergeClientErrorLogFn = src.match(/function mergeClientErrorLog[\s\S]*?\n}\n/);
  const sandbox = {};
  new Function('sandbox', constMatch[0] + mergeRecordArraysFn[0] + mergeClientErrorLogFn[0] + 'sandbox.mergeClientErrorLog = mergeClientErrorLog;')(sandbox);

  const staleRemote = [{ id: 'e1', message: 'Old error', time: '2026-08-20T00:00:00Z' }];
  const result = sandbox.mergeClientErrorLog([], staleRemote);
  assert.equal(result.length, 1, 'this is the exact mechanism that resurrected the cleared errors -- an empty local array merged with a stale remote one is not empty');
});

test('mergeClientErrorLog correctly stays empty once both sides genuinely agree the log is clear (the fixed scenario, after a real push has succeeded)', () => {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const constMatch = src.match(/const CLIENT_ERROR_LOG_MAX_AFTER_MERGE = \d+;/);
  const mergeRecordArraysFn = src.match(/function mergeRecordArrays[\s\S]*?\n}\n/);
  const mergeClientErrorLogFn = src.match(/function mergeClientErrorLog[\s\S]*?\n}\n/);
  const sandbox = {};
  new Function('sandbox', constMatch[0] + mergeRecordArraysFn[0] + mergeClientErrorLogFn[0] + 'sandbox.mergeClientErrorLog = mergeClientErrorLog;')(sandbox);

  const result = sandbox.mergeClientErrorLog([], []);
  assert.deepEqual(result, []);
});

function loadMergeClientErrorLog() {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const constMatch = src.match(/const CLIENT_ERROR_LOG_MAX_AFTER_MERGE = \d+;/);
  const mergeRecordArraysFn = src.match(/function mergeRecordArrays[\s\S]*?\n}\n/);
  const mergeClientErrorLogFn = src.match(/function mergeClientErrorLog[\s\S]*?\n}\n/);
  const sandbox = {};
  new Function('sandbox', constMatch[0] + mergeRecordArraysFn[0] + mergeClientErrorLogFn[0] + 'sandbox.mergeClientErrorLog = mergeClientErrorLog;')(sandbox);
  return sandbox.mergeClientErrorLog;
}

test('the actual fix: a stale device\'s old local entries no longer resurrect once a clearedAt cutoff is passed, even though the remote copy is empty and the merge is otherwise the same union', () => {
  const mergeClientErrorLog = loadMergeClientErrorLog();
  const staleLocal = [
    { id: 'e1', message: 'Old error from before the clear', time: '2026-09-05T00:00:00Z' },
  ];
  const clearedAt = '2026-09-07T00:00:00Z'; // matches the user's own report: no real errors since 9/7
  const result = mergeClientErrorLog(staleLocal, [], clearedAt);
  assert.deepEqual(result, [], 'a stale device\'s pre-clear entries must not survive the merge once a later clearedAt cutoff exists, on either side');
});

test('a genuinely new error logged after the clear is never filtered out by the cutoff', () => {
  const mergeClientErrorLog = loadMergeClientErrorLog();
  const clearedAt = '2026-09-07T00:00:00Z';
  const freshError = [{ id: 'e2', message: 'A real new error', time: '2026-09-22T12:00:00Z' }];
  const result = mergeClientErrorLog([], freshError, clearedAt);
  assert.equal(result.length, 1, 'an error logged after the clear has time > clearedAt and must survive the merge');
});

function loadDevTools(seedErrors) {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      if (seedErrors) w.localStorage.setItem('th_client_errors', JSON.stringify(seedErrors));
    },
  });
  return dom.window;
}

test('clearClientErrorLog genuinely calls pushSync() (an immediate push, not the usual debounced scheduleSync), so the empty state actually reaches the server before the function returns', async () => {
  const window = loadDevTools([
    { id: 'e1', message: 'Old error 1', time: '2026-08-20T00:00:00Z' },
    { id: 'e2', message: 'Old error 2', time: '2026-08-20T01:00:00Z' },
  ]);
  let pushSyncCalled = false;
  window.pushSync = async () => { pushSyncCalled = true; return { ok: true }; };
  window.showToast = () => {};

  await window.clearClientErrorLog();
  assert.equal(window.localStorage.getItem('th_client_errors'), null);
  assert.equal(pushSyncCalled, true, 'pushSync should be called directly, not the debounced scheduleSync -- a fast reopen right after clicking Clear would otherwise still race a 2.5-second debounce and pull the stale remote copy back in');
});

test('clearClientErrorLog sets th_client_errors_cleared_at to a fresh, real timestamp, and pushes it alongside the now-empty array -- this is the cutoff a stale device\'s sync merge filters against', async () => {
  const window = loadDevTools([{ id: 'e1', message: 'Old error', time: '2026-08-20T00:00:00Z' }]);
  window.pushSync = async () => ({ ok: true });
  window.showToast = () => {};

  const before = Date.now();
  await window.clearClientErrorLog();
  const after = Date.now();

  const clearedAt = window.localStorage.getItem('th_client_errors_cleared_at');
  assert.ok(clearedAt, 'th_client_errors_cleared_at should be set by clearClientErrorLog');
  const clearedAtMs = new Date(clearedAt).getTime();
  assert.ok(clearedAtMs >= before && clearedAtMs <= after, 'the cutoff should be set to the actual moment Clear was clicked');
});

test('th_client_errors_cleared_at is registered as a synced key, listed before th_client_errors (mergeClientErrorLog\'s branch reads it fresh from localStorage right after it merges)', () => {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const syncKeysMatch = src.match(/const SYNC_DATA_KEYS = \[[\s\S]*?\n\];/);
  assert.ok(syncKeysMatch, 'SYNC_DATA_KEYS not found');
  const clearedAtIndex = syncKeysMatch[0].indexOf("'th_client_errors_cleared_at'");
  const clientErrorsIndex = syncKeysMatch[0].indexOf("'th_client_errors'");
  assert.ok(clearedAtIndex > -1, 'th_client_errors_cleared_at missing from SYNC_DATA_KEYS');
  assert.ok(clientErrorsIndex > -1, 'th_client_errors missing from SYNC_DATA_KEYS');
  assert.ok(clearedAtIndex < clientErrorsIndex, 'th_client_errors_cleared_at must be listed before th_client_errors so its merge has already run and been written by the time th_client_errors is processed');
});

// sync.js is loaded via <script src> in the real page, which JSDOM
// never fetches -- extracted and window.eval()'d directly instead,
// same technique tests/sync/tombstones-extended.test.js already uses.
function loadApplySyncData(window) {
  const syncJs = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const parts = [
    syncJs.match(/const SYNC_DATA_KEYS = \[[\s\S]*?\n\];/),
    syncJs.match(/const MERGE_KEY_FIELD = \{[\s\S]*?\n\};/),
    syncJs.match(/function deepEqualValue[\s\S]*?\n\}/),
    syncJs.match(/function mergeRecordArrays[\s\S]*?\n\}/),
    syncJs.match(/function mergePartsReferenceUnits[\s\S]*?\n\}/),
    syncJs.match(/const CLIENT_ERROR_LOG_MAX_AFTER_MERGE[\s\S]*?function mergeClientErrorLog[\s\S]*?\n\}/),
    syncJs.match(/const GRAVEYARD_MAX_AFTER_MERGE[\s\S]*?function mergeGraveyard[\s\S]*?\n\}/),
    syncJs.match(/const SYNC_BASE_KEY = '[^']+';/),
    syncJs.match(/function loadSyncBase\(\)[\s\S]*?\n\}/),
    syncJs.match(/function saveSyncBaseForKey[\s\S]*?\n\}/),
    syncJs.match(/const SYNC_CONFLICT_LOG_MAX = \d+;/),
    syncJs.match(/function mergeSyncConflicts[\s\S]*?\n\}/),
    syncJs.match(/function applySyncData[\s\S]*?\n\}/),
    syncJs.match(/function deriveInvoicePaid[\s\S]*?\n\}/),
  ];
  assert.ok(parts.every(Boolean), 'one or more required sync.js pieces not found');
  window.eval(parts.map(m => m[0]).join('\n'));
}

test('applySyncData takes the newer of the two clearedAt values on merge, rather than blindly overwriting with whatever the remote happens to hold', () => {
  const window = loadDevTools();
  loadApplySyncData(window);
  const olderRemote = '2026-09-01T00:00:00Z';
  const newerLocal = '2026-09-07T00:00:00Z';
  window.localStorage.setItem('th_client_errors_cleared_at', newerLocal);
  window.applySyncData({ th_client_errors_cleared_at: olderRemote });
  assert.equal(window.localStorage.getItem('th_client_errors_cleared_at'), newerLocal, 'a more recent local clear must not be clobbered by an older remote value mid-sync');

  const newerRemote = '2026-09-10T00:00:00Z';
  window.applySyncData({ th_client_errors_cleared_at: newerRemote });
  assert.equal(window.localStorage.getItem('th_client_errors_cleared_at'), newerRemote, 'a genuinely newer remote clear should still win');
});

test('applySyncData end-to-end: a stale device with old client-error entries pulls a cleared server state and its old entries do not come back', () => {
  const window = loadDevTools([
    { id: 'e1', message: 'Old error from before the clear', time: '2026-09-05T00:00:00Z' },
  ]);
  loadApplySyncData(window);
  // The server now reflects a clear that happened 9/7 -- empty array,
  // plus the cutoff -- exactly what a real pull from another device
  // that clicked Clear would send.
  window.applySyncData({
    th_client_errors: JSON.stringify([]),
    th_client_errors_cleared_at: '2026-09-07T00:00:00Z',
  });
  const merged = JSON.parse(window.localStorage.getItem('th_client_errors'));
  assert.deepEqual(merged, [], 'this stale device\'s pre-clear entry must not survive the pull');
});

test('clearClientErrorLog does not use scheduleSync (the debounced version) -- confirmed directly in the source, since a race with its 2.5-second delay is exactly what would let the original bug still occur on a fast reopen', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const fnMatch = src.match(/(?:async )?function clearClientErrorLog\(\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'clearClientErrorLog not found');
  assert.doesNotMatch(fnMatch[0], /scheduleSync\(\)(?!'s)/);
  assert.match(fnMatch[0], /pushSync/);
});

test('clearClientErrorLog still updates the visible log immediately, even though it now awaits a real network push', async () => {
  const window = loadDevTools([{ id: 'e1', message: 'Old error', time: '2026-08-20T00:00:00Z' }]);
  window.pushSync = async () => ({ ok: true });
  window.showToast = () => {};

  await window.clearClientErrorLog();
  const el = window.document.getElementById('clientErrorLog');
  assert.match(el.innerHTML, /No client-side errors captured/);
});
