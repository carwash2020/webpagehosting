// Fix plan Group 4, RP1.3 / RP1.8 / RP1.10 (2026-11-07): runs the real
// sql/payments/03_portal_balance_and_sent.sql in PGlite on top of the Stripe
// ledger migration (stripe-db-harness.js). Made-up invoices only.
//
// What is proved, against the database:
//   - a part payment recorded on the invoice shows on the portal copy;
//   - Stripe paying just the balance marks it paid (not "paid short"), and
//     paying the full total again is flagged as overpaid;
//   - Pay All splits a payment by what each invoice still owed;
//   - a portal row being made stamps the invoice as sent, once;
//   - the backfills: paid-with-no-amount gets the total, fractional cents
//     round, existing portal rows get their paid amount and sent date.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./stripe-db-harness');

after(h.closeAll);

const G4 = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'payments', '03_portal_balance_and_sent.sql'), 'utf8');
const G4B = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'payments', '03b_round_real_invoice_amounts.sql'), 'utf8');
const q = async (db, sql, params) => (await db.query(sql, params)).rows;
const one = async (db, sql, params) => (await q(db, sql, params))[0];

async function build(before) {
  const db = await h.buildDb();
  if (before) await db.exec(before);
  await db.exec(G4);
  await db.exec(G4); // re-runnable
  return db;
}

// A payment_intent.succeeded for portal invoice(s), as Stripe sends it.
function succeeded(id, cents, meta) {
  const ev = h.fixture('pi_succeeded_single');
  ev.id = 'evt_' + id;
  Object.assign(ev.data.object, { id, amount: cents, amount_received: cents, metadata: meta, latest_charge: 'ch_' + id });
  return ev;
}

test('a part payment recorded in the Workspace shows on the portal copy, rounded to the cent', async () => {
  const db = await build();
  await db.exec('update invoices set paid_amount = 50.004 where id = 101');
  assert.equal(Number((await one(db, 'select paid_amount from client_portal_invoices where id = 1')).paid_amount), 50);
});

test('Stripe paying the balance of a part-paid invoice marks it paid; paying the whole total again is flagged as overpaid', async () => {
  let db = await build();
  await db.exec('update invoices set paid_amount = 50 where id = 101'); // $150 invoice, $50 paid in cash
  let r = await h.recordEvent(db, succeeded('pi_bal', 10000, { client_portal_invoice_id: '1' }));
  assert.equal(r.amount_mismatch, null);
  assert.equal(r.owed_cents, 10000);
  assert.equal(r.invoices_marked_paid.length, 1);
  const cpi = await one(db, 'select paid, paid_amount from client_portal_invoices where id = 1');
  assert.deepEqual([cpi.paid, Number(cpi.paid_amount)], [true, 150]);
  assert.equal(Number((await one(db, 'select paid_amount from invoices where id = 101')).paid_amount), 150);

  db = await build();
  await db.exec('update invoices set paid_amount = 50 where id = 101');
  r = await h.recordEvent(db, succeeded('pi_full', 15000, { client_portal_invoice_id: '1' }));
  assert.equal(r.amount_mismatch, 'overpaid', 'the staff alert fires: $50 may need a refund');
});

test('a payment short of the balance still leaves the invoice unpaid', async () => {
  const db = await build();
  await db.exec('update invoices set paid_amount = 50 where id = 101');
  const r = await h.recordEvent(db, succeeded('pi_short2', 9000, { client_portal_invoice_id: '1' }));
  assert.equal(r.amount_mismatch, 'underpaid');
  assert.equal(r.owed_cents, 10000);
  assert.equal((await one(db, 'select paid from client_portal_invoices where id = 1')).paid, false);
});

test('Pay All splits the payment by what each invoice still owed', async () => {
  const db = await build();
  await db.exec('update invoices set paid_amount = 20 where id = 102'); // $40 invoice, $20 left; $60 invoice, $60 left
  const r = await h.recordEvent(db, succeeded('pi_bulk', 8000, {}));
  assert.equal(r.invoices_marked_paid.length, 2);
  const allocs = await q(db, `select a.client_portal_invoice_id, a.amount_cents from payment_allocations a
    join payments p on p.id = a.payment_id where p.stripe_payment_intent_id = 'pi_bulk' order by 1`);
  assert.deepEqual(allocs.map((a) => [a.client_portal_invoice_id, Number(a.amount_cents)]), [[2, 2000], [3, 6000]]);
});

