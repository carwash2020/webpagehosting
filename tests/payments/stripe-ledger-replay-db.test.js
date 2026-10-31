// Replays sample Stripe events (tests/payments/fixtures, API 2024-06-20
// shapes) through stripe_record_event in PGlite, against the real
// sql/payments/01_stripe_event_ledger_payments_refunds.sql. This is the
// database half of stripe-webhook: the edge function verifies the
// signature, fetches the refund list for charge.refunded, and calls this.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./stripe-db-harness');

after(h.closeAll);

const q = async (db, sql, params) => (await db.query(sql, params)).rows;
const one = async (db, sql, params) => (await q(db, sql, params))[0];

// ---- migration -------------------------------------------------------------

test('the migration applies twice with no error and no duplicate rows (re-runnable, idempotent backfill)', async () => {
  const db = await h.buildDb();
  await db.exec(h.MIGRATION);
  assert.equal((await one(db, 'select count(*)::int n from payments')).n, 1);
  assert.equal((await one(db, 'select count(*)::int n from payment_allocations')).n, 1);
});

test('backfill: an invoice paid by card before the ledger gets a succeeded payment linked to both invoice tables', async () => {
  const db = await h.buildDb();
  const p = await one(db, `select p.*, a.client_portal_invoice_id, a.invoice_id, a.amount_cents alloc
    from payments p join payment_allocations a on a.payment_id = p.id`);
  assert.equal(p.stripe_payment_intent_id, 'pi_old');
  assert.equal(p.status, 'succeeded');
  assert.equal(p.source, 'backfill');
  assert.equal(p.livemode, null);
  assert.equal(Number(p.amount_cents), 8000);
  assert.equal(p.client_portal_invoice_id, 4);
  assert.equal(Number(p.invoice_id), 104);
  assert.equal(p.tenant_id, h.TRIPLE_H, 'a null portal tenant falls back to Triple H via set_tenant_id');
  assert.equal(p.client_id, 'cccccccc-0000-4000-8000-000000000001');
});

test('backfill: stripe_customers and card_authorizations get client_id by email (case-insensitive)', async () => {
  const db = await h.buildDb();
  assert.equal((await one(db, 'select client_id from stripe_customers')).client_id, 'cccccccc-0000-4000-8000-000000000001');
  assert.equal((await one(db, 'select client_id from card_authorizations')).client_id, 'cccccccc-0000-4000-8000-000000000001');
});

test('a new stripe_customers row for a client that already has one keeps client_id null instead of failing the insert', async () => {
  const db = await h.buildDb();
  await db.exec(`insert into stripe_customers (client_email, stripe_customer_id) values ('PAT@example.com ', 'cus_dupe')`);
  assert.equal((await one(db, `select client_id from stripe_customers where stripe_customer_id = 'cus_dupe'`)).client_id, null);
});

test('existing columns are untouched: refund columns default to none/0 and paid flags are unchanged', async () => {
  const db = await h.buildDb();
  const rows = await q(db, 'select id, paid, refunded_amount, refund_status from client_portal_invoices order by id');
  assert.deepEqual(rows.map((r) => [r.id, r.paid, Number(r.refunded_amount), r.refund_status]),
    [[1, false, 0, 'none'], [2, false, 0, 'none'], [3, false, 0, 'none'], [4, true, 0, 'none']]);
});

// ---- succeeded -------------------------------------------------------------

test('payment_intent.succeeded marks the portal invoice AND public.invoices paid in one call, and records the payment', async () => {
  const db = await h.buildDb();
  const r = await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  assert.equal(r.duplicate, false);
  assert.equal(r.action, 'invoice_payment');
  assert.equal(r.invoices_marked_paid.length, 1);
  const cpi = await one(db, 'select paid, paid_at from client_portal_invoices where id = 1');
  assert.equal(cpi.paid, true);
  assert.ok(cpi.paid_at);
  const inv = await one(db, 'select paid, paid_amount from invoices where id = 101');
  assert.equal(inv.paid, true);
  assert.equal(Number(inv.paid_amount), 150);
  const p = await one(db, `select * from payments where stripe_payment_intent_id = 'pi_single'`);
  assert.equal(p.status, 'succeeded');
  assert.equal(p.kind, 'invoice');
  assert.equal(p.livemode, true);
  assert.equal(p.stripe_charge_id, 'ch_single');
  assert.equal(Number(p.amount_received_cents), 15000);
  const ev = await one(db, `select * from stripe_events where event_id = 'evt_1PiSingleSucceeded'`);
  assert.ok(ev.processed_at);
  assert.equal(ev.outcome, 'processed');
  assert.equal(ev.error, null);
  assert.equal(ev.stripe_object_id, 'pi_single');
});

