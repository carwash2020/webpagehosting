// Tests for the referral incentive program (direct request, 2026-09-09).
// Terms: a $25 credit for the referring customer, earned once the
// referred customer's job is complete AND paid. See
// sql/infra/create_referral_program.sql for the schema.
//
// Capture happens in three places (a referral doesn't only ever arrive
// through a public form -- a phone call or walk-in never touches
// either): booking.html, index.html's Request form, and the Job
// Tracker's own Add Job field. These tests confirm all three capture
// points exist, that the Job Tracker's first-time-customer nudge and
// one-time (not-on-every-edit) referral creation actually work, that the
// invoice-paid hook fires the earn transition, and that mirrorUpsert's
// real HTTP call shape is what the referrals table actually expects.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');
const SYNC_JS = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const BOOKING = fs.readFileSync(repo('booking.html'), 'utf8');
const JOB_TRACKER = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
const WORKSPACE = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
const CLIENTS = fs.readFileSync(path.join(TOOLS_DIR, 'clients.html'), 'utf8');

test('both new mirror functions are defined in sync.js', () => {
  assert.match(SYNC_JS, /function mirrorReferralCreated\(job\)/);
  assert.match(SYNC_JS, /async function mirrorReferralEarnedForJob\(jobId\)/);
});

test('mirrorJobsToRelational() includes referred_by in the mapped row', () => {
  const jobsSrc = SYNC_JS.match(/function mirrorJobsToRelational[\s\S]*?\n\}/)[0];
  assert.match(jobsSrc, /referred_by: j\.referredBy \|\| null/);
});

test('booking.html: captures "Who referred you?" and sends it as referred_by', () => {
  assert.match(BOOKING, /id="bReferredBy" name="referred_by"/);
  assert.match(BOOKING, /referred_by: formData\.get\('referred_by'\) \|\| null/);
});

test("index.html: Request form captures a referrer and sends it to th_leads", () => {
  assert.match(INDEX, /id="referredBy" name="referredBy"/);
  assert.match(INDEX, /referred_by: formData\.get\('referredBy'\) \|\| null/);
});

test('index.html: FAQ (both static HTML and JSON-LD) mentions the $25 referral credit', () => {
  assert.match(INDEX, /Do you have a referral program\?/);
  assert.match(INDEX, /\$25 credit toward your next service/);
  const jsonLd = INDEX.match(/"@type": "FAQPage"[\s\S]*?\n<\/script>/)[0];
  assert.match(jsonLd, /Do you have a referral program\?/);
});

test('job-tracker.html: Add Job has a Referred By field, wired into fields and into edit-mode repopulation', () => {
  assert.match(JOB_TRACKER, /id="jobReferredBy"/);
  assert.match(JOB_TRACKER, /const referredBy = document\.getElementById\('jobReferredBy'\)\.value\.trim\(\);/);
  assert.match(JOB_TRACKER, /referredBy: referredBy \|\| '',/);
  assert.match(JOB_TRACKER, /document\.getElementById\('jobReferredBy'\)\.value = job\.referredBy \|\| '';/);
});

test('job-tracker.html: referral is only mirrored on genuine creation, never on an edit', () => {
  const addJobFn = JOB_TRACKER.match(/async function addJob\(\)[\s\S]*?\n  \}/)[0];
  assert.match(addJobFn, /if \(!wasEditing && referredBy && typeof mirrorReferralCreated === 'function'\)/);
});

test('job-tracker.html: first-time-customer nudge checks the Client Registry, not free-text guessing', () => {
  const nudgeFn = JOB_TRACKER.match(/function updateFirstTimeNudge\(typedName\)[\s\S]*?\n  \}/)[0];
  assert.match(nudgeFn, /typeof thFindClientByName === 'function' && !thFindClientByName\(typedName\)/);
  assert.match(JOB_TRACKER, /onchange="autofillJobClient\(\)"/, 'the nudge only fires from the existing autofill hook, no new event wiring duplicated');
  assert.match(JOB_TRACKER, /updateFirstTimeNudge\(typedName\);/);
});

test('workspace.html: togglePaid() flips a referral to earned only when the invoice reaches paid status', () => {
  const togglePaidFn = WORKSPACE.match(/async function togglePaid\(id\)[\s\S]*?\n  \}/)[0];
  assert.match(togglePaidFn, /if \(invoicePaymentStatus\(inv\) === 'paid' && inv\.jobRefId && typeof mirrorReferralEarnedForJob === 'function'\)/);
  assert.match(togglePaidFn, /mirrorReferralEarnedForJob\(Number\(inv\.jobRefId\)\);/);
});

