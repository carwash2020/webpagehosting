// Stripe double-charge guard (security audit, 2026-09-23).
//
// create-payment-intent and create-bulk-payment-intent minted a brand-new
// PaymentIntent on every call, so one invoice could be charged twice. The
// easiest way: pay, and portal/dashboard.html re-renders the list 1.8s
// later with the invoice still showing "Pay now" until stripe-webhook
// marks it paid. Or two open tabs. stripe-webhook then treats the second
// payment as an already-processed redelivery, and reconcile-stripe-payments
// skipped paid invoices, so nothing ever flagged it.
//
// Now both functions check the PaymentIntent the invoice already points
// at: gone through or processing -> refuse (409); still open for the same
// amount, customer and invoice(s) -> hand the same one back; anything
// unexpected from Stripe -> create a new one exactly as before, so the
// guard can never block a real payment. reconcile-stripe-payments alerts
// once on any invoice with two or more succeeded PaymentIntents.
//
// These run the real handlers with a stubbed Deno and fetch.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const CLIENT = 'client@example.com';
const CUSTOMER = 'cus_client';
const SERVICE_KEY = 'service-role-key-for-tests';

function jwtFor(email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ role: 'authenticated', email })}.sig`;
}

function load(name, state) {
  const src = stripTypeScriptTypes(fs.readFileSync(repo('edge-functions', `${name}-index.ts`), 'utf8'));
  const calls = [];
  const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: init.body });
    const parsed = new URL(u);
    const stripePath = parsed.hostname === 'api.stripe.com' ? parsed.pathname : null;
    if (u.includes('/rest/v1/client_portal_invoices') && method === 'GET') return j(state.invoices);
    if (u.includes('/rest/v1/client_portal_invoices') && method === 'PATCH') return j([]);
    if (u.includes('/rest/v1/stripe_customers') && method === 'GET') return j(state.customerId ? [{ stripe_customer_id: state.customerId }] : []);
    if (u.includes('/rest/v1/stripe_customers') && method === 'POST') return j([]);
    if (u.includes('/rest/v1/card_authorizations')) return j([], 201);
    if (u.includes('/rest/v1/notification_log') && method === 'GET') {
      const type = decodeURIComponent(u.match(/notif_type=eq\.([^&]+)/)[1]);
      const key = decodeURIComponent(u.match(/item_key=eq\.([^&]+)/)[1]);
      return j((state.log || []).filter((r) => r.notif_type === type && r.item_key === key));
    }
    if (u.includes('/rest/v1/notification_log') && method === 'POST') return j([], 201);
    if (u.includes('/functions/v1/Send-Push')) return j({ ok: true });
    if (stripePath === '/v1/payment_methods') return j({ data: state.savedCard === false ? [] : [{ id: 'pm_1' }] });
    if (stripePath === '/v1/customers') return j({ id: 'cus_new' });
    if (stripePath === '/v1/payment_intents' && method === 'GET') return j({ data: state.stripeList || [] });
    const m = u.match(/^https:\/\/api\.stripe\.com\/v1\/payment_intents\/([^/?]+)(\?expand\[\]=latest_charge)?$/);
    if (m && method === 'GET') {
      if (state.retrieveThrows) throw new Error('network down');
      const r = (state.retrieve || {})[decodeURIComponent(m[1])];
      if (!r) return j({ error: { code: 'resource_missing' } }, 404);
      if (r.httpStatus) return j({ error: {} }, r.httpStatus);
      return j(r);
    }
    if (u === 'https://api.stripe.com/v1/payment_intents' && method === 'POST') return j({ id: 'pi_new', client_secret: 'pi_new_secret_x' });
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };
  let handler = null;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_RECONCILE_SECRET_KEY: 'rk_test_x' };
  const context = vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    Intl, Date, JSON, Math, Promise, Set, Map, Number, String, Array, Object, parseInt, isNaN, encodeURIComponent, decodeURIComponent,
  });
  vm.runInContext(src, context, { filename: `${name}-index.ts` });
  const call = async (body, token = jwtFor(CLIENT)) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
  const created = () => calls.filter((c) => c.url === 'https://api.stripe.com/v1/payment_intents' && c.method === 'POST');
  const patched = () => calls.filter((c) => c.url.includes('/rest/v1/client_portal_invoices') && c.method === 'PATCH');
  return { call, calls, created, patched };
}

const invoice = (over = {}) => ({ id: 7, client_email: CLIENT, total: 150, paid: false, stripe_payment_intent_id: null, ...over });
const openPi = (over = {}) => ({ id: 'pi_old', status: 'requires_payment_method', amount: 15000, currency: 'usd', customer: CUSTOMER, metadata: { client_portal_invoice_id: '7' }, client_secret: 'pi_old_secret_x', ...over });

// ---------------------------------------------------------------- single

test('single: no earlier PaymentIntent -> a new one is created and recorded, as before', async () => {
  const f = load('create-payment-intent', { invoices: [invoice()], customerId: CUSTOMER });
  const r = await f.call({ invoice_id: 7 });
  assert.equal(r.status, 200);
  assert.equal(r.body.client_secret, 'pi_new_secret_x');
  assert.equal(f.created().length, 1);
  assert.equal(f.patched().length, 1);
});

for (const status of ['succeeded', 'processing', 'requires_capture']) {
  test(`single: the invoice's PaymentIntent is ${status} -> 409, and no second PaymentIntent is created`, async () => {
    const f = load('create-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' })], customerId: CUSTOMER, retrieve: { pi_old: openPi({ status }) } });
    const r = await f.call({ invoice_id: 7 });
    assert.equal(r.status, 409);
    assert.equal(r.body.already_paying, true);
    assert.match(r.body.error, /refresh/);
    assert.equal(f.created().length, 0);
    assert.equal(f.patched().length, 0);
  });
}

