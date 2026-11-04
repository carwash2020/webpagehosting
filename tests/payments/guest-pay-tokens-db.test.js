// sql/payments/02_guest_pay_tokens.sql run for real in PGlite (2026-11-04,
// handoff §3A). The pay code is the only key to /pay/, so the database
// itself holds the rules: one code opens one invoice, and only the shape
// guest-pay accepts can be stored.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'payments', '02_guest_pay_tokens.sql'), 'utf8');

const db = new PGlite();
after(() => db.close());

async function fresh() {
  await db.exec(`
    drop table if exists public.client_portal_invoices;
    create table public.client_portal_invoices (
      id bigserial primary key, source_invoice_id bigint unique, client_email text, invoice_number text,
      total numeric, paid boolean default false
    );
    insert into public.client_portal_invoices (source_invoice_id, client_email, invoice_number, total)
      values (1, 'tony@example.com', 'INV-2026-1112', 300), (2, 'jane@example.com', 'INV-2026-1113', 120);
  `);
}

test('adds pay_token; existing invoices keep a null code', async () => {
  await fresh();
  await db.exec(SQL);
  const r = await db.query('select count(*)::int n from client_portal_invoices where pay_token is null');
  assert.equal(r.rows[0].n, 2);
});

test('it runs twice without error (safe to re-apply)', async () => {
  await fresh();
  await db.exec(SQL);
  await db.exec(SQL);
});

test('one code can only ever open one invoice', async () => {
  await fresh();
  await db.exec(SQL);
  await db.query("update client_portal_invoices set pay_token = 'k7f3qm2xw9' where source_invoice_id = 1");
  await assert.rejects(db.query("update client_portal_invoices set pay_token = 'k7f3qm2xw9' where source_invoice_id = 2"), /unique|duplicate/i);
});

test('only the shape guest-pay accepts can be stored', async () => {
  await fresh();
  await db.exec(SQL);
  for (const bad of ['short', 'K7F3QM2XW9', 'k7f3qm2xw0', "k7f3qm2xw9' or 1=1", 'l1oi0l1oi0']) {
    await assert.rejects(db.query('update client_portal_invoices set pay_token = $1 where source_invoice_id = 1', [bad]), /check|violates/i, bad);
  }
  await db.query("update client_portal_invoices set pay_token = 'abcdefghjk' where source_invoice_id = 1");
});

test('the check matches guest-pay, sync-invoice-to-portal and the invoice email exactly', () => {
  const root = path.join(__dirname, '..', '..', 'edge-functions');
  const shape = '[a-hjkmnp-z2-9]{10,40}';
  assert.ok(SQL.includes(`'^${shape}$'`));
  for (const f of ['guest-pay-index.ts', 'sync-invoice-to-portal-index.ts', 'send-invoice-notification-index.ts']) {
    assert.ok(fs.readFileSync(path.join(root, f), 'utf8').includes(`/^${shape}$/`), f);
  }
});
