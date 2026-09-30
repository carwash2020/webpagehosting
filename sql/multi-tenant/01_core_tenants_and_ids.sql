-- Multi-tenant Tier 0 (batch 1/5): tenants table, current_tenant_id(),
-- and tenant_id on account_roles + client_profiles/jobs/invoices.
-- Additive only: nullable columns, backfilled to the real Triple H
-- business, existing behavior unchanged. Applied live 2026-09-30 --
-- see docs/specialist-logs/features.md for the full design writeup
-- and the local-Postgres testing that preceded it.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  branding jsonb not null default '{}'::jsonb,
  plan text not null default 'trial',
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

alter table public.tenants enable row level security;

create policy "No direct client access to tenants" on public.tenants
  for select to authenticated using (false);

insert into public.tenants (slug, name, plan)
values ('triple-h', 'Triple H Enterprises LLC', 'internal');

alter table public.account_roles
  add column tenant_id uuid references public.tenants(id);

update public.account_roles
  set tenant_id = (select id from public.tenants where slug = 'triple-h')
  where tenant_id is null;

create or replace function public.current_tenant_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select ar.tenant_id
  from public.account_roles ar
  where ar.email = (select auth.jwt() ->> 'email')
  limit 1;
$$;

revoke execute on function public.current_tenant_id() from public, anon;
grant execute on function public.current_tenant_id() to authenticated;

alter table public.client_profiles add column tenant_id uuid references public.tenants(id);
alter table public.jobs           add column tenant_id uuid references public.tenants(id);
alter table public.invoices       add column tenant_id uuid references public.tenants(id);

update public.client_profiles set tenant_id = (select id from public.tenants where slug = 'triple-h') where tenant_id is null;
update public.jobs           set tenant_id = (select id from public.tenants where slug = 'triple-h') where tenant_id is null;
update public.invoices       set tenant_id = (select id from public.tenants where slug = 'triple-h') where tenant_id is null;

create index if not exists client_profiles_tenant_id_idx on public.client_profiles(tenant_id);
create index if not exists jobs_tenant_id_idx           on public.jobs(tenant_id);
create index if not exists invoices_tenant_id_idx       on public.invoices(tenant_id);
