// Booking flow, round 2 (2026-09-22): what happens AFTER a booking, plus
// two push-privacy fixes found on the way.
//
//  - send-booking-email: also emails the guest (and staff) when a booking
//    is rescheduled or cancelled -- before, their inbox kept the OLD
//    time -- attaches a calendar file to every email that confirms a
//    time (re-sent without it if Resend rejects it), and now requires the
//    service-role bearer token.
//  - send-appointment-reminder: calendar file + Google link, a push to a
//    portal client's own device when their email EXACTLY matches a portal
//    account, and the service-role check.
//  - track_booking_changes(): a reschedule clears reminder_sent_at, so the
//    day-before reminder fires again for the new time.
//  - Send-Push: internal broadcasts reach internal accounts only (a client
//    who enabled portal push would otherwise have received every internal
//    alert), failing closed; plus a read-only audience-check.
//  - Six notification functions: getUserIdByEmail() used a GoTrue `email`
//    parameter that doesn't exist and took users[0] -- the newest account,
//    not the client. Now an exact lookup via get_auth_user_id_by_email().
//
// The two booking functions are EXECUTED here (Node strips the TypeScript
// types; Deno.serve is stubbed to capture the handler and fetch is mocked),
// so these check real behavior, not just source text.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { stripTypeScriptTypes } = require('node:module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');

// Fresh evaluation every call (a plain import would be cached after the
// first test): Node's own type stripper turns the .ts into plain JS, and
// the file runs with a stub Deno whose serve() hands back the handler.
// Neither function file has imports, so it runs as-is. fetch is read
// from globalThis at call time, so each test's mock applies.
async function loadEdgeFunction(file, env) {
  let handler = null;
  const js = stripTypeScriptTypes(read('edge-functions', file));
  const Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  new Function('Deno', js)(Deno);
  assert.ok(handler, 'Deno.serve handler should be registered');
  return handler;
}

function post(body, key) {
  return new Request('https://edge.test/fn', {
    method: 'POST',
    headers: key ? { Authorization: 'Bearer ' + key } : {},
    body: JSON.stringify(body),
  });
}

const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  RESEND_API_KEY: 'resend-key',
  LEAD_EMAIL_TO: 'staff@example.com',
  LEAD_EMAIL_FROM: 'leads@example.com',
};

const BOOKING = {
  id: 42, service_label: 'Appliance Repair', start_at: '2030-01-02T21:00:00Z', end_at: '2030-01-02T23:00:00Z',
  name: 'Jane <b>Public</b>', phone: '(555) 123-4567', email: 'jane@example.com', address: '1 A St, Apt 2',
  cancel_token: 'tok-abc', status: 'confirmed',
};

function mockResend({ rejectAttachments = false } = {}) {
  const sent = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push({ url: String(url), body });
    if (rejectAttachments && body.attachments) return new Response('attachment rejected', { status: 422 });
    return new Response('{"id":"email_1"}', { status: 200 });
  };
  return sent;
}

const icsOf = (email) => Buffer.from(email.body.attachments[0].content, 'base64').toString('utf8');

// ---------- send-booking-email ----------

test('send-booking-email rejects the public anon key and a missing token -- before reading the payload or sending anything', async () => {
  const sent = mockResend();
  const h = await loadEdgeFunction('send-booking-email-index.ts', ENV);
  assert.equal((await h(post({ type: 'INSERT', table: 'th_bookings', record: BOOKING }, 'the-public-anon-key'))).status, 401);
  assert.equal((await h(post({ type: 'INSERT', table: 'th_bookings', record: BOOKING }))).status, 401);
  assert.equal(sent.length, 0);
});

