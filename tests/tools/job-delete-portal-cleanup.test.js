// Deleting a completed job removes its copy from the client portal, for
// bulk delete as well as single delete (2026-10-01). bulkDeleteJobs() used
// to skip the portal cleanup that deleteJob() does, so a client could still
// see jobs Steve had bulk-deleted (found in the Item 1 inventory,
// docs/ITEM-1-INVENTORY.md bugs table). Both now call removeJobFromPortal().
//
// Runs the real deleteJob(), bulkDeleteJobs() and removeJobFromPortal() from
// tools/job-tracker.html in jsdom, with the 6-second undo timer run at once.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
const grab = (re) => { const m = SRC.match(re); assert.ok(m, 'found ' + re); return m[0]; };
const REMOVE = grab(/  function removeJobFromPortal\(job\) \{[\s\S]*?\n  \}\n/);
const DELETE_ONE = grab(/  async function deleteJob\(id\) \{[\s\S]*?\n  \}\n/);
const DELETE_BULK = grab(/  async function bulkDeleteJobs\(\) \{[\s\S]*?\n  \}\n/);

const JOBS = [
  { id: 1, title: 'Washer', status: 'done', clientEmail: 'a@example.com' },       // synced to the portal
  { id: 2, title: 'Dryer', status: 'done', clientEmail: 'b@example.com' },        // synced to the portal
  { id: 3, title: 'Fridge', status: 'in-progress', clientEmail: 'c@example.com' }, // not done: never synced
  { id: 4, title: 'Oven', status: 'done', clientEmail: '' },                      // no email: never synced
];

function setup({ signedIn = true, undo = false } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  const out = { portal: [], tombstones: [], mirrored: [], graveyard: [], jobs: JOBS.map((j) => ({ ...j })) };
  w.SUPABASE_URL = 'https://x.supabase.co';
  w.SUPABASE_ANON_KEY = 'anon';
  if (signedIn) w.getAuthToken = () => 'tok';
  w.fetch = async (url, init) => { out.portal.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true }; };
  w.loadJobs = () => out.jobs.map((j) => ({ ...j }));
  w.saveJobs = (list) => { out.jobs = list; };
  w.thAddJobTombstone = (id) => out.tombstones.push(id);
  w.mirrorDelete = (table, id) => out.mirrored.push(id);
  w.thAddToGraveyard = (type, j) => out.graveyard.push(j.id);
  w.showConfirm = async () => true;
  w.showAlert = async () => {};
  w.showToast = () => {};
  w.renderJobs = () => {};
  w.cancelJobEdit = () => {};
  w.animateRowExit = (row, done) => done();
  w.editingJobId = null;
  w.pendingDeleteJobIds = new Map();
  w.selectedJobIds = new Set();
  w.toggleJobSelectionMode = () => { w.selectedJobIds.clear(); };
  // The undo toast: either let the delete go through (the timer fires) or undo it.
  const timers = [];
  w.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  w.clearTimeout = (t) => { timers[t - 1] = null; };
  w.showUndoToast = (msg, onUndo) => { if (undo) onUndo(); };
  w.eval(REMOVE + DELETE_ONE + DELETE_BULK + '\nwindow.__t = { deleteJob, bulkDeleteJobs, removeJobFromPortal };');
  out.flush = async () => { for (const fn of timers.splice(0)) if (fn) await fn(); };
  return { w, api: w.__t, out };
}

test('bulk delete removes every synced job from the portal, and only those', async () => {
  const { w, api, out } = setup();
  [1, 2, 3, 4].forEach((id) => w.selectedJobIds.add(id));
  await api.bulkDeleteJobs();
  await out.flush();
  assert.deepEqual(out.portal.map((p) => p.body).sort((a, b) => a.source_job_id - b.source_job_id),
    [{ delete: true, source_job_id: 1 }, { delete: true, source_job_id: 2 }]);
  assert.ok(out.portal.every((p) => p.url === 'https://x.supabase.co/functions/v1/sync-job-to-portal' && p.auth === 'Bearer tok'));
  // The rest of the delete still happens for all four.
  assert.deepEqual(out.jobs, []);
  assert.deepEqual(out.tombstones.sort(), [1, 2, 3, 4]);
  assert.deepEqual(out.mirrored.sort(), [1, 2, 3, 4]);
  assert.deepEqual(out.graveyard.sort(), [1, 2, 3, 4]);
});

test('single delete still removes a synced job from the portal', async () => {
  const { api, out } = setup();
  await api.deleteJob(1);
  await out.flush();
  assert.deepEqual(out.portal.map((p) => p.body), [{ delete: true, source_job_id: 1 }]);
  assert.deepEqual(out.jobs.map((j) => j.id), [2, 3, 4]);
});

test('undoing a bulk delete within the window sends nothing to the portal', async () => {
  const { w, api, out } = setup({ undo: true });
  [1, 2].forEach((id) => w.selectedJobIds.add(id));
  await api.bulkDeleteJobs();
  await out.flush();
  assert.equal(out.portal.length, 0);
  assert.equal(out.jobs.length, 4);
});

test('a job never synced to the portal (not done, or no email) sends nothing', () => {
  const { api, out } = setup();
  api.removeJobFromPortal(JOBS[2]);
  api.removeJobFromPortal(JOBS[3]);
  api.removeJobFromPortal(null);
  assert.equal(out.portal.length, 0);
});

test('signed out, the portal call is skipped but the delete itself still goes through', async () => {
  const { w, api, out } = setup({ signedIn: false });
  w.selectedJobIds.add(1);
  await api.bulkDeleteJobs();
  await out.flush();
  assert.equal(out.portal.length, 0);
  assert.deepEqual(out.jobs.map((j) => j.id), [2, 3, 4]);
});

test('a failed portal call never blocks the delete', async () => {
  const { w, api, out } = setup();
  w.fetch = () => Promise.reject(new Error('offline'));
  w.selectedJobIds.add(1);
  w.selectedJobIds.add(2);
  await api.bulkDeleteJobs();
  await out.flush();
  assert.deepEqual(out.jobs.map((j) => j.id), [3, 4]);
});
