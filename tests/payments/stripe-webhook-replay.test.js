// End-to-end replay of sample Stripe events through the REAL
// edge-functions/stripe-webhook-index.ts, run in Node (type stripping) with:
//   - a fake `Deno` (env + serve),
//   - a fake Stripe SDK whose constructEventAsync checks a real Stripe-style
//     signature (t=...,v1=HMAC-SHA256(secret, "t.body")), and whose
//     refunds.list serves the fixture refund lists,
//   - fetch routed to PGlite: /rest/v1/rpc/stripe_record_event runs the real
//     SQL function as service_role; workspace_sync, Send-Push and Resend are
//     recorded in memory. Nothing leaves the process.
// The only change made to the source is the import line (npm:stripe ->
// the fake). See docs/stripe-hardening-2026-10-31/README.md for the same
// replay done by hand.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('./stripe-db-harness');

const SECRET = 'whsec_test_replay_only';
const ctx = { db: null, blob: null, pushes: [], emails: [], refundLists: {}, failRpc: false };

function sign(body, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

class FakeStripe {
  constructor(key, opts) { this.key = key; this.opts = opts; }
  static createFetchHttpClient() { return {}; }
  static createSubtleCryptoProvider() { return {}; }
  get webhooks() {
    return {
      async constructEventAsync(body, header, secret) {
        const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.split('=')));
        const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${body}`).digest('hex');
        if (!parts.v1 || parts.v1.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected))) {
          throw new Error('No signatures found matching the expected signature for payload');
        }
        return JSON.parse(body);
      },
    };
  }
  get refunds() {
    return {
      list({ charge }) {
        const list = ctx.refundLists[charge];
        return { async *[Symbol.asyncIterator]() {
          if (!list) throw new Error('simulated Stripe API outage');
          for (const r of list) yield r;
        } };
      },
    };
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(url, init = {}) {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  if (u.pathname === '/rest/v1/rpc/stripe_record_event') {
    if (ctx.failRpc) return json({ message: 'Could not find the function' }, 404);
    const { p_event, p_refunds } = JSON.parse(init.body);
    const rows = await h.as(ctx.db, { role: 'service_role' }, 'select public.stripe_record_event($1::jsonb, $2::jsonb) as r',
      [JSON.stringify(p_event), p_refunds ? JSON.stringify(p_refunds) : null]);
    if (rows.error) return json({ message: rows.error.message }, 400);
    return json(rows[0].r);
  }
  if (u.pathname === '/rest/v1/workspace_sync') {
    if (method === 'GET') return json(ctx.blob ? [{ data: ctx.blob }] : []);
    if (method === 'PATCH') { ctx.blob = JSON.parse(init.body).data; return new Response(null, { status: 204 }); }
  }
  if (u.pathname === '/functions/v1/Send-Push') { ctx.pushes.push(JSON.parse(init.body)); return json({ ok: true }); }
  if (u.host === 'api.resend.com') { ctx.emails.push(JSON.parse(init.body)); return json({ id: 'email_fake' }); }
  throw new Error(`unexpected fetch in replay: ${method} ${u}`);
}

let handler;
let tmpDir;
before(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'stripe-webhook-index.ts'), 'utf8');
  const importLine = 'import Stripe from "npm:stripe@latest";';
  assert.ok(src.includes(importLine), 'the webhook still imports the Stripe SDK the way this harness expects');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stripe-webhook-replay-'));
  const file = path.join(tmpDir, 'stripe-webhook.ts');
  fs.writeFileSync(file, src.replace(importLine, 'const Stripe = (globalThis as any).__fakeStripe;'));
  const env = { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    STRIPE_SECRET_KEY: 'sk_test_replay_only', STRIPE_WEBHOOK_SIGNING_SECRET: SECRET,
    RESEND_API_KEY: 're_test', LEAD_EMAIL_FROM: 'Triple H <test@example.com>' };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn; } };
  globalThis.__fakeStripe = FakeStripe;
  globalThis.fetch = fakeFetch;
  await import(file);
  assert.equal(typeof handler, 'function');
});
after(async () => {
  await h.closeAll();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function fresh() {
  ctx.db = await h.buildDb();
  ctx.blob = { th_invoices: JSON.stringify([
    { id: 101, total: 150, paid: false, paidAmount: 0 },
    { id: 102, total: 40, paid: false, paidAmount: 0 },
    { id: 103, total: 60, paid: false, paidAmount: 0 }]), th_income_log: '[]' };
  ctx.pushes = []; ctx.emails = []; ctx.failRpc = false;
  ctx.refundLists = {
    ch_single: h.fixture('charge_refunded_full_refunds'),
    ch_bulk: h.fixture('charge_refunded_bulk_partial_refunds'),
  };
}

async function deliver(name, { signature } = {}) {
  const body = typeof name === 'string' ? JSON.stringify(h.fixture(name)) : JSON.stringify(name);
  const res = await handler(new Request('https://project.supabase.test/functions/v1/stripe-webhook', {
    method: 'POST', headers: { 'Stripe-Signature': signature ?? sign(body) }, body }));
  return { status: res.status, body: JSON.parse(await res.text().then((t) => t || 'null').catch(() => 'null')) };
}
const one = async (sql, params) => (await ctx.db.query(sql, params)).rows[0];

test('a bad signature is rejected with 400 and nothing is recorded', async () => {
  await fresh();
  const r = await handler(new Request('https://x/', { method: 'POST',
    headers: { 'Stripe-Signature': sign('{"other":"body"}') }, body: JSON.stringify(h.fixture('pi_succeeded_single')) }));
  assert.equal(r.status, 400);
  assert.equal((await one('select count(*)::int n from stripe_events')).n, 0);
  const missing = await handler(new Request('https://x/', { method: 'POST', body: '{}' }));
  assert.equal(missing.status, 400);
});

test('succeeded: 200, both invoice tables paid, th_invoices blob paid in full, no alert', async () => {
  await fresh();
  const r = await deliver('pi_succeeded_single');
  assert.equal(r.status, 200);
  assert.equal(r.body.invoices_marked_paid, 1);
  assert.equal((await one('select paid from client_portal_invoices where id = 1')).paid, true);
  assert.equal((await one('select paid from invoices where id = 101')).paid, true);
  const blobInv = JSON.parse(ctx.blob.th_invoices).find((i) => i.id === 101);
  assert.deepEqual([blobInv.paid, blobInv.paidAmount], [true, 150]);
  assert.equal(ctx.pushes.length, 0);
});

test('the same event delivered again: 200 duplicate, no second blob write or alert', async () => {
  await fresh();
  await deliver('pi_succeeded_single');
  ctx.blob = { ...ctx.blob, th_invoices: JSON.stringify([{ id: 101, total: 150, paid: false, paidAmount: 0 }]) };
  const r = await deliver('pi_succeeded_single');
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true);
  assert.equal(JSON.parse(ctx.blob.th_invoices)[0].paid, false, 'the duplicate did not touch the blob');
});

test('paid short: 200, invoice left unpaid, staff alerted once', async () => {
  await fresh();
  const r = await deliver('pi_succeeded_short');
  assert.equal(r.status, 200);
  assert.equal(r.body.amount_mismatch, 'underpaid');
  assert.equal((await one('select paid from client_portal_invoices where id = 1')).paid, false);
  assert.equal(ctx.pushes.length, 1);
  assert.equal(ctx.pushes[0].title, 'Invoice paid short');
  assert.match(ctx.pushes[0].body, /\$100\.00 .*#INV-101.*\$150\.00/);
});

test('POS: first delivery logs income and sends the receipt; a second event for the same charge does neither', async () => {
  await fresh();
  await deliver('pi_succeeded_pos');
  await deliver('pi_succeeded_pos_again');
  const log = JSON.parse(ctx.blob.th_income_log);
  assert.equal(log.length, 1);
  assert.equal(log[0].stripePaymentIntentId, 'pi_pos');
  assert.equal(ctx.emails.length, 1);
  assert.equal(ctx.emails[0].to, 'walkin@example.com');
});

test('charge.refunded: the webhook reads the refund list from Stripe and the invoice shows refunded', async () => {
  await fresh();
  await deliver('pi_succeeded_single');
  const r = await deliver('charge_refunded_full');
  assert.equal(r.status, 200);
  const cpi = await one('select paid, refund_status, refunded_amount from client_portal_invoices where id = 1');
  assert.deepEqual([cpi.paid, cpi.refund_status, Number(cpi.refunded_amount)], [true, 'full', 150]);
  assert.equal((await one('select count(*)::int n from refunds')).n, 2);
});

test('charge.refunded while Stripe\'s API is down: 500 so Stripe retries; nothing recorded', async () => {
  await fresh();
  await deliver('pi_succeeded_single');
  delete ctx.refundLists.ch_single;
  const r = await deliver('charge_refunded_full');
  assert.equal(r.status, 500);
  assert.equal((await one(`select count(*)::int n from stripe_events where type = 'charge.refunded'`)).n, 0);
});

test('a failure inside the database answers 500 and leaves the event in the ledger with its error', async () => {
  await fresh();
  await deliver('pi_succeeded_single');
  // A refund list that doesn't add up to charge.amount_refunded.
  ctx.refundLists.ch_single = h.fixture('charge_refunded_partial_refunds');
  const r = await deliver('charge_refunded_full');
  assert.equal(r.status, 500);
  const ev = await one(`select processed_at, error from stripe_events where event_id = 'evt_1ChargeRefundedFull'`);
  assert.equal(ev.processed_at, null);
  assert.match(ev.error, /incomplete/);
  // Stripe's retry, once the list is complete, succeeds.
  ctx.refundLists.ch_single = h.fixture('charge_refunded_full_refunds');
  assert.equal((await deliver('charge_refunded_full')).status, 200);
});

test('the RPC not deployed yet (migration not applied): 500, so Stripe keeps the event for retry', async () => {
  await fresh();
  ctx.failRpc = true;
  assert.equal((await deliver('pi_succeeded_single')).status, 500);
});

test('payment_failed: 200, payment recorded failed, nothing else', async () => {
  await fresh();
  const r = await deliver('pi_failed_other');
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'payment_status');
  assert.equal((await one(`select status from payments where stripe_payment_intent_id = 'pi_declined'`)).status, 'failed');
  assert.equal(ctx.pushes.length + ctx.emails.length, 0);
});

test('dispute: staff push once, on charge.dispute.created only', async () => {
  await fresh();
  await deliver('pi_succeeded_bulk');
  await deliver('dispute_created');
  await deliver('dispute_won');
  assert.equal(ctx.pushes.length, 1);
  assert.equal(ctx.pushes[0].title, 'Payment disputed');
  assert.match(ctx.pushes[0].body, /\$100\.00 .*pat@example\.com.*fraudulent/);
});

test('an unhandled event type: 200, recorded as ignored', async () => {
  await fresh();
  const r = await deliver('customer_created');
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'ignored');
});