test('clients.html: Referral Credits panel exists with a summary, a list, and a mark-redeemed action', () => {
  assert.match(CLIENTS, /<h2>Referral Credits<\/h2>/);
  assert.match(CLIENTS, /id="referralCreditsSummary"/);
  assert.match(CLIENTS, /id="referralCreditsList"/);
  assert.match(CLIENTS, /async function renderReferralCredits\(\)/);
  assert.match(CLIENTS, /async function markReferralRedeemed\(id\)/);
  assert.match(CLIENTS, /renderReferralCredits\(\);/, 'must actually be called on page init, not just defined');
});

// Functional tests: mirrorReferralCreated/mirrorReferralEarnedForJob's
// real HTTP call shape, with a mocked fetch -- same pattern as
// tests/sync/relational-mirror.test.js uses for the other mirror
// functions.
function loadReferralMirrorFunctions() {
  const upsertSrc = SYNC_JS.match(/async function mirrorUpsert[\s\S]*?\n\}/)[0];
  const createdSrc = SYNC_JS.match(/function mirrorReferralCreated[\s\S]*?\n\}/)[0];
  const earnedSrc = SYNC_JS.match(/async function mirrorReferralEarnedForJob[\s\S]*?\n\}/)[0];
  assert.ok(upsertSrc && createdSrc && earnedSrc, 'one or more referral mirror functions not found in sync.js');

  const fetchWithRetryStub = 'async function fetchWithRetry(url, opts) { return fetch(url, opts); }\n';
  const sandbox = { isSyncConfigured: () => true, getAuthToken: () => 'fake-token', fetch: (...args) => global.fetch(...args) };
  const src = fetchWithRetryStub + upsertSrc + '\n' + createdSrc + '\n' + earnedSrc +
    '\nsandbox.mirrorUpsert = mirrorUpsert; sandbox.mirrorReferralCreated = mirrorReferralCreated; sandbox.mirrorReferralEarnedForJob = mirrorReferralEarnedForJob;' +
    '\nsandbox.fetchWithRetry = fetchWithRetry; sandbox.fetch = fetch;';
  // eslint-disable-next-line no-new-func
  new Function('sandbox', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'isSyncConfigured', 'getAuthToken', 'fetch',
    src
  )(sandbox, 'https://example-project.supabase.co', 'fake-anon-key', sandbox.isSyncConfigured, sandbox.getAuthToken, sandbox.fetch);
  return sandbox;
}

test('mirrorReferralCreated() POSTs a real pending row to /rest/v1/referrals when a referrer name was given', async () => {
  const { mirrorReferralCreated } = loadReferralMirrorFunctions();
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201 }; };

  mirrorReferralCreated({ id: 42, client: 'Alice', phone: '555-1234', referredBy: 'Bob Neighbor' });
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example-project.supabase.co/rest/v1/referrals');
  assert.equal(calls[0].opts.method, 'POST');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.length, 1);
  assert.equal(body[0].referrer_name, 'Bob Neighbor');
  assert.equal(body[0].referred_name, 'Alice');
  assert.equal(body[0].referred_job_id, 42);
  assert.equal(body[0].status, 'pending');
});

test('mirrorReferralCreated() is a no-op when no referrer was given', async () => {
  const { mirrorReferralCreated } = loadReferralMirrorFunctions();
  let called = false;
  global.fetch = async () => { called = true; return { ok: true, status: 201 }; };

  mirrorReferralCreated({ id: 42, client: 'Alice', referredBy: '' });
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(called, false);
});

test('mirrorReferralEarnedForJob() PATCHes only the pending referral(s) for that exact job_id to earned', async () => {
  const { mirrorReferralEarnedForJob } = loadReferralMirrorFunctions();
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };

  await mirrorReferralEarnedForJob(42);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/referrals\?referred_job_id=eq\.42&status=eq\.pending$/);
  assert.equal(calls[0].opts.method, 'PATCH');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.status, 'earned');
  assert.ok(body.earned_at, 'should stamp earned_at');
});

test('referral mirror functions never throw even when fetch itself fails -- best-effort, never blocks the real save', async () => {
  const { mirrorReferralCreated, mirrorReferralEarnedForJob } = loadReferralMirrorFunctions();
  global.fetch = async () => { throw new Error('network down'); };
  await assert.doesNotReject(async () => {
    mirrorReferralCreated({ id: 1, client: 'x', referredBy: 'y' });
    await mirrorReferralEarnedForJob(1);
  });
});
