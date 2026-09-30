-- Item 1 Phase 1a, step 1 of 2: the unified `clients` table, and moving the
-- old local client ids to `legacy_client_id` (docs/ITEM-1-MIGRATION-PLAN.md,
-- docs/ITEM-1-INVENTORY.md "Decisions needed before Phase 1", decided by
-- Connor 2026-09-30).
--
-- Additive only. Nothing is dropped or retyped here, and no app read changes.
--
-- WHY TWO STEPS. jobs, invoices and quotes already have `client_id text`,
-- holding the local registry ids ('c_…'). The plan's new FK needs that name
-- as `client_id uuid references clients(id)`. A browser tab still running the
-- old cached sync.js keeps sending `client_id: 'c_…'`; if the column were a
-- uuid now, every save from that tab would fail with 22P02 (the Tier 0 bug
-- shape again). So:
--   1. (this file) add `legacy_client_id text` and copy the old values into
--      it; the new sync.js writes `legacy_client_id` instead of `client_id`;
--      a trigger copies `client_id` into `legacy_client_id` for any old tab,
--      and records that it happened in `legacy_client_id_writes`.
--   2. (a later file, once `legacy_client_id_writes` shows no old writers for
--      a while) drop the text `client_id`, the trigger and the log table, and
--      add `client_id uuid references clients(id)`.
-- contracts and client_profiles have no `client_id` today, so they get the
-- uuid FK now.
--
-- TENANT. `clients` gets the `set_tenant_id` trigger (the 06 pattern; with
-- 07's Triple H fallback) and a staff policy checking current_tenant_id(),
-- so tests/sync/tenant-insert-guard.test.js covers it.

-- ---------------------------------------------------------------------------
-- A reusable updated_at trigger. None of the Item 1 tables has one yet
-- (docs/ITEM-1-INVENTORY.md "Schema facts"); Phase 3's conflict detection
-- will need it on every migrated table. Attached to `clients` only here.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- clients
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id),
  display_name text not null check (btrim(display_name) <> ''),
  email text,
  phone text,
  address text,                           -- decision 2
  role text,                              -- decision 3: from contacts; flags suppliers/trades in review
  notes text,                             -- decision 3
  -- Match columns, same rule as thNormalizeClientName() (tools/data-layer.js):
  -- trim, lowercase, collapse runs of whitespace.
  name_norm text generated always as (lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g'))) stored,
  email_norm text generated always as (nullif(lower(btrim(email)), '')) stored,
  phone_digits text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  -- Where the row came from, for seeding and review (decision 1).
  legacy_id text,                         -- th_clients id ('c_…')
  legacy_contact_id bigint,               -- th_tracker_contacts id
  seed_source text check (seed_source in ('registry', 'contact', 'portal', 'record_name', 'created')),
  needs_match boolean not null default false,  -- Phase 3.5: offline creates wait for review
  merged_into_id uuid references public.clients(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (merged_into_id is null or merged_into_id <> id)
);

create unique index if not exists clients_tenant_legacy_id_key
  on public.clients (tenant_id, legacy_id) where legacy_id is not null;
create unique index if not exists clients_tenant_legacy_contact_id_key
  on public.clients (tenant_id, legacy_contact_id) where legacy_contact_id is not null;
create index if not exists clients_tenant_name_norm_idx on public.clients (tenant_id, name_norm);
create index if not exists clients_tenant_email_norm_idx on public.clients (tenant_id, email_norm) where email_norm is not null;
create index if not exists clients_tenant_phone_digits_idx on public.clients (tenant_id, phone_digits) where phone_digits is not null;
create index if not exists clients_merged_into_id_idx on public.clients (merged_into_id) where merged_into_id is not null;

drop trigger if exists set_tenant_id on public.clients;
create trigger set_tenant_id before insert on public.clients
  for each row execute function public.set_tenant_id_from_session();

drop trigger if exists set_updated_at on public.clients;
create trigger set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

alter table public.clients enable row level security;
revoke all on public.clients from anon;

drop policy if exists "internal accounts can manage clients" on public.clients;
create policy "internal accounts can manage clients" on public.clients
  for all to authenticated
  using (
    exists (select 1 from public.account_roles where account_roles.email = (select auth.email()))
    and tenant_id = (select public.current_tenant_id())
  )
  with check (
    exists (select 1 from public.account_roles where account_roles.email = (select auth.email()))
    and tenant_id = (select public.current_tenant_id())
  );

-- ---------------------------------------------------------------------------
-- The uuid FK where the name is free now.
alter table public.contracts add column if not exists client_id uuid references public.clients(id);
alter table public.client_profiles add column if not exists client_id uuid references public.clients(id);
create index if not exists contracts_client_id_idx on public.contracts (client_id) where client_id is not null;
create index if not exists client_profiles_client_id_idx on public.client_profiles (client_id) where client_id is not null;

-- ---------------------------------------------------------------------------
-- legacy_client_id: the old local ids, under their permanent name.
alter table public.jobs add column if not exists legacy_client_id text;
alter table public.invoices add column if not exists legacy_client_id text;
alter table public.quotes add column if not exists legacy_client_id text;
alter table public.contracts add column if not exists legacy_client_id text;

-- Safe to run: the only other trigger on these tables, jobs.on_job_status_change,
-- sends an email only when cancelled_at or reschedule_requested_at is newly set.
update public.jobs set legacy_client_id = client_id where legacy_client_id is null and client_id is not null;
update public.invoices set legacy_client_id = client_id where legacy_client_id is null and client_id is not null;
update public.quotes set legacy_client_id = client_id where legacy_client_id is null and client_id is not null;

-- Transition: a tab on the old sync.js still writes `client_id`. Copy it into
-- `legacy_client_id` and note when it last happened, so step 2 knows when no
-- old writers are left. Remove both in step 2.
create table if not exists public.legacy_client_id_writes (
  table_name text primary key,
  last_seen timestamptz not null,
  write_count bigint not null default 0
);
alter table public.legacy_client_id_writes enable row level security;  -- no policies: postgres only
revoke all on public.legacy_client_id_writes from anon, authenticated;

create or replace function public.copy_client_id_to_legacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only when the writer set client_id: on insert a non-null value, on update
  -- a changed one. The mirror's upsert is INSERT ... ON CONFLICT DO UPDATE,
  -- and the BEFORE INSERT trigger fires on the proposed row even when it
  -- becomes an update, so every save from an old tab is logged, re-saves
  -- included. That's what step 2 needs to know. The new sync.js never sends
  -- client_id, so it never logs.
  if new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id) then
    new.legacy_client_id := new.client_id;
    insert into public.legacy_client_id_writes as w (table_name, last_seen, write_count)
      values (tg_table_name, now(), 1)
      on conflict (table_name) do update set last_seen = excluded.last_seen, write_count = w.write_count + 1;
  end if;
  return new;
end;
$$;
revoke execute on function public.copy_client_id_to_legacy() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['jobs', 'invoices', 'quotes'] loop
    execute format('drop trigger if exists copy_client_id_to_legacy on public.%I', t);
    execute format(
      'create trigger copy_client_id_to_legacy before insert or update on public.%I '
      'for each row execute function public.copy_client_id_to_legacy()', t);
  end loop;
end;
$$;

comment on column public.jobs.client_id is
  'DEPRECATED (Item 1 Phase 1): old local registry id, now written to legacy_client_id. Becomes the uuid FK to clients in step 2 (sql/item1/).';
comment on column public.invoices.client_id is
  'DEPRECATED (Item 1 Phase 1): old local registry id, now written to legacy_client_id. Becomes the uuid FK to clients in step 2 (sql/item1/).';
comment on column public.quotes.client_id is
  'DEPRECATED (Item 1 Phase 1): old local registry id, now written to legacy_client_id. Becomes the uuid FK to clients in step 2 (sql/item1/).';
