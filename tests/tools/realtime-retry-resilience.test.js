// Reliability fix (2026-09-07), replacing the narrower 2026-08-20 one:
// direct report of "we get these sync channel status errors almost
// daily," with a screenshot of repeated CHANNEL_ERROR/TIMED_OUT
// entries in th_client_errors from tools/job-tracker.html.
//
// Before changing anything, checked this project's own Supabase
// realtime logs for the exact failure window: server-side, the tenant
// cold-start (the documented cause of the original, narrower fix) each
// completed in ~1.2 seconds, and there were zero matching server-side
// error/timeout log entries anywhere in the same 24-hour window -- so
// the old budget (2 retries, CHANNEL_ERROR only, fixed 2s apart, ~4s
// total) was both too short and too narrow for whatever the real
// transient condition actually is (most plausibly this business's own
// field conditions -- phones/tablets on job sites, not stable office
// wifi). See the REALTIME_RETRY_DELAYS comment in tools/sync.js for
// the full writeup.
//
// This file exercises the real attemptSubscribe behavior extracted
// from startRealtimeSync, against a fake Supabase client and fake
// timers (so the ~29s foreground backoff and 30s background retry
// don't make the test suite itself slow).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SYNC = fs.readFileSync(repo('tools', 'sync.js'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

function extractConst(name) {
  const re = new RegExp(`const ${name} = ([^;]+);`);
  const m = SYNC.match(re);
  assert.ok(m, `expected to find const ${name}`);
  return m[1];
}

// Builds a sandbox with a fake Supabase client (subscribe callback
// captured and fired manually) and fake setTimeout (timers captured,
// not actually run on a delay) so the test drives the real retry
// state machine step by step.
function makeHarness() {
  const timers = []; // {fn, delay}
  const logs = [];
  const statusChanges = [];
  const removedChannels = [];
  const subscribeCallbacks = []; // one per attemptSubscribe() call, in order

  function makeChannel(name) {
    const channel = { name };
    channel.on = () => channel;
    channel.subscribe = (cb) => { subscribeCallbacks.push(cb); return channel; };
    return channel;
  }

  const fakeClient = {
    channel: (name) => makeChannel(name),
    removeChannel: (ch) => removedChannels.push(ch),
  };

  const sandbox = {
    setTimeout: (fn, delay) => { const t = { fn, delay }; timers.push(t); return t; },
    getSupabaseClient: () => fakeClient,
    getSyncCode: () => 'tripleh-workspace-2026',
    localStorage: { getItem: () => null, setItem: () => {} },
    pullSync: async () => {},
    logClientError: (msg) => logs.push(msg),
  };
  vm.createContext(sandbox);

  const src = `
    const REALTIME_RETRY_DELAYS = ${extractConst('REALTIME_RETRY_DELAYS')};
    const REALTIME_BACKGROUND_RETRY_MS = ${extractConst('REALTIME_BACKGROUND_RETRY_MS')};
    const REALTIME_WATCHDOG_MS = ${extractConst('REALTIME_WATCHDOG_MS')};
    let _realtimeChannel = null;
    ${extractFn(SYNC, 'startRealtimeSync')}
  `;
  vm.runInContext(src, sandbox);

  return {
    sandbox, timers, logs, removedChannels, subscribeCallbacks,
    onRemoteChange: () => {},
    onStatusChange: (s) => statusChanges.push(s),
    statusChanges,
    // Fires the most recently created channel's subscribe callback with a status.
    fireLatestStatus(status) {
      const cb = subscribeCallbacks[subscribeCallbacks.length - 1];
      assert.ok(cb, 'expected a subscribe callback to exist');
      cb(status);
    },
    // Runs the most recently scheduled timer (there's at most one
    // "next retry" timer pending at a time in this code, aside from
    // the one-shot watchdog scheduled up front with a much larger,
    // easily distinguished delay).
    runLatestRetryTimer() {
      const retryTimers = timers.filter((t) => t.delay !== sandbox.REALTIME_WATCHDOG_MS);
      const t = retryTimers[retryTimers.length - 1];
      assert.ok(t, 'expected a retry timer to be scheduled');
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    },
  };
}

test('CHANNEL_ERROR retries with the full exponential backoff schedule (2s/4s/8s/15s) before giving up', () => {
  const h = makeHarness();
  h.sandbox.startRealtimeSync(h.onRemoteChange, h.onStatusChange);
  const expectedDelays = [2000, 4000, 8000, 15000];
  for (const delay of expectedDelays) {
    h.fireLatestStatus('CHANNEL_ERROR');
    const retryTimers = h.timers.filter((t) => t.delay !== 35000);
    assert.equal(retryTimers[retryTimers.length - 1].delay, delay, `expected the next retry scheduled at ${delay}ms`);
    assert.equal(h.logs.length, 0, 'no intermediate retry should be logged');
    h.runLatestRetryTimer();
  }
  // 5th and final attempt still fails -- now it should give up (for now) and log once.
  h.fireLatestStatus('CHANNEL_ERROR');
  assert.equal(h.logs.length, 1, 'expected exactly one log once the foreground budget is exhausted');
  assert.match(h.logs[0], /Realtime workspace_sync channel status: CHANNEL_ERROR/);
});

