// sql/multi-tenant/07_tenant_id_fallback_for_sessionless_inserts.sql
// (2026-09-30, found while verifying batch 06 live).
//
// Batch 06 fills tenant_id from the staff session. Inserts with no staff
// session (anon create_booking(), service-role edge functions, a portal
// client's own push subscription) got tenant_id null, and staff RLS
// (tenant_id = current_tenant_id()) hid them. So a public booking was
// invisible to staff. 07 falls back to Triple H, like batch 04's defaults.
//
// Runs the real 06 and 07 files in PGlite, with default_tenant_id_triple_h()
// taken from the real batch 04 file.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MT = path.join(__dirname, '..', '..', 'sql', 'multi-tenant');
const BATCH_04 = fs.readFileSync(path.join(MT, '04_fixes_defaults_and_remaining_triggers.sql'), 'utf8');
const BATCH_06 = fs.readFileSync(path.join(MT, '06_tenant_id_from_session_top_level_tables.sql'), 'utf8');
const BATCH_07 = fs.readFileSync(path.join(MT, '07_tenant_id_fallback_for_sessionless_inserts.sql'), 'utf8');

// Just the default_tenant_id_triple_h() definition and its grant; the rest
// of batch 04 alters tables this test doesn't build.
const DEFAULT_TENANT_FN = BATCH_04.match(
  /create or replace function public\.default_tenant_id_triple_h\(\)[\s\S]*?grant execute on function public\.default_tenant_id_triple_h\(\)[^;]*;/)[0];

const TRIPLE_H = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const STAFF = { email: 'staff@triplehenterprisesllc.biz', role: 'authenticated' };
const OTHER_STAFF = { email: 'staff@other.example', role: 'authenticated' };
const CLIENT = { email: 'client@example.com', role: 'authenticated' };
const ANON = { role: 'anon' };
const SERVICE = { role: 'service_role' };

// Batch 06 attaches its trigger to all ten, so all ten must exist.
const TABLES = [
  'jobs', 'invoices', 'quotes', 'contracts',
  'referrals', 'th_job_photos', 'th_bookings',
  'push_subscriptions', 'notification_recipients', 'client_account_codes',
];

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
`;

function tableSql(t) {
  return `
    create table public.${t} (id bigint primary key, label text, owner_email text,
                              tenant_id uuid references public.tenants(id));
    alter table public.${t} enable row level security;
    grant select, insert, update, delete on public.${t} to anon, authenticated, service_role;
    create policy staff_all on public.${t} for all to authenticated
      using (exists (select 1 from account_roles where email = (select auth.email()))
             and tenant_id = (select public.current_tenant_id()))
      with check (exists (select 1 from account_roles where email = (select auth.email()))
                  and tenant_id = (select public.current_tenant_id()));
  `;
}

// Live shapes for the sessionless paths: a SECURITY DEFINER booking RPC
// granted to anon (create_booking), and push_subscriptions' own-row branch
// for a signed-in client.
const EXTRA = `
  create function public.create_booking(p_label text) returns bigint
    language plpgsql security definer set search_path = public as $$
  declare v_id bigint;
  begin
    insert into public.th_bookings (id, label) values (100, p_label) returning id into v_id;
    return v_id;
  end;
  $$;
  grant execute on function public.create_booking(text) to anon, authenticated;

  create policy client_own on public.push_subscriptions for all to authenticated
    using (owner_email = (select auth.email()))
    with check (owner_email = (select auth.email()));
