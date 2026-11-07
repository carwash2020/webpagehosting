// Fix plan Group 5, RP3 (2026-11-07): runs the real
// sql/security/group5_backend_hardening.sql in PGlite (real PostgreSQL) on
// stand-ins shaped like the live tables. Made-up people only.
//
// What is proved, against the database:
//   - rate_limit_take counts per bucket and key, resets after its window,
//     stores only a hash, and only the server may call it;
//   - the caller's IP is Cloudflare's cf-connecting-ip, else the LAST
//     x-forwarded-for entry (the first is whatever the caller wrote);
//   - create_booking: 5 an hour from one IP, then 429; a bad email refused;
//     staff not limited (RP3.3);
//   - a public lead arrives unhandled, now, in the default business, and the
//     public forms are rate limited per IP; error logs over the limit are
//     dropped quietly (RP3.4, RP3.5);
//   - receipts and secure documents need can_view_finance (RP3.6);
//   - D20: no deadline = as before; after it, no factor = no pass (RP3.7);
//   - policy names say what they do (RP3.32);
//   - D30: a staff member sees only their own account_roles row; a role
//     manager sees all; team_roster hides switches from non-managers;
//     internal_emails_among answers only about the emails asked (RP3.33);
//   - a declined work order carries the staff note (RP4.8);
//   - check-up reminders get a scheduled_at marker (RP3.8).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'security', 'group5_backend_hardening.sql'), 'utf8');
const T = '07775ed9-0000-4000-8000-000000000001';
const BOSS = 'boss@example.com';      // can manage roles, finance
const TECH = 'tech@example.com';      // plain staff
const CLIENT = 'pat@example.com';     // a portal client
const UID = { [BOSS]: '00000000-0000-4000-8000-0000000000b0', [TECH]: '00000000-0000-4000-8000-0000000000c0', [CLIENT]: '00000000-0000-4000-8000-0000000000d0' };

