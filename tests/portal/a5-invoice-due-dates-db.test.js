// Fix plan A5 (2026-11-07): runs sql/portal/a5_invoice_due_dates.sql in
// PGlite on the Stripe harness's made-up invoices. A client sees the due
// dates of their own invoices only, worked out from the Workspace terms the
// same way the pay page does.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('../payments/stripe-db-harness');

after(h.closeAll);
const A5 = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'portal', 'a5_invoice_due_dates.sql'), 'utf8');

async function build() {
  const db = await h.buildDb();
  await db.exec(`
    alter table public.invoices add column terms text;
    create function public.client_portal_my_emails() returns text[] language sql stable security definer set search_path = '' as $$
      select array[lower(coalesce((select auth.email()), ''))] $$;
    update public.client_portal_invoices set invoice_date = '2026-11-05';
    update public.invoices set terms = 'Net 15' where id = 101;
    update public.invoices set terms = 'Due Upon Receipt' where id = 102;
    update public.invoices set terms = 'Net 30' where id = 103;
    update public.invoices set terms = 'Something odd' where id = 104;
    insert into public.invoices (id, invoice_number, client_email, total, terms, tenant_id) values (201, 'INV-201', 'sam@example.com', 10, 'Net 15', '${h.TRIPLE_H}');
    insert into public.client_portal_invoices (id, source_invoice_id, client_email, invoice_number, invoice_date, total, tenant_id) values (21, 201, 'sam@example.com', 'INV-201', '2026-11-05', 10, '${h.TRIPLE_H}');
  `);
  await db.exec(A5);
  await db.exec(A5); // re-runnable
  return db;
}
const client = (email) => ({ role: 'authenticated', email });

test('a client gets the due date of each of their invoices, from its terms', async () => {
  const db = await build();
  const rows = await h.as(db, client('pat@example.com'), 'select id, due_date::text as d from public.client_portal_my_invoice_due_dates() order by id');
  assert.ok(!rows.error, rows.error && rows.error.message);
  // Portal rows 3 and 4 have no tenant (as 4 of 7 live rows do): they still
  // match their own invoice. Row 4's odd terms count as Net 15.
  assert.deepEqual(rows.map((r) => [Number(r.id), r.d]), [[1, '2026-11-20'], [2, '2026-11-05'], [3, '2026-12-05'], [4, '2026-11-20']]);
});

test('a portal row whose tenant differs from its invoice gets no date', async () => {
  const db = await build();
  await db.exec(`update public.client_portal_invoices set tenant_id = '${h.OTHER}' where id = 1`);
  const rows = await h.as(db, client('pat@example.com'), 'select id from public.client_portal_my_invoice_due_dates() where id = 1');
  assert.equal(rows.length, 0);
});

test('unknown terms count as Net 15, as on the pay page', async () => {
  const db = await build();
  await db.exec("update public.invoices set terms = 'Something odd' where id = 101");
  const rows = await h.as(db, client('pat@example.com'), 'select due_date::text as d from public.client_portal_my_invoice_due_dates() where id = 1');
  assert.equal(rows[0].d, '2026-11-20');
});

test('a client never sees another client\'s invoices', async () => {
  const db = await build();
  const rows = await h.as(db, client('sam@example.com'), 'select id from public.client_portal_my_invoice_due_dates()');
  assert.deepEqual(rows.map((r) => Number(r.id)), [21]);
});

test('anon cannot call it', async () => {
  const db = await build();
  const rows = await h.as(db, { role: 'anon' }, 'select * from public.client_portal_my_invoice_due_dates()');
  assert.ok(rows.error, 'anon should be refused');
});
