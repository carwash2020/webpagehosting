// Phase 5 analytics (2026-11-04): runs the real migration
// sql/infra/phase5_attribution_and_ga4.sql in PGlite (real PostgreSQL) on top
// of the live shapes of th_leads, th_bookings, jobs and invoices (their RLS as
// it is live, simplified to the same "internal account of this business"
// test), with stand-ins for Vault and pg_net that record what would be sent.
// Made-up people and amounts only; no real invoice is touched.
//
// What is proved, against the database:
//   - the public lead form and booking function store the GA visit ID and the
//     first referrer host; junk in either is dropped and the lead still saves;
//   - a visitor can't link their lead to a job; staff can;
//   - an invoice turning paid (by update or arriving already paid) queues one
//     sale for Google Analytics and calls ga4-conversion once, only when its
//     job came from a lead or booking that carries a visit ID; marking it
//     unpaid and paid again never sends a second time; a failure inside never
//     blocks the invoice save;
//   - the report cache and the sales queue are readable by internal accounts
//     only and writable by nobody but the server;
//   - insights_channel() labels sources the way the approved design reads;
//   - insights_source_funnel() counts leads, jobs, invoices and money received
//     per source, takes an old job's source from the booking that made it, and
//     leaves Paid empty for accounts that can't view finance.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'infra', 'phase5_attribution_and_ga4.sql'), 'utf8');
const T = '07775ed9-0000-4000-8000-000000000001';
const OWNER = 'owner@example.com';
const TECH = 'tech@example.com';

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
  create function auth.role() returns text language sql stable as $$ select coalesce(auth.jwt() ->> 'role', 'anon') $$;

  create table public.account_roles (email text primary key, tenant_id uuid, can_view_finance boolean not null default false);
  insert into public.account_roles values ('${OWNER}', '${T}', true), ('${TECH}', '${T}', false);
  alter table public.account_roles enable row level security;
  create function public.current_user_has_any_role() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email')) $$;
  create function public.current_tenant_id() returns uuid language sql stable security definer set search_path = public as $$
    select tenant_id from public.account_roles where email = (select auth.jwt() ->> 'email') limit 1 $$;
  create policy "Authenticated can view account roles" on public.account_roles for select to authenticated using ((select public.current_user_has_any_role()));
  grant select on public.account_roles to authenticated;
  create function public.default_tenant_id_triple_h() returns uuid language sql stable as $$ select '${T}'::uuid $$;
  create function public.set_tenant_id_from_session() returns trigger language plpgsql security definer set search_path = public as $$
    begin if new.tenant_id is null then new.tenant_id := coalesce(public.current_tenant_id(), public.default_tenant_id_triple_h()); end if; return new; end $$;

  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  insert into vault.decrypted_secrets values ('send_push_service_role_key', 'test-key');
  create schema net;
  create table net.calls (url text, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language plpgsql as $$
    begin insert into net.calls values (url, body); return 1; end $$;

  create sequence public.th_leads_id_seq;
  create table public.th_leads (
    id bigint primary key default nextval('public.th_leads_id_seq'), name text, phone text, email text, service text,
    details text, handled boolean default false, created_at timestamptz default now(), referred_by text, source text,
    utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text, referred_by_code text,
    tenant_id uuid default public.default_tenant_id_triple_h());
  grant usage on sequence public.th_leads_id_seq to anon, authenticated;
  alter table public.th_leads enable row level security;
  create policy "Anyone can submit a lead" on public.th_leads for insert to anon, authenticated with check (true);
  create policy "staff read leads" on public.th_leads for select using (auth.role() = 'authenticated' and exists (select 1 from public.account_roles where email = auth.email()) and tenant_id = public.current_tenant_id());
  create policy "staff update leads" on public.th_leads for update using (auth.role() = 'authenticated' and exists (select 1 from public.account_roles where email = auth.email()) and tenant_id = public.current_tenant_id());
  grant select, insert, update on public.th_leads to anon, authenticated;

  create sequence public.th_bookings_id_seq;
  create table public.th_bookings (
    id bigint primary key default nextval('public.th_bookings_id_seq'), service_key text, service_label text,
    start_at timestamptz, end_at timestamptz, name text, phone text, email text, address text, notes text,
    status text default 'confirmed', created_at timestamptz default now(), job_id bigint, cancel_token uuid default gen_random_uuid(),
    referred_by text, source text, utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
    referred_by_code text, tenant_id uuid);
  create trigger set_tenant_id before insert on public.th_bookings for each row execute function public.set_tenant_id_from_session();
  alter table public.th_bookings enable row level security;
  create policy "staff bookings" on public.th_bookings for select using (auth.role() = 'authenticated' and exists (select 1 from public.account_roles where email = auth.email()) and tenant_id = public.current_tenant_id());
  grant select, insert, update on public.th_bookings to anon, authenticated;

  create table public.jobs (id bigint primary key, title text, referred_by text, created_at timestamptz default now(), tenant_id uuid);
  create trigger set_tenant_id before insert on public.jobs for each row execute function public.set_tenant_id_from_session();
  create table public.invoices (
    id bigint primary key, total numeric, paid boolean default false, paid_amount numeric, job_id bigint,
    created_at timestamptz default now(), tenant_id uuid, refunded_amount numeric default 0);
  create trigger set_tenant_id before insert on public.invoices for each row execute function public.set_tenant_id_from_session();
  alter table public.jobs enable row level security;
  alter table public.invoices enable row level security;
  create policy "internal jobs" on public.jobs for all to authenticated
    using (exists (select 1 from public.account_roles where email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
    with check (exists (select 1 from public.account_roles where email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
  create policy "internal invoices" on public.invoices for all to authenticated
    using (exists (select 1 from public.account_roles where email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
    with check (exists (select 1 from public.account_roles where email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
  grant select, insert, update, delete on public.jobs, public.invoices to authenticated;
`;

let dbPromise;
async function db() {
  if (!dbPromise) dbPromise = (async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(MIGRATION);
    await d.exec(MIGRATION); // re-runnable
    return d;
  })();
  return dbPromise;
}
after(async () => { if (dbPromise) await (await dbPromise).close(); });

async function as(email, fn) {
  const d = await db();
  return d.transaction(async (tx) => {
    await tx.query(email ? 'set local role authenticated' : 'set local role anon');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(email ? { email, role: 'authenticated' } : { role: 'anon' })]);
    return fn(tx);
  });
}
const q = (email, sql, params) => as(email, (tx) => tx.query(sql, params));
const admin = async (sql, params) => (await db()).query(sql, params);
const calls = async () => (await admin('select url, body from net.calls order by 1')).rows;
const soon = () => new Date(Date.now() + 86400000).toISOString();
const later = () => new Date(Date.now() + 86400000 + 3600000).toISOString();

test('the public lead form and booking function keep the visit ID and first referrer host; junk is dropped, never the lead', async () => {
  await q(null, `insert into public.th_leads (name, ga_client_id, landing_referrer, utm_campaign) values
    ('Sample A', '1234567890.1700000000', 'WWW.Google.com', null),
    ('Sample B', '<script>', 'https://evil.example/path?x', 'spring')`);
  const rows = (await admin("select name, ga_client_id, landing_referrer from public.th_leads where name like 'Sample _' order by name")).rows;
  assert.deepEqual(rows.map((r) => [r.name, r.ga_client_id, r.landing_referrer]), [
    ['Sample A', '1234567890.1700000000', 'www.google.com'],
    ['Sample B', null, null],
  ]);
  const r = await q(null, 'select * from public.create_booking($1)', [JSON.stringify({
    name: 'Sample Booker', start_at: soon(), end_at: later(), source: 'Google Search',
    ga_client_id: '111.222', landing_referrer: 'www.bing.com',
  })]);
  assert.ok(r.rows[0].booking_id);
  const b = (await admin('select ga_client_id, landing_referrer, tenant_id from public.th_bookings where id = $1', [r.rows[0].booking_id])).rows[0];
  assert.deepEqual([b.ga_client_id, b.landing_referrer, b.tenant_id], ['111.222', 'www.bing.com', T]);
});

test('a visitor cannot link their lead to a job; staff can', async () => {
  await admin("insert into public.jobs (id, title, tenant_id) values (900, 'Someone else''s job', $1)", [T]);
  await q(null, "insert into public.th_leads (name, job_id, ga_client_id) values ('Sneaky', 900, '9.9')");
  assert.equal((await admin("select job_id from public.th_leads where name = 'Sneaky'")).rows[0].job_id, null);
  await q(OWNER, "update public.th_leads set job_id = 900 where name = 'Sample A'");
  assert.equal(Number((await admin("select job_id from public.th_leads where name = 'Sample A'")).rows[0].job_id), 900);
});

test('an invoice turning paid queues one sale and calls ga4-conversion once, only when its job came from a visitor with a visit ID', async () => {
  await admin('delete from net.calls');
  // Job 900 came from lead "Sample A" (visit ID 1234567890.1700000000).
  await q(OWNER, 'insert into public.invoices (id, total, job_id) values (5001, 240, 900)');
  assert.equal((await calls()).length, 0, 'unpaid: nothing');
  await q(OWNER, 'update public.invoices set paid = true, paid_amount = 240 where id = 5001');
  let c = await calls();
  assert.equal(c.length, 1);
  assert.equal(c[0].url, 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/ga4-conversion');
  assert.deepEqual(c[0].body, { invoice_id: 5001 }, 'only the invoice number goes out from the database');
  const row = (await admin('select * from public.ga_conversions where invoice_id = 5001')).rows[0];
  assert.equal(row.ga_client_id, '1234567890.1700000000');
  assert.equal(Number(row.value), 240);
  assert.equal(row.status, 'pending');

  await q(OWNER, 'update public.invoices set paid = false where id = 5001');
  await q(OWNER, 'update public.invoices set paid = true where id = 5001');
  await q(OWNER, "update public.invoices set total = 241 where id = 5001");
  assert.equal((await calls()).length, 1, 'unpaid then paid again, or any other edit: never a second send');

  // Arrives already paid (a POS charge, a mirror insert).
  await q(OWNER, 'insert into public.invoices (id, total, paid, paid_amount, job_id, refunded_amount) values (5002, 100, true, 100, 900, 25)');
  assert.equal(Number((await admin('select value from public.ga_conversions where invoice_id = 5002')).rows[0].value), 75, 'money actually kept');

  // A job with no lead/booking visit ID, and an invoice with no job: nothing queued.
  await admin("insert into public.jobs (id, title, tenant_id) values (901, 'Walk-in', $1)", [T]);
  await q(OWNER, 'insert into public.invoices (id, total, paid, job_id) values (5003, 50, true, 901), (5004, 60, true, null)');
  assert.equal((await calls()).length, 2);
  assert.equal((await admin('select count(*)::int n from public.ga_conversions')).rows[0].n, 2);
});

test('a problem inside the GA step never blocks marking an invoice paid', async () => {
  await admin('drop function net.http_post(text, jsonb, jsonb, int)');
  try {
    await admin("insert into public.th_bookings (name, job_id, ga_client_id, tenant_id) values ('Sample C', 902, '5.6', $1)", [T]);
    await admin("insert into public.jobs (id, title, tenant_id) values (902, 'From a booking', $1)", [T]);
    await q(OWNER, 'insert into public.invoices (id, total, job_id) values (5005, 80, 902)');
    await q(OWNER, 'update public.invoices set paid = true where id = 5005');
    assert.equal((await admin('select paid from public.invoices where id = 5005')).rows[0].paid, true);
  } finally {
    await admin(`create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language plpgsql as $$
      begin insert into net.calls values (url, body); return 1; end $$`);
  }
});

test('the website report and the sales queue: internal accounts read, nobody but the server writes, visitors see nothing', async () => {
  await admin(`insert into public.ga_report_cache (period, report) values ('90d', '{"sessions": 10}')`);
  assert.equal((await q(TECH, 'select count(*)::int n from public.ga_report_cache')).rows[0].n, 1);
  assert.ok((await q(TECH, 'select count(*)::int n from public.ga_conversions')).rows[0].n >= 1);
  await assert.rejects(q(OWNER, `insert into public.ga_report_cache (period, report) values ('30d', '{}')`), /permission denied/);
  await assert.rejects(q(OWNER, `update public.ga_conversions set status = 'sent'`), /permission denied/);
  await assert.rejects(q(null, 'select * from public.ga_report_cache'), /permission denied/);
  await assert.rejects(q(null, 'select * from public.ga_conversions'), /permission denied/);
  await assert.rejects(q(OWNER, 'select public.ga_client_id_for_job(900, $1)', [T]), /permission denied/);
  for (const fn of ['th_clean_attribution', 'ga_queue_paid_invoice']) {
    const r = await admin("select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') b", ['public.' + fn + '()']);
    assert.deepEqual([r.rows[0].a, r.rows[0].b], [false, false], fn + ' runs only as a trigger');
  }
  await assert.rejects(q(null, "select * from public.insights_source_funnel(now() - interval '90 days')"), /permission denied/);
});

test('insights_channel labels sources the way the design reads', async () => {
  const label = async (...a) => (await admin('select public.insights_channel($1, $2, $3, $4, $5, $6) as c', a)).rows[0].c;
  assert.equal(await label('Google Search', null, null, null, null, null), 'Google search');
  assert.equal(await label(null, null, null, null, null, 'www.google.com'), 'Google search');
  assert.equal(await label(null, 'google', 'organic', 'gbp', null, 'www.google.com'), 'Google Business');
  assert.equal(await label('Google Search', 'google', 'cpc', null, null, null), 'Google Ads');
  assert.equal(await label(null, 'facebook', 'paid', 'spring-tuneup', null, null), 'spring-tuneup');
  assert.equal(await label('Referral (friend or family)', null, null, null, null, null), 'Referral');
  assert.equal(await label(null, null, null, 'spring-tuneup', 'Pat Neighbor', null), 'Referral', 'a referral is a referral');
  assert.equal(await label(null, null, null, null, null, 'm.facebook.com'), 'Social');
  assert.equal(await label('Yelp / Online Reviews', null, null, null, null, null), 'Yelp / Online Reviews');
  assert.equal(await label(null, null, null, null, null, null), 'Not known');
});

test('the source funnel counts leads, jobs, invoices and money received per source; Paid is empty without finance access', async () => {
  const d = await db();
  await d.exec(`
    delete from public.invoices; delete from public.ga_conversions; delete from public.th_leads; delete from public.th_bookings; delete from public.jobs;
    insert into public.th_leads (name, source, job_id, tenant_id) values ('L1', 'Google Search', 10, '${T}'), ('L2', 'Google Search', null, '${T}'), ('L3', null, null, '${T}');
    insert into public.th_leads (name, source, created_at, tenant_id) values ('Old', 'Google Search', now() - interval '200 days', '${T}');
    insert into public.th_bookings (name, utm_campaign, job_id, tenant_id) values ('B1', 'spring-tuneup', 11, '${T}');
    insert into public.th_bookings (name, utm_campaign, status, tenant_id) values ('B2', 'spring-tuneup', 'cancelled', '${T}');
    insert into public.jobs (id, title, source, tenant_id) values (10, 'From L1', 'Google Search', '${T}');
    insert into public.jobs (id, title, tenant_id) values (11, 'From B1, made before Phase 5', '${T}'), (12, 'Walk-in', '${T}');
    insert into public.invoices (id, total, paid, paid_amount, job_id, tenant_id) values
      (1, 200, true, 200, 10, '${T}'), (2, 300, false, 100, 11, '${T}'), (3, 50, false, null, 12, '${T}');
  `);
  const owner = (await q(OWNER, "select * from public.insights_source_funnel(now() - interval '90 days')")).rows;
  const byCh = Object.fromEntries(owner.map((r) => [r.channel, [r.leads, r.jobs, r.invoiced, r.paid == null ? null : Number(r.paid)]]));
  assert.deepEqual(byCh, {
    'Google search': [2, 1, 1, 200],
    'spring-tuneup': [1, 1, 1, 100],
    'Not known': [1, 1, 1, 0],
  }, 'the 200-day-old lead and the cancelled booking are out; job 11 takes its source from the booking that made it');
  assert.equal(owner[owner.length - 1].channel, 'Not known', 'Not known sits last');
  const tech = (await q(TECH, "select * from public.insights_source_funnel(now() - interval '90 days')")).rows;
  assert.ok(tech.length === 3 && tech.every((r) => r.paid === null), 'counts yes, money no');
});
