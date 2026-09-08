// Tests for the record-merge logic in tools/sync.js -- the system that
// keeps an entry added on one device from silently vanishing when
// another device pushes its own (older) snapshot afterward.
//
// These extract just the pure merge functions out of sync.js rather than
// loading the whole file, since the rest of it talks to a real Supabase
// project and isn't something a test should be hitting over the network.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SYNC_JS_PATH = path.join(__dirname, '..', '..', 'tools', 'sync.js');

function loadMergeFunctions() {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const deepEqualValueSrc = src.match(/function deepEqualValue[\s\S]*?\n}\n/);
  const mergeRecordArraysSrc = src.match(/function mergeRecordArrays[\s\S]*?\n}\n/);
  const mergePartsSrc = src.match(/function mergePartsReferenceUnits[\s\S]*?\n}\n/);
  assert.ok(deepEqualValueSrc, 'deepEqualValue not found in sync.js -- did it get renamed or removed?');
  assert.ok(mergeRecordArraysSrc, 'mergeRecordArrays not found in sync.js -- did it get renamed or removed?');
  assert.ok(mergePartsSrc, 'mergePartsReferenceUnits not found in sync.js -- did it get renamed or removed?');
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function('sandbox', deepEqualValueSrc[0] + mergeRecordArraysSrc[0] + mergePartsSrc[0] +
    'sandbox.mergeRecordArrays = mergeRecordArrays; sandbox.mergePartsReferenceUnits = mergePartsReferenceUnits;'
  )(sandbox);
  return sandbox;
}

test('th_parts_reference_units is registered as a synced key', () => {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  assert.match(src, /'th_parts_reference_units'/, 'Appliance Wiki data key missing from SYNC_DATA_KEYS');
  assert.match(src, /th_parts_reference_units:\s*'id'/, 'Appliance Wiki data key missing from MERGE_KEY_FIELD');
});

test('mergeRecordArrays: an add on either side survives, no duplicates for shared ids', () => {
  const { mergeRecordArrays } = loadMergeFunctions();
  const local = [{ id: 1, name: 'a' }, { id: 2, name: 'local-only' }];
  const remote = [{ id: 1, name: 'a' }, { id: 3, name: 'remote-only' }];
  const result = mergeRecordArrays(local, remote, 'id');
  const ids = result.map(r => r.id).sort();
  assert.deepEqual(ids, [1, 2, 3]);
});

test('mergePartsReferenceUnits: two different NEW issues added to the SAME unit on different devices both survive', () => {
  const { mergePartsReferenceUnits } = loadMergeFunctions();
  const local = [{
    id: 100, brand: 'GE', type: 'Dryer', model: 'PTD60EBSR0WS',
    issues: [{ id: 1, symptom: 'shared' }, { id: 2, symptom: 'added locally' }],
  }];
  const remote = [{
    id: 100, brand: 'GE', type: 'Dryer', model: 'PTD60EBSR0WS',
    issues: [{ id: 1, symptom: 'shared' }, { id: 3, symptom: 'added remotely' }],
  }];
  const result = mergePartsReferenceUnits(local, remote);
  assert.equal(result.length, 1, 'expected the same unit, not duplicated');
  const issueIds = result[0].issues.map(i => i.id).sort();
  assert.deepEqual(issueIds, [1, 2, 3], 'an issue added on one side did not survive the merge');
});

// Base-tracked per-field merge (code-health pass, 2026-09-08): the real
// fix for "whole-blob last write wins." Without a base, the SAME record
// existing on both sides still falls back to "remote wins" wholesale
// (tested above implicitly, and directly in the "no base" test below) --
// but WITH a base (this device's own record of what was last agreed with
// the server), a same-id record now merges field-by-field: whichever
// side actually changed a field relative to that base wins for that
// field specifically, and only a field both sides changed to DIFFERENT
// values counts as a real conflict.

