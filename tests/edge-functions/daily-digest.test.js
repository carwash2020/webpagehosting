// daily-digest: auth, disabled-by-default, hour guard (incl. DST), idempotency,
// retry/alert, section failure isolation, privacy. Runs the real .ts handler
// against fake Supabase/Stripe/Resend (tests/edge-functions/daily-digest-harness.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadDigest, sampleState } = require('./daily-digest-harness');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SQL = fs.readFileSync(repo('sql', 'infra', 'add_daily_digest.sql'), 'utf8');
const CRON = fs.readFileSync(repo('sql', 'infra', 'add_daily_digest_cron.sql'), 'utf8');

test('rejects any bearer token that is not the service-role key (anon key included)', async () => {
  const { call, calls } = loadDigest(sampleState());
  const r = await call({}, 'some-anon-jwt');
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0, 'no fetches before auth passes');
});

test('migration ships disabled with no recipients, RLS on both tables, additive only', () => {
  assert.match(SQL, /enabled boolean not null default false/);
  assert.match(SQL, /recipients text\[\] not null default '\{\}'/);
  assert.match(SQL, /values \(1, \(select id from public\.tenants where slug = 'triple-h'\), false, '\{\}'\)/);
  assert.match(SQL, /alter table public\.digest_settings enable row level security/);
  assert.match(SQL, /alter table public\.digest_runs enable row level security/);
  assert.match(SQL, /unique \(digest_date\)/);
  assert.doesNotMatch(SQL, /drop table|drop column|alter column|delete from|truncate/i);
  assert.doesNotMatch(SQL, /@/, 'no email addresses in the migration');
});

test('cron uses cron_tracked_http_post, vault key, hourly', () => {
  assert.match(CRON, /'0 \* \* \* \*'/);
  assert.match(CRON, /cron_tracked_http_post/);
  assert.match(CRON, /vault\.decrypted_secrets where name = 'send_push_service_role_key'/);
});

test('disabled (the shipped default) sends nothing and writes nothing', async () => {
  const s = sampleState(); s.settings.enabled = false; s.settings.recipients = [];
  const { call } = loadDigest(s);
  const r = await call({});
  assert.equal(r.body.skipped, 'disabled');
  assert.equal(s.resend.calls.length, 0);
  assert.equal(s.runs.length, 0);
});

test('enabled but no recipients: skipped, no run row (so adding recipients later still sends today)', async () => {
  const s = sampleState(); s.settings.recipients = [];
  const { call } = loadDigest(s);
  assert.equal((await call({})).body.skipped, 'no_recipients');
  assert.equal(s.runs.length, 0);
});

test('hour guard: before send hour and after the 3h catch-up window return 204', async () => {
  for (const iso of ['2026-11-01T01:30:00Z' /* 7:30 PM MDT */, '2026-11-01T07:30:00Z' /* 1:30 AM MST-ish next day */]) {
    const s = sampleState(); s.now = Date.parse(iso);
    const { call } = loadDigest(s);
    assert.equal((await call({})).status, 204, iso);
    assert.equal(s.resend.calls.length, 0);
  }
});

test('hour guard follows local time across DST: 8 PM MST (03:00Z, after fall-back) sends for the right local date', async () => {
  const s = sampleState(); s.now = Date.parse('2026-11-02T03:30:00Z'); // Sun Nov 1 8:30 PM MST
  const { call } = loadDigest(s);
  const r = await call({});
  assert.equal(r.status, 200);
  assert.equal(r.body.digest_date, '2026-11-01');
  assert.equal(s.runs[0].digest_date, '2026-11-01');
});

test('sends once, with Idempotency-Key, both recipients, counts-only run row; second call is a no-op', async () => {
  const s = sampleState();
  const { call } = loadDigest(s);
  const r = await call({});
  assert.equal(r.body.ok, true);
  assert.equal(s.resend.calls.length, 1);
  const sent = s.resend.calls[0];
  assert.equal(sent.headers['Idempotency-Key'], 'daily-digest-2026-10-31');
  assert.deepEqual(sent.body.to, ['owner1@example.com', 'owner2@example.com']);
  assert.match(sent.body.from, /digest@example\.com/);
  assert.equal(s.runs[0].status, 'sent');
  assert.equal(s.runs[0].resend_message_id, 'email_sample_1');
  const countsJson = JSON.stringify(s.runs[0].counts);
  assert.doesNotMatch(countsJson, /Maria|Gonzales|@/);
  assert.equal((await call({})).body.skipped, 'sent');
  assert.equal(s.resend.calls.length, 1);
});

test('a pending run under 10 minutes old is in flight; an older one is retried', async () => {
  const s = sampleState();
  s.runs.push({ id: 1, digest_date: '2026-10-31', status: 'pending', attempts: 0, created_at: new Date(s.now - 2 * 60000).toISOString() });
  let h = loadDigest(s);
  assert.equal((await h.call({})).body.skipped, 'in_flight');
  s.runs[0].created_at = new Date(s.now - 20 * 60000).toISOString();
  h = loadDigest(s);
  assert.equal((await h.call({})).body.ok, true);
  assert.equal(s.runs[0].status, 'sent');
});

test('Resend failure: run marked failed (attempts+1), 500; third failure writes one cron_alerts row; then stops retrying', async () => {
  const s = sampleState(); s.resend.status = 500;
  const { call } = loadDigest(s);
  assert.equal((await call({})).status, 500);
  assert.equal(s.runs[0].status, 'failed'); assert.equal(s.runs[0].attempts, 1);
  assert.equal(s.alerts.length, 0);
  assert.equal((await call({})).status, 500);
  assert.equal((await call({})).status, 500);
  assert.equal(s.runs[0].attempts, 3);
  assert.equal(s.alerts.length, 1);
  assert.equal(s.alerts[0].alert_type, 'job_run_failed');
  assert.equal((await call({})).body.skipped, 'max_attempts');
  assert.equal(s.alerts.length, 1);
  assert.doesNotMatch(String(s.runs[0].error), /nope|re_test_x/);
});

