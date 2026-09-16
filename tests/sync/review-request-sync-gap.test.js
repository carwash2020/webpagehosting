// Tests for closing the review-request sync gap (audit item #11):
// th_review_requests_log and th_review_requests_pending were never
// listed in sync.js's SYNC_DATA_KEYS, so a review request logged as
// sent, or a delayed follow-up reminder set, on one device silently
// never reached another -- even though the sent-log's own
// saveSentLog() already called scheduleSync() (a real, separate bug:
// savePending() never called it at all, so the pending-reminder queue
// had TWO gaps stacked on top of each other).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
const REVIEW_REQUEST = fs.readFileSync(path.join(TOOLS_DIR, 'review-request.html'), 'utf8');
const SYNC_JS = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');

// --- sync.js: keys actually registered -----------------------------

test('th_review_requests_log and th_review_requests_pending (plus its tombstones) are listed in SYNC_DATA_KEYS', () => {
  const syncDataKeysMatch = SYNC_JS.match(/const SYNC_DATA_KEYS = \[[\s\S]*?\n\];/);
  assert.ok(syncDataKeysMatch);
  assert.match(syncDataKeysMatch[0], /'th_review_requests_pending_tombstones',/);
  assert.match(syncDataKeysMatch[0], /'th_review_requests_pending',/);
  assert.match(syncDataKeysMatch[0], /'th_review_requests_log',/);
  // Tombstones-before-array ordering, same convention as every other
  // deletable array key in this list.
  const tIdx = syncDataKeysMatch[0].indexOf("'th_review_requests_pending_tombstones'");
  const pIdx = syncDataKeysMatch[0].indexOf("'th_review_requests_pending'");
  assert.ok(tIdx !== -1 && pIdx !== -1 && tIdx < pIdx);
});

test('both keys have a MERGE_KEY_FIELD entry, so a pull merges by record id instead of blindly overwriting the whole array', () => {
  const mergeKeyFieldMatch = SYNC_JS.match(/const MERGE_KEY_FIELD = \{[\s\S]*?\n\};/);
  assert.ok(mergeKeyFieldMatch);
  assert.match(mergeKeyFieldMatch[0], /th_review_requests_pending_tombstones: 'id',/);
  assert.match(mergeKeyFieldMatch[0], /th_review_requests_pending: 'id',/);
  assert.match(mergeKeyFieldMatch[0], /th_review_requests_log: 'id',/);
});

// --- functional: applySyncData actually merges/tombstones this data ---

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

test('a review request logged as sent on device A actually appears after device B applies the pulled sync payload', () => {
  const window = loadSyncModule();
  // Device B starts with nothing logged yet.
  window.applySyncData({
    th_review_requests_log: JSON.stringify([
      { id: 1, name: 'Jane', phone: '4355551234', job: 'Washer repair', method: 'sms', sentAt: '2026-09-14T12:00:00.000Z', status: 'sent' },
    ]),
  });
  const log = JSON.parse(window.localStorage.getItem('th_review_requests_log'));
  assert.equal(log.length, 1);
  assert.equal(log[0].name, 'Jane');
});

test('a pending reminder set on device A actually appears after device B applies the pulled sync payload', () => {
  const window = loadSyncModule();
  window.applySyncData({
    th_review_requests_pending: JSON.stringify([
      { id: 2, name: 'Bob', phone: '4355555678', job: 'Dryer repair', remindAt: '2026-09-20' },
    ]),
  });
  const pending = JSON.parse(window.localStorage.getItem('th_review_requests_pending'));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].name, 'Bob');
});

test('a reminder dismissed on one device (tombstoned) does not get resurrected when a stale device pushes its old copy back', () => {
  const window = loadSyncModule();
  // This device already knows reminder 3 was dismissed.
  window.localStorage.setItem('th_review_requests_pending_tombstones', JSON.stringify([{ id: 3, deletedAt: new Date().toISOString() }]));

  window.applySyncData({
    th_review_requests_pending_tombstones: JSON.stringify([]),
    // The incoming payload is from a stale device that never saw the
    // dismissal -- it still has the reminder.
    th_review_requests_pending: JSON.stringify([{ id: 3, name: 'Stale', phone: '4355559999', remindAt: '2026-09-25' }]),
  });

  const pending = JSON.parse(window.localStorage.getItem('th_review_requests_pending'));
  assert.deepEqual(pending, [], 'the tombstoned reminder must not be resurrected');
});

// --- review-request.html: the fix is actually wired up ---------------

test('savePending() calls scheduleSync(), closing the gap where setting a reminder never left the device at all', () => {
  const fnMatch = REVIEW_REQUEST.match(/function savePending\(list\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'expected to isolate savePending()');
  assert.match(fnMatch[0], /if \(typeof scheduleSync === 'function'\) scheduleSync\(\);/);
});

test('addPendingTombstone() records a tombstone and also triggers a sync', () => {
  const fnMatch = REVIEW_REQUEST.match(/function addPendingTombstone\(id\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'expected to isolate addPendingTombstone()');
  assert.match(fnMatch[0], /localStorage\.setItem\(PENDING_TOMBSTONES_KEY/);
  assert.match(fnMatch[0], /if \(typeof scheduleSync === 'function'\) scheduleSync\(\);/);
});

test('dismissReminder() records a tombstone before removing the reminder from the local list', () => {
  const fnMatch = REVIEW_REQUEST.match(/async function dismissReminder\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'expected to isolate dismissReminder()');
  const tombstoneIdx = fnMatch[0].indexOf('addPendingTombstone(id);');
  const saveIdx = fnMatch[0].indexOf('savePending(loadPending().filter(p => p.id !== id));');
  assert.ok(tombstoneIdx !== -1 && saveIdx !== -1 && tombstoneIdx < saveIdx);
});

test('clearMatchingReminder() (called automatically when a request is logged as sent) tombstones every matching reminder, not just the local list, before removing them', () => {
  const fnMatch = REVIEW_REQUEST.match(/function clearMatchingReminder\(phone\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'expected to isolate clearMatchingReminder()');
  assert.match(fnMatch[0], /addPendingTombstone\(p\.id\)/);
});

test('saveSentLog() still calls scheduleSync() (the half of this gap that was already fixed) and was not accidentally regressed', () => {
  const fnMatch = REVIEW_REQUEST.match(/function saveSentLog\(log\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'expected to isolate saveSentLog()');
  assert.match(fnMatch[0], /if \(typeof scheduleSync === 'function'\) scheduleSync\(\);/);
});
