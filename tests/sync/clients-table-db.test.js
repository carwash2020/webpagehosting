// sql/item1/01_clients_table_and_legacy_client_id.sql (Item 1 Phase 1a,
// step 1): the unified `clients` table, and the old local client ids moving
// from jobs/invoices/quotes.client_id to legacy_client_id.
//
// Runs the real 06, 07 and 01 files in PGlite, with default_tenant_id_triple_h()
// taken from the real batch 04 file, against the live policy shapes.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SQL = path.join(__dirname, '..', '..', 'sql');
const read = (...p) => fs.readFileSync(path.join(SQL, ...p), 'utf8');
const BATCH_04 = read('multi-tenant', '04_fixes_defaults_and_remaining_triggers.sql');
const BATCH_06 = read('multi-tenant', '06_tenant_id_from_session_top_level_tables.sql');
const BATCH_07 = read('multi-tenant', '07_tenant_id_fallback_for_sessionless_inserts.sql');
const MIGRATION = read('item1', '01_clients_table_and_legacy_client_id.sql');
const DEFAULT_TENANT_FN = BATCH_04.match(
  /create or replace function public\.default_tenant_id_triple_h\(\)[\s\S]*?grant execute on function public\.default_tenant_id_triple_h\(\)[^;]*;/)[0];

const TRIPLE_H = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const STAFF = { email: 'staff@triplehenterprisesllc.biz', role: 'authenticated' };
const OTHER_STAFF = { email: 'staff@other.example', role: 'authenticated' };
const CLIENT = { email: 'client@example.com', role: 'authenticated' };
const ANON = { role: 'anon' };

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
  insert into public.account_roles values ('${STAFF.email}', '${TRIPLE_H}'), ('${OTHER_STAFF.email}', '${OTHER}');
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

  -- Supabase grants table privileges to anon/authenticated by default.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

// Batch 06 attaches its trigger to all ten; jobs/invoices/quotes carry the
// old text client_id, like production.
const TEN = ['jobs', 'invoices', 'quotes', 'contracts', 'referrals', 'th_job_photos', 'th_bookings',
  'push_subscriptions', 'notification_recipients', 'client_account_codes'];
const HAS_TEXT_CLIENT_ID = new Set(['jobs', 'invoices', 'quotes']);

function tableSql(t) {
  return `
    create table public.${t} (id bigint primary key, label text,
      ${HAS_TEXT_CLIENT_ID.has(t) ? 'client_id text,' : ''}
      tenant_id uuid references public.tenants(id));
    alter table public.${t} enable row level security;
    create policy staff_all on public.${t} for all to authenticated
      using (exists (select 1 from account_roles where email = (select auth.email()))
             and tenant_id = (select public.current_tenant_id()))
      with check (exists (select 1 from account_roles where email = (select auth.email()))
                  and tenant_id = (select public.current_tenant_id()));
  `;
}

const dbs = [];
after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

async function buildDb({ seedBefore = '' } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  dbs.push(db);
  await db.exec(BASE_SCHEMA);
  await db.exec(DEFAULT_TENANT_FN);
  for (const t of TEN) await db.exec(tableSql(t));
  await db.exec(`create table public.client_profiles (client_email text primary key, display_name text,
    tenant_id uuid references public.tenants(id));`);
  await db.exec(BATCH_06);
  await db.exec(BATCH_07);
  if (seedBefore) await db.exec(seedBefore);
  await db.exec(MIGRATION);
  return db;
}

// Each step runs as its own identity inside ONE rolled-back transaction.
async function inTx(db, steps) {
  const out = [];
  await db.exec('begin');
  try {
    for (const [claims, sql] of steps) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || {})]);
      if (claims) await db.exec(`set local role ${claims.role}`);
      // A savepoint per step, so an expected error doesn't abort the rest.
      await db.exec('savepoint step');
      try {
        out.push({ rows: (await db.query(sql)).rows });
        await db.exec('release savepoint step');
      } catch (error) {
        out.push({ error });
        await db.exec('rollback to savepoint step');
      }
    }
  } finally {
    await db.exec('rollback');
  }
  return out;
}

test('a staff insert gets the tenant from the session and normalized match columns', async () => {
  const db = await buildDb();
  const [r] = await inTx(db, [[STAFF, `
    insert into public.clients (display_name, email, phone)
    values ('  Sarah   MILLER ', ' Sarah@Example.COM ', '(435) 555-0142')
    returning tenant_id, name_norm, email_norm, phone_digits, needs_match, merged_into_id`]]);
  assert.ifError(r.error);
  assert.deepEqual(r.rows[0], {
    tenant_id: TRIPLE_H, name_norm: 'sarah miller', email_norm: 'sarah@example.com',
    phone_digits: '4355550142', needs_match: false, merged_into_id: null,
  });
});

