// Idempotency-Key on every Stripe POST in the four payment-creating edge
// functions, exercised by running the REAL handlers (Node type stripping,
// fake Deno) against a fake Stripe that behaves like the real one: a repeated
// Idempotency-Key returns the first response (with Idempotent-Replayed: true)
// instead of creating a second object, and the same key with different
// parameters is an error. Any Stripe POST without a key fails the test.
// Supabase REST calls are answered from in-memory state. Nothing leaves the
// process.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const st = {};
function reset() {
  Object.assign(st, {
    stripeCalls: [], idem: new Map(), created: { customers: 0, payment_intents: 0, setup_intents: 0 },
    customers: [], posClaims: new Set(), incomeLog: [], emails: [], portalInvoices: [], patches: [],
    savedCards: { cus_pat: [{ id: 'pm_saved', card: { brand: 'visa', last4: '4242' } }] },
  });
}
reset();

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function stripeCreate(kind, params) {
  st.created[kind] += 1;
  const n = st.created[kind];
  if (kind === 'customers') return { id: `cus_new${n}`, object: 'customer', email: params.get('email') };
  if (kind === 'setup_intents') return { id: `seti_${n}`, client_secret: `seti_${n}_secret`, status: 'requires_payment_method' };
  const confirm = params.get('confirm') === 'true';
  return { id: `pi_${n}`, object: 'payment_intent', amount: Number(params.get('amount')), currency: 'usd',
    customer: params.get('customer'), client_secret: `pi_${n}_secret`, status: confirm ? 'succeeded' : 'requires_payment_method',
    metadata: Object.fromEntries([...params].filter(([k]) => k.startsWith('metadata[')).map(([k, v]) => [k.slice(9, -1), v])) };
}

