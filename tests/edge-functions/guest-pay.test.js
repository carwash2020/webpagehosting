// guest-pay (2026-11-03, handoff §3A; Connor: "no account needed"). The
// invoice email's button and the PDF's printed link open
// /pay/INV-2026-1112-<code>; that page calls this function with the code.
// The code is the only key: long, random, one invoice. This runs the real
// handler with a stubbed Deno, database and Stripe, the same way the
// create-payment-intent double-charge tests do.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOKEN = 'k7f3qm2xw9hcz4bv';
const CLIENT = 'tony@example.com';

function load(state) {
  const src = stripTypeScriptTypes(fs.readFileSync(repo('edge-functions', 'guest-pay-index.ts'), 'utf8'));
  const calls = [];
  const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: init.body, headers: init.headers || {} });
    if (u.includes('/rest/v1/client_portal_invoices') && method === 'GET') {
      const tok = decodeURIComponent((u.match(/pay_token=eq\.([^&]+)/) || [])[1] || '');
      return j(state.invoices.filter((i) => i.pay_token === tok));
    }
    if (u.includes('/rest/v1/client_portal_invoices') && method === 'PATCH') return j([]);
    if (u.includes('/rest/v1/invoices?id=eq.') && method === 'GET') {
      const id = (u.match(/id=eq\.(\d+)/) || [])[1];
      return j((state.workspaceInvoices || []).filter((i) => String(i.id) === id));
    }
    if (u.includes('/storage/v1/object/sign/invoice-pdfs/')) {
      const p = decodeURIComponent(u.split('/storage/v1/object/sign/invoice-pdfs/')[1]);
      calls.push({ signed: p, body: init.body });
      return (state.pdfs || []).includes(p) ? j({ signedURL: `/object/sign/invoice-pdfs/${encodeURIComponent(p)}?token=signed` }) : j({ error: 'not_found' }, 400);
    }
    const m = u.match(/^https:\/\/api\.stripe\.com\/v1\/payment_intents\/([^/?]+)\?expand\[\]=latest_charge$/);
    if (m && method === 'GET') {
      const r = (state.retrieve || {})[decodeURIComponent(m[1])];
      return r ? j(r) : j({ error: { code: 'resource_missing' } }, 404);
    }
    if (u === 'https://api.stripe.com/v1/payment_intents' && method === 'POST') return j({ id: 'pi_guest', client_secret: 'pi_guest_secret_x' });
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };
  let handler = null;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key', STRIPE_SECRET_KEY: 'sk_test_x' };
  const ctx = vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    Intl, Date, JSON, Math, Promise, Set, Map, Number, String, Array, Object, parseInt, isNaN, encodeURIComponent, decodeURIComponent,
    crypto: globalThis.crypto, TextEncoder, Uint8Array, setTimeout,
  });
  vm.runInContext(src, ctx, { filename: 'guest-pay-index.ts' });
  const call = async (body, headers = {}) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/guest-pay', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const created = () => calls.filter((c) => c.url === 'https://api.stripe.com/v1/payment_intents' && c.method === 'POST');
  return { call, calls, created };
}

const invoice = (over = {}) => ({
  id: 41, source_invoice_id: 1730000000000, pay_token: TOKEN, invoice_number: 'INV-2026-1112', invoice_date: '2026-10-28', description: 'Repair fridge',
  client_name: 'Tony Perides', client_email: CLIENT, total: 300, paid: false, paid_at: null, stripe_payment_intent_id: null, ...over,
});

test('view: the code shows what the client needs to pay, and nothing that identifies them beyond an initial and surname', async () => {
  const g = load({ invoices: [invoice()], workspaceInvoices: [{ id: 1730000000000, terms: 'Due Upon Receipt' }] });
  const r = await g.call({ action: 'view', token: TOKEN });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, invoice_number: 'INV-2026-1112', invoice_date: '2026-10-28', description: 'Repair fridge', billed_to: 'T. Perides', amount_due: 300, due_date: '2026-10-28', paid: false, paid_at: null });
  assert.ok(!JSON.stringify(r.body).includes(CLIENT), 'the email never leaves the server');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://www.triplehenterprisesllc.biz');
});

test('a wrong, malformed or missing code all get the same answer, and a malformed one never reaches the database', async () => {
  const g = load({ invoices: [invoice()] });
  const wrong = await g.call({ action: 'view', token: 'zzzzzzzzzzzzzzzz' });
  const bad = await g.call({ action: 'view', token: "x' or 1=1" });
  const none = await g.call({ action: 'pay' });
  for (const r of [wrong, bad, none]) { assert.equal(r.status, 404); assert.deepEqual(r.body, { ok: false, error: 'not_found' }); }
  assert.equal(g.calls.filter((c) => c.url.includes('pay_token=eq.x')).length, 0);
  assert.equal(g.created().length, 0);
});

test('pay: a one-time payment for the invoice total -- no saved card, no customer, receipt to the email on file', async () => {
  const g = load({ invoices: [invoice()] });
  const r = await g.call({ action: 'pay', token: TOKEN });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, client_secret: 'pi_guest_secret_x' });
  const [pi] = g.created();
  const p = new URLSearchParams(pi.body);
  assert.equal(p.get('amount'), '30000');
  assert.equal(p.get('currency'), 'usd');
  assert.equal(p.get('automatic_payment_methods[enabled]'), 'true');
  assert.equal(p.get('metadata[client_portal_invoice_id]'), '41', 'the webhook marks it paid exactly like a portal payment');
  assert.equal(p.get('metadata[paid_via]'), 'guest_link');
  assert.equal(p.get('receipt_email'), CLIENT);
  assert.equal(p.get('customer'), null, 'no Stripe customer');
  assert.equal(p.get('setup_future_usage'), null, 'no card saved, so no signed card-on-file authorization is needed');
  assert.match(pi.headers['Idempotency-Key'], /^pi-guest-v1-41-30000-none$/);
  const patch = g.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.body), { stripe_payment_intent_id: 'pi_guest' });
});

