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

const SYNC_JS_PATH = path.join(__dirname, '..', 'tools', 'sync.js');

function loadMergeFunctions() {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const mergeRecordArraysSrc = src.match(/function mergeRecordArrays[\s\S]*?\n}\n/);
  const mergePartsSrc = src.match(/function mergePartsReferenceUnits[\s\S]*?\n}\n/);
  assert.ok(mergeRecordArraysSrc, 'mergeRecordArrays not found in sync.js -- did it get renamed or removed?');
  assert.ok(mergePartsSrc, 'mergePartsReferenceUnits not found in sync.js -- did it get renamed or removed?');
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function('sandbox', mergeRecordArraysSrc[0] + mergePartsSrc[0] +
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

test('mergePartsReferenceUnits: a brand-new unit added on either side survives', () => {
  const { mergePartsReferenceUnits } = loadMergeFunctions();
  const local = [{ id: 200, brand: 'Whirlpool', type: 'Washer', model: 'ABC', issues: [] }];
  const remote = [{ id: 201, brand: 'Samsung', type: 'Range', model: 'XYZ', issues: [] }];
  const result = mergePartsReferenceUnits(local, remote);
  const ids = result.map(u => u.id).sort();
  assert.deepEqual(ids, [200, 201]);
});

// Retry-on-CHANNEL_ERROR fix (2026-08-20), based on real evidence from
// this project's own live Supabase logs (queried directly): the
// realtime "tenant" shuts down after a period with no connected
// clients, then cold-starts again -- creating replication partitions,
// checking publications, starting stream replication -- the next time
// someone connects. CHANNEL_ERROR showed up as a transient condition
// during that window in the real logs, with the tenant reaching a
// stable, working state shortly after. This retries specifically on
// CHANNEL_ERROR (not TIMED_OUT) up to twice before giving up.

function loadRealtimeFunction(fnName) {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const fnSrc = src.match(new RegExp('function ' + fnName + '\\([\\s\\S]*?\\n}\\n'));
  assert.ok(fnSrc, fnName + ' not found in sync.js -- did it get renamed or removed?');
  const sandbox = {};
  // _realtimeChannel/_leadsRealtimeChannel are declared elsewhere in
  // sync.js (module-level), not inside these functions themselves --
  // declaring them here too so the extracted function's assignment to
  // them doesn't throw.
  new Function('sandbox', 'let _realtimeChannel, _leadsRealtimeChannel;\n' + fnSrc[0] + 'sandbox.' + fnName + ' = ' + fnName + ';')(sandbox);
  return sandbox[fnName];
}

function makeFakeClient(statusSequence) {
  // statusSequence[0] is what the FIRST .subscribe() callback receives,
  // statusSequence[1] what the retry receives, and so on.
  let subscribeCallCount = 0;
  const removedChannels = [];
  const client = {
    channel(name) {
      const chan = {
        on() { return chan; },
        subscribe(cb) {
          const status = statusSequence[subscribeCallCount];
          subscribeCallCount++;
          cb(status);
          return chan;
        },
      };
      return chan;
    },
    removeChannel(chan) { removedChannels.push(chan); },
  };
  return { client, removedChannels, getSubscribeCallCount: () => subscribeCallCount };
}

test('startRealtimeSync retries once on CHANNEL_ERROR and succeeds, without ever reporting the error to the page', async () => {
  const startRealtimeSync = loadRealtimeFunction('startRealtimeSync');
  const { client, removedChannels, getSubscribeCallCount } = makeFakeClient(['CHANNEL_ERROR', 'SUBSCRIBED']);

  global.getSupabaseClient = () => client;
  global.getSyncCode = () => 'test-code';
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.SYNC_KNOWN_AT_KEY = 'th_sync_known_at';
  global.pullSync = async () => {};
  const loggedMessages = [];
  global.logClientError = (msg) => { loggedMessages.push(msg); };
  // Fire the retry's setTimeout immediately instead of waiting 2 real
  // seconds, so this test runs fast while still exercising the retry.
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };

  const statuses = [];
  try {
    startRealtimeSync(() => {}, (status) => statuses.push(status));
  } finally {
    global.setTimeout = realSetTimeout;
  }

  assert.equal(getSubscribeCallCount(), 2, 'should have attempted subscribe twice: once, then the retry');
  assert.equal(removedChannels.length, 1, 'the failed channel should be cleaned up before retrying');
  assert.deepEqual(statuses, ['SUBSCRIBED'], 'the page should only ever hear about the final, successful status -- not the transient CHANNEL_ERROR');
  assert.ok(loggedMessages.some(m => m.includes('retrying')), 'the retry itself should still be logged for visibility');
});

test('startRealtimeSync gives up after exhausting retries and reports CHANNEL_ERROR to the page', () => {
  const startRealtimeSync = loadRealtimeFunction('startRealtimeSync');
  const { client, getSubscribeCallCount } = makeFakeClient(['CHANNEL_ERROR', 'CHANNEL_ERROR', 'CHANNEL_ERROR']);

  global.getSupabaseClient = () => client;
  global.getSyncCode = () => 'test-code';
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.SYNC_KNOWN_AT_KEY = 'th_sync_known_at';
  global.pullSync = async () => {};
  global.logClientError = () => {};
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };

  const statuses = [];
  try {
    startRealtimeSync(() => {}, (status) => statuses.push(status));
  } finally {
    global.setTimeout = realSetTimeout;
  }

  // 2 retries means 3 total attempts (initial + 2 retries) before giving up.
  assert.equal(getSubscribeCallCount(), 3);
  assert.deepEqual(statuses, ['CHANNEL_ERROR'], 'once retries are exhausted, the real error should reach the page');
});

test('startLeadsRealtime has the same retry behavior and the same 12-second watchdog that startRealtimeSync already had -- it was missing both entirely before', () => {
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const fnSrc = src.match(/function startLeadsRealtime\([\s\S]*?\n}\n/)[0];
  assert.match(fnSrc, /attemptSubscribe/, 'should use the same retry helper pattern');
  assert.match(fnSrc, /retriesLeft/);
  assert.match(fnSrc, /setTimeout\(\(\) => \{\s*\n\s*if \(!realtimeResolved/, 'should have the same watchdog pattern as startRealtimeSync');
});

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

test('the debug flag persists into a new page load that never had ?debug=1 in its own URL, simulating a multi-page flow like the app tour', () => {
  const { JSDOM } = require('jsdom');
  const src = fs.readFileSync(SYNC_JS_PATH, 'utf8');
  const dom1 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/tools/job-tracker.html?debug=1', runScripts: 'dangerously' });
  const window1 = dom1.window;
  const s1 = window1.document.createElement('script');
  s1.textContent = src;
  window1.document.head.appendChild(s1);
  window1.isDebugModeOn(); // triggers the sessionStorage write from the ?debug=1 param

  const dom2 = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/tools/finance.html', runScripts: 'dangerously' });
  const window2 = dom2.window;
  // Simulate sessionStorage carrying over, as it genuinely does across
  // same-origin navigation in a real browser (a fresh JSDOM instance
  // doesn't share storage automatically the way real tabs do).
  window2.sessionStorage.setItem('th_debug_mode', window1.sessionStorage.getItem('th_debug_mode'));
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
  const rdSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'runway-dashboard.html'), 'utf8');
  assert.match(rdSrc, /<script src="\/tools\/sync\.js/, 'runway-dashboard.html should load sync.js, confirming debugTrace is genuinely available there too');
});