test('TIMED_OUT is now retried exactly the same as CHANNEL_ERROR -- the likely single biggest source of the reported errors', () => {
  const h = makeHarness();
  h.sandbox.startRealtimeSync(h.onRemoteChange, h.onStatusChange);
  h.fireLatestStatus('TIMED_OUT');
  const retryTimers = h.timers.filter((t) => t.delay !== 35000);
  assert.equal(retryTimers.length, 1, 'expected TIMED_OUT to schedule a retry, not give up immediately');
  assert.equal(retryTimers[0].delay, 2000);
  assert.equal(h.logs.length, 0, 'the first TIMED_OUT should not be logged -- it gets the same retry chance as CHANNEL_ERROR');
});

test('once the foreground budget is exhausted, it never permanently gives up -- a slow background retry is scheduled every 30s', () => {
  const h = makeHarness();
  h.sandbox.startRealtimeSync(h.onRemoteChange, h.onStatusChange);
  for (let i = 0; i < 4; i++) { h.fireLatestStatus('CHANNEL_ERROR'); h.runLatestRetryTimer(); }
  h.fireLatestStatus('CHANNEL_ERROR'); // 5th attempt, foreground budget exhausted
  assert.equal(h.logs.length, 1);
  const backgroundTimer = h.timers.filter((t) => t.delay !== 35000).pop();
  assert.equal(backgroundTimer.delay, 30000, 'expected a background retry scheduled 30s out');

  // Firing that background retry and having it fail again must NOT log
  // a second time, and must schedule yet another background retry --
  // this is what makes it "never happens again" rather than "happens
  // one fewer time."
  backgroundTimer.fn();
  h.fireLatestStatus('CHANNEL_ERROR');
  assert.equal(h.logs.length, 1, 'a repeated background failure during the same outage should not log again');
  const nextBackgroundTimer = h.timers.filter((t) => t.delay !== 35000).pop();
  assert.equal(nextBackgroundTimer.delay, 30000, 'expected it to keep retrying every 30s indefinitely, not stop');
});

test('a successful reconnect resets the failure flag, so a later, separate outage logs again instead of staying silent forever', () => {
  const h = makeHarness();
  h.sandbox.startRealtimeSync(h.onRemoteChange, h.onStatusChange);
  for (let i = 0; i < 4; i++) { h.fireLatestStatus('CHANNEL_ERROR'); h.runLatestRetryTimer(); }
  h.fireLatestStatus('CHANNEL_ERROR'); // exhausted, logged once
  assert.equal(h.logs.length, 1);
  const backgroundTimer = h.timers.filter((t) => t.delay !== 35000).pop();
  backgroundTimer.fn();
  h.fireLatestStatus('SUBSCRIBED'); // recovers
  assert.equal(h.statusChanges[h.statusChanges.length - 1], 'SUBSCRIBED');

  // A brand new, later outage should log again -- it's a genuinely new episode.
  h.fireLatestStatus('CHANNEL_ERROR');
  for (let i = 0; i < 3; i++) { h.runLatestRetryTimer(); h.fireLatestStatus('CHANNEL_ERROR'); }
  h.runLatestRetryTimer();
  h.fireLatestStatus('CHANNEL_ERROR');
  assert.equal(h.logs.length, 2, 'expected the second, separate outage to log its own entry');
});

test('the intermediate-retry channel is always cleaned up before the next attempt, avoiding a duplicate-subscription bug', () => {
  const h = makeHarness();
  h.sandbox.startRealtimeSync(h.onRemoteChange, h.onStatusChange);
  h.fireLatestStatus('CHANNEL_ERROR');
  assert.equal(h.removedChannels.length, 1, 'expected the failed channel to be removed before scheduling a retry');
});

test('the stuck-forever watchdog fires well after the full foreground retry budget (29s), so it cannot preempt a real retry in flight', () => {
  const h = makeHarness();
  h.sandbox.startRealtimeSync(h.onRemoteChange, h.onStatusChange);
  const watchdog = h.timers.find((t) => t.delay === 35000);
  assert.ok(watchdog, 'expected a watchdog timer at REALTIME_WATCHDOG_MS');
  const totalForegroundBudget = 2000 + 4000 + 8000 + 15000;
  assert.ok(watchdog.delay > totalForegroundBudget, `watchdog (${watchdog.delay}ms) must exceed the full foreground retry span (${totalForegroundBudget}ms)`);
});

test('the tools service worker cache was bumped for this change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 81, `expected v81 or later, got v${version}`);
});

test('startLeadsRealtime and startBookingsRealtime share the exact same retry/backoff/never-gives-up shape as startRealtimeSync', () => {
  for (const fnName of ['startLeadsRealtime', 'startBookingsRealtime']) {
    const fnSrc = extractFn(SYNC, fnName);
    assert.match(fnSrc, /attempt < REALTIME_RETRY_DELAYS\.length/, `${fnName} should retry using the shared backoff schedule`);
    assert.match(fnSrc, /status === 'CHANNEL_ERROR' \|\| status === 'TIMED_OUT'/, `${fnName} should treat TIMED_OUT the same as CHANNEL_ERROR`);
    assert.match(fnSrc, /setTimeout\(\(\) => attemptSubscribe\(REALTIME_RETRY_DELAYS\.length\), REALTIME_BACKGROUND_RETRY_MS\);/, `${fnName} should keep retrying in the background indefinitely`);
    assert.match(fnSrc, /if \(status === 'SUBSCRIBED'\) loggedFailure = false;/, `${fnName} should reset its logged-failure flag on reconnect`);
    assert.match(fnSrc, /REALTIME_WATCHDOG_MS/, `${fnName} should use the widened watchdog delay`);
  }
});