test('mergeRecordArrays with a base: different fields edited on each side both survive, not just one side\'s whole record', () => {
  const { mergeRecordArrays } = loadMergeFunctions();
  const base = [{ id: 1, status: 'Not Started', notes: '' }];
  const local = [{ id: 1, status: 'Not Started', notes: 'called the client back' }]; // local only edited notes
  const remote = [{ id: 1, status: 'In Progress', notes: '' }]; // remote only edited status
  const conflicts = [];
  const result = mergeRecordArrays(local, remote, 'id', base, conflicts);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'In Progress', 'remote\'s status edit should survive');
  assert.equal(result[0].notes, 'called the client back', 'local\'s notes edit should NOT be clobbered by remote\'s stale notes value');
  assert.equal(conflicts.length, 0, 'different fields changed on each side is not a real conflict');
});

test('mergeRecordArrays with a base: the SAME field changed differently on both sides is a real conflict -- remote wins that field, but it is logged, not silent', () => {
  const { mergeRecordArrays } = loadMergeFunctions();
  const base = [{ id: 1, status: 'Not Started' }];
  const local = [{ id: 1, status: 'In Progress' }];
  const remote = [{ id: 1, status: 'Done' }];
  const conflicts = [];
  const result = mergeRecordArrays(local, remote, 'id', base, conflicts);
  assert.equal(result[0].status, 'Done', 'remote wins the actual conflicting field, same safe default as the no-base case');
  assert.equal(conflicts.length, 1, 'a genuine same-field conflict should be logged, not silently dropped');
  assert.equal(conflicts[0].recordId, '1');
  assert.deepEqual(conflicts[0].fields, ['status']);
  assert.equal(conflicts[0].localValues.status, 'In Progress');
  assert.equal(conflicts[0].remoteValues.status, 'Done');
  assert.equal(conflicts[0].resolvedTo, 'remote');
});

test('mergeRecordArrays with a base: a local edit survives when remote is simply stale (unchanged from base)', () => {
  const { mergeRecordArrays } = loadMergeFunctions();
  const base = [{ id: 1, notes: 'old note' }];
  const local = [{ id: 1, notes: 'updated note' }];
  const remote = [{ id: 1, notes: 'old note' }]; // remote never touched this field
  const conflicts = [];
  const result = mergeRecordArrays(local, remote, 'id', base, conflicts);
  assert.equal(result[0].notes, 'updated note', 'local\'s real edit should not be lost to a remote copy that never changed');
  assert.equal(conflicts.length, 0);
});

test('mergeRecordArrays with NO base (first sync ever for this record type): falls back to the original whole-record "remote wins" behavior', () => {
  const { mergeRecordArrays } = loadMergeFunctions();
  const local = [{ id: 1, status: 'In Progress', notes: 'local note' }];
  const remote = [{ id: 1, status: 'Done', notes: 'remote note' }];
  const result = mergeRecordArrays(local, remote, 'id'); // no baseArr/conflicts passed, same as every pre-existing call site
  assert.equal(result[0].status, 'Done');
  assert.equal(result[0].notes, 'remote note', 'with no base to 3-way diff against, remote still wins the whole record, unchanged from before this fix');
});

test('mergePartsReferenceUnits: a brand-new unit added on either side survives', () => {
  const { mergePartsReferenceUnits } = loadMergeFunctions();
  const local = [{ id: 200, brand: 'Whirlpool', type: 'Washer', model: 'ABC', issues: [] }];
  const remote = [{ id: 201, brand: 'Samsung', type: 'Range', model: 'XYZ', issues: [] }];
  const result = mergePartsReferenceUnits(local, remote);
  const ids = result.map(u => u.id).sort();
  assert.deepEqual(ids, [200, 201]);
});

// Retry-on-CHANNEL_ERROR/TIMED_OUT: the realtime "tenant" shuts down
// after a period with no connected clients, then cold-starts again --
// creating replication partitions, checking publications, starting
// stream replication -- the next time someone connects. First added
// 2026-08-20 (CHANNEL_ERROR only, up to twice); widened substantially
// 2026-09-07 after a direct "almost daily" complaint (TIMED_OUT now
// retries too, a longer exponential backoff, and the connection never
// permanently gives up). See the REALTIME_RETRY_DELAYS comment in
// tools/sync.js and tests/tools/realtime-retry-resilience.test.js for
// the full behavior and the real Supabase-log evidence behind it.

