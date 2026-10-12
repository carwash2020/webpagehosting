// sql/item1/05_client_id_uuid_fk.sql (Item 1 Phase 1a, step 2): jobs,
// invoices and quotes' client_id moves from the old free-text 'c_...'
// registry id to a real uuid FK into clients(id). Also removes the step 1
// transition machinery (copy_client_id_to_legacy trigger/function and the
// legacy_client_id_writes log) whose only job was watching for old-tab
// writes this step makes impossible.
//
// Runs the real batch 04 default-tenant function, 06, 07 and item1/01-05 in
// PGlite, against the live policy shapes.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SQL = path.join(__dirname, '..', '..', 'sql');
const read = (...p) => fs.readFileSync(path.join(SQL, ...p), 'utf8');
const BATCH_04 = read('multi-tenant', '04_fixes_defaults_and_remaining_triggers.sql');
const BATCH_06 = read('multi-tenant', '06_tenant_id_from_session_top_level_tables.sql');
const BATCH_07 = read('multi-tenant', '07_tenant_id_fallback_for_sessionless_inserts.sql');
const ITEM1 = ['01_clients_table_and_legacy_client_id.sql', '02_client_seeding_and_duplicate_candidates.sql',
  '03_client_review_actions.sql', '04_one_client_per_email.sql', '05_client_id_uuid_fk.sql'].map((f) => read('item1', f));
const DEFAULT_TENANT_FN = BATCH_04.match(
  /create or replace function public\.default_tenant_id_triple_h\(\)[\s\S]*?grant execute on function public\.default_tenant_id_triple_h\(\)[^;]*;/)[0];

const TRIPLE_H = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const STAFF = { email: 'staff@triplehenterprisesllc.biz', role: 'authenticated' };

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;

  create table public.tenants (id uuid primary key, slug text unique);
  insert into public.tenants values ('${TRIPLE_H}', 'triple-h'), ('${OTHER}', 'other');

  create table public.account_roles (email text primary key, tenant_id uuid references public.tenants(id),
    can_manage_invoices boolean not null default false);
  insert into public.account_roles values ('${STAFF.email}', '${TRIPLE_H}', true);
  alter table public.account_roles enable row level security;
  grant select on public.account_roles to authenticated;
  create policy own_role on public.account_roles for select to authenticated
    using (email = (select auth.email()));

  create function public.current_tenant_id() returns uuid language sql security definer
    set search_path = public stable as $$
    select ar.tenant_id from public.account_roles ar where ar.email = (select auth.jwt() ->> 'email') limit 1;
  $$;
  revoke execute on function public.current_tenant_id() from public, anon;
  grant execute on function public.current_tenant_id() to authenticated;

  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

  create table public.workspace_sync (code text primary key, data jsonb, updated_at timestamptz default now());