async function fakeFetch(url, init = {}) {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});
  if (u.host === 'api.stripe.com') {
    const p = u.pathname.replace('/v1/', '');
    if (method === 'GET') {
      if (p === 'payment_methods') return json({ data: st.savedCards[u.searchParams.get('customer')] || [] });
      if (p.startsWith('payment_methods/')) return json({ id: p.split('/')[1], customer: 'cus_pat' });
      if (p.startsWith('payment_intents/')) return json({ error: { message: 'No such payment_intent' } }, 404);
      throw new Error(`unexpected Stripe GET ${u}`);
    }
    const key = headers.get('Idempotency-Key');
    const body = String(init.body ?? '');
    st.stripeCalls.push({ path: p, key, body });
    assert.ok(key, `Stripe POST /v1/${p} was sent without an Idempotency-Key`);
    if (st.idem.has(key)) {
      const prev = st.idem.get(key);
      if (prev.body !== body) return json({ error: { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.' } }, 400);
      return json(prev.response, 200, { 'Idempotent-Replayed': 'true' });
    }
    const kind = p.endsWith('/detach') ? null : p;
    const response = kind ? stripeCreate(kind, new URLSearchParams(body)) : { id: p.split('/')[1], customer: null };
    st.idem.set(key, { body, response });
    return json(response);
  }
  // ---- Supabase REST ----
  if (u.pathname === '/rest/v1/account_roles') return json([{ email: 'staff@triplehenterprisesllc.biz' }]);
  if (u.pathname === '/rest/v1/rpc/check_internal_mfa_for_edge_function') return json(true);
  if (u.pathname === '/rest/v1/stripe_customers') {
    if (method === 'GET') {
      const email = (u.searchParams.get('client_email') || '').replace(/^eq\./, '');
      const row = st.customers.find((c) => c.client_email === email);
      return json(row ? [row] : []);
    }
    for (const row of JSON.parse(init.body)) if (!st.customers.some((c) => c.client_email === row.client_email)) st.customers.push(row);
    return new Response(null, { status: 201 });
  }
  if (u.pathname === '/rest/v1/card_authorizations') return new Response(null, { status: 201 });
  if (u.pathname === '/rest/v1/stripe_pos_charges_logged') {
    const id = JSON.parse(init.body).payment_intent_id;
    if (st.posClaims.has(id)) return json([], 201);
    st.posClaims.add(id);
    return json([{ payment_intent_id: id }], 201);
  }
  if (u.pathname === '/rest/v1/workspace_sync') {
    if (method === 'GET') return json([{ data: { th_income_log: JSON.stringify(st.incomeLog) } }]);
    st.incomeLog = JSON.parse(JSON.parse(init.body).data.th_income_log);
    return new Response(null, { status: 204 });
  }
  if (u.pathname === '/rest/v1/client_portal_invoices') {
    if (method === 'GET') {
      const f = u.searchParams.get('id') || '';
      const ids = f.startsWith('in.') ? f.slice(4, -1).split(',').map(Number) : [Number(f.replace('eq.', ''))];
      return json(st.portalInvoices.filter((r) => ids.includes(r.id)));
    }
    st.patches.push({ filter: u.searchParams.get('id'), body: JSON.parse(init.body) });
    for (const r of st.portalInvoices) {
      const f = u.searchParams.get('id');
      const ids = f.startsWith('in.') ? f.slice(4, -1).split(',').map(Number) : [Number(f.replace('eq.', ''))];
      if (ids.includes(r.id)) Object.assign(r, JSON.parse(init.body));
    }
    return new Response(null, { status: 204 });
  }
  if (u.host === 'api.resend.com') { st.emails.push(JSON.parse(init.body)); return json({ id: 'email' }); }
  throw new Error(`unexpected fetch ${method} ${u}`);
}

const handlers = {};
let tmpDir;
before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-idem-'));
  const env = { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'srk',
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_POS_SECRET_KEY: 'sk_test_pos', STRIPE_CLIENT_CARDS_SECRET_KEY: 'rk_test_cards',
    RESEND_API_KEY: 're_x', LEAD_EMAIL_FROM: 'Triple H <t@example.com>' };
  globalThis.fetch = fakeFetch;
  for (const fn of ['create-pos-charge', 'create-payment-intent', 'create-bulk-payment-intent', 'manage-saved-card']) {
    let captured;
    globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { captured = h; } };
    const file = path.join(tmpDir, `${fn}.ts`);
    fs.copyFileSync(path.join(ROOT, 'edge-functions', `${fn}-index.ts`), file);
    await import(file);
    handlers[fn] = captured;
  }
});
after(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

const jwt = (email) => 'h.' + Buffer.from(JSON.stringify({ role: 'authenticated', email, sub: 'u1', aal: 'aal2' })).toString('base64url') + '.s';
async function call(fn, body, email = 'staff@triplehenterprisesllc.biz') {
  const res = await handlers[fn](new Request(`https://x/functions/v1/${fn}`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + jwt(email), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const SIG = { signer_name: 'Pat Client', signature_image: 'data:image/png;base64,AAAA' };

// ---- POS saved card --------------------------------------------------------

test('POS charge_saved: a retried tap with the same request_id charges once, logs once, emails once', async () => {
  reset();
  st.customers.push({ client_email: 'pat@example.com', stripe_customer_id: 'cus_pat' });
  const body = { mode: 'charge_saved', client_email: 'pat@example.com', amount: 85, description: 'Dryer belt', request_id: 'pos-0f1e2d3c-4b5a-6978' };
  const a = await call('create-pos-charge', body);
  const b = await call('create-pos-charge', body);
  assert.equal(a.status, 200); assert.equal(a.body.charged, true);
  assert.equal(b.status, 200); assert.equal(b.body.charged, true); assert.equal(b.body.replayed, true);
  assert.equal(st.created.payment_intents, 1, 'Stripe created exactly one PaymentIntent');
  assert.equal(st.incomeLog.length, 1);
  assert.equal(st.emails.length, 1);
  assert.equal(st.stripeCalls[0].key, 'pos-saved-v1-pos-0f1e2d3c-4b5a-6978');
  const sent = new URLSearchParams(st.stripeCalls[0].body);
  assert.equal(sent.get('metadata[pos_client_email]'), 'pat@example.com', 'the webhook can log it identically if it wins');
  assert.equal(sent.get('metadata[pos_amount]'), '85');
});

test('POS charge_saved: a new request_id is a new charge (two real sales)', async () => {
  reset();
  st.customers.push({ client_email: 'pat@example.com', stripe_customer_id: 'cus_pat' });
  await call('create-pos-charge', { mode: 'charge_saved', client_email: 'pat@example.com', amount: 85, request_id: 'pos-aaaaaaaaaaaaaaaa' });
  await call('create-pos-charge', { mode: 'charge_saved', client_email: 'pat@example.com', amount: 85, request_id: 'pos-bbbbbbbbbbbbbbbb' });
  assert.equal(st.created.payment_intents, 2);
  assert.equal(st.incomeLog.length, 2);
});

test('POS charge_saved: if the webhook already claimed the charge, create-pos-charge does not log it again', async () => {
  reset();
  st.customers.push({ client_email: 'pat@example.com', stripe_customer_id: 'cus_pat' });
  st.posClaims.add('pi_1'); // the webhook's delivery got there first
  const r = await call('create-pos-charge', { mode: 'charge_saved', client_email: 'pat@example.com', amount: 85, request_id: 'pos-cccccccccccccccc' });
  assert.equal(r.body.charged, true);
  assert.equal(st.incomeLog.length, 0);
  assert.equal(st.emails.length, 0);
});

test('POS charge_saved without a request_id (an old cached page) still gets a key, just a one-off one', async () => {
  reset();
  st.customers.push({ client_email: 'pat@example.com', stripe_customer_id: 'cus_pat' });
  await call('create-pos-charge', { mode: 'charge_saved', client_email: 'pat@example.com', amount: 85 });
  assert.match(st.stripeCalls[0].key, /^pos-saved-v1-[0-9a-f-]{36}$/);
});

test('POS new card: customer and PaymentIntent keyed; same request_id twice returns the same PaymentIntent', async () => {
  reset();
  const body = { mode: 'new_card', client_email: 'New@Example.com', amount: 40, description: 'Service call', request_id: 'pos-dddddddddddddddd', ...SIG };
  const a = await call('create-pos-charge', body);
  const b = await call('create-pos-charge', body);
  assert.equal(a.body.client_secret, b.body.client_secret);
  assert.equal(st.created.customers, 1);
  assert.equal(st.created.payment_intents, 1);
  assert.match(st.stripeCalls.find((c) => c.path === 'customers').key, /^cust-v1-[0-9a-f]{64}$/);
});

// ---- customers -------------------------------------------------------------

test('the customer key is the same for one email in every function (case and spaces ignored), so a race makes one Customer', async () => {
  reset();
  st.portalInvoices = [{ id: 7, client_email: 'new@example.com', total: 50, paid: false, stripe_payment_intent_id: null }];
  await call('create-pos-charge', { mode: 'new_card', client_email: ' NEW@example.com', amount: 10, request_id: 'pos-eeeeeeeeeeeeeeee', ...SIG });
  st.customers = []; // the DB mapping insert lost the race: the portal call doesn't see it
  await call('create-payment-intent', { invoice_id: 7, ...SIG }, 'new@example.com');
  const keys = st.stripeCalls.filter((c) => c.path === 'customers').map((c) => c.key);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(st.created.customers, 1, 'Stripe returned the first Customer to the second call');
});

// ---- portal PaymentIntents -------------------------------------------------

test('create-payment-intent: two racing calls for the same invoice get one PaymentIntent', async () => {
  reset();
  st.customers.push({ client_email: 'pat@example.com', stripe_customer_id: 'cus_pat' });
  st.portalInvoices = [{ id: 1, client_email: 'pat@example.com', total: 150, paid: false, stripe_payment_intent_id: null }];
  const [a, b] = await Promise.all([call('create-payment-intent', { invoice_id: 1 }, 'pat@example.com'),
    call('create-payment-intent', { invoice_id: 1 }, 'pat@example.com')]);
  assert.equal(a.body.client_secret, b.body.client_secret);
  assert.equal(st.created.payment_intents, 1);
  assert.equal(st.stripeCalls[0].key, 'pi-inv-v1-1-15000-cus_pat-none');
});

test('create-payment-intent: once the invoice points at a PaymentIntent that is gone, the next key differs (a fresh PI is allowed)', async () => {
  reset();
  st.customers.push({ client_email: 'pat@example.com', stripe_customer_id: 'cus_pat' });
  st.portalInvoices = [{ id: 1, client_email: 'pat@example.com', total: 150, paid: false, stripe_payment_intent_id: 'pi_canceled_earlier' }];
  await call('create-payment-intent', { invoice_id: 1 }, 'pat@example.com');
  assert.equal(st.stripeCalls[0].key, 'pi-inv-v1-1-15000-cus_pat-pi_canceled_earlier');
});

test('create-bulk-payment-intent: the same batch in a different order is the same request (sorted key and metadata)', async () => {
  reset();
  st.customers.push({ client_email: 'pat@example.com', stripe_customer_id: 'cus_pat' });
  st.portalInvoices = [
    { id: 2, client_email: 'pat@example.com', total: 40, paid: false, stripe_payment_intent_id: null },
    { id: 3, client_email: 'pat@example.com', total: 60, paid: false, stripe_payment_intent_id: null }];
  const a = await call('create-bulk-payment-intent', { invoice_ids: [3, 2] }, 'pat@example.com');
  for (const r of st.portalInvoices) r.stripe_payment_intent_id = null; // as if the first PATCH hadn't landed yet
  const b = await call('create-bulk-payment-intent', { invoice_ids: [2, 3] }, 'pat@example.com');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.client_secret, b.body.client_secret);
  assert.equal(st.created.payment_intents, 1);
  assert.equal(new URLSearchParams(st.stripeCalls[0].body).get('metadata[client_portal_invoice_ids]'), '2,3');
  assert.match(st.stripeCalls[0].key, /^pi-bulk-v1-[0-9a-f]{64}$/);
});

// ---- saved cards -----------------------------------------------------------

test('manage-saved-card: SetupIntent and detach are keyed; a retried add-card with the same request_id makes one SetupIntent', async () => {
  reset();
  st.customers.push({ client_email: 'pat@example.com', stripe_customer_id: 'cus_pat' });
  const body = { mode: 'create_setup_intent', request_id: 'card-ffffffffffffffff', ...SIG };
  const a = await call('manage-saved-card', body, 'pat@example.com');
  const b = await call('manage-saved-card', body, 'pat@example.com');
  assert.equal(a.body.client_secret, b.body.client_secret);
  assert.equal(st.created.setup_intents, 1);
  await call('manage-saved-card', { mode: 'remove', payment_method_id: 'pm_saved' }, 'pat@example.com');
  assert.equal(st.stripeCalls.at(-1).key, 'pm-detach-v1-pm_saved');
});

// ---- static backstop -------------------------------------------------------

test('no Stripe POST in these functions bypasses stripePost() (every write carries a key)', () => {
  for (const fn of ['create-pos-charge', 'create-payment-intent', 'create-bulk-payment-intent', 'manage-saved-card']) {
    const src = fs.readFileSync(path.join(ROOT, 'edge-functions', `${fn}-index.ts`), 'utf8');
    const direct = [...src.matchAll(/fetch\(\s*[`"]https:\/\/api\.stripe\.com[^]*?\{([^]*?)\}\)/g)]
      .filter((m) => /method:\s*"POST"/.test(m[1]) && !/Idempotency-Key/.test(m[1]));
    assert.deepEqual(direct.map((m) => m[0].slice(0, 80)), [], `${fn} has a Stripe POST without an Idempotency-Key`);
  }
});
