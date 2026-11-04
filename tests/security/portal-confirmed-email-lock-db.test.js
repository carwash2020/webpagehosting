// sql/portal/portal_self_signup_and_confirmed_email_lock.sql run for real
// in PGlite (2026-11-04). Connor chose server-side portal sign-up plus a
// database lock: a session whose email is not confirmed sees nothing a
// client sees -- even if it carries that client's email -- while confirmed
// clients and staff keep exactly the access they had.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'portal', 'portal_self_signup_and_confirmed_email_lock.sql'), 'utf8');

const CLIENT = 'tony@example.com';
const CONFIRMED_ID = '00000000-0000-0000-0000-000000000001';
const UNCONFIRMED_ID = '00000000-0000-0000-0000-000000000002'; // same email made by a stranger, never confirmed
const STAFF_ID = '00000000-0000-0000-0000-000000000003';

const SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, confirmed_at timestamptz);

  create table public.account_roles (email text primary key);
  create function public.current_user_has_any_role() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.account_roles where email = auth.email()) $$;

  create table public.client_portal_invoices (id bigserial primary key, client_email text, total numeric);
  alter table public.client_portal_invoices enable row level security;
  create policy "clients or internal accounts can view invoices" on public.client_portal_invoices
    for select to authenticated using ((select auth.email()) = client_email);

  create table public.client_portal_work_orders (id bigserial primary key, client_email text, status text);
  alter table public.client_portal_work_orders enable row level security;
  create policy "clients create their own work orders" on public.client_portal_work_orders
    for insert to authenticated with check ((select auth.email()) = client_email and status = 'submitted');
  create policy "clients or internal accounts view work orders" on public.client_portal_work_orders
    for select to authenticated using ((select auth.email()) = client_email);

  create table public.card_authorizations (id bigserial primary key, client_email text);
  alter table public.card_authorizations enable row level security;
  create policy "clients or internal accounts can view card authorizations" on public.card_authorizations
    for select to authenticated using (client_email = (select auth.email()) or public.current_user_has_any_role());

  grant select, insert on all tables in schema public to authenticated;
  grant usage on all sequences in schema public to authenticated;

  insert into auth.users values
    ('${CONFIRMED_ID}', '${CLIENT}', now(), now()),
    ('${UNCONFIRMED_ID}', '${CLIENT}', null, null),
    ('${STAFF_ID}', 'steve@triplehenterprisesllc.biz', now(), now());
  insert into public.account_roles values ('steve@triplehenterprisesllc.biz');
  insert into public.client_portal_invoices (client_email, total) values ('${CLIENT}', 300), ('jane@example.com', 120);
  insert into public.card_authorizations (client_email) values ('${CLIENT}'), ('jane@example.com');
`;

const dbs = [];
after(async () => { await Promise.all(dbs.map((d) => d.close().catch(() => {}))); });

async function build({ apply = true } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  dbs.push(db);
  await db.exec(SCHEMA);
  if (apply) await db.exec(SQL);
  return db;
}

async function as(db, sub, email, sql, params) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, email, role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    return tx.query(sql, params);
  });
}

test('before the lock: a session carrying the client\'s email sees their invoices whether or not it was confirmed (the gap)', async () => {
  const db = await build({ apply: false });
  const r = await as(db, UNCONFIRMED_ID, CLIENT, 'select total from client_portal_invoices');
  assert.equal(r.rows.length, 1);
});

test('after the lock: an unconfirmed session sees nothing and can write nothing', async () => {
  const db = await build();
  assert.equal((await as(db, UNCONFIRMED_ID, CLIENT, 'select * from client_portal_invoices')).rows.length, 0);
  assert.equal((await as(db, UNCONFIRMED_ID, CLIENT, 'select * from card_authorizations')).rows.length, 0);
  await assert.rejects(
    as(db, UNCONFIRMED_ID, CLIENT, `insert into client_portal_work_orders (client_email, status) values ($1, 'submitted')`, [CLIENT]),
    /row-level security/,
  );
});

test('after the lock: the confirmed client keeps exactly their own rows; staff keep theirs', async () => {
  const db = await build();
  const mine = await as(db, CONFIRMED_ID, CLIENT, 'select total from client_portal_invoices');
  assert.deepEqual(mine.rows.map((x) => Number(x.total)), [300]);
  await as(db, CONFIRMED_ID, CLIENT, `insert into client_portal_work_orders (client_email, status) values ($1, 'submitted')`, [CLIENT]);
  const staff = await as(db, STAFF_ID, 'steve@triplehenterprisesllc.biz', 'select * from card_authorizations');
  assert.equal(staff.rows.length, 2, 'the restrictive policy only takes access away from unconfirmed sessions');
});

test('portal_signup_codes is service-role only: a signed-in client can neither read nor write it', async () => {
  const db = await build();
  await db.query(`insert into portal_signup_codes (email, code_hash, expires_at) values ('${CLIENT}', 'h', now() + interval '15 minutes')`);
  await assert.rejects(as(db, CONFIRMED_ID, CLIENT, 'select * from portal_signup_codes'), /permission denied/);
  await assert.rejects(db.query(`insert into portal_signup_codes (email, code_hash, expires_at) values ('UPPER@x.com', 'h', now())`), /check/);
});

test('it runs twice without error, and every client-facing table in the live list is covered', async () => {
  const db = await build();
  await db.exec(SQL);
  const r = await db.query(`select tablename from pg_policies where policyname = 'Confirmed email only' and permissive = 'RESTRICTIVE' order by 1`);
  assert.deepEqual(r.rows.map((x) => x.tablename), ['card_authorizations', 'client_portal_invoices', 'client_portal_work_orders']);
  for (const t of ['client_portal_contracts', 'client_portal_quotes', 'client_portal_jobs', 'client_profiles', 'quote_questions', 'client_notification_preferences', 'client_portal_job_messages', 'client_portal_work_order_messages', 'client_portal_thread_reads', 'client_portal_checkups', 'client_account_codes']) {
    assert.ok(SQL.includes(`'${t}'`), `${t} is in the lock list`);
  }
});

test('portal_account_status() is now in the repo, matching the live rule (confirmed_at decides)', async () => {
  const db = await build();
  const s = async (e) => (await db.query('select public.portal_account_status($1) s', [e])).rows[0].s;
  assert.equal(await s('nobody@example.com'), 'none');
  assert.equal(await s('STEVE@triplehenterprisesllc.biz '), 'confirmed');
});