const SCHEMA = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create table auth.users (id uuid primary key, email text, last_sign_in_at timestamptz);
  create table auth.mfa_factors (user_id uuid, status text);

  create table public.tenants (id uuid primary key);
  insert into public.tenants values ('${T}');
  create table public.account_roles (email text primary key, role_name text, display_name text, title text, tenant_id uuid,
    invited_at timestamptz, can_manage_roles boolean default false, can_access_dev_tools boolean default false,
    can_access_dev_tools_full boolean default false, can_manage_site_content boolean default false, can_manage_invoices boolean default false,
    can_manage_contracts boolean default false, can_view_finance boolean default false, can_view_runway boolean default false,
    can_manage_reviews boolean default false, can_manage_clients boolean default false, can_manage_others_jobs boolean default false);
  insert into public.account_roles (email, display_name, title, tenant_id, can_manage_roles, can_view_finance) values
    ('${BOSS}', 'Boss', 'Owner', '${T}', true, true), ('${TECH}', 'Tech', 'Technician', '${T}', false, false);
  create table public.account_roles_deactivated (email text, display_name text, row_data jsonb, deactivated_at timestamptz);
  insert into auth.users values ('${UID[BOSS]}', '${BOSS}', now()), ('${UID[TECH]}', '${TECH}', now());

  create table public.internal_mfa_enforcement (id boolean primary key default true, mode text not null default 'log');
  insert into public.internal_mfa_enforcement values (true, 'enforce');
  create function public.internal_mfa_mode() returns text language sql stable as $$
    select coalesce((select e.mode from public.internal_mfa_enforcement e where e.id), 'enforce') $$;
  create function public.trusted_device_session_valid(p_user uuid, p_session text) returns boolean language sql stable as $$ select false $$;
  create function public.internal_mfa_session_ok(p_user_id uuid, p_aal text) returns boolean language sql stable security definer as $$
    select coalesce(p_aal, '') = 'aal2' or (p_user_id is not null and not exists (
      select 1 from auth.mfa_factors f where f.user_id = p_user_id and f.status = 'verified')) $$;
  create function public.current_user_has_any_role() returns boolean language plpgsql stable security definer set search_path = public as $$
  begin
    if not exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email')) then return false; end if;
    if public.internal_mfa_mode() = 'off' then return true; end if;
    return public.internal_mfa_session_ok(auth.uid(), auth.jwt() ->> 'aal');
  end $$;
  create function public.current_tenant_id() returns uuid language sql stable security definer set search_path = public as $$
    select tenant_id from public.account_roles where email = (select auth.jwt() ->> 'email') $$;
  create function public.current_user_can_manage_roles() returns boolean language sql stable set search_path = public as $$
    select coalesce((select ar.can_manage_roles from public.account_roles ar where ar.email = (select auth.jwt() ->> 'email')), false) $$;
  alter table public.account_roles enable row level security;
  create policy "Authenticated can view account roles" on public.account_roles for select to authenticated
    using ((select public.current_user_has_any_role()));
  grant select on public.account_roles to authenticated;
  create function public.default_tenant_id_triple_h() returns uuid language sql stable as $$ select '${T}'::uuid $$;

  create table public.th_leads (id bigserial primary key, name text, email text, phone text, handled boolean default false,
    handled_at timestamptz, created_at timestamptz default now(), tenant_id uuid default '${T}', job_id bigint);
  alter table public.th_leads enable row level security;
  create policy "Anyone can submit a lead" on public.th_leads for insert to anon, authenticated with check (true);
  grant insert on public.th_leads to anon, authenticated; grant usage on sequence public.th_leads_id_seq to anon, authenticated;
  create table public.th_job_applications (id bigserial primary key, name text);
  alter table public.th_job_applications enable row level security;
  create policy "Anyone can submit a job application" on public.th_job_applications for insert to anon, authenticated with check (true);
  grant insert on public.th_job_applications to anon, authenticated; grant usage on sequence public.th_job_applications_id_seq to anon, authenticated;
  create table public.portal_bug_reports (id bigserial primary key, message text);
  create table public.portal_client_errors (id bigserial primary key, message text);
  alter table public.portal_bug_reports enable row level security; alter table public.portal_client_errors enable row level security;
  create policy "bug" on public.portal_bug_reports for insert to anon, authenticated with check (true);
  create policy "err" on public.portal_client_errors for insert to anon, authenticated with check (true);
  grant insert on public.portal_bug_reports, public.portal_client_errors to anon, authenticated;
  grant usage on sequence public.portal_bug_reports_id_seq, public.portal_client_errors_id_seq to anon, authenticated;

  create table public.th_bookings (id bigserial primary key, service_key text, service_label text, start_at timestamptz, end_at timestamptz,
    name text, phone text, email text, address text, notes text, referred_by text, referred_by_code text, source text,
    utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text, ga_client_id text, landing_referrer text,
    cancel_token uuid default gen_random_uuid());

  create schema storage; grant usage on schema storage to authenticated;
  create table storage.objects (id bigserial primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant select, insert, delete on storage.objects to authenticated; grant usage on sequence storage.objects_id_seq to authenticated;
  create policy "Internal accounts can view job-photos" on storage.objects for select to authenticated using (bucket_id = 'job-photos' and public.current_user_has_any_role());
  create policy "Internal accounts can view receipts" on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.current_user_has_any_role());
  create policy "Internal accounts can upload receipts" on storage.objects for insert to authenticated with check (bucket_id = 'receipts' and public.current_user_has_any_role());
  create policy "Internal accounts can view secure-documents" on storage.objects for select to authenticated using (bucket_id = 'secure-documents' and public.current_user_has_any_role());
  insert into storage.objects (bucket_id, name) values ('receipts', 'r1.jpg'), ('secure-documents', 'insurance.pdf'), ('job-photos', 'p1.jpg');

  create table public.client_portal_invoices (id bigserial primary key, client_email text);
  alter table public.client_portal_invoices enable row level security;
  create policy "clients or internal accounts can view invoices" on public.client_portal_invoices for select using (client_email = auth.email());
  create table public.client_portal_checkups (id bigserial primary key, client_email text);
  create table public.client_portal_work_orders (id bigserial primary key, client_email text, status text, scheduled_at timestamptz,
    updated_at timestamptz, tenant_id uuid);
  grant select on public.client_portal_work_orders to authenticated;
  insert into public.client_portal_work_orders (client_email, status, tenant_id) values ('${CLIENT}', 'new', '${T}');
