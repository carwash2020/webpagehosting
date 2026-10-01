// Converting an online booking into a job writes the job to public.jobs and
// keeps the booking's referral (2026-10-01). convertBookingToJob() used to
// write localStorage only, so the job reached the relational table only when
// some other job was saved later, and the booking's "Who referred you?"
// answer was dropped, so the referrer never got their $25 credit (found in
// the Item 1 inventory, docs/ITEM-1-INVENTORY.md bugs table).
//
// Runs the real convertBookingToJob() from tools/workspace.html with the real
// mirrorJobsToRelational() and mirrorReferralCreated() from tools/sync.js in
// jsdom; only mirrorUpsert (the network call) is faked.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const WS = fs.readFileSync(path.join(TOOLS, 'workspace.html'), 'utf8');
const SYNC = fs.readFileSync(path.join(TOOLS, 'sync.js'), 'utf8');
const grab = (src, re) => { const m = src.match(re); assert.ok(m, 'found ' + re); return m[0]; };
const CONVERT = grab(WS, /  async function convertBookingToJob\(id\) \{[\s\S]*?\n  \}\n/);
const MIRROR_JOBS = grab(SYNC, /function mirrorJobsToRelational\(jobs\) \{[\s\S]*?\n\}\n/);
const MIRROR_REFERRAL = grab(SYNC, /function mirrorReferralCreated\(job\) \{[\s\S]*?\n\}\n/);

const BOOKING = {
  id: 7, name: 'Dana Reyes', phone: '435-555-0101', email: 'dana@example.com', address: '1 Main St',
  service_label: 'Dryer repair', notes: 'Back gate', start_at: '2026-10-02T16:00:00Z', end_at: '2026-10-02T18:00:00Z',
  referred_by: ' Pat Lee ',
};

function setup({ booking = BOOKING, jobMirrorOk = true } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/workspace.html', runScripts: 'outside-only' });
  const w = dom.window;
  const out = { upserts: [], marked: [], toasts: [], alerts: [] };
  w.mirrorUpsert = async (table, rows) => {
    out.upserts.push({ table, rows: JSON.parse(JSON.stringify(rows)) });
    return table === 'jobs' && !jobMirrorOk ? { ok: false, error: 'http-500' } : { ok: true };
  };
  w.fetchUnconvertedBookings = async () => ({ ok: true, bookings: [booking] });
  w.markBookingConverted = async (id, jobId) => { out.marked.push([id, jobId]); return { ok: true }; };
  w.thEnsureClient = () => ({ id: 'c_dana' });
  w.getCurrentUserEmail = () => 'steve@example.com';
  w.scheduleSync = () => {};
  w.showToast = (m) => out.toasts.push(m);
  w.showAlert = async (m) => { out.alerts.push(m); };
  w.loadAndRenderBookings = () => {};
  w.loadJobs = () => JSON.parse(w.localStorage.getItem('th_tracker_jobs') || '[]');
  w.eval(MIRROR_JOBS + MIRROR_REFERRAL + CONVERT + '\nwindow.__c = convertBookingToJob;');
  // The mirror runs in the background; let its promise chain settle.
  out.run = async (id) => { await w.__c(id); await new Promise((r) => setTimeout(r, 0)); };
  return { w, out };
}

test('the new job is written to public.jobs, with the booking details', async () => {
  const { w, out } = setup();
  await out.run(7);
  const saved = JSON.parse(w.localStorage.getItem('th_tracker_jobs'));
  assert.equal(saved.length, 1);
  const jobs = out.upserts.filter((u) => u.table === 'jobs');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].rows.length, 1, 'only the new job, not the whole list');
  const row = jobs[0].rows[0];
  assert.equal(row.id, saved[0].id);
  assert.equal(row.title, 'Dryer repair');
  assert.equal(row.client, 'Dana Reyes');
  assert.equal(row.legacy_client_id, 'c_dana');
  assert.equal(row.client_email, 'dana@example.com');
  assert.equal(row.job_date, '2026-10-02');
  assert.equal(row.status, 'not-started');
  assert.equal(row.show_on_calendar, true);
  assert.equal(row.referred_by, 'Pat Lee');
  assert.deepEqual(out.marked, [[7, saved[0].id]]);
  assert.deepEqual(out.toasts, ['Added to Jobs.']);
});

test("the booking's referrer gets a referral row, after the job it points at", async () => {
  const { w, out } = setup();
  await out.run(7);
  const jobId = JSON.parse(w.localStorage.getItem('th_tracker_jobs'))[0].id;
  assert.deepEqual(out.upserts.map((u) => u.table), ['jobs', 'referrals']);
  const ref = out.upserts[1].rows[0];
  assert.equal(ref.referrer_name, 'Pat Lee');
  assert.equal(ref.referred_name, 'Dana Reyes');
  assert.equal(ref.referred_phone, '435-555-0101');
  assert.equal(ref.referred_job_id, jobId);
  assert.equal(ref.status, 'pending');
});

test('no referral row for a booking nobody referred', async () => {
  const { out } = setup({ booking: { ...BOOKING, referred_by: null } });
  await out.run(7);
  assert.deepEqual(out.upserts.map((u) => u.table), ['jobs']);
  assert.equal(out.upserts[0].rows[0].referred_by, null);
});

test('if the job mirror fails, the referral is not sent (it would point at a missing job), and the conversion still completes', async () => {
  const { w, out } = setup({ jobMirrorOk: false });
  await out.run(7);
  assert.deepEqual(out.upserts.map((u) => u.table), ['jobs']);
  const saved = JSON.parse(w.localStorage.getItem('th_tracker_jobs'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].referredBy, 'Pat Lee', 'the referral stays on the job record');
  assert.equal(out.marked.length, 1);
  assert.deepEqual(out.toasts, ['Added to Jobs.']);
});

test('the conversion does not wait for the mirror', async () => {
  const { w, out } = setup();
  let release;
  w.mirrorUpsert = (table, rows) => { out.upserts.push({ table, rows }); return new Promise((r) => { release = r; }); };
  await w.__c(7);
  assert.equal(out.marked.length, 1, 'the booking is marked converted while the mirror is still pending');
  assert.deepEqual(out.toasts, ['Added to Jobs.']);
  release({ ok: true });
});
