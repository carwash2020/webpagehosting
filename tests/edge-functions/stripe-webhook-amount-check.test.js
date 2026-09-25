// stripe-webhook amount check (security audit, 2026-09-23, finding #7).
//
// stripe-webhook marked an invoice paid on any payment_intent.succeeded
// without comparing the amount Stripe received to what the invoice still
// owed. The double-charge fix (#386) means a raised invoice gets a fresh
// PaymentIntent the next time "Pay" is tapped, but a page that was
// already open still holds the old, smaller one. Paying it settled the
// raised invoice short, and nothing noticed. Two ways that happens:
//   - the client opens Pay, Steve raises the invoice, the client pays from
//     that same page. No new PaymentIntent was ever made, so the invoice
//     still points at the old one.
//   - a second tab minted the new PaymentIntent, and the first tab pays
//     the old one. The webhook finds the invoice through its metadata.
//
// Now: paid short -> left unpaid, staff alerted; overpaid -> marked paid,
// staff alerted; exact -> marked paid, no alert, as before.
//
// These run the real handler with a stubbed Deno, fetch and Stripe SDK.
// The fake Supabase honors select=, the way PostgREST does, so a lookup
// that forgets to read `total` fails here too.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const CLIENT = 'client@example.com';
const SERVICE_KEY = 'service-role-key-for-tests';
const GOOD_SIGNATURE = 't=1,v1=good';

function project(row, select) {
  if (!select) return { ...row };
  const out = {};
  for (const col of select.split(',')) if (col in row) out[col] = row[col];
  return out;
}

function j(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// state.invoices: client_portal_invoices rows. state.workspace: the
// th_invoices array inside the workspace_sync blob.
function loadWebhook(state) {
  const raw = fs.readFileSync(repo('edge-functions', 'stripe-webhook-index.ts'), 'utf8');
  const src = stripTypeScriptTypes(raw).replace(/^import Stripe from "npm:stripe@latest";$/m, '');
  assert.notEqual(src, stripTypeScriptTypes(raw), 'expected to strip the Stripe SDK import');

  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: init.body });
    const parsed = new URL(u);
    const select = parsed.searchParams.get('select');

    if (parsed.pathname === '/rest/v1/client_portal_invoices' && method === 'GET') {
      const byPi = parsed.searchParams.get('stripe_payment_intent_id');
      const byIds = parsed.searchParams.get('id');
      let rows = state.invoices;
      if (byPi) rows = rows.filter((r) => `eq.${r.stripe_payment_intent_id}` === byPi);
      if (byIds) {
        const ids = byIds.replace(/^in\.\(|\)$/g, '').split(',').map(Number);
        rows = rows.filter((r) => ids.includes(r.id));
      }
      return j(rows.map((r) => project(r, select)));
    }
    if (parsed.pathname === '/rest/v1/client_portal_invoices' && method === 'PATCH') {
      const ids = parsed.searchParams.get('id').replace(/^in\.\(|\)$/g, '').split(',').map(Number);
      const patch = JSON.parse(init.body);
      for (const r of state.invoices) if (ids.includes(r.id)) Object.assign(r, patch);
      return j([]);
    }
    if (parsed.pathname === '/rest/v1/workspace_sync' && method === 'GET') {
      return j([{ data: { th_invoices: JSON.stringify(state.workspace || []) } }]);
    }
    if (parsed.pathname === '/rest/v1/workspace_sync' && method === 'PATCH') {
      state.workspace = JSON.parse(JSON.parse(init.body).data.th_invoices);
      return j([]);
    }
    if (parsed.pathname === '/rest/v1/stripe_pos_charges_logged' && method === 'POST') {
      return j([{ payment_intent_id: JSON.parse(init.body).payment_intent_id }], 201);
    }
    if (parsed.pathname === '/functions/v1/Send-Push') {
      if (state.pushThrows) throw new Error('network down');
      return j(state.pushFails ? { ok: false } : { ok: true }, state.pushFails ? 500 : 200);
    }
    if (u === 'https://api.resend.com/emails') return j({ id: 'email_1' });
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };

  class FakeStripe {
    constructor() {
      this.webhooks = {
        constructEventAsync: async (body, signature) => {
          if (signature !== GOOD_SIGNATURE) throw new Error('No signatures found matching the expected signature');
          return JSON.parse(body);
        },
      };
    }
    static createFetchHttpClient() { return {}; }
    static createSubtleCryptoProvider() { return {}; }
  }

  let handler = null;
  const env = {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SIGNING_SECRET: 'whsec_x',
    RESEND_API_KEY: 're_x', LEAD_EMAIL_FROM: 'Triple H <noreply@example.com>',
  };
  const context = vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    Stripe: FakeStripe,
    fetch, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    Intl, Date, JSON, Math, Promise, Set, Map, Number, String, Array, Object, parseInt, isNaN, encodeURIComponent, decodeURIComponent,
  });
  vm.runInContext(src, context, { filename: 'stripe-webhook-index.ts' });

  const deliver = async (pi, { type = 'payment_intent.succeeded', signature = GOOD_SIGNATURE } = {}) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/stripe-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
      body: JSON.stringify({ id: 'evt_1', type, data: { object: pi } }),
    }));
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };
  const pushes = () => calls.filter((c) => c.url.endsWith('/functions/v1/Send-Push')).map((c) => JSON.parse(c.body));
  const invoicePatches = () => calls.filter((c) => c.url.includes('/rest/v1/client_portal_invoices') && c.method === 'PATCH');
  const workspacePatches = () => calls.filter((c) => c.url.includes('/rest/v1/workspace_sync') && c.method === 'PATCH');
  return { deliver, calls, pushes, invoicePatches, workspacePatches };
}