`;

let dbPromise;
async function db() {
  if (!dbPromise) dbPromise = (async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(SQL);
    await d.exec(SQL); // re-runnable
    await d.exec('grant execute on function public.current_user_can_manage_roles() to authenticated;');
    return d;
  })();
  return dbPromise;
}
after(async () => { if (dbPromise) await (await dbPromise).close(); });

// One request: role, JWT claims and (optionally) the gateway's headers.
async function as(who, sql, params, headers = {}) {
  const d = await db();
  return d.transaction(async (tx) => {
    const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated';
    const claims = who === 'anon' ? { role: 'anon' } : who === 'service' ? { role: 'service_role' } : { role: 'authenticated', email: who, sub: UID[who], aal: 'aal1' };
    await tx.query(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
    return (await tx.query(sql, params)).rows;
  });
}
const admin = async (sql, params) => (await (await db()).query(sql, params)).rows;
const soon = (h) => new Date(Date.now() + h * 3600000).toISOString();
const booking = (n, extra = {}) => JSON.stringify(Object.assign({ name: 'Sample ' + n, start_at: soon(24 + n * 2), end_at: soon(25 + n * 2) }, extra));

test('rate_limit_take counts per bucket and key, resets after its window, stores only a hash, and only the server may call it', async () => {
  const take = (k, max = 2, win = 3600) => as('service', 'select public.rate_limit_take($1, $2, $3, $4) as ok', ['t', k, max, win]);
  assert.equal((await take('1.2.3.4'))[0].ok, true);
  assert.equal((await take('1.2.3.4'))[0].ok, true);
  assert.equal((await take('1.2.3.4'))[0].ok, false, 'third hit over a limit of 2');
  assert.equal((await take('5.6.7.8'))[0].ok, true, 'another key has its own count');
  await admin("update public.rate_limit_hits set window_start = now() - interval '2 hours' where bucket = 't'");
  assert.equal((await take('1.2.3.4'))[0].ok, true, 'a new window starts over');
  const rows = await admin("select key_hash from public.rate_limit_hits where bucket = 't'");
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.key_hash)), 'only hashes are kept');
  await assert.rejects(as('anon', "select public.rate_limit_take('t', 'x', 1, 60)"), /permission denied/);
  await assert.rejects(as(TECH, "select public.rate_limit_take('t', 'x', 1, 60)"), /permission denied/);
});

test('the caller IP is Cloudflare\'s, else the LAST forwarded-for entry, never the caller-written first one', async () => {
  const ip = (h) => admin("select set_config('request.headers', $1, false); select public.request_client_ip() as ip", [JSON.stringify(h)]).catch(() => null);
  const d = await db();
  const read = async (h) => { await d.query("select set_config('request.headers', $1, false)", [JSON.stringify(h)]); return (await d.query('select public.request_client_ip() as ip')).rows[0].ip; };
  assert.equal(await read({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), '203.0.113.9');
  assert.equal(await read({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4' }), '198.51.100.4');
  assert.equal(await read({}), 'unknown');
  await d.query("select set_config('request.headers', '', false)");
  void ip;
});

test('RP3.3: create_booking allows 5 an hour from one IP, then 429; a bad email is refused; staff are not limited', async () => {
  const h = { 'cf-connecting-ip': '192.0.2.10' };
  for (let i = 1; i <= 5; i++) assert.ok((await as('anon', 'select * from public.create_booking($1)', [booking(i)], h))[0].booking_id);
  await assert.rejects(as('anon', 'select * from public.create_booking($1)', [booking(6)], h), (e) => /too-many/.test(e.message) && e.code === 'PT429');
  assert.ok((await as('anon', 'select * from public.create_booking($1)', [booking(7)], { 'cf-connecting-ip': '192.0.2.11' }))[0].booking_id, 'someone else still can');
  await assert.rejects(as('anon', 'select * from public.create_booking($1)', [booking(8, { email: 'not an email' })], { 'cf-connecting-ip': '192.0.2.12' }), /invalid-email/);
  assert.ok((await as('anon', 'select * from public.create_booking($1)', [booking(9, { email: 'Sam@Example.com' })], { 'cf-connecting-ip': '192.0.2.12' }))[0].booking_id);
  const r = await as('anon', 'select * from public.create_booking($1)', [booking(10)], { 'cf-connecting-ip': '192.0.2.13' });
  assert.deepEqual(Object.keys(r[0]).sort(), ['booking_id', 'manage_token'], 'same answer shape as before');
  for (let i = 11; i <= 17; i++) assert.ok((await as(BOSS, 'select * from public.create_booking($1)', [booking(i)], h))[0].booking_id, 'staff are not limited');
});

test('RP3.4 + RP3.5: a public lead arrives unhandled, now, in the default business; public forms are limited per IP; error logs over the limit are dropped quietly', async () => {
  const h = { 'cf-connecting-ip': '192.0.2.20' };
  await as('anon', "insert into public.th_leads (name, handled, handled_at, created_at, tenant_id) values ('Crafted', true, now(), '2020-01-01', gen_random_uuid())", [], h);
  const lead = (await admin("select handled, handled_at, created_at, tenant_id from public.th_leads where name = 'Crafted'"))[0];
  assert.equal(lead.handled, false);
  assert.equal(lead.handled_at, null);
  assert.ok(Date.now() - new Date(lead.created_at).getTime() < 60000);
  assert.equal(lead.tenant_id, T);
  for (let i = 0; i < 4; i++) await as('anon', "insert into public.th_leads (name) values ('L')", [], h);
  await assert.rejects(as('anon', "insert into public.th_leads (name) values ('L6')", [], h), (e) => e.code === 'PT429' && /Too many submissions/.test(e.message));
  for (let i = 0; i < 3; i++) await as('anon', "insert into public.th_job_applications (name) values ('A')", [], h);
  await assert.rejects(as('anon', "insert into public.th_job_applications (name) values ('A4')", [], h), (e) => e.code === 'PT429');
  for (let i = 0; i < 32; i++) await as('anon', "insert into public.portal_client_errors (message) values ('boom')", [], h);
  assert.equal((await admin('select count(*)::int n from public.portal_client_errors'))[0].n, 30, 'two dropped, no error');
  await as(TECH, "insert into public.th_leads (name, handled) values ('Staff-entered', true)", [], h);
  assert.equal((await admin("select handled from public.th_leads where name = 'Staff-entered'"))[0].handled, true, 'staff are trusted and not limited');
});

test('RP3.6: receipts and secure documents need can_view_finance; job photos stay staff-wide', async () => {
  const seen = async (who) => (await as(who, 'select bucket_id from storage.objects order by bucket_id')).map((r) => r.bucket_id);
  assert.deepEqual(await seen(BOSS), ['job-photos', 'receipts', 'secure-documents']);
  assert.deepEqual(await seen(TECH), ['job-photos']);
  assert.deepEqual(await seen(CLIENT), []);
  await assert.rejects(as(TECH, "insert into storage.objects (bucket_id, name) values ('receipts', 'x.jpg')"), /row-level security/);
  await as(BOSS, "insert into storage.objects (bucket_id, name) values ('receipts', 'y.jpg')");
});

test('RP3.7 (D20): no deadline changes nothing; after it, an account with no factor stops passing; one with a factor is unaffected', async () => {
  const ok = async (who, aal = 'aal1') => (await admin('select public.internal_mfa_session_ok($1, $2) as ok', [UID[who], aal]))[0].ok;
  assert.equal(await ok(TECH), true, 'no factor, no deadline: as before');
  await admin("update public.internal_mfa_enforcement set enroll_deadline = now() + interval '7 days'");
  assert.equal(await ok(TECH), true, 'before the deadline: still fine');
  await admin("update public.internal_mfa_enforcement set enroll_deadline = now() - interval '1 minute'");
  assert.equal(await ok(TECH), false, 'after the deadline: no factor, no pass');
  assert.equal(await ok(TECH, 'aal2'), true);
  await admin(`insert into auth.mfa_factors values ('${UID[BOSS]}', 'verified')`);
  assert.equal(await ok(BOSS, 'aal2'), true);
  await admin('update public.internal_mfa_enforcement set enroll_deadline = null');
  await admin(`delete from auth.mfa_factors`);
});

test('RP3.32: the portal policy names say what they do', async () => {
  const names = (await admin("select policyname from pg_policies where tablename = 'client_portal_invoices'")).map((r) => r.policyname);
  assert.deepEqual(names, ['clients can view their own invoices']);
});

test('RP3.33 (D30): staff see only their own account_roles row; a role manager sees all; the roster hides switches from non-managers', async () => {
  assert.deepEqual((await as(TECH, 'select email from public.account_roles order by 1')).map((r) => r.email), [TECH]);
  assert.deepEqual((await as(BOSS, 'select email from public.account_roles order by 1')).map((r) => r.email), [BOSS, TECH]);
  assert.deepEqual(await as(CLIENT, 'select email from public.account_roles'), []);
  const techView = await as(TECH, 'select * from public.team_roster() order by email');
  assert.deepEqual(techView.map((r) => [r.email, r.display_name, r.title, r.status]), [[BOSS, 'Boss', 'Owner', 'active'], [TECH, 'Tech', 'Technician', 'active']]);
  assert.ok(techView.every((r) => r.can_manage_roles === null && r.can_view_finance === null && r.last_sign_in_at === null), 'no switches or sign-in dates for a non-manager');
  const bossView = await as(BOSS, 'select * from public.team_roster() order by email');
  assert.equal(bossView[0].can_manage_roles, true);
  assert.ok(bossView[0].last_sign_in_at);
  assert.deepEqual((await as(TECH, 'select public.internal_emails_among($1) as e', [[CLIENT, 'BOSS@example.com', 'x@y.z']]))[0].e, [BOSS]);
  assert.deepEqual((await as(CLIENT, 'select public.internal_emails_among($1) as e', [[BOSS]]))[0].e, [], 'a client learns nothing');
  await assert.rejects(as(CLIENT, 'select * from public.team_roster()'), /not an internal account/);
});

test('RP3.8: check-up reminders have a scheduled_at column for the booked marker', async () => {
  const cols = (await admin("select column_name, data_type from information_schema.columns where table_name = 'client_portal_checkups' and column_name = 'scheduled_at'"));
  assert.deepEqual(cols.map((c) => c.data_type), ['timestamp with time zone']);
});

test('RP4.8: closing a work order carries the staff note; any other status clears it', async () => {
  const id = (await admin('select id from public.client_portal_work_orders limit 1'))[0].id;
  let r = await as(TECH, "select * from public.internal_update_client_portal_work_order($1, 'declined', null, $2)", [id, '  We do not service that area yet.  ']);
  assert.equal(r[0].status_note, 'We do not service that area yet.');
  r = await as(TECH, "select * from public.internal_update_client_portal_work_order($1, 'scheduled', now(), null)", [id]);
  assert.equal(r[0].status_note, null);
  r = await as(TECH, "select * from public.internal_update_client_portal_work_order($1, 'declined', null)", [id]);
  assert.equal(r[0].status, 'declined', 'the old 3-argument call still works');
  await assert.rejects(as(CLIENT, "select * from public.internal_update_client_portal_work_order($1, 'declined', null, 'x')", [id]), /Only internal accounts/);
});
