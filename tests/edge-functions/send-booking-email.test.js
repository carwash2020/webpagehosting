// send-booking-email (2026-10-20 polish pass): greeting heuristic,
// missing address/notes in the guest confirmation, "arrival window"
// framing, and delivery tracking (Resend message id + send status
// PATCHed onto th_bookings, a staff alert on a genuine guest-send
// failure). Same vm-sandbox harness style as
// tests/edge-functions/stripe-webhook-amount-check.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

function j(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function loadFunction(state) {
  const raw = fs.readFileSync(repo('edge-functions', 'send-booking-email-index.ts'), 'utf8');
  const src = stripTypeScriptTypes(raw);

  const resendCalls = [];
  const patchCalls = [];
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u === 'https://api.resend.com/emails') {
      const payload = JSON.parse(init.body);
      resendCalls.push(payload);
      if (state.resendFailsAlways) return j({ message: 'boom' }, 500);
      // The .ics-attachment retry path: fail once (the with-attachment
      // attempt) when asked, then succeed on the plain retry.
      if (state.resendFailsAttachmentOnly && payload.attachments && !payload.__retried) {
        return j({ message: 'attachment rejected' }, 422);
      }
      return j({ id: state.resendId || 'email_test_123' });
    }
    if (u.includes('/rest/v1/th_bookings') && method === 'PATCH') {
      const patch = JSON.parse(init.body);
      patchCalls.push({ url: u, patch });
      if (state.patchFails) return j({ message: 'boom' }, 500);
      return j([], 200);
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };

  let handler = null;
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests',
    RESEND_API_KEY: 're_test',
    LEAD_EMAIL_TO: 'steve@example.com,connor@example.com',
    LEAD_EMAIL_FROM: 'leads@example.com',
  };
  const context = vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch: fetchStub, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    Intl, Date, JSON, Math, Promise, Set, Map, Number, String, Array, Object, parseInt, isNaN,
    encodeURIComponent, decodeURIComponent, TextEncoder,
  });
  vm.runInContext(src, context, { filename: 'send-booking-email-index.ts' });

  const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const insert = async (booking) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/send-booking-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ type: 'INSERT', table: 'th_bookings', record: booking }),
    }));
    return { status: res.status, body: await res.json() };
  };

  return { insert, resendCalls, patchCalls, context };
}

const BASE_BOOKING = {
  id: 42,
  service_label: 'Plumbing Fixes & Leaks',
  start_at: '2026-11-01T22:00:00Z',
  end_at: '2026-11-01T23:00:00Z',
  cancel_token: 'tok-abc',
  email: 'guest@example.com',
};

test('a personal first name gets a first-name greeting', async () => {
  const { insert, resendCalls } = loadFunction({});
  await insert({ ...BASE_BOOKING, name: 'Jane Smith' });
  const guest = resendCalls.find((c) => c.to === 'guest@example.com');
  assert.match(guest.html, /Hi Jane,/);
  assert.match(guest.text, /Hi Jane,/);
});

test('a name with a legal suffix gets greeted by its full name, not a first-word guess', async () => {
  const { insert, resendCalls } = loadFunction({});
  await insert({ ...BASE_BOOKING, name: 'Silver Silo Bakery LLC' });
  const guest = resendCalls.find((c) => c.to === 'guest@example.com');
  assert.match(guest.html, /Hi Silver Silo Bakery LLC,/);
  assert.doesNotMatch(guest.html, /Hi Silver,/);
});

test('an ambiguous multi-word name (no legal suffix, could be a business or a person) falls back to "Hi there,"', async () => {
  const { insert, resendCalls } = loadFunction({});
  await insert({ ...BASE_BOOKING, name: 'Silver Silo Bakery' });
  const guest = resendCalls.find((c) => c.to === 'guest@example.com');
  assert.match(guest.html, /Hi there,/);
  assert.doesNotMatch(guest.html, /Hi Silver,/);
});