const invoice = (over = {}) => ({
  id: 7, source_invoice_id: 1007, invoice_number: 'INV-1007', client_email: CLIENT,
  total: 150, paid: false, paid_at: null, stripe_payment_intent_id: 'pi_1', ...over,
});
const pi = (over = {}) => ({
  id: 'pi_1', object: 'payment_intent', status: 'succeeded', currency: 'usd',
  amount: 15000, amount_received: 15000, metadata: { client_portal_invoice_id: '7' }, ...over,
});

// ------------------------------------------------------------- exact amount

test('single: paid in full -> marked paid in the portal and the Invoice Log, no alert (unchanged)', async () => {
  const state = { invoices: [invoice()], workspace: [{ id: 1007, paid: false }] };
  const f = loadWebhook(state);
  const r = await f.deliver(pi());
  assert.equal(r.status, 200);
  assert.equal(r.body.invoices_marked_paid, 1);
  assert.equal(state.invoices[0].paid, true);
  assert.equal(state.workspace[0].paid, true);
  assert.equal(f.pushes().length, 0);
});

test('bulk: one payment covering exactly the sum of its invoices -> all marked paid, no alert (unchanged)', async () => {
  const state = {
    invoices: [
      invoice({ id: 7, source_invoice_id: 1007, invoice_number: 'INV-1007', total: 50, stripe_payment_intent_id: 'pi_bulk' }),
      invoice({ id: 8, source_invoice_id: 1008, invoice_number: 'INV-1008', total: 75.5, stripe_payment_intent_id: 'pi_bulk' }),
    ],
    workspace: [{ id: 1007, paid: false }, { id: 1008, paid: false }],
  };
  const f = loadWebhook(state);
  const r = await f.deliver(pi({ id: 'pi_bulk', amount: 12550, amount_received: 12550, metadata: { client_portal_invoice_ids: '7,8' } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.invoices_marked_paid, 2);
  assert.deepEqual(state.invoices.map((i) => i.paid), [true, true]);
  assert.deepEqual(state.workspace.map((i) => i.paid), [true, true]);
  assert.equal(f.pushes().length, 0);
});

// A legitimate payment must always match to the cent, or every real
// payment would be held. So the amount each create function actually asks
// Stripe for is fed straight back into the webhook, with totals that don't
// convert to cents cleanly in floating point.
function loadCreator(name, invoices) {
  const src = stripTypeScriptTypes(fs.readFileSync(repo('edge-functions', `${name}-index.ts`), 'utf8'));
  let sentAmount = null;
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.includes('/rest/v1/client_portal_invoices') && method === 'GET') return j(invoices);
    if (u.includes('/rest/v1/client_portal_invoices') && method === 'PATCH') return j([]);
    if (u.includes('/rest/v1/stripe_customers') && method === 'GET') return j([{ stripe_customer_id: 'cus_client' }]);
    if (u.startsWith('https://api.stripe.com/v1/payment_methods')) return j({ data: [{ id: 'pm_1' }] });
    if (u === 'https://api.stripe.com/v1/payment_intents' && method === 'POST') {
      sentAmount = Number(new URLSearchParams(init.body).get('amount'));
      return j({ id: 'pi_new', client_secret: 'pi_new_secret_x' });
    }
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };
  let handler = null;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, STRIPE_SECRET_KEY: 'sk_test_x' };
  const context = vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    Intl, Date, JSON, Math, Promise, Set, Map, Number, String, Array, Object, parseInt, isNaN, encodeURIComponent, decodeURIComponent,
  });
  vm.runInContext(src, context, { filename: `${name}-index.ts` });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'HS256' })}.${b64({ role: 'authenticated', email: CLIENT })}.sig`;
  return async (body) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    }));
    assert.equal(res.status, 200, `${name} should create a PaymentIntent`);
    return sentAmount;
  };
}

for (const total of [0.3, 19.99, 1234.57, 0.1 + 0.2, 19.999999999998]) {
  test(`single: the amount create-payment-intent charges for a ${total} total is accepted by the webhook as paid in full`, async () => {
    const charged = await loadCreator('create-payment-intent', [{ id: 7, client_email: CLIENT, total, paid: false, stripe_payment_intent_id: null }])({ invoice_id: 7 });
    const state = { invoices: [invoice({ total })], workspace: [] };
    const f = loadWebhook(state);
    await f.deliver(pi({ amount: charged, amount_received: charged }));
    assert.equal(state.invoices[0].paid, true);
    assert.equal(f.pushes().length, 0);
  });
}

for (const totals of [[0.1, 0.2], [19.99, 0.01, 5.05], [33.33, 33.33, 33.34], [10.075, 10.075]]) {
  test(`bulk: the amount create-bulk-payment-intent charges for totals ${totals.join(' + ')} is accepted by the webhook as paid in full`, async () => {
    const rows = totals.map((total, i) => ({ id: 10 + i, client_email: CLIENT, total, paid: false, stripe_payment_intent_id: null }));
    const charged = await loadCreator('create-bulk-payment-intent', rows)({ invoice_ids: rows.map((r) => r.id) });
    const state = {
      invoices: rows.map((r) => invoice({ id: r.id, source_invoice_id: 1000 + r.id, invoice_number: `INV-${r.id}`, total: r.total, stripe_payment_intent_id: 'pi_bulk' })),
      workspace: [],
    };
    const f = loadWebhook(state);
    await f.deliver(pi({ id: 'pi_bulk', amount: charged, amount_received: charged, metadata: { client_portal_invoice_ids: rows.map((r) => r.id).join(',') } }));
    assert.ok(state.invoices.every((i) => i.paid), 'every invoice marked paid');
    assert.equal(f.pushes().length, 0);
  });
}

// ----------------------------------------------------------------- paid short

test('stale page, same PaymentIntent: invoice raised from $100 to $150 after Pay was opened -> left unpaid, staff alerted', async () => {
  const state = { invoices: [invoice({ total: 150 })], workspace: [{ id: 1007, paid: false }] };
  const f = loadWebhook(state);
  const r = await f.deliver(pi({ amount: 10000, amount_received: 10000 }));
  assert.equal(r.status, 200, 'acknowledged, so Stripe does not retry an event a retry cannot fix');
  assert.equal(r.body.amount_mismatch, true);
  assert.equal(r.body.invoices_marked_paid, 0);
  assert.equal(state.invoices[0].paid, false);
  assert.equal(f.invoicePatches().length, 0);
  assert.equal(f.workspacePatches().length, 0, 'the Invoice Log is not marked paid either');
  assert.equal(state.workspace[0].paid, false);

  const pushes = f.pushes();
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].type, 'stripe-reconciliation-alert', 'reuses the staff-only alert type');
  assert.equal(pushes[0].title, 'Invoice paid short');
  assert.match(pushes[0].body, /pi_1/);
  assert.match(pushes[0].body, /received \$100\.00 for invoice #INV-1007 \(client@example\.com\), which still owed \$150\.00/);
  assert.match(pushes[0].body, /left unpaid/);
});

test('stale tab, superseded PaymentIntent: found through metadata, paid short -> left unpaid, staff alerted', async () => {
  // A second tab already moved the invoice onto the new $150 PaymentIntent.
  const state = { invoices: [invoice({ total: 150, stripe_payment_intent_id: 'pi_new' })], workspace: [{ id: 1007, paid: false }] };
  const f = loadWebhook(state);
  const r = await f.deliver(pi({ id: 'pi_old', amount: 10000, amount_received: 10000 }));
  assert.equal(r.status, 200);
  assert.equal(r.body.amount_mismatch, true);
  assert.equal(state.invoices[0].paid, false);
  assert.equal(f.invoicePatches().length, 0);
  assert.ok(f.calls.some((c) => c.url.includes('client_portal_invoices?id=in.(7)')), 'reached the invoice through the metadata fallback');
  assert.equal(f.pushes().length, 1);
  assert.match(f.pushes()[0].body, /pi_old received \$100\.00/);
});

test('bulk paid short: an invoice in the batch was raised -> none marked paid, one alert naming every invoice', async () => {
  const state = {
    invoices: [
      invoice({ id: 7, source_invoice_id: 1007, invoice_number: 'INV-1007', total: 50, stripe_payment_intent_id: 'pi_bulk' }),
      invoice({ id: 8, source_invoice_id: 1008, invoice_number: 'INV-1008', total: 90, stripe_payment_intent_id: 'pi_bulk' }),
    ],
    workspace: [{ id: 1007, paid: false }, { id: 1008, paid: false }],
  };
  const f = loadWebhook(state);
  const r = await f.deliver(pi({ id: 'pi_bulk', amount: 12550, amount_received: 12550, metadata: { client_portal_invoice_ids: '7,8' } }));
  assert.equal(r.status, 200);
  assert.deepEqual(state.invoices.map((i) => i.paid), [false, false]);
  assert.equal(f.invoicePatches().length, 0);
  assert.equal(f.pushes().length, 1);
  assert.match(f.pushes()[0].body, /received \$125\.50 for invoices #INV-1007, #INV-1008 \(client@example\.com\), which still owed \$140\.00/);
});

test('a PaymentIntent with no amount_received is held, not treated as paid', async () => {
  const state = { invoices: [invoice()], workspace: [] };
  const f = loadWebhook(state);
  const noAmount = pi();
  delete noAmount.amount_received;
  const r = await f.deliver(noAmount);
  assert.equal(r.status, 200);
  assert.equal(state.invoices[0].paid, false);
  assert.equal(f.pushes().length, 1);
  assert.equal(f.pushes()[0].title, 'Invoice paid short');
});

for (const [label, flag] of [['returns an error', 'pushFails'], ['throws', 'pushThrows']]) {
  test(`paid short and Send-Push ${label} -> still left unpaid and still acknowledged with 200`, async () => {
    const state = { invoices: [invoice({ total: 150 })], workspace: [], [flag]: true };
    const f = loadWebhook(state);
    const r = await f.deliver(pi({ amount: 10000, amount_received: 10000 }));
    assert.equal(r.status, 200);
    assert.equal(r.body.amount_mismatch, true);
    assert.equal(state.invoices[0].paid, false);
    assert.equal(f.invoicePatches().length, 0);
  });
}

// ------------------------------------------------------------------- overpaid

test('overpaid: invoice lowered after Pay was opened -> marked paid (it is covered), staff alerted to refund the extra', async () => {
  const state = { invoices: [invoice({ total: 150 })], workspace: [{ id: 1007, paid: false }] };
  const f = loadWebhook(state);
  const r = await f.deliver(pi({ amount: 20000, amount_received: 20000 }));
  assert.equal(r.status, 200);
  assert.equal(r.body.invoices_marked_paid, 1);
  assert.equal(state.invoices[0].paid, true);
  assert.equal(state.workspace[0].paid, true);
  const pushes = f.pushes();
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].type, 'stripe-reconciliation-alert');
  assert.equal(pushes[0].title, 'Invoice overpaid');
  assert.match(pushes[0].body, /received \$200\.00 for invoice #INV-1007 \(client@example\.com\), which still owed \$150\.00/);
  assert.match(pushes[0].body, /marked paid.*extra \$50\.00 may need a refund/);
});

test('bulk where one invoice was already marked paid by hand -> the rest is marked paid and the overlap is flagged', async () => {
  const state = {
    invoices: [
      invoice({ id: 7, source_invoice_id: 1007, invoice_number: 'INV-1007', total: 50, paid: true, stripe_payment_intent_id: 'pi_bulk' }),
      invoice({ id: 8, source_invoice_id: 1008, invoice_number: 'INV-1008', total: 75.5, stripe_payment_intent_id: 'pi_bulk' }),
    ],
    workspace: [{ id: 1007, paid: true }, { id: 1008, paid: false }],
  };
  const f = loadWebhook(state);
  const r = await f.deliver(pi({ id: 'pi_bulk', amount: 12550, amount_received: 12550, metadata: { client_portal_invoice_ids: '7,8' } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.invoices_marked_paid, 1);
  assert.equal(state.invoices[1].paid, true);
  assert.equal(f.pushes().length, 1);
  assert.equal(f.pushes()[0].title, 'Invoice overpaid');
  assert.match(f.pushes()[0].body, /received \$125\.50 for invoice #INV-1008 .*still owed \$75\.50/);
});

test('overpaid and Send-Push fails -> the invoice is still marked paid', async () => {
  const state = { invoices: [invoice({ total: 150 })], workspace: [], pushFails: true };
  const f = loadWebhook(state);
  const r = await f.deliver(pi({ amount: 20000, amount_received: 20000 }));
  assert.equal(r.status, 200);
  assert.equal(state.invoices[0].paid, true);
});

// ------------------------------------------------------ paths that must not change

test('a redelivered event for an invoice already marked paid -> already_processed, no alert', async () => {
  const state = { invoices: [invoice({ paid: true })], workspace: [] };
  const f = loadWebhook(state);
  const r = await f.deliver(pi({ amount: 10000, amount_received: 10000 }));
  assert.equal(r.body.already_processed, true);
  assert.equal(f.pushes().length, 0);
  assert.equal(f.invoicePatches().length, 0);
});

test('a POS charge is untouched by the invoice amount check', async () => {
  const state = { invoices: [invoice()], workspace: [] };
  const f = loadWebhook(state);
  const r = await f.deliver(pi({ id: 'pi_pos', amount: 4200, amount_received: 4200, metadata: { pos_charge: 'true', pos_amount: '42', pos_client_email: CLIENT } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.pos_charge, true);
  assert.equal(f.pushes().length, 0);
  assert.equal(f.invoicePatches().length, 0);
});

test('a bad signature is still rejected before anything is read or written', async () => {
  const state = { invoices: [invoice()], workspace: [] };
  const f = loadWebhook(state);
  const r = await f.deliver(pi(), { signature: 't=1,v1=forged' });
  assert.equal(r.status, 400);
  assert.equal(f.calls.length, 0);
});

test('the alert only goes through the exact-cased Send-Push slug with the service role key', () => {
  const src = fs.readFileSync(repo('edge-functions', 'stripe-webhook-index.ts'), 'utf8');
  assert.ok(src.includes('`${SUPABASE_URL}/functions/v1/Send-Push`'));
  assert.doesNotMatch(src, /functions\/v1\/send-push/);
  assert.match(src, /Authorization: `Bearer \$\{SERVICE_ROLE_KEY\}` \},\n\s*body: JSON\.stringify\(\{ type: "stripe-reconciliation-alert", title, body \}\)/);
});