test('the first portal row for an invoice stamps it as sent, once; the portal row starts with what was already paid', async () => {
  const db = await build();
  await db.exec(`insert into invoices (id, invoice_number, client_email, total, paid_amount, tenant_id) values (105, 'INV-105', 'pat@example.com', 90, 30, '${h.TRIPLE_H}')`);
  assert.equal((await one(db, 'select sent_at from invoices where id = 105')).sent_at, null, 'not sent yet');
  await db.exec(`insert into client_portal_invoices (id, source_invoice_id, client_email, invoice_number, total, tenant_id) values (5, 105, 'pat@example.com', 'INV-105', 90, '${h.TRIPLE_H}')`);
  const first = (await one(db, 'select sent_at from invoices where id = 105')).sent_at;
  assert.ok(first);
  assert.equal(Number((await one(db, 'select paid_amount from client_portal_invoices where id = 5')).paid_amount), 30);
  await db.exec(`update client_portal_invoices set total = 91 where id = 5`);
  assert.equal(String((await one(db, 'select sent_at from invoices where id = 105')).sent_at), String(first), 'a resend keeps the first date');
});

test('03 alone changes no existing amount; 03b rounds fractional cents and gives a paid invoice with no amount its total', async () => {
  const db = await build(`
    insert into invoices (id, invoice_number, client_email, total, paid, paid_amount, tenant_id) values
      (106, 'INV-106', 'pat@example.com', 125.0025, true, 125, '${h.TRIPLE_H}'),
      (107, 'INV-107', 'pat@example.com', 1.60125, true, null, '${h.TRIPLE_H}');
    insert into client_portal_invoices (id, source_invoice_id, client_email, invoice_number, total, paid, tenant_id) values
      (7, 107, 'pat@example.com', 'INV-107', 1.60125, true, '${h.TRIPLE_H}');
  `);
  let inv = await q(db, 'select id, total, paid_amount from invoices where id in (106, 107) order by id');
  assert.deepEqual(inv.map((r) => [Number(r.total), r.paid_amount == null ? null : Number(r.paid_amount)]), [[125.0025, 125], [1.60125, null]]);
  assert.equal(Number((await one(db, 'select paid_amount from client_portal_invoices where id = 7')).paid_amount), 1.60125, 'new column only: the paid portal row gets its total');
  await db.exec(G4B);
  await db.exec(G4B); // re-runnable
  inv = await q(db, 'select id, total, paid_amount from invoices where id in (106, 107) order by id');
  assert.deepEqual(inv.map((r) => [Number(r.total), Number(r.paid_amount)]), [[125, 125], [1.6, 1.6]]);
  const cpi = await one(db, 'select total, paid_amount from client_portal_invoices where id = 7');
  assert.deepEqual([Number(cpi.total), Number(cpi.paid_amount)], [1.6, 1.6]);
});

test('backfill of the new columns: existing portal rows get paid amount and sent date', async () => {
  const db = await build(`
    insert into invoices (id, invoice_number, client_email, total, paid, paid_amount, tenant_id) values
      (106, 'INV-106', 'pat@example.com', 125, true, 125, '${h.TRIPLE_H}'),
      (107, 'INV-107', 'pat@example.com', 70, true, 70, '${h.TRIPLE_H}');
    insert into client_portal_invoices (id, source_invoice_id, client_email, invoice_number, total, paid, created_at, tenant_id) values
      (6, 106, 'pat@example.com', 'INV-106', 125, true, '2026-10-02T10:00:00Z', '${h.TRIPLE_H}');
    update invoices set paid_amount = 40 where id = 104;
  `);
  const inv = await q(db, 'select id, total, paid_amount, sent_at from invoices where id in (101, 104, 106, 107) order by id');
  assert.deepEqual(inv.map((r) => [Number(r.id), Number(r.total), r.paid_amount == null ? null : Number(r.paid_amount)]), [
    [101, 150, 0], [104, 80, 40], [106, 125, 125], [107, 70, 70],
  ]);
  assert.equal(new Date(inv[2].sent_at).toISOString(), '2026-10-02T10:00:00.000Z', 'sent date from the portal row');
  assert.equal(inv[3].sent_at, null, 'never reached the portal: not sent');
  const cpi = await q(db, 'select id, total, paid_amount from client_portal_invoices where id in (1, 4, 6) order by id');
  assert.deepEqual(cpi.map((r) => [Number(r.id), Number(r.total), Number(r.paid_amount)]), [[1, 150, 0], [4, 80, 40], [6, 125, 125]]);
});

test('the new trigger functions are not callable through the API', async () => {
  const db = await build();
  for (const fn of ['portal_invoice_follow_payment', 'portal_invoice_on_send']) {
    const r = await one(db, "select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b", ['public.' + fn + '()']);
    assert.deepEqual([r.a, r.b], [false, false], fn);
  }
  const r = await one(db, "select has_function_privilege('authenticated', 'public.stripe_apply_pi_succeeded(jsonb, timestamptz)', 'execute') a");
  assert.equal(r.a, false);
});