// Improvement #7 from the 8/14-8/20 site audit (2026-08-20): extending
// the same resilience pattern already proven for
// startRealtimeSync/startLeadsRealtime's CHANNEL_ERROR retry to
// pushSync/pullSync, which had zero retry logic at all despite running
// on every page load and every save. Only retries genuinely transient
// conditions (a network-level exception, a 5xx server error) --
// deliberately never retries 4xx client errors, since those mean
// something is actually wrong and a retry would just fail identically
// again.

function loadFetchWithRetry() {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const fnSrc = src.match(/async function fetchWithRetry\([\s\S]*?\n}\n/);
  assert.ok(fnSrc, 'fetchWithRetry not found in sync.js -- did it get renamed or removed?');
  const sandbox = {};
  new Function('sandbox', fnSrc[0] + 'sandbox.fetchWithRetry = fetchWithRetry;')(sandbox);
  return sandbox.fetchWithRetry;
}

test('fetchWithRetry retries a network-level exception and succeeds once the connection recovers', async () => {
  const fetchWithRetry = loadFetchWithRetry();
  let callCount = 0;
  global.fetch = async () => {
    callCount++;
    if (callCount < 3) throw new Error('network blip');
    return { ok: true, status: 200 };
  };
  const res = await fetchWithRetry('http://x', {}, 2, 10);
  assert.equal(res.ok, true);
  assert.equal(callCount, 3);
});

test('fetchWithRetry does NOT retry a 4xx client error -- that means something is really wrong, not transient', async () => {
  const fetchWithRetry = loadFetchWithRetry();
  let callCount = 0;
  global.fetch = async () => { callCount++; return { ok: false, status: 401 }; };
  const res = await fetchWithRetry('http://x', {}, 2, 10);
  assert.equal(res.status, 401);
  assert.equal(callCount, 1, 'should not retry a 4xx at all');
});

test('fetchWithRetry retries a 5xx server error up to the configured limit, then returns the failing response for the caller\'s existing error handling', async () => {
  const fetchWithRetry = loadFetchWithRetry();
  let callCount = 0;
  global.fetch = async () => { callCount++; return { ok: false, status: 503 }; };
  const res = await fetchWithRetry('http://x', {}, 2, 10);
  assert.equal(res.status, 503);
  assert.equal(callCount, 3, 'initial attempt + 2 retries');
});

test('fetchWithRetry re-throws the original exception once retries are exhausted, so the caller\'s existing catch block still works exactly as before', async () => {
  const fetchWithRetry = loadFetchWithRetry();
  let callCount = 0;
  global.fetch = async () => { callCount++; throw new Error('persistent network failure'); };
  await assert.rejects(() => fetchWithRetry('http://x', {}, 2, 10), /persistent network failure/);
  assert.equal(callCount, 3);
});

test('pushSync and pullSync both use fetchWithRetry for their core fetch call, not a bare fetch', () => {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const pushFn = src.match(/async function pushSync\(\)[\s\S]*?\n}\n/)[0];
  const pullFn = src.match(/async function pullSync\(\)[\s\S]*?\n}\n/)[0];
  assert.match(pushFn, /await fetchWithRetry\(/);
  assert.match(pullFn, /await fetchWithRetry\(/);
});