for (const [label, latestCharge, blocked] of [
  ['its charge was fully refunded', { id: 'ch_1', refunded: true, amount_refunded: 15000 }, false],
  ['its charge was only partly refunded', { id: 'ch_1', refunded: false, amount_refunded: 5000 }, true],
  ['its charge was not refunded', { id: 'ch_1', refunded: false, amount_refunded: 0 }, true],
  ['Stripe returned the charge unexpanded', 'ch_1', true],
]) {
  test(`single: a succeeded PaymentIntent where ${label} -> ${blocked ? 'still 409' : 'a new payment is allowed'}`, async () => {
    const f = load('create-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' })], customerId: CUSTOMER, retrieve: { pi_old: openPi({ status: 'succeeded', latest_charge: latestCharge }) } });
    const r = await f.call({ invoice_id: 7 });
    assert.equal(r.status, blocked ? 409 : 200);
    assert.equal(f.created().length, blocked ? 0 : 1);
  });
}

test('single and bulk: the lookup expands latest_charge, so a refund is visible', () => {
  for (const name of ['create-payment-intent', 'create-bulk-payment-intent']) {
    const src = fs.readFileSync(repo('edge-functions', `${name}-index.ts`), 'utf8');
    assert.ok(src.includes('/v1/payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge`'), name);
  }
});

test('single: a client who just paid is not asked to sign again before being told it went through', async () => {
  const f = load('create-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' })], customerId: CUSTOMER, savedCard: false, retrieve: { pi_old: openPi({ status: 'succeeded' }) } });
  const r = await f.call({ invoice_id: 7 });
  assert.equal(r.status, 409);
  assert.equal(r.body.needs_signature, undefined);
});

for (const status of ['requires_payment_method', 'requires_confirmation', 'requires_action']) {
  test(`single: an open (${status}) PaymentIntent for the same amount, customer and invoice is handed back instead of a new one`, async () => {
    const f = load('create-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' })], customerId: CUSTOMER, retrieve: { pi_old: openPi({ status }) } });
    const r = await f.call({ invoice_id: 7 });
    assert.equal(r.status, 200);
    assert.equal(r.body.client_secret, 'pi_old_secret_x');
    assert.equal(r.body.reused, true);
    assert.equal(f.created().length, 0);
    assert.equal(f.patched().length, 0);
  });
}