test('a failed run recovers on a later hour once Resend works', async () => {
  const s = sampleState(); s.resend.status = 500;
  const { call } = loadDigest(s);
  await call({});
  s.resend.status = 200; s.now += 60 * 60 * 1000; // 9 PM, still inside the window
  assert.equal((await call({})).body.ok, true);
  assert.equal(s.runs[0].status, 'sent');
});

test('Stripe outage: email still sends, Stripe sections say unavailable', async () => {
  const s = sampleState(); s.stripeFail = true;
  const { call } = loadDigest(s);
  assert.equal((await call({})).body.ok, true);
  const html = s.resend.calls[0].body.html;
  assert.match(html, /Stripe unavailable/);
  assert.match(html, /Dishwasher install/);
});

test('a failing DB section shows unavailable while the rest send', async () => {
  const s = sampleState(); s.failTables = ['client_portal_quotes'];
  const { call } = loadDigest(s);
  await call({});
  const html = s.resend.calls[0].body.html;
  assert.match(html, /Quotes<\/div>[\s\S]*?Unavailable/);
  assert.match(html, /INV-2210/);
});

test('test-mode Stripe key shows a TEST banner; live does not', async () => {
  const s = sampleState(); s.stripe.livemode = false;
  const { call } = loadDigest(s);
  assert.match((await call({ dry_run: true })).body.html, /Stripe mode: TEST/);
  s.stripe.livemode = true;
  assert.doesNotMatch((await call({ dry_run: true })).body.html, /Stripe mode: TEST/);
});

test('dry_run works while disabled, sends nothing, writes nothing', async () => {
  const s = sampleState(); s.settings.enabled = false; s.settings.recipients = [];
  const { call } = loadDigest(s);
  const r = await call({ dry_run: true });
  assert.equal(r.body.dry_run, true);
  assert.match(r.body.html, /Triple H/);
  assert.equal(s.resend.calls.length, 0); assert.equal(s.runs.length, 0);
});

test('content: dedupes linked work orders, shows MDT time, counts unparseable jobs, first-name+initial, no phones/addresses', async () => {
  const s = sampleState();
  const { call } = loadDigest(s);
  const { body } = await call({ dry_run: true });
  assert.equal((body.html.match(/Dishwasher install/g) || []).length, 1, 'work order linked to job 1 not shown twice');
  assert.match(body.html, /Ice maker not cooling &mdash; 3:00 PM MDT/);
  assert.match(body.html, /1 job\(s\) skipped/);
  assert.match(body.html, /Maria G\./);
  assert.doesNotMatch(body.html, /Gonzales/);
  assert.equal(body.counts.jobs_today, 2);
  assert.match(body.html, /Tomorrow \(Sunday\)/);
});

test('quiet day: sends "Quiet day" when send_on_empty_day, else skips the run', async () => {
  const s = sampleState();
  s.tables = { stripe_pos_charges_logged: [] };
  s.stripe.payment_intents = []; s.stripe.refunds = [];
  let h = loadDigest(s);
  await h.call({});
  assert.match(s.resend.calls[0].body.subject, /quiet day/);
  assert.match(s.resend.calls[0].body.html, /Nothing scheduled/);
  assert.match(s.resend.calls[0].body.html, /Available/);

  const s2 = sampleState(); s2.tables = { stripe_pos_charges_logged: [] };
  s2.stripe.payment_intents = []; s2.stripe.refunds = []; s2.settings.send_on_empty_day = false;
  h = loadDigest(s2);
  assert.equal((await h.call({})).body.skipped, 'empty_day');
  assert.equal(s2.runs[0].status, 'skipped'); assert.equal(s2.resend.calls.length, 0);
});

test('DST: the Stripe window for the 25-hour day is 06:00Z-07:00Z+24h aware, via dry run of Nov 1', async () => {
  const s = sampleState(); s.now = Date.parse('2026-11-02T03:30:00Z'); // Nov 1 evening MST
  const { call, calls } = loadDigest(s);
  await call({ dry_run: true });
  const pi = calls.find((c) => c.url.includes('/payment_intents'));
  const q = new URL(pi.url).search;
  // today = Nov 1 local: 06:00Z (MDT midnight) to 07:00Z next day (MST midnight) = 25h
  assert.match(decodeURIComponent(q), new RegExp(`created\\[gte\\]=${Date.parse('2026-11-01T06:00:00Z') / 1000}`));
  assert.match(decodeURIComponent(q), new RegExp(`created\\[lt\\]=${Date.parse('2026-11-02T07:00:00Z') / 1000}`));
});

test('logs contain no client names, emails, or key values', async () => {
  const s = sampleState();
  const { call, logs } = loadDigest(s);
  await call({});
  const all = logs.join('\n');
  assert.doesNotMatch(all, /Maria|Gonzales|owner1@|sk_test|re_test|service-role-key/);
});

test('plain-text part has no HTML tags or entities, and keeps line breaks', async () => {
  const s = sampleState();
  const { call } = loadDigest(s);
  const { body } = await call({ dry_run: true });
  assert.doesNotMatch(body.text, /<[a-z\/]|&[a-z]+;/i);
  assert.match(body.text, /Available \$1,284\.50 \| Pending \$605\.00/);
  assert.match(body.text, /3:00 PM MDT\n1 job\(s\) skipped/);
});
