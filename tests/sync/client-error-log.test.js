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