test('the same event delivered twice is a recorded no-op the second time (ledger dedupe by event id)', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  await db.exec(`update client_portal_invoices set paid = false where id = 1`); // staff un-marked it since
  const r = await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  assert.equal(r.duplicate, true);
  assert.equal((await one(db, 'select paid from client_portal_invoices where id = 1')).paid, false, 'a replay must not re-mark it');
  assert.equal((await one(db, 'select count(*)::int n from stripe_events')).n, 1);
});

test('Pay All Outstanding: one PaymentIntent marks both invoices paid and allocates each its own total', async () => {
  const db = await h.buildDb();
  const r = await h.recordEvent(db, h.fixture('pi_succeeded_bulk'));
  assert.equal(r.invoices_marked_paid.length, 2);
  assert.deepEqual((await q(db, 'select id, paid from client_portal_invoices where id in (2,3) order by id')).map((x) => x.paid), [true, true]);
  assert.deepEqual((await q(db, 'select id, paid from invoices where id in (102,103) order by id')).map((x) => x.paid), [true, true]);
  const allocs = await q(db, `select a.client_portal_invoice_id, a.amount_cents from payment_allocations a
    join payments p on p.id = a.payment_id where p.stripe_payment_intent_id = 'pi_bulk' order by 1`);
  assert.deepEqual(allocs.map((a) => [a.client_portal_invoice_id, Number(a.amount_cents)]), [[2, 4000], [3, 6000]]);
});

test('paid short: the invoice stays unpaid, the payment is still recorded, and the result flags it for the staff alert', async () => {
  const db = await h.buildDb();
  const r = await h.recordEvent(db, h.fixture('pi_succeeded_short'));
  assert.equal(r.amount_mismatch, 'underpaid');
  assert.equal(r.received_cents, 10000);
  assert.equal(r.owed_cents, 15000);
  assert.equal((await one(db, 'select paid from client_portal_invoices where id = 1')).paid, false);
  assert.equal((await one(db, 'select paid from invoices where id = 101')).paid, false);
  const s = await one(db, 'select * from invoice_payment_status where invoice_id = 101');
  assert.equal(s.payment_status, 'partially_paid');
  assert.equal(Number(s.net_paid_cents), 10000);
});

test('POS sale: recorded as a pos payment; only the first event for that PaymentIntent wins the income/receipt claim', async () => {
  const db = await h.buildDb();
  const a = await h.recordEvent(db, h.fixture('pi_succeeded_pos'));
  const b = await h.recordEvent(db, h.fixture('pi_succeeded_pos_again'));
  assert.equal(a.pos_first, true);
  assert.equal(b.pos_first, false);
  const p = await one(db, `select kind, client_email, status from payments where stripe_payment_intent_id = 'pi_pos'`);
  assert.deepEqual([p.kind, p.client_email, p.status], ['pos', 'walkin@example.com', 'succeeded']);
});

test('POS: if create-pos-charge already claimed the PaymentIntent, the webhook does not log it again', async () => {
  const db = await h.buildDb();
  await db.exec(`insert into stripe_pos_charges_logged (payment_intent_id) values ('pi_pos')`);
  assert.equal((await h.recordEvent(db, h.fixture('pi_succeeded_pos'))).pos_first, false);
});

// ---- failed ----------------------------------------------------------------

test('payment_intent.payment_failed records a failed payment with the decline code; no invoice changes', async () => {
  const db = await h.buildDb();
  const r = await h.recordEvent(db, h.fixture('pi_failed_other'));
  assert.equal(r.status, 'failed');
  assert.equal(r.decline_code, 'generic_decline');
  const p = await one(db, `select * from payments where stripe_payment_intent_id = 'pi_declined'`);
  assert.equal(p.failure_count, 1);
  assert.equal(p.last_error_code, 'card_declined');
  assert.equal((await one(db, 'select paid from client_portal_invoices where id = 2')).paid, false);
  const s = await one(db, 'select payment_status, net_paid_cents from invoice_payment_status where invoice_id = 102');
  assert.deepEqual([s.payment_status, Number(s.net_paid_cents)], ['unpaid', 0]);
});

