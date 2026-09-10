// Relational tables Phase 2, step 1 (2026-09-09): calendar.html is the
// first page to read jobs from the real `jobs` table instead of the
// localStorage/workspace_sync blob copy. Deliberately the safest
// possible starting page for this multi-page cutover -- read-only, so
// a mistake here can only show wrong/stale data on a calendar, never
// corrupt a job, invoice, quote, or contract. See
// sql/infra/add_jobs_to_realtime_phase2.sql and CONTINUE-HERE.md's
// "Open follow-up: relational tables Phase 2" for the full plan (one
// page at a time, offline-first preserved).
//
// These tests confirm: fetchJobsFromRelational()'s real HTTP call shape
// and camelCase field mapping, startJobsRealtime()/stopRealtimeSync()
// wiring, and that calendar.html's loadJobsForCalendar() prefers the
// relational cache once loaded but still falls back to localStorage
// instantly (offline-first, matching the existing cachedUnconvertedBookings
// pattern) before that first fetch resolves.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');
const SYNC_JS = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
const CALENDAR = fs.readFileSync(path.join(TOOLS_DIR, 'calendar.html'), 'utf8');

test('sync.js: fetchJobsFromRelational and startJobsRealtime are defined, and stopRealtimeSync clears the jobs channel', () => {
  assert.match(SYNC_JS, /async function fetchJobsFromRelational\(\)/);
  assert.match(SYNC_JS, /function startJobsRealtime\(onChange, onStatusChange\)/);
  const stopFn = SYNC_JS.match(/function stopRealtimeSync\(\)[\s\S]*?\n\}/)[0];
  assert.match(stopFn, /_jobsRealtimeChannel/);
});

test('calendar.html: loadJobsForCalendar() prefers the relational cache once set, falls back to localStorage while null', () => {
  const fn = CALENDAR.match(/function loadJobsForCalendar\(\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(cachedRelationalJobs !== null\)/);
  assert.match(fn, /localStorage\.getItem\('th_tracker_jobs'\)/, 'must still have the localStorage fallback for offline-first instant paint');
});

test('calendar.html: init wiring refreshes the relational cache on load and subscribes to jobs realtime', () => {
  assert.match(CALENDAR, /refreshRelationalJobsCache\(\)\.then\(\(\) => \{ renderCalendar\(\); renderDayDetail\(\); \}\);/);
  assert.match(CALENDAR, /if \(typeof startJobsRealtime === 'function'\) \{\s*startJobsRealtime\(\(\) => \{ refreshRelationalJobsCache\(\)/);
});

test('calendar.html: cachedRelationalJobs starts as null (distinct from an empty array), not [] -- so a page with zero jobs never gets mistaken for "not loaded yet"', () => {
  assert.match(CALENDAR, /let cachedRelationalJobs = null;/);
});

// Functional test: fetchJobsFromRelational()'s real HTTP call shape and
// field mapping, with a mocked fetch -- same pattern as
// tests/sync/relational-mirror.test.js uses for the mirror functions.
function loadFetchJobsFromRelational() {
  const fnSrc = SYNC_JS.match(/async function fetchJobsFromRelational\(\)[\s\S]*?\n\}/)[0];
  const sandbox = { isSyncConfigured: () => true, getAuthToken: () => 'fake-token', fetch: (...args) => global.fetch(...args) };
  const src = fnSrc + '\nsandbox.fetchJobsFromRelational = fetchJobsFromRelational;';
  // eslint-disable-next-line no-new-func
  new Function('sandbox', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'isSyncConfigured', 'getAuthToken', 'fetch',
    src
  )(sandbox, 'https://example-project.supabase.co', 'fake-anon-key', sandbox.isSyncConfigured, sandbox.getAuthToken, sandbox.fetch);
  return sandbox.fetchJobsFromRelational;
}

test('fetchJobsFromRelational() GETs /rest/v1/jobs with the right headers and maps rows to the camelCase shape loadJobs() callers expect', async () => {
  const fetchJobsFromRelational = loadFetchJobsFromRelational();
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => [{
        id: 42, title: 'Fix dryer', client: 'Alice', client_id: 'c_1', phone: '555-1234',
        address: '1 Main St', client_email: 'alice@example.com', priority: 'medium',
        job_date: '2026-09-10', status: 'not-started', notes: '', show_on_calendar: true,
        status_changed_at: null, created_by: 'a@b.com', last_edited_by: 'a@b.com', referred_by: 'Bob',
      }],
    };
  };

  const result = await fetchJobsFromRelational();

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/example-project\.supabase\.co\/rest\/v1\/jobs\?select=\*&order=id\.desc&limit=500$/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer fake-token');

  assert.equal(result.ok, true);
  assert.equal(result.jobs.length, 1);
  const j = result.jobs[0];
  assert.equal(j.id, 42);
  assert.equal(j.clientId, 'c_1');
  assert.equal(j.clientEmail, 'alice@example.com');
  assert.equal(j.date, '2026-09-10');
  assert.equal(j.showOnCalendar, true);
  assert.equal(j.referredBy, 'Bob');
});

test('fetchJobsFromRelational() reports ok:false on a non-2xx response, never throws', async () => {
  const fetchJobsFromRelational = loadFetchJobsFromRelational();
  global.fetch = async () => ({ ok: false, status: 500 });
  const result = await fetchJobsFromRelational();
  assert.equal(result.ok, false);
  assert.deepEqual(result.jobs, []);
});

test('fetchJobsFromRelational() reports ok:false on a network failure, never throws -- this is exactly what lets loadJobsForCalendar() safely fall back to localStorage', async () => {
  const fetchJobsFromRelational = loadFetchJobsFromRelational();
  global.fetch = async () => { throw new Error('network down'); };
  await assert.doesNotReject(async () => {
    const result = await fetchJobsFromRelational();
    assert.equal(result.ok, false);
  });
});