test('name_norm matches thNormalizeClientName() in tools/data-layer.js', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'data-layer.js'), 'utf8');
  const fnSrc = src.match(/function thNormalizeClientName\([\s\S]*?\n\}/)[0];
  // eslint-disable-next-line no-new-func
  const thNormalizeClientName = new Function(`${fnSrc}; return thNormalizeClientName;`)();
  const db = await buildDb();
  const names = ['Sarah Miller', '  sarah   MILLER  ', 'O\'Brien\tPlumbing', 'Ann Lee'];
  const literals = names.map((n) => `'${n.replace(/'/g, "''").replace(/\t/g, "' || chr(9) || '")}'`).join(',');
  const [r] = await inTx(db, [[STAFF, `
    insert into public.clients (display_name) select unnest(array[${literals}])
    returning display_name, name_norm`]]);
  assert.ifError(r.error);
  assert.equal(r.rows.length, names.length);
  for (const row of r.rows) assert.equal(row.name_norm, thNormalizeClientName(row.display_name), row.display_name);
});

test('blank email and phone normalize to null, not empty string (so they never match each other)', async () => {
  const db = await buildDb();
  const [r] = await inTx(db, [[STAFF, `
    insert into public.clients (display_name, email, phone) values ('A', '  ', '') returning email_norm, phone_digits`]]);
  assert.ifError(r.error);
  assert.deepEqual(r.rows[0], { email_norm: null, phone_digits: null });
});

test('a blank display name is rejected', async () => {
  const db = await buildDb();
  const [r] = await inTx(db, [[STAFF, `insert into public.clients (display_name) values ('   ')`]]);
  assert.ok(r.error);
});

test('RLS: staff see only their tenant; portal clients and anon see nothing', async () => {
  const db = await buildDb();
  const [ins, mine, theirs, client, anon] = await inTx(db, [
    [STAFF, `insert into public.clients (display_name) values ('Triple H client') returning id`],
    [STAFF, `select count(*)::int as n from public.clients`],
    [OTHER_STAFF, `select count(*)::int as n from public.clients`],
    [CLIENT, `select count(*)::int as n from public.clients`],
    [ANON, `select count(*)::int as n from public.clients`],
  ]);
  assert.ifError(ins.error);
  assert.equal(mine.rows[0].n, 1);
  assert.equal(theirs.rows[0].n, 0);
  assert.equal(client.rows[0].n, 0);
  assert.ok(anon.error, 'anon has no privileges on clients');
  assert.match(anon.error.message, /permission denied/);
});

test('RLS: a staff write into another tenant is rejected; a portal client cannot insert', async () => {
  const db = await buildDb();
  const [cross, client] = await inTx(db, [
    [STAFF, `insert into public.clients (display_name, tenant_id) values ('x', '${OTHER}')`],
    [CLIENT, `insert into public.clients (display_name) values ('x')`],
  ]);
  assert.match(cross.error.message, /row-level security/);
  assert.match(client.error.message, /row-level security/);
});

test('updated_at moves on update; created_at does not', async () => {
  const db = await buildDb();
  await db.exec(`insert into public.clients (id, display_name, tenant_id, created_at, updated_at)
    values ('11111111-1111-4111-8111-111111111111', 'A', '${TRIPLE_H}', '2026-01-01', '2026-01-01')`);
  await db.exec(`update public.clients set phone = '1' where id = '11111111-1111-4111-8111-111111111111'`);
  const r = (await db.query(`select created_at, updated_at from public.clients`)).rows[0];
  assert.equal(new Date(r.created_at).toISOString(), '2026-01-01T00:00:00.000Z');
  assert.ok(new Date(r.updated_at) > new Date('2026-09-01'));
});

test('a legacy id is unique per tenant', async () => {
  const db = await buildDb();
  const [a, b] = await inTx(db, [
    [STAFF, `insert into public.clients (display_name, legacy_id) values ('A', 'c_1')`],
    [STAFF, `insert into public.clients (display_name, legacy_id) values ('A again', 'c_1')`],
  ]);
  assert.ifError(a.error);
  assert.match(b.error.message, /duplicate key/);
});

test('a client cannot be merged into itself', async () => {
  const db = await buildDb();
  const [r] = await inTx(db, [[STAFF, `
    insert into public.clients (id, display_name, merged_into_id)
    values ('22222222-2222-4222-8222-222222222222', 'A', '22222222-2222-4222-8222-222222222222')`]]);
  assert.ok(r.error);
});

