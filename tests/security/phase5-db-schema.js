// Live-shaped tables for the Phase 5 attribution migration's PGlite tests
// (phase5-attribution-db.test.js, group4-insights-db.test.js): th_leads,
// th_bookings, jobs and invoices with their RLS as live, simplified to the
// same "internal account of this business" test, plus stand-ins for Vault
// and pg_net that record what would be sent.
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
    id bigint primary key, client_name text, total numeric, paid boolean default false, paid_amount numeric, job_id bigint,
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

module.exports = { T, OWNER, TECH, SCHEMA };
