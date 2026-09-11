// Manual booking confirmation email (2026-09-11), direct request: "if
// a guest asks us to schedule them, and we put the job on the
// calendar, does that send them a confirmation email? Can we add
// that safely, without accidentally sending it multiple times?"
//
// Today only booking.html's self-service flow auto-emails (an INSERT
// trigger on th_bookings). A job created by hand in job-tracker.html
// writes to public.jobs, which has no trigger -- silent unless staff
// separately call/text the customer. This adds a "Send Confirmation
// Email" button, backed by a new edge function that claims
// jobs.confirmation_sent_at with an atomic conditional UPDATE before
// sending, so the double-send the request specifically worried about
// can't happen even from a double-click or two staff acting at once.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');
const JOB_TRACKER_PATH = path.join(TOOLS_DIR, 'job-tracker.html');
const JOB_TRACKER_SRC = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
const SYNC_JS = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
const EDGE_FN = fs.readFileSync(repo('edge-functions', 'send-job-confirmation-email-index.ts'), 'utf8');
const MIGRATION = fs.readFileSync(repo('sql', 'infra', 'add_job_confirmation_email.sql'), 'utf8');

function loadJobTracker(jobs, fetchImpl) {
  const dom = new JSDOM(JOB_TRACKER_SRC, {
    runScripts: 'dangerously', url: 'https://example.com/tools/job-tracker.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, scale(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, fillRect(){}, arc(){}, arcTo(){}, closePath(){}, createLinearGradient(){ return { addColorStop(){} }; }, setLineDash(){},
      });
      w.localStorage.setItem('th_tracker_jobs', JSON.stringify(jobs));
    },
  });
  const { window } = dom;
  window.getCurrentUserEmail = () => null;
  window.pullSync = () => Promise.resolve({ ok: false });
  // getAuthToken() itself comes from auth.js (loaded below) -- not
  // stubbed, since its real fallback-to-anon-key behavior with no
  // stored session is exactly what these tests want to exercise.
  // showToast() calls requestAnimationFrame, not provided by jsdom --
  // a synchronous stub is enough since these tests don't assert on
  // toast animation timing (matches smoke-job-invoice-paid.test.js).
  window.requestAnimationFrame = (cb) => cb();
  if (fetchImpl) window.fetch = fetchImpl;
  for (const name of ['auth.js', 'data-layer.js', 'sync.js', 'tools-dialogs.js', 'tools-effects.js', 'tools-media-sharing.js', 'tools-nav-pwa.js', 'tools-tour.js']) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, name), 'utf8');
    const s = window.document.createElement('script');
    s.textContent = src;
    window.document.head.appendChild(s);
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.renderJobs();
  return window;
}

test('a job with a client email and no confirmation sent shows a "Send Confirmation Email" button', () => {
  const window = loadJobTracker([
    { id: 1, title: 'Fix Fridge', client: 'Alice', clientEmail: 'alice@example.com', status: 'not-started', priority: 'high', date: '2026-09-11' },
  ]);
  const card = window.document.querySelector('.job-card[data-job-id="1"]');
  const btn = [...card.querySelectorAll('button')].find(b => b.textContent === 'Send Confirmation Email');
  assert.ok(btn, 'expected a Send Confirmation Email button');
  assert.equal(btn.disabled, false);
});

test('a job with confirmation_sent_at already set shows a disabled "Confirmation Sent" state instead', () => {
  const window = loadJobTracker([
    { id: 2, title: 'AC Repair', client: 'Bob', clientEmail: 'bob@example.com', confirmationSentAt: '2026-09-11T12:00:00.000Z', status: 'not-started', priority: 'medium', date: '2026-09-11' },
  ]);
  const card = window.document.querySelector('.job-card[data-job-id="2"]');
  const sentBtn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('Confirmation Sent'));
  const sendBtn = [...card.querySelectorAll('button')].find(b => b.textContent === 'Send Confirmation Email');
  assert.ok(sentBtn, 'expected a "Confirmation Sent" indicator');
  assert.equal(sentBtn.disabled, true);
  assert.equal(sendBtn, undefined, 'the still-clickable send button should not also be present');
});

test('a job with no client email shows neither confirmation button', () => {
  const window = loadJobTracker([
    { id: 3, title: 'Drywall Patch', client: 'Carla', status: 'not-started', priority: 'low', date: '2026-09-11' },
  ]);
  const card = window.document.querySelector('.job-card[data-job-id="3"]');
  const anyConfirmationBtn = [...card.querySelectorAll('button')].find(b => b.textContent.includes('Confirmation'));
  assert.equal(anyConfirmationBtn, undefined);
});