test('existing client_id values are copied to legacy_client_id by the migration', async () => {
  const db = await buildDb({ seedBefore: `
    insert into public.jobs (id, label, client_id, tenant_id) values (1, 'j', 'c_old', '${TRIPLE_H}');
    insert into public.invoices (id, label, client_id, tenant_id) values (1, 'i', 'c_old', '${TRIPLE_H}');
    insert into public.quotes (id, label, client_id, tenant_id) values (1, 'q', null, '${TRIPLE_H}');` });
  const rows = (await db.query(`
    select 'jobs' t, legacy_client_id from public.jobs union all
    select 'invoices', legacy_client_id from public.invoices union all
    select 'quotes', legacy_client_id from public.quotes order by 1`)).rows;
  assert.deepEqual(rows, [
    { t: 'invoices', legacy_client_id: 'c_old' },
    { t: 'jobs', legacy_client_id: 'c_old' },
    { t: 'quotes', legacy_client_id: null },
  ]);
  // The one-time copy is not an "old writer".
  assert.equal((await db.query(`select count(*)::int as n from public.legacy_client_id_writes`)).rows[0].n, 0);
});

const upsert = (t, cols) => {
  const names = Object.keys(cols);
  return `insert into public.${t} (id, ${names.join(', ')}) values (5, ${names.map((n) => `'${cols[n]}'`).join(', ')})
    on conflict (id) do update set ${names.map((n) => `${n} = excluded.${n}`).join(', ')}
    returning legacy_client_id`;
};

test('an old tab still writing client_id: the value lands in legacy_client_id and the write is logged', async () => {
  const db = await buildDb();
  for (const t of ['jobs', 'invoices', 'quotes']) {
    const [r, log] = await inTx(db, [
      [STAFF, upsert(t, { label: 'old tab', client_id: 'c_from_old_tab' })],
      [null, `select table_name, write_count from public.legacy_client_id_writes`],
    ]);
    assert.ifError(r.error);
    assert.equal(r.rows[0].legacy_client_id, 'c_from_old_tab', t);
    assert.deepEqual(log.rows, [{ table_name: t, write_count: 1 }], t);
  }
});

test('the new sync.js writing legacy_client_id: nothing is logged, including on an update of that row', async () => {
  const db = await buildDb();
  const [ins, upd, log] = await inTx(db, [
    [STAFF, upsert('jobs', { label: 'new', legacy_client_id: 'c_new' })],
    [STAFF, upsert('jobs', { label: 'new, edited', legacy_client_id: 'c_new' })],
    [null, `select count(*)::int as n from public.legacy_client_id_writes`],
  ]);
  assert.ifError(ins.error);
  assert.equal(upd.rows[0].legacy_client_id, 'c_new');
  assert.equal(log.rows[0].n, 0);
});

// The mirror's upsert fires the BEFORE INSERT trigger on the proposed row
// even when it becomes an update, so every old-tab save counts. That is the
// signal step 2 waits on: any old tab still saving at all.
test('every save from an old tab is logged, including a re-save with the same client_id', async () => {
  const db = await buildDb();
  const [, , log] = await inTx(db, [
    [STAFF, upsert('jobs', { label: 'a', client_id: 'c_1' })],
    [STAFF, upsert('jobs', { label: 'b', client_id: 'c_1' })],
    [null, `select write_count from public.legacy_client_id_writes`],
  ]);
  assert.deepEqual(log.rows, [{ write_count: 2 }]);
});

test('contracts and client_profiles get a uuid client_id FK to clients', async () => {
  const db = await buildDb();
  const fks = (await db.query(`
    select tc.table_name, kcu.column_name, ccu.table_name as ref
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY' and kcu.column_name = 'client_id' order by 1`)).rows;
  assert.deepEqual(fks, [
    { table_name: 'client_profiles', column_name: 'client_id', ref: 'clients' },
    { table_name: 'contracts', column_name: 'client_id', ref: 'clients' },
  ]);
  const types = (await db.query(`select table_name, data_type from information_schema.columns
    where column_name = 'client_id' and table_name in ('jobs', 'invoices', 'quotes') order by 1`)).rows;
  assert.ok(types.every((r) => r.data_type === 'text'), 'jobs/invoices/quotes.client_id stays text until step 2');
});

test('the new trigger functions are not callable over RPC, and the write log is postgres-only', async () => {
  const db = await buildDb();
  const rows = (await db.query(`
    select has_function_privilege('authenticated', 'public.set_updated_at()', 'execute') as a,
           has_function_privilege('anon', 'public.set_updated_at()', 'execute') as b,
           has_function_privilege('authenticated', 'public.copy_client_id_to_legacy()', 'execute') as c,
           has_function_privilege('anon', 'public.copy_client_id_to_legacy()', 'execute') as d,
           has_table_privilege('authenticated', 'public.legacy_client_id_writes', 'select') as e`)).rows[0];
  assert.deepEqual(rows, { a: false, b: false, c: false, d: false, e: false });
});

test('the migration can be re-run safely', async () => {
  const db = await buildDb();
  await db.exec(MIGRATION);
  assert.equal((await db.query(`select count(*)::int as n from pg_trigger where tgname = 'copy_client_id_to_legacy'`)).rows[0].n, 3);
});
