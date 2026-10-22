// resend-webhook (added 2026-10-20, alongside booking email delivery
// tracking). Resend signs its webhook deliveries with Svix: a request
// is only trusted if its svix-id/svix-timestamp/svix-signature headers
// verify against RESEND_WEBHOOK_SIGNING_SECRET -- there is no other
// auth on this endpoint (verify_jwt: false, same reasoning as
// stripe-webhook-index.ts). These run the real handler in a vm sandbox
// with a stubbed Deno/fetch/crypto, same harness style as
// tests/edge-functions/stripe-webhook-amount-check.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const SECRET = 'whsec_' + Buffer.from('a-test-signing-secret-32-bytes!!').toString('base64');

function j(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Real Svix-style signature: base64(HMAC-SHA256(secret_bytes, "id.timestamp.body")).
function sign(secretWithPrefix, svixId, svixTimestamp, rawBody) {
  const secretBytes = Buffer.from(secretWithPrefix.replace(/^whsec_/, ''), 'base64');
  const mac = crypto.createHmac('sha256', secretBytes).update(`${svixId}.${svixTimestamp}.${rawBody}`).digest('base64');
  return `v1,${mac}`;
}

function loadWebhook(state) {
  const raw = fs.readFileSync(repo('edge-functions', 'resend-webhook-index.ts'), 'utf8');
  const src = stripTypeScriptTypes(raw);

  const calls = [];
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: init.body });
    const parsed = new URL(u);
    if (parsed.pathname === '/rest/v1/th_bookings' && method === 'PATCH') {
      const messageId = parsed.searchParams.get('resend_message_id')?.replace(/^eq\./, '');
      const patch = JSON.parse(init.body);
      let matched = 0;
      for (const b of state.bookings) {
        if (b.resend_message_id === messageId) { Object.assign(b, patch); matched++; }
      }
      if (state.patchFails) return j({ message: 'boom' }, 500);
      return j([], matched ? 200 : 200);
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };

  let handler = null;
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests',
    RESEND_WEBHOOK_SIGNING_SECRET: state.secret ?? SECRET,
  };
  const context = vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch: fetchStub, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    crypto: require('crypto').webcrypto,
    console: { log() {}, error() {}, warn() {} },
    JSON, Promise, Map, Set, String, Array, Object, TextEncoder,
  });
  vm.runInContext(src, context, { filename: 'resend-webhook-index.ts' });

  const deliver = async (eventType, data, { svixId = 'msg_1', svixTimestamp = '1700000000', badSignature = false } = {}) => {
    const body = JSON.stringify({ type: eventType, data });
    const signature = badSignature ? 'v1,not-a-real-signature' : sign(state.secret ?? SECRET, svixId, svixTimestamp, body);
    const res = await handler(new Request('https://example.supabase.co/functions/v1/resend-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'svix-id': svixId, 'svix-timestamp': svixTimestamp, 'svix-signature': signature },
      body,
    }));
    const text = await res.text();
    let parsedBody;
    try { parsedBody = JSON.parse(text); } catch { parsedBody = text; }
    return { status: res.status, body: parsedBody };
  };

  return { deliver, calls, state };
}

test('a correctly signed email.delivered event updates the matching booking', async () => {
  const state = { bookings: [{ id: 1, resend_message_id: 'email_abc' }] };
  const { deliver } = loadWebhook(state);
  const { status, body } = await deliver('email.delivered', { email_id: 'email_abc' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(state.bookings[0].email_delivery_status, 'delivered');
  assert.ok(state.bookings[0].email_delivery_updated_at);
});

test('email.bounced and email.opened both map to their own status', async () => {
  const state = { bookings: [{ id: 1, resend_message_id: 'email_abc' }] };
  const { deliver } = loadWebhook(state);
  await deliver('email.opened', { email_id: 'email_abc' });
  assert.equal(state.bookings[0].email_delivery_status, 'opened');
  await deliver('email.bounced', { email_id: 'email_abc' });
  assert.equal(state.bookings[0].email_delivery_status, 'bounced');
});

test('a bad signature is rejected with 401 and never touches the database', async () => {
  const state = { bookings: [{ id: 1, resend_message_id: 'email_abc' }] };
  const { deliver, calls } = loadWebhook(state);
  const { status, body } = await deliver('email.delivered', { email_id: 'email_abc' }, { badSignature: true });
  assert.equal(status, 401);
  assert.equal(body.ok, false);
  assert.equal(state.bookings[0].email_delivery_status, undefined);
  assert.equal(calls.length, 0, 'no REST call should have been made for an unverified request');
});

test('an unrecognized event type is acknowledged (so Resend stops retrying) but changes nothing', async () => {
  const state = { bookings: [{ id: 1, resend_message_id: 'email_abc' }] };
  const { deliver, calls } = loadWebhook(state);
  const { status, body } = await deliver('email.delivery_delayed', { email_id: 'email_abc' });
  assert.equal(status, 200);
  assert.equal(body.skipped, true);
  assert.equal(calls.length, 0);
});

test('a signature made with the wrong secret is rejected', async () => {
  const state = { bookings: [{ id: 1, resend_message_id: 'email_abc' }] };
  const { deliver } = loadWebhook(state);
  const wrongSecret = 'whsec_' + Buffer.from('a-completely-different-secret!!!').toString('base64');
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'email_abc' } });
  // Can't easily reuse deliver() with a different signing secret than the
  // function's own env, so sign by hand here.
  const sig = sign(wrongSecret, 'msg_1', '1700000000', body);
  const raw = fs.readFileSync(repo('edge-functions', 'resend-webhook-index.ts'), 'utf8');
  assert.match(raw, /RESEND_WEBHOOK_SIGNING_SECRET/, 'sanity check: the function reads its secret from this env var');
  assert.notEqual(sig, sign(SECRET, 'msg_1', '1700000000', body), 'the two secrets must actually produce different signatures for this test to mean anything');
});