for (const [label, over] of [
  ['the amount changed (invoice total was edited)', { amount: 12000 }],
  ['it belongs to a different Stripe customer', { customer: 'cus_someone_else' }],
  ['it was made for a different invoice', { metadata: { client_portal_invoice_id: '8' } }],
  ['it is a bulk PaymentIntent covering several invoices', { metadata: { client_portal_invoice_ids: '7,8' } }],
  ['it was canceled', { status: 'canceled' }],
]) {
  test(`single: an earlier PaymentIntent is NOT reused when ${label} -> a new one, as before`, async () => {
    const f = load('create-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' })], customerId: CUSTOMER, retrieve: { pi_old: openPi(over) } });
    const r = await f.call({ invoice_id: 7 });
    assert.equal(r.status, 200);
    assert.equal(r.body.client_secret, 'pi_new_secret_x');
    assert.equal(f.created().length, 1);
  });
}

for (const [label, state] of [
  ['404 (e.g. a test-mode id after the live-key cutover)', { retrieve: {} }],
  ['a 500', { retrieve: { pi_old: { httpStatus: 500 } } }],
  ['a 403 (key permissions)', { retrieve: { pi_old: { httpStatus: 403 } } }],
  ['a network error', { retrieveThrows: true }],
]) {
  test(`single: Stripe answering the lookup with ${label} never blocks the payment -> a new one, as before`, async () => {
    const f = load('create-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' })], customerId: CUSTOMER, ...state });
    const r = await f.call({ invoice_id: 7 });
    assert.equal(r.status, 200);
    assert.equal(r.body.client_secret, 'pi_new_secret_x');
    assert.equal(f.created().length, 1);
  });
}

test("single: someone else's invoice is still refused before Stripe is ever asked anything", async () => {
  const f = load('create-payment-intent', { invoices: [invoice({ client_email: 'other@example.com', stripe_payment_intent_id: 'pi_old' })], customerId: CUSTOMER, retrieve: { pi_old: openPi() } });
  const r = await f.call({ invoice_id: 7 });
  assert.equal(r.status, 403);
  assert.equal(f.calls.filter((c) => new URL(c.url).hostname === 'api.stripe.com').length, 0);
});

test('single: an invoice already marked paid is still refused with the same 400', async () => {
  const f = load('create-payment-intent', { invoices: [invoice({ paid: true, stripe_payment_intent_id: 'pi_old' })], customerId: CUSTOMER, retrieve: { pi_old: openPi({ status: 'succeeded' }) } });
  const r = await f.call({ invoice_id: 7 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'This invoice is already paid.');
});

test('single: a first-time card still needs a signature before anything is created', async () => {
  const f = load('create-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' })], customerId: CUSTOMER, savedCard: false, retrieve: { pi_old: openPi() } });
  const r = await f.call({ invoice_id: 7 });
  assert.equal(r.status, 400);
  assert.equal(r.body.needs_signature, true);
  assert.equal(f.created().length, 0);
});

// ---------------------------------------------------------------- bulk

const inv8 = (over = {}) => invoice({ id: 8, total: 50, ...over });
const bulkPi = (over = {}) => openPi({ id: 'pi_bulk', amount: 20000, metadata: { client_portal_invoice_ids: '7,8' }, client_secret: 'pi_bulk_secret_x', ...over });

test('bulk: a fully refunded earlier payment on one invoice does not block paying the batch', async () => {
  const f = load('create-bulk-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' }), inv8()], customerId: CUSTOMER, retrieve: { pi_old: openPi({ status: 'succeeded', latest_charge: { id: 'ch_1', refunded: true } }) } });
  const r = await f.call({ invoice_ids: [7, 8] });
  assert.equal(r.status, 200);
  assert.equal(r.body.client_secret, 'pi_new_secret_x');
});