test('a failed event delivered after the success never downgrades the payment', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  await h.recordEvent(db, h.fixture('pi_failed_single_late'));
  const p = await one(db, `select status, failure_count from payments where stripe_payment_intent_id = 'pi_single'`);
  assert.equal(p.status, 'succeeded');
  assert.equal(p.failure_count, 1, 'the attempt is still counted');
  assert.equal((await one(db, 'select paid from client_portal_invoices where id = 1')).paid, true);
});

test('failed first, then succeeded on the same PaymentIntent: ends succeeded and paid', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_failed_single_late'));
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  assert.equal((await one(db, `select status from payments where stripe_payment_intent_id = 'pi_single'`)).status, 'succeeded');
  assert.equal((await one(db, 'select paid from client_portal_invoices where id = 1')).paid, true);
});

// ---- refunds ---------------------------------------------------------------

test('partial refund: refund row, invoice shows partial refund, paid stays true, net paid drops', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  const r = await h.recordEvent(db, h.fixture('charge_refunded_partial'), h.fixture('charge_refunded_partial_refunds'));
  assert.equal(r.action, 'refund');
  assert.equal(r.invoices[0].refund_status, 'partial');
  const cpi = await one(db, 'select paid, refunded_amount, refund_status from client_portal_invoices where id = 1');
  assert.deepEqual([cpi.paid, Number(cpi.refunded_amount), cpi.refund_status], [true, 50, 'partial']);
  const inv = await one(db, 'select paid, paid_amount, refunded_amount, refund_status from invoices where id = 101');
  assert.deepEqual([inv.paid, Number(inv.paid_amount), Number(inv.refunded_amount), inv.refund_status], [true, 150, 50, 'partial'],
    'paid / paid_amount are not lowered (that would trigger payment-reminder emails)');
  const s = await one(db, 'select * from invoice_payment_status where invoice_id = 101');
  assert.deepEqual([s.payment_status, Number(s.net_paid_cents), Number(s.refunded_cents)], ['partially_refunded', 10000, 5000]);
  assert.equal((await one(db, `select receipt_url from payments where stripe_payment_intent_id = 'pi_single'`)).receipt_url,
    'https://pay.stripe.com/receipts/redacted/ch_single');
});

test('full refund (second refund on the same charge): refunded status and net paid 0', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  await h.recordEvent(db, h.fixture('charge_refunded_partial'), h.fixture('charge_refunded_partial_refunds'));
  await h.recordEvent(db, h.fixture('charge_refunded_full'), h.fixture('charge_refunded_full_refunds'));
  assert.equal((await one(db, 'select count(*)::int n from refunds')).n, 2, 're_partial is upserted once, not duplicated');
  const cpi = await one(db, 'select paid, refunded_amount, refund_status from client_portal_invoices where id = 1');
  assert.deepEqual([cpi.paid, Number(cpi.refunded_amount), cpi.refund_status], [true, 150, 'full']);
  const s = await one(db, 'select payment_status, net_paid_cents from invoice_payment_status where invoice_id = 101');
  assert.deepEqual([s.payment_status, Number(s.net_paid_cents)], ['refunded', 0]);
});

test('charge.refunded without the refund list fails (ledger error, 500 to Stripe) instead of under-recording', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  const r = await h.recordEvent(db, h.fixture('charge_refunded_partial'));
  assert.match(r.error, /refund list .* is incomplete/);
  const ev = await one(db, `select processed_at, error, attempts from stripe_events where event_id = 'evt_1ChargeRefundedPartial'`);
  assert.equal(ev.processed_at, null);
  assert.ok(ev.error);
  assert.equal((await one(db, 'select count(*)::int n from refunds')).n, 0, 'the failed attempt left nothing half-written');
  // Stripe retries; this time the webhook got the list.
  const retry = await h.recordEvent(db, h.fixture('charge_refunded_partial'), h.fixture('charge_refunded_partial_refunds'));
  assert.equal(retry.error, undefined);
  const ev2 = await one(db, `select processed_at, error, attempts from stripe_events where event_id = 'evt_1ChargeRefundedPartial'`);
  assert.ok(ev2.processed_at);
  assert.equal(ev2.error, null);
  assert.equal(ev2.attempts, 2);
});

