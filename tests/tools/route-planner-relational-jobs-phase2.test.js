// Relational tables Phase 2, step 2 (2026-09-10): route-planner.html's
// "Pull Today's Jobs" now prefers the real `jobs` table
// (fetchJobsFromRelational() in tools/sync.js, the same function
// calendar.html already uses) over the localStorage copy. Chosen as
// the next page specifically because it only ever READS jobs (never
// writes th_tracker_jobs) and pulls on a single button click rather
// than a live render -- no cache/realtime subscription needed, just a
// fetch-then-fall-back. See CONTINUE-HERE.md's "Open follow-up:
// relational tables Phase 2" for the full rollout plan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'route-planner.html'), 'utf8');

function extractFn(name) {
  let start = HTML.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  // pullTodaysJobs() is declared `async function` -- include that
  // keyword in the extracted source, or the awaits inside become a
  // syntax error once handed to `new Function()` below.
  const asyncStart = HTML.lastIndexOf('async ', start);
  if (asyncStart >= 0 && HTML.slice(asyncStart + 6, start).trim() === '') start = asyncStart;
  const braceStart = HTML.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}

test('pullTodaysJobs() prefers fetchJobsFromRelational() and only falls back to localStorage on a genuine failure, not a legitimate empty result', () => {
  const src = extractFn('pullTodaysJobs');
  assert.match(src, /if \(typeof fetchJobsFromRelational === 'function'\)/);
  assert.match(src, /if \(jobs === null\)/, 'must distinguish "fetch failed" (null) from "fetch succeeded with zero jobs" ([]) -- an empty array is a real answer, not a fallback trigger');
  assert.match(src, /localStorage\.getItem\('th_tracker_jobs'\)/, 'must still have the localStorage fallback');
});

// Functional test: actually run the extracted function against a
// sandboxed fetchJobsFromRelational/localStorage/showAlert/addStop, to
// confirm the three real scenarios behave correctly, not just that the
// right strings appear in the source.
function loadPullTodaysJobs(fetchJobsFromRelational) {
  const src = extractFn('pullTodaysJobs');
  const calls = { alerts: [], stops: [], toasts: [] };
  const sandbox = {
    fetchJobsFromRelational,
    localStorage: {
      _store: {},
      getItem(key) { return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null; },
    },
    showAlert: async (msg) => { calls.alerts.push(msg); },
    addStop: (address, fromJob) => { calls.stops.push({ address, fromJob }); },
    showToast: (msg) => { calls.toasts.push(msg); },
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'fetchJobsFromRelational', 'localStorage', 'showAlert', 'addStop', 'showToast',
    `${src}\nreturn pullTodaysJobs;`
  );
  const fn = factory(sandbox.fetchJobsFromRelational, sandbox.localStorage, sandbox.showAlert, sandbox.addStop, sandbox.showToast);
  return { fn, calls, sandbox };
}

const today = new Date().toISOString().slice(0, 10);

test('a successful relational fetch with real jobs is used directly, never falls back to localStorage', async () => {
  const { fn, calls, sandbox } = loadPullTodaysJobs(async () => ({
    ok: true,
    jobs: [{ title: 'Fix dryer', date: today, status: 'not-started', address: '1 Main St' }],
  }));
  sandbox.localStorage._store.th_tracker_jobs = JSON.stringify([{ title: 'STALE local job', date: today, status: 'not-started', address: '2 Other St' }]);

  await fn();

  assert.equal(calls.stops.length, 1);
  assert.equal(calls.stops[0].address, '1 Main St');
});

test('a successful relational fetch that legitimately finds zero jobs is trusted as-is, not overridden by a stale localStorage copy', async () => {
  const { fn, calls, sandbox } = loadPullTodaysJobs(async () => ({ ok: true, jobs: [] }));
  sandbox.localStorage._store.th_tracker_jobs = JSON.stringify([{ title: 'STALE local job', date: today, status: 'not-started', address: '2 Other St' }]);

  await fn();

  assert.equal(calls.stops.length, 0, 'a real, successful "zero jobs" answer must not be replaced by the local cache');
  assert.equal(calls.alerts.length, 1);
  assert.match(calls.alerts[0], /No active jobs due today/);
});

test('a failed/unavailable relational fetch falls back to the localStorage copy, so this still works offline exactly as before', async () => {
  const { fn, calls, sandbox } = loadPullTodaysJobs(async () => ({ ok: false, error: 'network', jobs: [] }));
  sandbox.localStorage._store.th_tracker_jobs = JSON.stringify([{ title: 'Local-only job', date: today, status: 'not-started', address: '3 Fallback Ave' }]);

  await fn();

  assert.equal(calls.stops.length, 1);
  assert.equal(calls.stops[0].address, '3 Fallback Ave');
});
