// Fix plan A3 (2026-11-07), found verifying it live: portal mirror rows
// written by edge functions (service_role, no staff session) had no
// tenant_id, so internal_read_client_portal_*() -- which return only
// tenant_id = current_tenant_id() -- hid them from staff, and the Workspace
// said "Never sent to portal" about INV-2026-1174. Runs
// sql/multi-tenant/08_portal_tables_tenant_id.sql in PGlite on the Stripe
// harness. Made-up rows only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('../payments/stripe-db-harness');

after(h.closeAll);
const B8 = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'multi-tenant', '08_portal_tables_tenant_id.sql'), 'utf8');

// The live staff read, verbatim.
const INTERNAL_READ = `
  create function public.internal_read_client_portal_invoices() returns setof public.client_portal_invoices
  language sql stable security definer set search_path to 'public' as $$
    select * from public.client_portal_invoices where public.current_user_has_any_role() and tenant_id = public.current_tenant_id();
  $$;`;
const OTHER_PORTAL_TABLES = `
  create table public.quotes (id bigint primary key, tenant_id uuid);
  create table public.contracts (id bigint primary key, tenant_id uuid);
  create table public.client_portal_quotes (id bigint primary key, source_quote_id bigint, client_email text, tenant_id uuid);
  create table public.client_portal_contracts (id bigint primary key, source_contract_id bigint, client_email text, tenant_id uuid);
  create table public.client_portal_jobs (id bigint primary key, client_email text, tenant_id uuid);
  create table public.client_portal_checkups (id bigint primary key, client_email text, tenant_id uuid);
  create table public.client_portal_work_orders (id bigint primary key, client_email text, tenant_id uuid);
`;
const STAFF = { role: 'authenticated', email: h.STAFF.email };

async function build() {
  const db = await h.buildDb();
  await db.exec(INTERNAL_READ + OTHER_PORTAL_TABLES);
  await db.exec(`grant execute on function public.internal_read_client_portal_invoices() to authenticated;`);
  // Portal rows 3 and 4 have no tenant, as live rows 13/15/17/18 did; a quote
  // and a contract too, one of each with no source row.
  await db.exec(`
    insert into public.quotes values (31, '${h.TRIPLE_H}');
    insert into public.client_portal_quotes values (1, 31, 'pat@example.com', null), (2, 999, 'pat@example.com', null);
    insert into public.client_portal_contracts values (1, 888, 'pat@example.com', null);
  `);
  return db;
}
const visible = async (db) => (await h.as(db, STAFF, 'select id from public.internal_read_client_portal_invoices() order by id')).map((r) => Number(r.id));

test('before: staff cannot see portal invoices that have no tenant (the A3 badge bug)', async () => {
  const db = await build();
  assert.deepEqual(await visible(db), [1, 2]);
});

test('after: the backfill gives each portal invoice its own invoice\'s tenant, and staff see all of them', async () => {
  const db = await build();
  await db.exec(B8);
  await db.exec(B8); // re-runnable
  assert.deepEqual(await visible(db), [1, 2, 3, 4]);
  const t = (await db.query('select id, tenant_id::text as t from public.client_portal_invoices order by id')).rows;
  // Rows 3 and 4 take their invoices' (103, 104) Triple H tenant.
  assert.ok(t.every((r) => r.t === h.TRIPLE_H), JSON.stringify(t));
});

test('after: quotes and contracts are filled from their source row, else the default; a set tenant is never changed', async () => {
  const db = await build();
  await db.exec(`update public.client_portal_invoices set tenant_id = '${h.OTHER}' where id = 1`);
  await db.exec(B8);
  assert.equal((await db.query('select tenant_id::text t from public.client_portal_invoices where id = 1')).rows[0].t, h.OTHER, 'an existing tenant stays');
  const q = (await db.query('select id, tenant_id::text t from public.client_portal_quotes order by id')).rows;
  assert.deepEqual(q.map((r) => r.t), [h.TRIPLE_H, h.TRIPLE_H]);
  const c = (await db.query('select tenant_id::text t from public.client_portal_contracts')).rows;
  assert.equal(c[0].t, h.TRIPLE_H);
});

test('after: a new portal row written with no staff session (as the edge functions do) gets the Triple H tenant', async () => {
  const db = await build();
  await db.exec(B8);
  for (const [tbl, cols, vals] of [
    ['client_portal_invoices', 'id, source_invoice_id, client_email, invoice_number, total', `50, 150, 'x@example.com', 'INV-X', 1`],
    ['client_portal_quotes', 'id, client_email', `50, 'x@example.com'`],
    ['client_portal_contracts', 'id, client_email', `50, 'x@example.com'`],
    ['client_portal_jobs', 'id, client_email', `50, 'x@example.com'`],
    ['client_portal_checkups', 'id, client_email', `50, 'x@example.com'`],
    ['client_portal_work_orders', 'id, client_email', `50, 'x@example.com'`],
  ]) {
    const r = await h.as(db, { role: 'service_role' }, `insert into public.${tbl} (${cols}) values (${vals}) returning tenant_id::text as t`);
    assert.ok(!r.error, tbl + ': ' + (r.error && r.error.message));
    assert.equal(r[0].t, h.TRIPLE_H, tbl);
  }
});