test('a refund that later fails (refund.updated) gives the money back to the invoice', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  await h.recordEvent(db, h.fixture('charge_refunded_partial'), h.fixture('charge_refunded_partial_refunds'));
  await h.recordEvent(db, h.fixture('refund_failed'));
  assert.equal((await one(db, `select status from refunds where stripe_refund_id = 're_partial'`)).status, 'failed');
  const cpi = await one(db, 'select refunded_amount, refund_status from client_portal_invoices where id = 1');
  assert.deepEqual([Number(cpi.refunded_amount), cpi.refund_status], [0, 'none']);
  assert.equal(Number((await one(db, 'select net_paid_cents from invoice_payment_status where invoice_id = 101')).net_paid_cents), 15000);
});

test('refund.updated for a payment with no record yet is a recorded warning, not a $0 "fully refunded" stub', async () => {
  const db = await h.buildDb();
  const r = await h.recordEvent(db, h.fixture('refund_failed'));
  assert.match(r.warning, /no payment on record for pi_single/);
  assert.equal((await one(db, `select count(*)::int n from payments where stripe_payment_intent_id = 'pi_single'`)).n, 0);
  assert.equal((await one(db, 'select refund_status from client_portal_invoices where id = 1')).refund_status, 'none');
  assert.ok((await one(db, `select processed_at from stripe_events where event_id = 'evt_1RefundFailed'`)).processed_at);
});

test('a partial refund of a Pay All Outstanding payment is split pro rata across its invoices', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_bulk'));
  await h.recordEvent(db, h.fixture('charge_refunded_bulk_partial'), h.fixture('charge_refunded_bulk_partial_refunds'));
  const rows = await q(db, 'select id, refunded_amount, refund_status from client_portal_invoices where id in (2,3) order by id');
  assert.deepEqual(rows.map((r) => [r.id, Number(r.refunded_amount), r.refund_status]), [[2, 12, 'partial'], [3, 18, 'partial']]);
});

test('a refund delivered BEFORE its payment_intent.succeeded still lands on the right invoice', async () => {
  const db = await h.buildDb();
  const r = await h.recordEvent(db, h.fixture('charge_refunded_partial'), h.fixture('charge_refunded_partial_refunds'));
  assert.equal(r.error, undefined);
  assert.equal((await one(db, 'select refund_status from client_portal_invoices where id = 1')).refund_status, 'partial');
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  assert.equal((await one(db, 'select count(*)::int n from payments where stripe_payment_intent_id = $1', ['pi_single'])).n, 1);
  assert.equal((await one(db, 'select paid from client_portal_invoices where id = 1')).paid, true);
});

// ---- disputes --------------------------------------------------------------

test('dispute created: recorded, funds counted as withdrawn, invoice shows disputed; dispute won restores net paid', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_bulk'));
  const r = await h.recordEvent(db, h.fixture('dispute_created'));
  assert.equal(r.action, 'dispute');
  assert.equal(r.first_seen, true);
  assert.equal(r.status, 'needs_response');
  assert.ok(r.evidence_due_by);
  let s = await one(db, 'select payment_status, net_paid_cents, disputed_cents from invoice_payment_status where invoice_id = 102');
  assert.deepEqual([s.payment_status, Number(s.net_paid_cents), Number(s.disputed_cents)], ['disputed', 0, 4000]);
  await h.recordEvent(db, h.fixture('dispute_won'));
  assert.equal((await one(db, 'select count(*)::int n from payment_disputes')).n, 1);
  s = await one(db, 'select payment_status, net_paid_cents from invoice_payment_status where invoice_id = 102');
  assert.deepEqual([s.payment_status, Number(s.net_paid_cents)], ['paid', 4000]);
});

test('an older dispute event delivered late does not reopen a closed dispute', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_bulk'));
  await h.recordEvent(db, h.fixture('dispute_won'));
  await h.recordEvent(db, h.fixture('dispute_created'));
  assert.equal((await one(db, 'select status from payment_disputes')).status, 'won');
});

// ---- other -----------------------------------------------------------------