// The real architectural fix for "whole-blob last write wins" (code-health
// pass, 2026-09-08): pushSync() used to POST collectSyncData() -- local's
// current state, whatever it happened to be -- straight over the server
// row, completely unconditionally. Two devices editing without an
// intervening pull meant whichever one pushed last silently discarded
// everything the other had already gotten onto the server, with no merge
// of any kind on the push side (only pullSync ever merged anything).
test('pushSync fetches the current server row and merges it via applySyncData BEFORE building the payload it pushes, not just pullSync', () => {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const pushFn = src.match(/async function pushSync\(\)[\s\S]*?\n}\n/)[0];
  const getIndex = pushFn.search(/await fetchWithRetry\(`\$\{SUPABASE_URL\}\/rest\/v1\/\$\{SYNC_TABLE\}\?code=eq\./);
  const applyIndex = pushFn.indexOf('applySyncData(');
  const collectIndex = pushFn.indexOf('data: collectSyncData()');
  const postIndex = pushFn.search(/method: 'POST'/);
  assert.notEqual(getIndex, -1, 'pushSync should fetch the current server row (a GET by code) before pushing');
  assert.notEqual(applyIndex, -1, 'pushSync should merge that row in via applySyncData, the same merge pullSync uses');
  assert.ok(getIndex < applyIndex, 'the GET must happen before the merge is applied');
  assert.ok(applyIndex < collectIndex, 'the merge must be applied before collectSyncData() is read for the push body, so the push reflects the merged state');
  assert.ok(collectIndex < postIndex, 'the merged collectSyncData() must be gathered before the POST is sent');
});

// Improvement #5 from the 8/14-8/20 site audit (2026-08-20): a
// reusable debug-trace utility, replacing the diagnostic panel pattern
// hand-built from scratch twice this past week to track down hard-to-
// reproduce issues. Placed in sync.js specifically since it's one of
// only two files (alongside auth.js) genuinely loaded on every single
// tool page, including runway-dashboard.html.

test('debugTrace does nothing at all without ?debug=1 -- silent by default, no panel created', () => {
  const { JSDOM } = require('jsdom');
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/tools/job-tracker.html', runScripts: 'dangerously' });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.head.appendChild(s);
  window.debugTrace('should not appear');
  assert.equal(window.document.getElementById('__debugTracePanel'), null);
});

test('debugTrace activates with ?debug=1 and logs real, timestamped messages to a visible panel anchored at the TOP of the screen', () => {
  const { JSDOM } = require('jsdom');
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/tools/job-tracker.html?debug=1', runScripts: 'dangerously' });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = src;
  window.document.head.appendChild(s);
  window.debugTrace('page init started');
  window.debugTrace('sync resolved ok');
  const panel = window.document.getElementById('__debugTracePanel');
  assert.ok(panel);
  assert.match(panel.textContent, /page init started/);
  assert.match(panel.textContent, /sync resolved ok/);
  // Anchored to the top, not the bottom -- a bottom-anchored version of
  // this exact idea once ended up covering the very thing it was built
  // to help diagnose, a real mistake made and fixed on Runway Dashboard
  // earlier this session.
  assert.equal(panel.style.top, '8px');
  assert.equal(panel.style.bottom, '');
});

test('the debug flag persists into a new page load that never had ?debug=1 in its own URL, simulating both a multi-page flow like the app tour and setting the flag via a regular Safari tab so it carries into a standalone home-screen-installed PWA', () => {
  const { JSDOM } = require('jsdom');
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const dom1 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/tools/job-tracker.html?debug=1', runScripts: 'dangerously' });
  const window1 = dom1.window;
  const s1 = window1.document.createElement('script');
  s1.textContent = src;
  window1.document.head.appendChild(s1);
  window1.isDebugModeOn(); // triggers the localStorage write from the ?debug=1 param

  const dom2 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/tools/finance.html', runScripts: 'dangerously' });
  const window2 = dom2.window;
  // Simulate localStorage carrying over, as it genuinely does across
  // same-origin navigation in a real browser -- switched from
  // sessionStorage (2026-08-27) specifically because sessionStorage
  // does NOT carry over between a regular Safari tab and a standalone
  // home-screen-installed PWA on iOS, even for the same origin, but
  // localStorage does. A fresh JSDOM instance doesn't share storage
  // automatically the way real tabs/apps do, hence simulating it here.
  window2.localStorage.setItem('th_debug_mode', window1.localStorage.getItem('th_debug_mode'));
  const s2 = window2.document.createElement('script');
  s2.textContent = src;
  window2.document.head.appendChild(s2);
  window2.debugTrace('this page never had ?debug=1 in its own URL');
  assert.ok(window2.document.getElementById('__debugTracePanel'));
});

test('debugTrace is defined in sync.js, one of only two files loaded on every tool page including the deliberately self-contained runway-dashboard.html', () => {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  assert.match(src, /function debugTrace\(msg\)/);
  assert.match(src, /function isDebugModeOn\(\)/);
  const rdSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'runway-dashboard.html'), 'utf8');
  assert.match(rdSrc, /<script src="\/tools\/sync\.js/, 'runway-dashboard.html should load sync.js, confirming debugTrace is genuinely available there too');
});