`;

const dbs = [];
after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

async function buildDb({ with07 }) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  dbs.push(db);
  await db.exec(BASE_SCHEMA);
  await db.exec(DEFAULT_TENANT_FN);
  for (const t of TABLES) await db.exec(tableSql(t));
  await db.exec(EXTRA);
  await db.exec(BATCH_06);
  if (with07) await db.exec(BATCH_07);
  return db;
}

// Runs steps in ONE rolled-back transaction, switching identity per step, so
// a row written by one caller can be read back by another (the actual bug:
// staff couldn't see a public booking).
async function inTx(db, steps) {
  const out = [];
  await db.exec('begin');
  try {
    for (const [claims, sql] of steps) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await db.exec(`set local role ${claims.role}`);
      try {
        out.push({ rows: (await db.query(sql)).rows });
      } catch (error) {
        out.push({ error });
      }
    }
  } finally {
    await db.exec('rollback');
  }
  return out;
}

const tenantOf = (t, id) => `select tenant_id from public.${t} where id = ${id}`;
const staffCount = (t, id) => `select count(*)::int as n from public.${t} where id = ${id}`;

test('regression baseline: with 06 alone, an anon booking lands tenant null and staff cannot see it', async () => {
  const db = await buildDb({ with07: false });
  const [book, , seen] = await inTx(db, [
    [ANON, `select public.create_booking('public booking') as id`],
    [SERVICE, tenantOf('th_bookings', 100)],
    [STAFF, staffCount('th_bookings', 100)],
  ]);
  assert.ifError(book.error);
  assert.equal(seen.rows[0].n, 0);
});

test('anon create_booking(): tenant falls back to Triple H and staff can see the booking', async () => {
  const db = await buildDb({ with07: true });
  const [book, tenant, seen] = await inTx(db, [
    [ANON, `select public.create_booking('public booking') as id`],
    [SERVICE, tenantOf('th_bookings', 100)],
    [STAFF, staffCount('th_bookings', 100)],
  ]);
  assert.ifError(book.error);
  assert.equal(tenant.rows[0].tenant_id, TRIPLE_H);
  assert.equal(seen.rows[0].n, 1);
});

test('service-role inserts (edge functions): tenant falls back to Triple H', async () => {
  const db = await buildDb({ with07: true });
  for (const t of ['th_bookings', 'client_account_codes']) {
    const [ins, seen] = await inTx(db, [
      [SERVICE, `insert into public.${t} (id, label) values (200, 'edge fn') returning tenant_id`],
      [STAFF, staffCount(t, 200)],
    ]);
    assert.ifError(ins.error);
    assert.equal(ins.rows[0].tenant_id, TRIPLE_H, t);
    assert.equal(seen.rows[0].n, 1, t);
  }
});

test('a portal client (authenticated, not staff) saving their own push subscription gets Triple H', async () => {
  const db = await buildDb({ with07: true });
  const [ins] = await inTx(db, [
    [CLIENT, `insert into public.push_subscriptions (id, label, owner_email)
              values (300, 'client device', '${CLIENT.email}') returning tenant_id`],
  ]);
  assert.ifError(ins.error);
  assert.equal(ins.rows[0].tenant_id, TRIPLE_H);
});

test('a staff session still wins over the fallback: other-tenant staff get their own tenant', async () => {
  const db = await buildDb({ with07: true });
  const [mine, theirs] = await inTx(db, [
    [STAFF, `insert into public.invoices (id, label) values (400, 'x') returning tenant_id`],
    [OTHER_STAFF, `insert into public.invoices (id, label) values (401, 'y') returning tenant_id`],
  ]);
  assert.ifError(mine.error);
  assert.equal(mine.rows[0].tenant_id, TRIPLE_H);
  assert.ifError(theirs.error);
  assert.equal(theirs.rows[0].tenant_id, OTHER);
});

test('an explicit wrong tenant_id is never overwritten, so RLS still rejects it', async () => {
  const db = await buildDb({ with07: true });
  const [r] = await inTx(db, [
    [STAFF, `insert into public.invoices (id, label, tenant_id) values (500, 'x', '${OTHER}')`],
  ]);
  assert.ok(r.error, 'wrong-tenant insert should fail');
  assert.match(r.error.message, /row-level security/);
});

test('the fallback grants no write access: a non-staff client still cannot insert a staff-only table', async () => {
  const db = await buildDb({ with07: true });
  const [r] = await inTx(db, [
    [CLIENT, `insert into public.invoices (id, label) values (600, 'x')`],
  ]);
  assert.ok(r.error);
  assert.match(r.error.message, /row-level security/);
});

test('the trigger function stays off the PostgREST RPC surface', async () => {
  const db = await buildDb({ with07: true });
  const rows = (await db.query(`
    select has_function_privilege('authenticated', 'public.set_tenant_id_from_session()', 'execute') as auth_exec,
           has_function_privilege('anon', 'public.set_tenant_id_from_session()', 'execute') as anon_exec`)).rows;
  assert.deepEqual(rows[0], { auth_exec: false, anon_exec: false });
});