test('an event type with no handler is recorded as ignored and processed', async () => {
  const db = await h.buildDb();
  const r = await h.recordEvent(db, h.fixture('customer_created'));
  assert.equal(r.action, 'ignored');
  const ev = await one(db, `select outcome, processed_at from stripe_events where event_id = 'evt_1CustomerCreated'`);
  assert.equal(ev.outcome, 'ignored');
  assert.ok(ev.processed_at);
});

test('a malformed event is rejected outright (nothing written)', async () => {
  const db = await h.buildDb();
  await assert.rejects(h.recordEvent(db, { id: 'not-an-event', type: 'x', data: { object: {} } }), /malformed event/);
  assert.equal((await one(db, 'select count(*)::int n from stripe_events')).n, 0);
});

test('invoices with no Stripe payment fall back to paid_amount (cash/check) in the net-paid view', async () => {
  const db = await h.buildDb();
  await db.exec(`update invoices set paid = true, paid_amount = 40 where id = 102`);
  const s = await one(db, 'select paid_via, payment_status, net_paid_cents from invoice_payment_status where invoice_id = 102');
  assert.deepEqual([s.paid_via, s.payment_status, Number(s.net_paid_cents)], ['manual', 'paid', 4000]);
});

// ---- access ----------------------------------------------------------------

const NEW_TABLES = ['stripe_events', 'payments', 'payment_allocations', 'refunds', 'payment_disputes'];

test('RLS is enabled on every new table', async () => {
  const db = await h.buildDb();
  const rows = await q(db, `select relname, relrowsecurity from pg_class where relname = any($1) order by relname`, [NEW_TABLES]);
  assert.equal(rows.length, NEW_TABLES.length);
  assert.ok(rows.every((r) => r.relrowsecurity), JSON.stringify(rows));
});

test('staff in the same tenant can read the ledger, payments and the net-paid view', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  for (const t of NEW_TABLES) {
    const rows = await h.as(db, h.STAFF, `select count(*)::int n from ${t}`);
    assert.ok(!rows.error, `${t}: ${rows.error}`);
  }
  assert.equal((await h.as(db, h.STAFF, 'select count(*)::int n from payments'))[0].n, 2);
  assert.equal((await h.as(db, h.STAFF, `select payment_status from invoice_payment_status where invoice_id = 101`))[0].payment_status, 'paid');
  assert.equal((await h.as(db, h.CLIENT, `select count(*)::int n from invoice_payment_status`))[0].n, 0,
    'security_invoker: a client gets nothing, because public.invoices is staff-only');
  assert.equal((await h.as(db, h.OTHER_STAFF, `select count(*)::int n from invoice_payment_status`))[0].n, 0);
});

test('a client, another tenant\'s staff and anon see nothing; nobody but service_role can write or call the RPC', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  for (const who of [h.CLIENT, h.OTHER_STAFF]) {
    for (const t of NEW_TABLES) {
      const rows = await h.as(db, who, `select count(*)::int n from ${t}`);
      assert.equal(rows[0].n, 0, `${who.email} read ${t}`);
    }
  }
  for (const t of NEW_TABLES) {
    const r = await h.as(db, { role: 'anon' }, `select 1 from ${t}`);
    assert.ok(r.error, `anon could read ${t}`);
  }
  for (const who of [h.STAFF, h.CLIENT, { role: 'anon' }]) {
    const ins = await h.as(db, who, `insert into payments (kind, stripe_payment_intent_id, amount_cents, status) values ('unknown', 'pi_x', 1, 'succeeded')`);
    assert.ok(ins.error, `${who.email || who.role} could insert into payments`);
    const del = await h.as(db, who, `delete from stripe_events`);
    assert.ok(del.error, `${who.email || who.role} could delete from stripe_events`);
    const rpc = await h.as(db, who, `select public.stripe_record_event('{}'::jsonb, null)`);
    assert.match(String(rpc.error?.message), /permission denied/, `${who.email || who.role} could call stripe_record_event`);
  }
});

test('the client can still read their own portal invoice, now carrying refund columns', async () => {
  const db = await h.buildDb();
  await h.recordEvent(db, h.fixture('pi_succeeded_single'));
  await h.recordEvent(db, h.fixture('charge_refunded_partial'), h.fixture('charge_refunded_partial_refunds'));
  const rows = await h.as(db, h.CLIENT, 'select id, refund_status, refunded_amount from client_portal_invoices order by id');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].refund_status, 'partial');
});
