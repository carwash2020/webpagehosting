// Item 1 Phase 2a: the jobs data-access seam in tools/data-layer.js
// (docs/ITEM-1-MIGRATION-PLAN.md "Phase 2 -- Data-access seam and query
// shapes"). Additive only -- no page calls thJobs yet, so these tests exist
// purely to prove the seam itself behaves correctly in isolation, backed by
// localStorage exactly as every page's own loadJobs()/saveJobs() pair is
// today.
//
// Same JSDOM sandbox approach as tests/sync/contract-client-details.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const DATA_LAYER = fs.readFileSync(path.join(TOOLS, 'data-layer.js'), 'utf8');

function loadLayer(seed) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  Object.entries(seed || {}).forEach(([k, v]) => window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
  const fn = new Function('window', 'document', 'localStorage', DATA_LAYER + '\nreturn { thJobs, thRead, TH_KEYS };');
  return fn(window, window.document, window.localStorage);
}

const JOB = (overrides) => Object.assign({
  id: 1000, title: 'Fix dryer', client: 'Sarah Miller', clientId: null,
  phone: '', address: '', priority: 'medium', date: '2026-10-01', status: 'not-started', notes: '',
}, overrides);

test('list() with no filters returns everything, most-recent-first', () => {
  const L = loadLayer({ th_tracker_jobs: [JOB({ id: 1 }), JOB({ id: 3 }), JOB({ id: 2 })] });
  const { rows, nextCursor } = L.thJobs.list();
  assert.deepEqual(rows.map(j => j.id), [3, 2, 1]);
  assert.equal(nextCursor, null);
});

test('list() filters by status, clientId, client, and date range', () => {
  const jobs = [
    JOB({ id: 1, status: 'done', clientId: 'c1', client: 'Sarah', date: '2026-09-01' }),
    JOB({ id: 2, status: 'not-started', clientId: 'c2', client: 'Dana', date: '2026-10-05' }),
    JOB({ id: 3, status: 'not-started', clientId: 'c1', client: 'Sarah', date: '2026-10-10' }),
  ];
  const L = loadLayer({ th_tracker_jobs: jobs });
  assert.deepEqual(L.thJobs.list({ status: 'done' }).rows.map(j => j.id), [1]);
  assert.deepEqual(L.thJobs.list({ notStatus: 'done' }).rows.map(j => j.id), [3, 2]);
  assert.deepEqual(L.thJobs.list({ clientId: 'c1' }).rows.map(j => j.id), [3, 1]);
  assert.deepEqual(L.thJobs.list({ client: 'Dana' }).rows.map(j => j.id), [2]);
  assert.deepEqual(L.thJobs.list({ dateFrom: '2026-10-01', dateTo: '2026-10-09' }).rows.map(j => j.id), [2]);
  assert.deepEqual(L.thJobs.list({ ids: [1, 3] }).rows.map(j => j.id), [3, 1]);
});

test('list() paginates with a keyset cursor on id, descending', () => {
  const jobs = [1, 2, 3, 4, 5].map((id) => JOB({ id }));
  const L = loadLayer({ th_tracker_jobs: jobs });
  const page1 = L.thJobs.list({ pageSize: 2 });
  assert.deepEqual(page1.rows.map(j => j.id), [5, 4]);
  assert.equal(page1.nextCursor, 4);
  const page2 = L.thJobs.list({ pageSize: 2 }, page1.nextCursor);
  assert.deepEqual(page2.rows.map(j => j.id), [3, 2]);
  assert.equal(page2.nextCursor, 2);
  const page3 = L.thJobs.list({ pageSize: 2 }, page2.nextCursor);
  assert.deepEqual(page3.rows.map(j => j.id), [1]);
  assert.equal(page3.nextCursor, null, 'a short final page has no next cursor');
});

test('get() finds a job by id, or returns null', () => {
  const L = loadLayer({ th_tracker_jobs: [JOB({ id: 1 }), JOB({ id: 2 })] });
  assert.equal(L.thJobs.get(2).id, 2);
  assert.equal(L.thJobs.get(999), null);
});

test('create() assigns an id and persists the job', () => {
  const L = loadLayer({ th_tracker_jobs: [] });
  const created = L.thJobs.create({ title: 'New job', client: 'Dana', status: 'not-started' });
  assert.ok(created.id, 'got an assigned id');
  assert.equal(created.title, 'New job');
  const stored = L.thRead(L.TH_KEYS.jobs, []);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, created.id);
});

test('update() merges a patch into the existing row', () => {
  const L = loadLayer({ th_tracker_jobs: [JOB({ id: 1, status: 'not-started' })] });
  const updated = L.thJobs.update(1, { status: 'done' });
  assert.equal(updated.status, 'done');
  assert.equal(updated.title, 'Fix dryer', 'untouched fields survive the merge');
  assert.equal(L.thJobs.get(1).status, 'done');
});

test('update() on a missing id returns null without touching storage', () => {
  const L = loadLayer({ th_tracker_jobs: [JOB({ id: 1 })] });
  assert.equal(L.thJobs.update(999, { status: 'done' }), null);
});

test('update() with a stale baseUpdatedAt returns a conflict instead of overwriting', () => {
  const L = loadLayer({ th_tracker_jobs: [JOB({ id: 1, updatedAt: 100 })] });
  const result = L.thJobs.update(1, { status: 'done' }, 50);
  assert.equal(result.conflict, true);
  assert.equal(result.current.updatedAt, 100);
  assert.equal(L.thJobs.get(1).status, 'not-started', 'the stale write never applied');
});

test('update() with no updatedAt on either side (the common case today) just applies the patch', () => {
  const L = loadLayer({ th_tracker_jobs: [JOB({ id: 1 })] });
  const result = L.thJobs.update(1, { status: 'done' });
  assert.equal(result.status, 'done');
  assert.equal(result.conflict, undefined);
});

test('remove() deletes the job and returns true; a missing id returns false', () => {
  const L = loadLayer({ th_tracker_jobs: [JOB({ id: 1 }), JOB({ id: 2 })] });
  assert.equal(L.thJobs.remove(1), true);
  assert.deepEqual(L.thRead(L.TH_KEYS.jobs, []).map(j => j.id), [2]);
  assert.equal(L.thJobs.remove(999), false);
});