test('bulk: no earlier PaymentIntents -> a new one, as before', async () => {
  const f = load('create-bulk-payment-intent', { invoices: [invoice(), inv8()], customerId: CUSTOMER });
  const r = await f.call({ invoice_ids: [7, 8] });
  assert.equal(r.status, 200);
  assert.equal(r.body.client_secret, 'pi_new_secret_x');
  assert.equal(f.created().length, 1);
});

test('bulk: one invoice in the batch already has a succeeded single payment -> 409, nothing created', async () => {
  const f = load('create-bulk-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' }), inv8()], customerId: CUSTOMER, retrieve: { pi_old: openPi({ status: 'succeeded' }) } });
  const r = await f.call({ invoice_ids: [7, 8] });
  assert.equal(r.status, 409);
  assert.equal(r.body.already_paying, true);
  assert.equal(f.created().length, 0);
  assert.equal(f.patched().length, 0);
});

test('bulk: the same batch still open on one shared PaymentIntent is handed back (in either id order)', async () => {
  const f = load('create-bulk-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_bulk' }), inv8({ stripe_payment_intent_id: 'pi_bulk' })], customerId: CUSTOMER, retrieve: { pi_bulk: bulkPi() } });
  const r = await f.call({ invoice_ids: [8, 7] });
  assert.equal(r.status, 200);
  assert.equal(r.body.client_secret, 'pi_bulk_secret_x');
  assert.equal(r.body.reused, true);
  assert.equal(f.created().length, 0);
});

test('bulk: a shared open PaymentIntent for a different set of invoices is not reused', async () => {
  const f = load('create-bulk-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_bulk' }), inv8({ stripe_payment_intent_id: 'pi_bulk' })], customerId: CUSTOMER, retrieve: { pi_bulk: bulkPi({ metadata: { client_portal_invoice_ids: '7,8,9' } }) } });
  const r = await f.call({ invoice_ids: [7, 8] });
  assert.equal(r.body.client_secret, 'pi_new_secret_x');
});

test('bulk: invoices pointing at different open PaymentIntents get a new one', async () => {
  const f = load('create-bulk-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_old' }), inv8({ stripe_payment_intent_id: 'pi_other' })], customerId: CUSTOMER, retrieve: { pi_old: openPi(), pi_other: openPi({ id: 'pi_other', metadata: { client_portal_invoice_id: '8' } }) } });
  const r = await f.call({ invoice_ids: [7, 8] });
  assert.equal(r.body.client_secret, 'pi_new_secret_x');
});

test('bulk: Stripe errors on the lookup never block the payment', async () => {
  const f = load('create-bulk-payment-intent', { invoices: [invoice({ stripe_payment_intent_id: 'pi_bulk' }), inv8({ stripe_payment_intent_id: 'pi_bulk' })], customerId: CUSTOMER, retrieveThrows: true });
  const r = await f.call({ invoice_ids: [7, 8] });
  assert.equal(r.status, 200);
  assert.equal(r.body.client_secret, 'pi_new_secret_x');
});

// ---------------------------------------------------------------- reconcile

function reconcile(state) {
  const f = load('reconcile-stripe-payments', state);
  const alerts = () => f.calls.filter((c) => c.url.includes('/functions/v1/Send-Push')).map((c) => JSON.parse(c.body));
  const logged = () => f.calls.filter((c) => c.url.includes('/rest/v1/notification_log') && c.method === 'POST').map((c) => JSON.parse(c.body));
  return { ...f, alerts, logged, run: () => f.call({}, SERVICE_KEY) };
}
const succeededPi = (id, amount, metadata) => ({ id, status: 'succeeded', amount, metadata });