test('pay: a receipt address typed on the page is used if it is a real address', async () => {
  const g = load({ invoices: [invoice()] });
  await g.call({ action: 'pay', token: TOKEN, receipt_email: ' Office@Example.com ' });
  assert.equal(new URLSearchParams(g.created()[0].body).get('receipt_email'), 'office@example.com');
  const g2 = load({ invoices: [invoice()] });
  await g2.call({ action: 'pay', token: TOKEN, receipt_email: 'not an email' });
  assert.equal(new URLSearchParams(g2.created()[0].body).get('receipt_email'), CLIENT);
});

test('an invoice already paid cannot be paid again, and the page is told when', async () => {
  const g = load({ invoices: [invoice({ paid: true, paid_at: '2026-11-04T16:00:00Z' })] });
  const v = await g.call({ action: 'view', token: TOKEN });
  assert.equal(v.body.paid, true);
  assert.equal(v.body.amount_due, 0);
  assert.equal(v.body.paid_at, '2026-11-04T16:00:00Z');
  const p = await g.call({ action: 'pay', token: TOKEN });
  assert.equal(p.status, 409);
  assert.equal(p.body.already_paid, true);
  assert.equal(g.created().length, 0);
});

test('double-charge guards, as in the portal: a payment already through or processing blocks a new one; an open one is reused', async () => {
  const done = load({ invoices: [invoice({ stripe_payment_intent_id: 'pi_old' })], retrieve: { pi_old: { id: 'pi_old', status: 'processing', amount: 30000 } } });
  const r1 = await done.call({ action: 'pay', token: TOKEN });
  assert.equal(r1.status, 409);
  assert.equal(r1.body.already_paying, true);
  assert.equal(done.created().length, 0);
  const open = load({ invoices: [invoice({ stripe_payment_intent_id: 'pi_open' })], retrieve: { pi_open: { id: 'pi_open', status: 'requires_payment_method', amount: 30000, currency: 'usd', customer: null, metadata: { client_portal_invoice_id: '41' }, client_secret: 'pi_open_secret' } } });
  const r2 = await open.call({ action: 'pay', token: TOKEN });
  assert.deepEqual(r2.body, { ok: true, client_secret: 'pi_open_secret', reused: true });
  assert.equal(open.created().length, 0);
});

test('view: the due date follows the invoice terms, as in the Workspace; no Workspace row, no due date', async () => {
  const net15 = await load({ invoices: [invoice()], workspaceInvoices: [{ id: 1730000000000, terms: 'Net 15' }] }).call({ action: 'view', token: TOKEN });
  assert.equal(net15.body.due_date, '2026-11-12');
  const net30 = await load({ invoices: [invoice()], workspaceInvoices: [{ id: 1730000000000, terms: 'Net 30' }] }).call({ action: 'view', token: TOKEN });
  assert.equal(net30.body.due_date, '2026-11-27');
  const none = await load({ invoices: [invoice()] }).call({ action: 'view', token: TOKEN });
  assert.equal(none.body.due_date, null);
});

test('pdf: a five-minute link to the archived invoice PDF; none archived, a plain no', async () => {
  const g = load({ invoices: [invoice()], pdfs: ['invoices/INV-2026-1112.pdf'] });
  const r = await g.call({ action: 'pdf', token: TOKEN });
  assert.deepEqual(r.body, { ok: true, url: 'https://example.supabase.co/storage/v1/object/sign/invoice-pdfs/invoices%2FINV-2026-1112.pdf?token=signed' });
  assert.deepEqual(JSON.parse(g.calls.find((c) => c.signed).body), { expiresIn: 300 });
  const none = await load({ invoices: [invoice()] }).call({ action: 'pdf', token: TOKEN });
  assert.equal(none.status, 404);
  const wrong = await load({ invoices: [invoice()], pdfs: ['invoices/INV-2026-1112.pdf'] }).call({ action: 'pdf', token: 'zzzzzzzzzz' });
  assert.equal(wrong.status, 404, 'no code, no PDF');
});

test('no sign-in needed: it works with no Authorization header at all', async () => {
  const g = load({ invoices: [invoice()] });
  const r = await g.call({ action: 'view', token: TOKEN }, {});
  assert.equal(r.status, 200);
});

// Fix plan RP1.3 (2026-11-07): a part-paid invoice asks for, and charges,
// only what is left.
test('RP1.3: a part-paid invoice shows and charges only the balance; nothing left means nothing to pay', async () => {
  let g = load({ invoices: [invoice({ paid_amount: 100.5 })], workspaceInvoices: [{ id: 1730000000000, terms: 'Due Upon Receipt' }] });
  assert.equal((await g.call({ action: 'view', token: TOKEN })).body.amount_due, 199.5);
  const r = await g.call({ action: 'pay', token: TOKEN });
  assert.equal(r.status, 200);
  assert.equal(new URLSearchParams(g.created()[0].body).get('amount'), '19950');
  g = load({ invoices: [invoice({ paid_amount: 300 })] });
  const none = await g.call({ action: 'pay', token: TOKEN });
  assert.equal(none.status, 409);
  assert.equal(none.body.already_paid, true);
  assert.equal(g.created().length, 0, 'no charge');
  assert.ok(g.calls.some((c) => /select=[^&]*paid_amount/.test(c.url)), 'the balance is read from the database');
});