`;

const EXTRA_COLUMNS = {
  jobs: 'client text, client_id text, client_email text, phone text, address text, created_at timestamptz default now(),',
  invoices: 'client_name text, client_id text, client_email text, created_at timestamptz default now(),',
  quotes: 'client_name text, client_id text, client_email text, created_at timestamptz default now(),',
  contracts: 'fields jsonb, created_at timestamptz default now(),',
};
const TEN = ['jobs', 'invoices', 'quotes', 'contracts', 'referrals', 'th_job_photos', 'th_bookings',
  'push_subscriptions', 'notification_recipients', 'client_account_codes'];
const tableSql = (t) => `
  create table public.${t} (id bigint primary key, ${EXTRA_COLUMNS[t] || ''} tenant_id uuid references public.tenants(id));
  alter table public.${t} enable row level security;
  create policy staff_all on public.${t} for all to authenticated
    using (exists (select 1 from account_roles where email = (select auth.email()))
           and tenant_id = (select public.current_tenant_id()))
    with check (exists (select 1 from account_roles where email = (select auth.email()))
                and tenant_id = (select public.current_tenant_id()));`;

async function as(db, claims, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || {})]);
    if (claims) await db.exec(`set local role ${claims.role}`);
    const r = await db.query(sql, params);
    await db.exec('commit');
    return r.rows;
  } catch (error) {
    await db.exec('rollback');
    return { error };
  }
}

const dbs = [];
after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

async function buildDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  dbs.push(db);
  await db.exec(BASE_SCHEMA);
  await db.exec(DEFAULT_TENANT_FN);
  for (const t of TEN) await db.exec(tableSql(t));
  await db.exec(`create table public.client_profiles (client_email text primary key, display_name text,
    phone text, updated_at timestamptz, tenant_id uuid references public.tenants(id));`);
  await db.exec(BATCH_06);
  await db.exec(BATCH_07);
  for (const f of ITEM1) await db.exec(f);
  return db;
}

test('client_id on jobs/invoices/quotes is now a real uuid FK into clients, not text', async () => {
  const db = await buildDb();
  const r = await db.query(`select table_name, data_type from information_schema.columns
    where table_schema = 'public' and table_name in ('jobs', 'invoices', 'quotes') and column_name = 'client_id'
    order by table_name`);
  assert.deepEqual(r.rows, [
    { table_name: 'invoices', data_type: 'uuid' },
    { table_name: 'jobs', data_type: 'uuid' },
    { table_name: 'quotes', data_type: 'uuid' },
  ]);
  // legacy_client_id (the display/history column) is untouched by this step.
  const legacy = await db.query(`select table_name, data_type from information_schema.columns
    where table_schema = 'public' and table_name in ('jobs', 'invoices', 'quotes') and column_name = 'legacy_client_id'`);
  assert.equal(legacy.rows.length, 3);
  assert.ok(legacy.rows.every((row) => row.data_type === 'text'));
});

test('a job whose legacy_client_id matches a live client backfills to that client\'s real id', async () => {
  const db = await buildDb();
  const clientId = (await as(db, STAFF,
    `insert into public.clients (display_name, legacy_id) values ('Sarah Miller', 'c_sarah') returning id`))[0].id;
  // The backfill in 05 only runs once, at migration time -- re-run it by hand
  // here (same statement the migration uses) against a row inserted after
  // the migration already ran, which is exactly what this test needs to do
  // since PGlite applies the whole file list once per buildDb() call.
  await as(db, STAFF, `insert into public.jobs (id, legacy_client_id, tenant_id) values (1, 'c_sarah', '${TRIPLE_H}')`);
  await db.exec(`update public.jobs j set client_id = coalesce(c.merged_into_id, c.id)
    from public.clients c where c.legacy_id = j.legacy_client_id and j.client_id is null`);
  const row = (await as(db, STAFF, `select client_id from public.jobs where id = 1`))[0];
  assert.equal(row.client_id, clientId);
});

test('a legacy_client_id resolves through merged_into_id to the live survivor (merges never chain)', async () => {
  const db = await buildDb();
  const survivor = (await as(db, STAFF,
    `insert into public.clients (display_name, legacy_id) values ('Kept', 'c_kept') returning id`))[0].id;
  await as(db, STAFF,
    `insert into public.clients (display_name, legacy_id, merged_into_id) values ('Merged away', 'c_gone', '${survivor}')`);
  await as(db, STAFF, `insert into public.invoices (id, legacy_client_id, tenant_id) values (1, 'c_gone', '${TRIPLE_H}')`);
  await db.exec(`update public.invoices j set client_id = coalesce(c.merged_into_id, c.id)
    from public.clients c where c.legacy_id = j.legacy_client_id and j.client_id is null`);
  const row = (await as(db, STAFF, `select client_id from public.invoices where id = 1`))[0];
  assert.equal(row.client_id, survivor);
});

test('a legacy_client_id with no matching client (a deleted client, Phase 1b\'s known remainder) leaves client_id null, not an error', async () => {
  const db = await buildDb();
  await as(db, STAFF, `insert into public.quotes (id, legacy_client_id, tenant_id) values (1, 'c_never_existed', '${TRIPLE_H}')`);
  const row = (await as(db, STAFF, `select client_id from public.quotes where id = 1`))[0];
  assert.equal(row.client_id, null);
});

test('the step-1 transition machinery (trigger, function, log table) is gone', async () => {
  const db = await buildDb();
  const triggers = await db.query(`select tgname from pg_trigger where tgname = 'copy_client_id_to_legacy'`);
  assert.equal(triggers.rows.length, 0, 'no copy_client_id_to_legacy trigger should remain on any table');
  const fn = await db.query(`select 1 from pg_proc where proname = 'copy_client_id_to_legacy'`);
  assert.equal(fn.rows.length, 0);
  const tbl = await db.query(`select 1 from information_schema.tables where table_schema = 'public' and table_name = 'legacy_client_id_writes'`);
  assert.equal(tbl.rows.length, 0);
});

test('inserting the old free-text style id directly into client_id now fails (there is no longer a text column to silently accept it)', async () => {
  const db = await buildDb();
  const r = await as(db, STAFF, `insert into public.jobs (id, client_id, tenant_id) values (1, 'c_some_old_id', '${TRIPLE_H}')`);
  assert.ok(r.error);
  assert.match(r.error.message, /invalid input syntax for type uuid/);
});

test('client_id still points into the staff\'s own tenant (RLS on clients is unaffected by the column-type change)', async () => {
  const db = await buildDb();
  const otherClient = (await as(db, STAFF,
    `insert into public.clients (display_name, tenant_id) values ('Someone else''s client', '${OTHER}') returning id`));
  // Staff in TRIPLE_H cannot even see a client row in another tenant, so this
  // insert fails under RLS -- confirming the FK's target table is still
  // correctly tenant-scoped after the column swap, not a new permission hole.
  assert.ok(otherClient.error);
  assert.match(otherClient.error.message, /row-level security/);
});
