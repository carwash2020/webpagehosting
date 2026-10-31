// Shared PGlite harness for sql/payments/01_stripe_event_ledger_payments_refunds.sql.
//
// BASE_SCHEMA mirrors the live column shapes of the tables the migration
// touches (read from information_schema on 2026-10-31): bigint ids on
// invoices / client_portal_invoices, identity ids on stripe_customers /
// card_authorizations, nullable tenant_id everywhere, clients.email_norm as
// a generated column. Supabase's roles, auth.* helpers, default privileges
// and the multi-tenant helpers are stubbed the same way the other *-db tests do.

const fs = require('fs');
const path = require('path');

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', '..', 'sql', 'payments', '01_stripe_event_ledger_payments_refunds.sql'), 'utf8');

const TRIPLE_H = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const STAFF = { email: 'staff@triplehenterprisesllc.biz', role: 'authenticated' };
const OTHER_STAFF = { email: 'staff@other.example', role: 'authenticated' };
const CLIENT = { email: 'pat@example.com', role: 'authenticated' };

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;

  create table public.tenants (id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null default '');
  insert into public.tenants (id, slug) values ('${TRIPLE_H}', 'triple-h'), ('${OTHER}', 'other');

  create table public.account_roles (email text primary key, tenant_id uuid references public.tenants(id));
  insert into public.account_roles values ('${STAFF.email}', '${TRIPLE_H}'), ('${OTHER_STAFF.email}', '${OTHER}');

  create function public.current_tenant_id() returns uuid language sql stable security definer set search_path = public as $$
    select ar.tenant_id from public.account_roles ar where ar.email = (select auth.jwt() ->> 'email') limit 1 $$;
  -- Stub: the live function also enforces internal MFA; that's tested elsewhere.
  create function public.current_user_has_any_role() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email')) $$;
  create function public.default_tenant_id_triple_h() returns uuid language sql stable security definer set search_path = public as $$
    select id from public.tenants where slug = 'triple-h' $$;
  create function public.set_tenant_id_from_session() returns trigger language plpgsql security definer set search_path = public as $$
  begin
    if new.tenant_id is null then new.tenant_id := coalesce(public.current_tenant_id(), public.default_tenant_id_triple_h()); end if;
    return new;
  end $$;

  create table public.clients (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid references public.tenants(id),
    display_name text not null,
    email text,
    email_norm text generated always as (nullif(lower(btrim(email)), '')) stored,
    merged_into_id uuid,
    not_a_client boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now());

  create table public.invoices (
    id bigint primary key, invoice_number text, client_email text, total numeric,
    paid boolean not null default false, paid_amount numeric,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    tenant_id uuid references public.tenants(id), client_id uuid references public.clients(id));
  alter table public.invoices enable row level security;
  create policy "internal accounts can manage invoices" on public.invoices for all to authenticated
    using (exists (select 1 from account_roles where email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
    with check (exists (select 1 from account_roles where email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

  create table public.client_portal_invoices (
    id bigint primary key, source_invoice_id bigint not null unique, client_email text not null,
    client_name text not null default 'Client', invoice_number text not null, invoice_date date not null default current_date,
    description text, total numeric not null, paid boolean not null default false, paid_at timestamptz,
    stripe_payment_intent_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    line_items jsonb, tenant_id uuid references public.tenants(id));
  alter table public.client_portal_invoices enable row level security;
  create policy "clients or internal accounts can view invoices" on public.client_portal_invoices
    for select to authenticated using ((select auth.email()) = client_email);

  create table public.stripe_customers (
    id bigint generated always as identity primary key, client_email text not null unique,
    stripe_customer_id text not null unique, created_at timestamptz not null default now(),
    tenant_id uuid references public.tenants(id));

  create table public.card_authorizations (
    id bigint generated always as identity primary key, client_email text not null, stripe_customer_id text,
    signer_name text not null, authorization_text text not null, context text not null,
    created_at timestamptz not null default now(), tenant_id uuid references public.tenants(id));

  create table public.stripe_pos_charges_logged (
    payment_intent_id text primary key, logged_at timestamptz not null default now());
`;

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

// Seed: client Pat (one Triple H client), invoices 101/102/103 mirrored into
// the portal as 1/2/3, a Stripe customer and a card authorization for Pat,
// and one invoice (104/4) already paid by card before the ledger existed.
const SEED = `
  insert into public.clients (id, tenant_id, display_name, email) values
    ('cccccccc-0000-4000-8000-000000000001', '${TRIPLE_H}', 'Pat Client', 'Pat@Example.com');
  insert into public.invoices (id, invoice_number, client_email, total, paid, paid_amount, tenant_id) values
    (101, 'INV-101', 'pat@example.com', 150.00, false, 0, '${TRIPLE_H}'),
    (102, 'INV-102', 'pat@example.com', 40.00, false, 0, '${TRIPLE_H}'),
    (103, 'INV-103', 'pat@example.com', 60.00, false, 0, '${TRIPLE_H}'),
    (104, 'INV-104', 'pat@example.com', 80.00, true, 80.00, '${TRIPLE_H}');
  insert into public.client_portal_invoices (id, source_invoice_id, client_email, invoice_number, total, paid, paid_at, stripe_payment_intent_id, tenant_id) values
    (1, 101, 'pat@example.com', 'INV-101', 150.00, false, null, 'pi_single', '${TRIPLE_H}'),
    (2, 102, 'pat@example.com', 'INV-102', 40.00, false, null, 'pi_bulk', '${TRIPLE_H}'),
    (3, 103, 'pat@example.com', 'INV-103', 60.00, false, null, 'pi_bulk', null),
    (4, 104, 'pat@example.com', 'INV-104', 80.00, true, '2026-10-01T12:00:00Z', 'pi_old', null);
  insert into public.stripe_customers (client_email, stripe_customer_id, tenant_id) values ('pat@example.com', 'cus_pat', null);
  insert into public.card_authorizations (client_email, stripe_customer_id, signer_name, authorization_text, context)
    values ('pat@example.com', 'cus_pat', 'Pat', 'I authorize...', 'invoice_payment');
`;

const dbs = [];
async function buildDb({ seed = true, migrate = true } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  dbs.push(db);
  await db.exec(BASE_SCHEMA);
  if (seed) await db.exec(SEED);
  if (migrate) await db.exec(MIGRATION);
  return db;
}
async function closeAll() { await Promise.all(dbs.splice(0).map((db) => db.close().catch(() => {}))); }

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));
}

// Calls stripe_record_event exactly as stripe-webhook does (as service_role).
async function recordEvent(db, event, refunds = null) {
  const rows = await as(db, { role: 'service_role' },
    'select public.stripe_record_event($1::jsonb, $2::jsonb) as r', [JSON.stringify(event), refunds ? JSON.stringify(refunds) : null]);
  if (rows.error) throw rows.error;
  return rows[0].r;
}

module.exports = { MIGRATION, BASE_SCHEMA, SEED, TRIPLE_H, OTHER, STAFF, OTHER_STAFF, CLIENT, as, buildDb, closeAll, fixture, recordEvent };