test('send-booking-email: a new booking still sends the staff email and the guest confirmation, now with a calendar file', async () => {
  const sent = mockResend();
  const h = await loadEdgeFunction('send-booking-email-index.ts', ENV);
  const res = await h(post({ type: 'INSERT', table: 'th_bookings', record: BOOKING }, ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(res.status, 200);
  assert.equal(sent.length, 2);
  const staff = sent.find((s) => s.body.to === 'staff@example.com' || (Array.isArray(s.body.to) && s.body.to.includes('staff@example.com')));
  const guest = sent.find((s) => s.body.to === 'jane@example.com');
  assert.ok(staff && guest);
  assert.equal(staff.body.attachments, undefined, 'staff email unchanged -- no calendar file');
  assert.equal(guest.body.subject, "You're booked, Triple H Enterprises");
  const ics = icsOf(guest);
  assert.match(ics, /DTSTART:20300102T210000Z/);
  assert.match(ics, /UID:th-booking-42@triplehenterprisesllc\.biz/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /TRIGGER:-PT2H/);
  assert.match(guest.body.html, /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.doesNotMatch(guest.body.html, /<b>Public<\/b>/, 'guest-supplied text stays escaped');
});

test('send-booking-email: a reschedule emails staff AND the guest the new time (old one struck through) with an updated calendar file', async () => {
  const sent = mockResend();
  const h = await loadEdgeFunction('send-booking-email-index.ts', ENV);
  const moved = { ...BOOKING, start_at: '2030-01-03T22:00:00Z', end_at: '2030-01-04T00:00:00Z' };
  const res = await h(post({ type: 'UPDATE', table: 'th_bookings', record: moved, old_record: BOOKING }, ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(res.status, 200);
  assert.equal(sent.length, 2);
  const guest = sent.find((s) => s.body.to === 'jane@example.com');
  assert.equal(guest.body.subject, 'Your visit has moved, Triple H Enterprises');
  assert.match(guest.body.html, /<s>Wednesday, January 2, 2030/);
  assert.match(icsOf(guest), /DTSTART:20300103T220000Z/, 'the calendar file carries the NEW time');
  assert.match(icsOf(guest), /UID:th-booking-42@/, 'same UID, so a calendar app updates the one event');
  const staff = sent.find((s) => s !== guest);
  assert.match(staff.body.subject, /^Booking moved: /);
});

test('send-booking-email: a cancellation emails staff and the guest (no calendar file, a rebook link)', async () => {
  const sent = mockResend();
  const h = await loadEdgeFunction('send-booking-email-index.ts', ENV);
  const res = await h(post({ type: 'UPDATE', table: 'th_bookings', record: { ...BOOKING, status: 'cancelled' }, old_record: BOOKING }, ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(res.status, 200);
  const guest = sent.find((s) => s.body.to === 'jane@example.com');
  assert.equal(guest.body.subject, 'Your visit is cancelled, Triple H Enterprises');
  assert.equal(guest.body.attachments, undefined);
  assert.match(guest.body.html, /booking\.html/);
  assert.ok(sent.some((s) => /^Booking cancelled: /.test(s.body.subject)));
});

test('send-booking-email: any other update (the reminder stamping reminder_sent_at, a job link) sends nothing', async () => {
  const sent = mockResend();
  const h = await loadEdgeFunction('send-booking-email-index.ts', ENV);
  for (const record of [{ ...BOOKING, reminder_sent_at: '2030-01-01T21:00:00Z' }, { ...BOOKING, job_id: 7 }]) {
    const res = await h(post({ type: 'UPDATE', table: 'th_bookings', record, old_record: BOOKING }, ENV.SUPABASE_SERVICE_ROLE_KEY));
    assert.deepEqual(await res.json(), { ok: true, skipped: true });
  }
  assert.equal(sent.length, 0);
});

test('send-booking-email: a phone-only booking that moves still tells staff, and just skips the guest email', async () => {
  const sent = mockResend();
  const h = await loadEdgeFunction('send-booking-email-index.ts', ENV);
  const noEmail = { ...BOOKING, email: null };
  await h(post({ type: 'UPDATE', table: 'th_bookings', record: { ...noEmail, start_at: '2030-01-05T21:00:00Z', end_at: '2030-01-05T23:00:00Z' }, old_record: noEmail }, ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.subject, /^Booking moved: /);
});

test('send-booking-email: if Resend rejects the calendar attachment, the confirmation is re-sent without it -- never lost', async () => {
  const sent = mockResend({ rejectAttachments: true });
  const h = await loadEdgeFunction('send-booking-email-index.ts', ENV);
  const origError = console.error; console.error = () => {};
  try {
    await h(post({ type: 'INSERT', table: 'th_bookings', record: BOOKING }, ENV.SUPABASE_SERVICE_ROLE_KEY));
  } finally { console.error = origError; }
  const guestSends = sent.filter((s) => s.body.to === 'jane@example.com');
  assert.equal(guestSends.length, 2);
  assert.ok(guestSends[0].body.attachments && !guestSends[1].body.attachments);
});

// ---------- send-appointment-reminder ----------

function mockReminderWorld({ userId = 'user-uuid-1', emailOk = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, body });
    if (url.includes('/rest/v1/th_bookings?select=')) return new Response(JSON.stringify([BOOKING]), { status: 200 });
    if (url.includes('/rest/v1/th_bookings?id=eq.')) return new Response(null, { status: 204 });
    if (new URL(url).hostname === 'api.resend.com') return new Response('{}', { status: emailOk ? 200 : 500 });
    if (url.includes('/rpc/get_auth_user_id_by_email')) return new Response(JSON.stringify(userId), { status: 200 });
    if (url.includes('/functions/v1/Send-Push')) return new Response('{"ok":true}', { status: 200 });
    return new Response('unexpected', { status: 404 });
  };
  return calls;
}

test('send-appointment-reminder rejects the anon key before reading anything', async () => {
  const calls = mockReminderWorld();
  const h = await loadEdgeFunction('send-appointment-reminder-index.ts', ENV);
  assert.equal((await h(post({}, 'the-public-anon-key'))).status, 401);
  assert.equal(calls.length, 0);
});

test('send-appointment-reminder: email with a calendar file, marked sent, THEN a push to the client\'s own portal account', async () => {
  const calls = mockReminderWorld();
  const h = await loadEdgeFunction('send-appointment-reminder-index.ts', ENV);
  const res = await h(post({}, ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.deepEqual(await res.json(), { ok: true, checked: 1, sent: 1, pushed: 1 });
  const order = calls.map((c) => (c.url.includes('resend') ? 'email' : c.url.includes('id=eq.') ? 'mark' : c.url.includes('get_auth_user_id_by_email') ? 'lookup' : c.url.includes('Send-Push') ? 'push' : 'fetch'));
  assert.deepEqual(order, ['fetch', 'email', 'mark', 'lookup', 'push'], 'marked sent before the push, so a slow push can never cause a second email');
  const email = calls.find((c) => c.url.includes('resend'));
  const ics = Buffer.from(email.body.attachments[0].content, 'base64').toString();
  assert.match(ics, /TRIGGER:-PT2H/);
  assert.doesNotMatch(ics, /TRIGGER:-P1D/, 'a day-before alarm on a reminder sent a day before would fire immediately');
  const lookup = calls.find((c) => c.url.includes('get_auth_user_id_by_email'));
  assert.deepEqual(lookup.body, { p_email: 'jane@example.com' });
  const push = calls.find((c) => c.url.includes('Send-Push'));
  assert.equal(push.body.type, 'client-notification');
  assert.equal(push.body.user_id, 'user-uuid-1');
  assert.equal(push.body.url, '/portal/home.html');
});

test('send-appointment-reminder: no portal account for that email means no push at all', async () => {
  const calls = mockReminderWorld({ userId: null });
  const h = await loadEdgeFunction('send-appointment-reminder-index.ts', ENV);
  const res = await h(post({}, ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal((await res.json()).pushed, 0);
  assert.ok(!calls.some((c) => c.url.includes('Send-Push')));
});

test('send-appointment-reminder: a failed email is not marked sent and not pushed (retried next hour)', async () => {
  const calls = mockReminderWorld({ emailOk: false });
  const h = await loadEdgeFunction('send-appointment-reminder-index.ts', ENV);
  const origError = console.error; console.error = () => {};
  let body;
  try { body = await (await h(post({}, ENV.SUPABASE_SERVICE_ROLE_KEY))).json(); } finally { console.error = origError; }
  assert.equal(body.sent, 0);
  assert.ok(!calls.some((c) => c.url.includes('id=eq.') || c.url.includes('Send-Push')));
});

test('both booking functions\' real callers authenticate with the vault service-role key the new checks require', () => {
  const notifications = read('sql', 'booking', 'add_booking_notifications.sql');
  const block = notifications.slice(notifications.indexOf("functions/v1/send-booking-email") - 600, notifications.indexOf("functions/v1/send-booking-email") + 400);
  assert.match(block, /send_push_service_role_key/);
  assert.match(block, /'Bearer ' \|\| service_key/);
  const change = read('sql', 'booking', 'add_booking_change_emails_and_reminder_rearm.sql');
  assert.match(change, /name = 'send_push_service_role_key'/);
  assert.match(change, /'Authorization', 'Bearer ' \|\| service_key/);
  const cron = read('sql', 'infra', 'add_appointment_reminder_emails.sql');
  assert.match(cron, /'Authorization', 'Bearer ' \|\| \(select decrypted_secret from vault\.decrypted_secrets where name = 'send_push_service_role_key'/);
});

// ---------- the migration ----------

test('track_booking_changes clears reminder_sent_at only inside the reschedule branch', () => {
  const sql = read('sql', 'booking', 'add_booking_change_emails_and_reminder_rearm.sql');
  const fn = sql.match(/create or replace function public\.track_booking_changes\(\)[\s\S]*?\$\$;/)[0];
  const reschedBranch = fn.match(/if OLD\.status = 'confirmed' and NEW\.status = 'confirmed' and OLD\.start_at is distinct from NEW\.start_at then([\s\S]*?)end if;/)[1];
  assert.match(reschedBranch, /NEW\.reminder_sent_at := null;/);
  assert.match(reschedBranch, /NEW\.reschedule_count := OLD\.reschedule_count \+ 1;/, 'existing reporting columns kept');
  assert.equal((fn.match(/reminder_sent_at := null/g) || []).length, 1);
  assert.match(fn, /NEW\.cancelled_at := now\(\);/);
});

test('the change-email trigger only fires on a real cancellation or a moved start time (gated in WHEN, before any HTTP call)', () => {
  const sql = read('sql', 'booking', 'add_booking_change_emails_and_reminder_rearm.sql');
  const trig = sql.match(/create trigger on_booking_change_send_email[\s\S]*?execute function public\.notify_booking_change_email\(\);/)[0];
  assert.match(trig, /after update on public\.th_bookings/);
  assert.match(trig, /\(old\.status = 'confirmed' and new\.status = 'cancelled'\)/);
  assert.match(trig, /\(old\.status = 'confirmed' and new\.status = 'confirmed' and old\.start_at is distinct from new\.start_at\)/);
});

test('the change-email trigger function gets the same postgres/service_role-only EXECUTE as every other trigger function', () => {
  // Changed 2026-09-23: this used to assert there was NO revoke (an old
  // note blamed one for breaking lead notifications). By then every other
  // trigger function in public had been locked down to postgres and
  // service_role (2026-09-21), and a rolled-back probe on the live project
  // showed Postgres never checks EXECUTE when a trigger fires -- only at
  // CREATE TRIGGER. So the lockdown can't stop the email, and leaving it
  // off made this the one trigger function anon could EXECUTE.
  const sql = read('sql', 'booking', 'add_booking_change_emails_and_reminder_rearm.sql');
  assert.ok(sql.includes('revoke all on function public.notify_booking_change_email() from public, anon, authenticated;'));
  assert.ok(sql.includes('grant execute on function public.notify_booking_change_email() to service_role;'));
  assert.ok(sql.indexOf('revoke all on function public.notify_booking_change_email()') > sql.indexOf('create or replace function public.notify_booking_change_email()'), 'revoked after it exists');
});

// ---------- push privacy ----------

test('Send-Push: internal broadcasts come from get_internal_push_subscriptions() and fail CLOSED', () => {
  const src = read('edge-functions', 'send-push-index.ts');
  const fn = src.match(/async function getAllSubscriptions\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(fn, /\/rest\/v1\/rpc\/get_internal_push_subscriptions/);
  assert.doesNotMatch(fn, /push_subscriptions\?select=id,subscription/, 'must no longer read every subscription row');
  assert.match(fn, /if \(!res\.ok\) \{[\s\S]*?return \[\];/, 'a failed lookup sends to nobody');
  assert.match(src, /token !== SERVICE_ROLE_KEY/, 'the pending caller check ships with it');
  assert.match(src, /if \(!SERVICE_ROLE_KEY \|\| token !== SERVICE_ROLE_KEY\) \{/, 'an empty env key can never match an empty bearer');
});

test('Send-Push: the audience-check branch reports counts and never sends', () => {
  const src = read('edge-functions', 'send-push-index.ts');
  const branch = src.match(/if \(payload\.type === "audience-check"\) \{[\s\S]*?\n    \}/)[0];
  assert.doesNotMatch(branch, /sendToAllSubscriptions|sendToUserSubscriptions|webpush/);
  assert.match(branch, /internal: internal\.length/);
});

const LOOKUP_FUNCTIONS = ['send-invoice-notification', 'send-quote-notification', 'send-contract-notification', 'notify-work-order-scheduled-email', 'notify-job-message-email', 'notify-work-order-message-email'];

for (const fn of LOOKUP_FUNCTIONS) {
  test(`${fn}: getUserIdByEmail is an exact lookup through get_auth_user_id_by_email, never "first user in the list"`, async () => {
    const src = read('edge-functions', fn + '-index.ts');
    const body = src.match(/async function getUserIdByEmail\(email: string\): Promise<string \| null> \{[\s\S]*?\n\}/)[0];
    assert.doesNotMatch(body, /admin\/users/);
    assert.doesNotMatch(body, /users\[0\]/);
    assert.match(body, /\/rest\/v1\/rpc\/get_auth_user_id_by_email/);
    // Run the real function body with a mocked fetch.
    const js = body.replace(/\(email: string\): Promise<string \| null>/, '(email)');
    const calls = [];
    const run = new Function('SUPABASE_URL', 'SERVICE_ROLE_KEY', 'fetch', js + '; return getUserIdByEmail;')(
      'https://proj.supabase.co', 'svc',
      async (url, opts) => { calls.push({ url, opts }); return new Response(JSON.stringify(calls.length === 1 ? 'uuid-1' : null), { status: 200 }); });
    assert.equal(await run('Client@Example.com'), 'uuid-1');
    assert.equal(await run('nobody@example.com'), null);
    assert.equal(JSON.parse(calls[0].opts.body).p_email, 'Client@Example.com');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer svc');
  });
}

test('the lookup SQL: service-role only, exact case-insensitive match, internal-only subscriptions', () => {
  const sql = read('sql', 'security', 'scope_push_broadcasts_to_internal_accounts.sql');
  for (const sig of ['get_internal_push_subscriptions()', 'get_auth_user_id_by_email(text)']) {
    // Plain substring checks: no regex built from `sig`, so nothing in it
    // needs escaping (CodeQL flagged the old escape of only "(" and ")").
    assert.ok(sql.includes('revoke all on function public.' + sig + ' from public, anon, authenticated;'), sig + ' revoked');
    assert.ok(sql.includes('grant execute on function public.' + sig + ' to service_role;'), sig + ' granted to service_role');
  }
  assert.match(sql, /lower\(u\.email\) = lower\(trim\(p_email\)\)/);
  assert.match(sql, /exists \(\s*select 1 from public\.account_roles ar\s*where lower\(ar\.email\) = lower\(u\.email\)/);
  assert.equal((sql.match(/security definer/g) || []).length, 2);
});