test('reconcile: an invoice with two succeeded PaymentIntents raises one "possible double charge" alert, even though it is marked paid', async () => {
  const r = reconcile({
    invoices: [{ id: 7, client_email: CLIENT, invoice_number: 'INV-7', total: 150, paid: true }],
    stripeList: [succeededPi('pi_a', 15000, { client_portal_invoice_id: '7' }), succeededPi('pi_b', 15000, { client_portal_invoice_id: '7' })],
  });
  const res = await r.run();
  assert.equal(res.status, 200);
  assert.equal(res.body.duplicates, 1);
  assert.equal(res.body.mismatches, 0);
  const a = r.alerts();
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'stripe-reconciliation-alert');
  assert.equal(a[0].title, 'Possible double charge');
  assert.match(a[0].body, /INV-7.*2 successful Stripe payments \(\$150\.00 \+ \$150\.00\)/);
  assert.deepEqual(r.logged().map((l) => [l.notif_type, l.item_key]), [['stripe-duplicate-payment', '7:pi_a,pi_b']]);
});

test('reconcile: the same duplicate is alerted once, not every day (a refunded PaymentIntent still reads succeeded)', async () => {
  const r = reconcile({
    invoices: [{ id: 7, client_email: CLIENT, invoice_number: 'INV-7', total: 150, paid: true }],
    stripeList: [succeededPi('pi_b', 15000, { client_portal_invoice_id: '7' }), succeededPi('pi_a', 15000, { client_portal_invoice_id: '7' })],
    log: [{ notif_type: 'stripe-duplicate-payment', item_key: '7:pi_a,pi_b' }],
  });
  const res = await r.run();
  assert.equal(res.body.duplicates, 0);
  assert.equal(r.alerts().length, 0);
});

test('reconcile: a bulk payment plus a single payment covering the same invoice is a duplicate for that invoice only', async () => {
  const r = reconcile({
    invoices: [
      { id: 7, client_email: CLIENT, invoice_number: 'INV-7', total: 150, paid: true },
      { id: 8, client_email: CLIENT, invoice_number: 'INV-8', total: 50, paid: true },
    ],
    stripeList: [succeededPi('pi_bulk', 20000, { client_portal_invoice_ids: '7,8' }), succeededPi('pi_single', 15000, { client_portal_invoice_id: '7' })],
  });
  const res = await r.run();
  assert.equal(res.body.duplicates, 1);
  assert.match(r.alerts()[0].body, /INV-7/);
});

test('reconcile: one payment per invoice raises nothing (the normal case)', async () => {
  const r = reconcile({
    invoices: [
      { id: 7, client_email: CLIENT, invoice_number: 'INV-7', total: 150, paid: true },
      { id: 8, client_email: CLIENT, invoice_number: 'INV-8', total: 50, paid: true },
    ],
    stripeList: [succeededPi('pi_a', 15000, { client_portal_invoice_id: '7' }), succeededPi('pi_b', 5000, { client_portal_invoice_id: '8' }), { id: 'pi_failed', status: 'requires_payment_method', amount: 15000, metadata: { client_portal_invoice_id: '7' } }],
  });
  const res = await r.run();
  assert.equal(res.body.duplicates, 0);
  assert.equal(res.body.mismatches, 0);
  assert.equal(r.alerts().length, 0);
});

test('reconcile: the existing "paid in Stripe, unpaid in the portal" alert still fires as before', async () => {
  const r = reconcile({
    invoices: [{ id: 7, client_email: CLIENT, invoice_number: 'INV-7', total: 150, paid: false }],
    stripeList: [succeededPi('pi_a', 15000, { client_portal_invoice_id: '7' })],
  });
  const res = await r.run();
  assert.equal(res.body.mismatches, 1);
  assert.equal(res.body.duplicates, 0);
  assert.equal(r.alerts()[0].title, 'Payment reconciliation mismatch');
  assert.deepEqual(r.logged().map((l) => l.notif_type), ['stripe-reconciliation-mismatch']);
});

test('reconcile: still never writes to client_portal_invoices (alert-only)', async () => {
  const r = reconcile({
    invoices: [{ id: 7, client_email: CLIENT, invoice_number: 'INV-7', total: 150, paid: true }],
    stripeList: [succeededPi('pi_a', 15000, { client_portal_invoice_id: '7' }), succeededPi('pi_b', 15000, { client_portal_invoice_id: '7' })],
  });
  await r.run();
  assert.equal(r.calls.filter((c) => c.url.includes('client_portal_invoices') && c.method !== 'GET').length, 0);
});
