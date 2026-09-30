// sql/multi-tenant/06_tenant_id_from_session_top_level_tables.sql
// (2026-09-30, Item 1 Phase 0d mirror audit).
//
// Tier 0 ANDed `tenant_id = current_tenant_id()` onto staff RLS policies,
// but the app never sends tenant_id and the top-level tables had no default
// or trigger. Every staff insert, and every upsert of an existing row
// (Postgres applies the INSERT WITH CHECK to the proposed row even on
// conflict), failed with 42501. tools/sync.js's mirror swallowed it.
//
// Runs the real migration file in PGlite against the live policy shapes.
// The table list is the output of this live audit query on 2026-09-30:
//
//   select c.table_name from information_schema.columns c
//   where c.table_schema = 'public' and c.column_name = 'tenant_id'
//     and c.column_default is null
//     and not exists (select 1 from pg_trigger t join pg_class k on k.oid = t.tgrelid
//                     where k.relname = c.table_name and t.tgname = 'set_tenant_id')
//     and exists (select 1 from pg_policies p where p.tablename = c.table_name
//                 and p.cmd in ('INSERT','ALL') and p.with_check ilike '%current_tenant_id%');

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', '..', 'sql', 'multi-tenant', '06_tenant_id_from_session_top_level_tables.sql'), 'utf8');

const AFFECTED = [
  'jobs', 'invoices', 'quotes', 'contracts',
  'referrals', 'th_job_photos', 'th_bookings',
  'push_subscriptions', 'notification_recipients', 'client_account_codes',
];

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

  create table public.account_roles (email text primary key, tenant_id uuid references public.tenants(id));
  insert into public.account_roles values ('${STAFF.email}', '${TRIPLE_H}');
  alter table public.account_roles enable row level security;
  grant select on public.account_roles to authenticated;
  create policy own_role on public.account_roles for select to authenticated
    using (email = (select auth.email()));

  -- Live definition (sql/multi-tenant/01).
  create function public.current_tenant_id() returns uuid language sql security definer
    set search_path = public stable as $$
    select ar.tenant_id from public.account_roles ar where ar.email = (select auth.jwt() ->> 'email') limit 1;
  $$;
  revoke execute on function public.current_tenant_id() from public, anon;
  grant execute on function public.current_tenant_id() to authenticated;
`;

// Every affected table gets the live staff policy shape. th_bookings also
// gets an anon insert policy (public booking page), which is the case that
// breaks if the trigger function isn't SECURITY DEFINER.
function tableSql(t) {
  return `
    create table public.${t} (id bigint primary key, label text, tenant_id uuid references public.tenants(id));
    alter table public.${t} enable row level security;
    grant select, insert, update, delete on public.${t} to anon, authenticated, service_role;
    create policy staff_all on public.${t} for all to authenticated
      using (exists (select 1 from account_roles where email = (select auth.email()))
             and tenant_id = (select public.current_tenant_id()))
      with check (exists (select 1 from account_roles where email = (select auth.email()))
                  and tenant_id = (select public.current_tenant_id()));
  `;
}
const ANON_BOOKING_POLICY = `create policy anon_book on public.th_bookings for insert to anon with check (true);`;

const dbs = [];
after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

async function buildDb({ migrate }) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  dbs.push(db);
  await db.exec(BASE_SCHEMA);
  for (const t of AFFECTED) await db.exec(tableSql(t));
  await db.exec(ANON_BOOKING_POLICY);
  // A pre-existing row, as the live tables have.
  for (const t of AFFECTED) await db.exec(`insert into public.${t} values (1, 'existing', '${TRIPLE_H}')`);
  if (migrate) await db.exec(MIGRATION);
  return db;
}

async function run(db, role, claims, sql) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await db.exec(`set local role ${role}`);
    const r = await db.query(sql);
    return { rows: r.rows };
  } catch (error) {
    return { error };
  } finally {
    await db.exec('rollback');
  }
}

// Exactly what mirrorUpsert() sends: no tenant_id, merge-duplicates.
const upsertSql = (t, id) =>
  `insert into public.${t} (id, label) values (${id}, 'from app') on conflict (id) do update set label = excluded.label returning tenant_id`;

test('regression baseline: without the fix, staff insert AND upsert-of-existing both fail RLS', async () => {
  const db = await buildDb({ migrate: false });
  for (const t of AFFECTED) {
    const ins = await run(db, 'authenticated', STAFF, upsertSql(t, 2));
    assert.ok(ins.error, `${t}: new-row insert unexpectedly succeeded`);
    assert.match(ins.error.message, /row-level security/, t);
    const upd = await run(db, 'authenticated', STAFF, upsertSql(t, 1));
    assert.ok(upd.error, `${t}: upsert of existing row unexpectedly succeeded`);
    assert.match(upd.error.message, /row-level security/, t);
  }
});

test('with the fix: staff insert and upsert-of-existing succeed on every affected table, tenant resolved from session', async () => {
  const db = await buildDb({ migrate: true });
  for (const t of AFFECTED) {
    const ins = await run(db, 'authenticated', STAFF, upsertSql(t, 2));
    assert.ifError(ins.error);
    assert.equal(ins.rows[0].tenant_id, TRIPLE_H, `${t}: new row`);
    const upd = await run(db, 'authenticated', STAFF, upsertSql(t, 1));
    assert.ifError(upd.error);
    assert.equal(upd.rows[0].tenant_id, TRIPLE_H, `${t}: existing row`);
  }
});

test('an explicitly supplied tenant_id is never overwritten, so a wrong-tenant write is still rejected', async () => {
  const db = await buildDb({ migrate: true });
  const r = await run(db, 'authenticated', STAFF,
    `insert into public.invoices (id, label, tenant_id) values (3, 'x', '${OTHER}') returning tenant_id`);
  assert.ok(r.error, 'insert into another tenant should still fail');
  assert.match(r.error.message, /row-level security/);
});

test('anon insert (public booking page) still works: trigger must not call current_tenant_id() as anon', async () => {
  const db = await buildDb({ migrate: true });
  const r = await run(db, 'anon', { role: 'anon' },
    `insert into public.th_bookings (id, label) values (4, 'public booking')`);
  assert.ifError(r.error);
});

test('service-role insert (edge functions) still works and is unchanged', async () => {
  const db = await buildDb({ migrate: true });
  const r = await run(db, 'service_role', { role: 'service_role' },
    `insert into public.jobs (id, label) values (5, 'edge fn') returning tenant_id`);
  assert.ifError(r.error);
  assert.equal(r.rows[0].tenant_id, null);
});

test('the trigger function is not directly callable (off the PostgREST RPC surface)', async () => {
  const db = await buildDb({ migrate: true });
  const rows = (await db.query(`
    select has_function_privilege('authenticated', 'public.set_tenant_id_from_session()', 'execute') as auth_exec,
           has_function_privilege('anon', 'public.set_tenant_id_from_session()', 'execute') as anon_exec`)).rows;
  assert.deepEqual(rows[0], { auth_exec: false, anon_exec: false });
});

test('migration covers exactly the audited table list', () => {
  const listed = MIGRATION.match(/foreach t in array array\[([\s\S]*?)\]/)[1]
    .match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(listed, [...AFFECTED].sort());
});