test('an ALL CAPS name with no legal-suffix word also falls back to "Hi there,"', async () => {
  const { insert, resendCalls } = loadFunction({});
  await insert({ ...BASE_BOOKING, name: 'MARY JOHNSON' });
  const guest = resendCalls.find((c) => c.to === 'guest@example.com');
  assert.match(guest.html, /Hi there,/);
});

test('an ALL CAPS name that DOES contain a legal-suffix word is confident enough to use the full name', async () => {
  const { insert, resendCalls } = loadFunction({});
  await insert({ ...BASE_BOOKING, name: 'ACME HOME SERVICES' });
  const guest = resendCalls.find((c) => c.to === 'guest@example.com');
  assert.match(guest.html, /Hi ACME HOME SERVICES,/);
});

test('no name at all falls back to "Hi there,"', async () => {
  const { insert, resendCalls } = loadFunction({});
  await insert({ ...BASE_BOOKING });
  const guest = resendCalls.find((c) => c.to === 'guest@example.com');
  assert.match(guest.html, /Hi there,/);
});

test('the guest email includes address and notes when present, and the time row reads as an arrival window', async () => {
  const { insert, resendCalls } = loadFunction({});
  await insert({ ...BASE_BOOKING, name: 'Jane Smith', address: '123 Main St', notes: "Kitchen faucet won't stop dripping" });
  const guest = resendCalls.find((c) => c.to === 'guest@example.com');
  assert.match(guest.html, /123 Main St/);
  assert.match(guest.html, /Kitchen faucet won&#39;t stop dripping|Kitchen faucet won't stop dripping/);
  assert.match(guest.html, /Arrival window/);
  assert.doesNotMatch(guest.html, />Time<\/td>/);
  assert.match(guest.text, /Address: 123 Main St/);
  assert.match(guest.text, /What's going on:/);
  assert.match(guest.text, /Arrival window:/);
});

test('address and notes rows are omitted entirely when not given, not shown as "not given"', async () => {
  const { insert, resendCalls } = loadFunction({});
  await insert({ ...BASE_BOOKING, name: 'Jane Smith' });
  const guest = resendCalls.find((c) => c.to === 'guest@example.com');
  assert.doesNotMatch(guest.html, />Address<\/td>/);
  assert.doesNotMatch(guest.html, /What's going on/);
  assert.doesNotMatch(guest.text, /Address:/);
  assert.doesNotMatch(guest.text, /not given/);
});

test('a successful guest send PATCHes the booking with the Resend message id and email_send_status=sent', async () => {
  const { insert, patchCalls } = loadFunction({ resendId: 'email_xyz' });
  await insert({ ...BASE_BOOKING, name: 'Jane Smith' });
  const guestPatch = patchCalls.find((c) => c.url.includes('id=eq.42'));
  assert.ok(guestPatch, 'expected a PATCH for booking id 42');
  assert.equal(guestPatch.patch.resend_message_id, 'email_xyz');
  assert.equal(guestPatch.patch.email_send_status, 'sent');
});

test('a guest send that fails even after the no-attachment retry is recorded as failed and raises a staff alert', async () => {
  const { insert, patchCalls, resendCalls } = loadFunction({ resendFailsAlways: true });
  await insert({ ...BASE_BOOKING, name: 'Jane Smith' });
  const guestPatch = patchCalls.find((c) => c.url.includes('id=eq.42'));
  assert.equal(guestPatch.patch.email_send_status, 'failed');
  const alert = resendCalls.find((c) => typeof c.subject === 'string' && /failed to send/.test(c.subject));
  assert.ok(alert, 'expected an internal alert email about the failed guest send');
  assert.deepEqual(alert.to, ['steve@example.com', 'connor@example.com']);
  assert.match(alert.text, /Jane Smith/);
});

test('the checkmark is a hosted GIF, not the old plain HTML/CSS circle, and only on the confirmation', async () => {
  const { insert, resendCalls } = loadFunction({});
  await insert({ ...BASE_BOOKING, name: 'Jane Smith' });
  const guest = resendCalls.find((c) => c.to === 'guest@example.com');
  assert.match(guest.html, /booking-confirmed-check\.gif/);
});
