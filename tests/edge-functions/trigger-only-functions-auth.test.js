// Service-role caller check on the trigger/cron-only edge functions
// (security audit, 2026-09-23).
//
// These 8 functions are only ever called by a Postgres trigger or a
// pg_cron job, each of which sends the service_role key from Vault
// (`send_push_service_role_key`) as its bearer token. None of them
// checked the caller. Supabase's verify_jwt accepts the public anon key
// (it checks the signature, not the role), so anyone could POST a fake
// trigger payload. The worst cases were notify-job-message-email and
// notify-work-order-message-email: given any job or work-order id, they
// look up that REAL client and email them a branded "New reply" message
// carrying the caller's text, a phishing relay on Triple H's own sending
// domain. notify-work-order-scheduled-email mailed any address in the
// payload directly.
//
// Same fix as uptime-alert / send-payment-reminder / send-quote-followup
// (see uptime-alert-auth.test.js), plus a guard so an empty env key can
// never match an empty header. These tests execute each real handler
// with a mocked Deno runtime and fetch, rather than only reading source.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const SERVICE_KEY = 'service-role-key-for-tests';
// Shaped like the real public anon key: a validly-signed JWT that
// verify_jwt would accept, which is exactly why a role check is needed.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig';

const FUNCTIONS = [
  { name: 'notify-job-message-email', payload: { type: 'INSERT', table: 'client_portal_job_messages', record: { job_id: 1, sender_type: 'internal', message: 'hi' } } },
  { name: 'notify-work-order-message-email', payload: { type: 'INSERT', table: 'client_portal_work_order_messages', record: { work_order_id: 1, sender_type: 'internal', message: 'hi' } } },
  { name: 'notify-work-order-scheduled-email', payload: { type: 'UPDATE', table: 'client_portal_work_orders', record: { id: 1, client_email: 'client@example.com', title: 't', scheduled_at: '2026-10-01T15:00:00Z' } } },
  { name: 'notify-new-work-order-email', payload: { type: 'INSERT', table: 'client_portal_work_orders', record: { id: 1, client_email: 'client@example.com', title: 't', description: 'd' } } },
  { name: 'send-lead-email', payload: { type: 'INSERT', table: 'th_leads', record: { id: 1, name: 'n', email: 'lead@example.com', details: 'd' } } },
  { name: 'send-job-application-email', payload: { type: 'INSERT', table: 'th_job_applications', record: { id: 1, name: 'n', email: 'applicant@example.com' } } },
  { name: 'send-job-status-change-email', payload: { type: 'UPDATE', table: 'jobs', record: { id: 1, cancelled_at: '2026-09-23T00:00:00Z' }, old_record: { id: 1, cancelled_at: null } } },
  { name: 'reconcile-stripe-payments', payload: {} },
];

// Load the real function source, strip TypeScript types, and run it in a
// sandbox where Deno.serve hands us the handler and every fetch() is
// recorded instead of sent anywhere.
function loadHandler(name, env) {
  const src = fs.readFileSync(repo('edge-functions', `${name}-index.ts`), 'utf8');
  const js = stripTypeScriptTypes(src);
  const calls = [];
  let handler = null;
  const context = vm.createContext({
    Deno: {
      env: { get: (k) => (k in env ? env[k] : 'test-value') },
      serve: (h) => { handler = h; },
    },
    fetch: async (url, init) => {
      calls.push(String(url));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, Intl, Date, JSON, Math, Promise, crypto: globalThis.crypto,
  });
  vm.runInContext(js, context, { filename: `${name}-index.ts` });
  assert.equal(typeof handler, 'function', `${name}: expected Deno.serve to register a handler`);
  return { handler, calls };
}

function request(payload, authorization) {
  const headers = { 'Content-Type': 'application/json' };
  if (authorization !== undefined) headers.Authorization = authorization;
  return new Request('https://example.supabase.co/functions/v1/x', {
    method: 'POST', headers, body: JSON.stringify(payload),
  });
}

for (const fn of FUNCTIONS) {
  test(`${fn.name}: the public anon key is rejected with 401 before anything is fetched or sent`, async () => {
    const { handler, calls } = loadHandler(fn.name, { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    const res = await handler(request(fn.payload, `Bearer ${ANON_KEY}`));
    assert.equal(res.status, 401);
    assert.deepEqual(calls, [], 'no database read, email, push, or Stripe call may happen for an unauthorized caller');
  });

  test(`${fn.name}: a request with no Authorization header is rejected too`, async () => {
    const { handler, calls } = loadHandler(fn.name, { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    const res = await handler(request(fn.payload, undefined));
    assert.equal(res.status, 401);
    assert.deepEqual(calls, []);
  });

  test(`${fn.name}: an empty service key in the environment can never match an empty bearer`, async () => {
    const { handler, calls } = loadHandler(fn.name, { SUPABASE_SERVICE_ROLE_KEY: '' });
    const res = await handler(request(fn.payload, 'Bearer '));
    assert.equal(res.status, 401);
    assert.deepEqual(calls, []);
  });

  test(`${fn.name}: the real caller's service-role bearer still gets through to the function's own logic`, async () => {
    const { handler, calls } = loadHandler(fn.name, { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    const res = await handler(request(fn.payload, `Bearer ${SERVICE_KEY}`));
    assert.notEqual(res.status, 401, 'the legitimate trigger/cron caller must not be rejected');
    assert.ok(calls.length > 0, 'expected the handler to proceed past the check and do its normal work');
  });

  test(`${fn.name}: the check sits before the payload is read`, () => {
    const src = fs.readFileSync(repo('edge-functions', `${fn.name}-index.ts`), 'utf8');
    const handlerSrc = src.slice(src.indexOf('Deno.serve('));
    const checkIdx = handlerSrc.indexOf('!SERVICE_ROLE_KEY || token !== SERVICE_ROLE_KEY');
    assert.ok(checkIdx !== -1, 'expected the guarded service-role comparison in the handler');
    const readIdx = handlerSrc.indexOf('await req.json()');
    if (readIdx !== -1) assert.ok(checkIdx < readIdx, 'the auth check must come before the payload is trusted');
  });
}

// Every caller that lives in the repo sends the Vault service-role secret,
// so the new check can't break it. (The three work-order triggers exist
// only in the live database; the audit read them there and they use the
// same secret. The live cron/trigger calls to functions that already
// enforce this exact check returned 200 on 2026-09-22, confirming the
// Vault secret matches the functions' SUPABASE_SERVICE_ROLE_KEY.)
test('every in-repo SQL caller authenticates with the send_push_service_role_key Vault secret', () => {
  const callers = [
    ['sql/portal/create_client_portal_job_messages.sql', 'notify-job-message-email'],
    ['sql/leads/add_lead_email_notification.sql', 'send-lead-email'],
    ['sql/careers/create_th_job_applications.sql', 'send-job-application-email'],
    ['sql/infra/add_job_cancel_reschedule.sql', 'send-job-status-change-email'],
    ['sql/infra/add_stripe_reconciliation_cron.sql', 'reconcile-stripe-payments'],
  ];
  for (const [file, fn] of callers) {
    const sql = fs.readFileSync(repo(file), 'utf8');
    const idx = sql.indexOf(`/functions/v1/${fn}`);
    assert.ok(idx !== -1, `${file} should call ${fn}`);
    const window = sql.slice(Math.max(0, idx - 1200), idx + 600);
    assert.match(window, /send_push_service_role_key/, `${file} must read the Vault service-role secret`);
    assert.match(window, /'Authorization',\s*'Bearer ' \|\|/, `${file} must send it as a Bearer token`);
  }
});