test('sendJobConfirmationEmail posts job_id to send-job-confirmation-email with the caller\'s auth token', async () => {
  let capturedUrl = null;
  let capturedBody = null;
  let capturedAuth = null;
  // The real saveJobs() this handler calls on success also fires
  // mirrorJobsToRelational's own fetch to /rest/v1/jobs -- only
  // capture the call this test actually cares about, and let the
  // mirror's best-effort call resolve harmlessly.
  const fetchImpl = (url, opts) => {
    if (String(url).includes('/functions/v1/send-job-confirmation-email')) {
      capturedUrl = url;
      capturedAuth = opts.headers.Authorization;
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, confirmation_sent_at: '2026-09-11T12:00:00.000Z' }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  const window = loadJobTracker([
    { id: 4, title: 'Water Heater', client: 'Dana', clientEmail: 'dana@example.com', status: 'not-started', priority: 'medium', date: '2026-09-11' },
  ], fetchImpl);

  await window.sendJobConfirmationEmail(4);

  assert.match(capturedUrl, /\/functions\/v1\/send-job-confirmation-email$/);
  // getAuthToken() falls back to the anon key with no real session
  // stored (matches auth.js's real behavior, not stubbed here) -- the
  // point of this assertion is just that a real bearer token is sent.
  assert.match(capturedAuth, /^Bearer .+/);
  assert.deepEqual(capturedBody, { job_id: 4 });

  const jobs = JSON.parse(window.localStorage.getItem('th_tracker_jobs'));
  const job = jobs.find(j => j.id === 4);
  assert.equal(job.confirmationSentAt, '2026-09-11T12:00:00.000Z', 'local job state should reflect the server-confirmed timestamp');
});

test('a 409 (already sent elsewhere) re-renders instead of just resetting the button, so the card picks up the real state', () => {
  const src = JOB_TRACKER_SRC;
  const fnMatch = src.match(/async function sendJobConfirmationEmail\(jobId\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate sendJobConfirmationEmail()');
  assert.match(fnMatch[0], /if \(res\.status === 409\) renderJobs\(\);/);
});

test('mirrorJobsToRelational never sends confirmation_sent_at -- that column is server-owned', () => {
  // Critical for the double-send guard to actually hold: the mirror is
  // a full-array upsert of every local job on every save. If it ever
  // included confirmation_sent_at, a stale local session (one that
  // hasn't yet learned another device already sent the confirmation)
  // could push a plain object without that field, and PostgREST's
  // json_populate_recordset would fill the missing column as NULL for
  // that row -- silently erasing the server-set timestamp and
  // reopening the exact double-send window this feature exists to
  // close. So the client must never touch this column at all; only
  // send-job-confirmation-email's atomic claim may set it.
  const fnMatch = SYNC_JS.match(/function mirrorJobsToRelational\(jobs\) \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate mirrorJobsToRelational()');
  assert.doesNotMatch(fnMatch[0], /confirmation_sent_at/);
});

test('send-job-confirmation-email claims confirmation_sent_at with an atomic conditional UPDATE before sending', () => {
  assert.match(EDGE_FN, /jobs\?id=eq\.\$\{jobId\}&confirmation_sent_at=is\.null/);
  assert.match(EDGE_FN, /method: "PATCH"/);
  // The claim must happen before the send, not after -- confirms the
  // ordering, not just the presence of both operations.
  const claimIdx = EDGE_FN.indexOf('const claimedJob = await claimConfirmation(job_id);');
  const sendIdx = EDGE_FN.indexOf('const sent = await sendGuestConfirmation(claimedJob);');
  assert.ok(claimIdx > -1 && sendIdx > -1 && claimIdx < sendIdx, 'claim must happen before send');
});

test('send-job-confirmation-email rolls the claim back if the email send fails, so a transient failure doesn\'t permanently block confirmation', () => {
  const fnMatch = EDGE_FN.match(/const sent = await sendGuestConfirmation\(claimedJob\);\n[\s\S]*?\n    \}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /await releaseConfirmationClaim\(job_id\);/);
});

test('send-job-confirmation-email verifies the caller is a real internal account before doing anything', () => {
  assert.match(EDGE_FN, /callerIsInternalAccount\(claims\.email\)/);
  assert.match(EDGE_FN, /account_roles\?email=eq\./);
});

test('confirmation_sent_at is a nullable timestamptz on public.jobs, same shape as th_bookings.reminder_sent_at', () => {
  assert.match(MIGRATION, /alter table public\.jobs add column if not exists confirmation_sent_at timestamptz;/);
});

test('send-job-confirmation-email BCCs LEAD_EMAIL_TO on the guest confirmation, so staff get a record it sent', () => {
  // Direct follow-up request: "we should be CC'ed on the email...
  // to confirm it worked correctly each time and to have additional
  // record." BCC (not CC or a separate send) so staff never appear as
  // a visible recipient on the guest's own copy, reusing the same
  // LEAD_EMAIL_TO list already configured for the booking/lead pipeline.
  assert.match(EDGE_FN, /const LEAD_EMAIL_TO = \(Deno\.env\.get\("LEAD_EMAIL_TO"\) \|\| ""\)/);
  const sendFnMatch = EDGE_FN.match(/async function sendGuestConfirmation\(job: Record<string, unknown>\): Promise<boolean> \{[\s\S]*?\n\}\n/);
  assert.ok(sendFnMatch, 'expected to isolate sendGuestConfirmation()');
  assert.match(sendFnMatch[0], /bcc: LEAD_EMAIL_TO\.length \? LEAD_EMAIL_TO : undefined,/);
});
