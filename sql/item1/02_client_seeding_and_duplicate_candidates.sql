-- Item 1 Phase 1b, part 1: seed `clients` and list likely duplicates
-- (docs/ITEM-1-MIGRATION-PLAN.md "1b. Seeding and dedup",
-- docs/ITEM-1-INVENTORY.md section 3.7).
--
-- This file only defines things: a candidates table and two functions. It
-- writes no data. The seed itself is a separate, approved run:
--   select public.item1_seed_clients((select id from public.tenants where slug = 'triple-h'),
--                                    'tripleh-workspace-2026');
--   select public.refresh_client_duplicate_candidates((select id from public.tenants where slug = 'triple-h'));
--
-- Seed sources, in order (each one skips what an earlier one already covers):
--   1. registry     th_clients in the blob. legacy_id = the 'c_…' id, which
--                   is what jobs/invoices/quotes.legacy_client_id hold.
--   2. contact      th_tracker_contacts in the blob (decision 1: contacts
--                   merge into clients). Keeps role and notes (decision 3).
--   3. portal       client_profiles rows with no client_id yet; the new row
--                   is linked back through client_profiles.client_id.
--   4. record_name  a client name on jobs, invoices, quotes or contracts that
--                   no row above has and whose record isn't already tied to
--                   a registry id.
-- Nothing is merged here. The same person from two sources gets two rows and
-- a candidate pair; the review queue (tools/clients.html, next PR) decides.
--
-- DELETED CLIENTS ARE NOT RE-SEEDED. A registry or contact entry with a live
-- tombstone is skipped, and so is a record name matching a live client
-- tombstone's normalizedName: the same rule as thBackfillClients()
-- (tools/data-layer.js). A tombstone is live unless Restore lifted it
-- (restoredAt at or after deletedAt).
--
-- Both functions are safe to re-run. Registry and contact rows are keyed by
-- legacy_id / legacy_contact_id, portal rows by client_profiles.client_id,
-- record names by name_norm. A re-run adds only what's new.

-- ---------------------------------------------------------------------------
-- Candidate pairs. One row per pair of clients that might be the same
-- person, with why. client_a < client_b so each pair appears once.
create table if not exists public.client_duplicate_candidates (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id),
  client_a uuid not null references public.clients(id) on delete cascade,
  client_b uuid not null references public.clients(id) on delete cascade,
  reasons text[] not null,                -- any of 'email', 'phone', 'name'
  status text not null default 'open' check (status in ('open', 'merged', 'kept_separate')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_a < client_b),
  unique (client_a, client_b)
);
create index if not exists client_duplicate_candidates_tenant_status_idx
  on public.client_duplicate_candidates (tenant_id, status);
create index if not exists client_duplicate_candidates_client_b_idx
  on public.client_duplicate_candidates (client_b);

drop trigger if exists set_tenant_id on public.client_duplicate_candidates;
create trigger set_tenant_id before insert on public.client_duplicate_candidates
  for each row execute function public.set_tenant_id_from_session();

drop trigger if exists set_updated_at on public.client_duplicate_candidates;
create trigger set_updated_at before update on public.client_duplicate_candidates
  for each row execute function public.set_updated_at();

alter table public.client_duplicate_candidates enable row level security;
revoke all on public.client_duplicate_candidates from anon;

drop policy if exists "internal accounts can manage client duplicate candidates" on public.client_duplicate_candidates;
create policy "internal accounts can manage client duplicate candidates" on public.client_duplicate_candidates
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
-- A timestamp from the blob, or null if it doesn't parse.
create or replace function public.item1_try_timestamptz(p text)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end;
$$;
revoke execute on function public.item1_try_timestamptz(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The seed. Runs as postgres (it reads the blob and writes across RLS), so
-- tenant_id is set explicitly on every row rather than left to the trigger.
create or replace function public.item1_seed_clients(p_tenant uuid, p_sync_code text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_blob jsonb;
  v_registry jsonb;
  v_contacts jsonb;
  v_client_tombstones jsonb;
  v_contact_tombstones jsonb;
  v_registry_n int := 0;
  v_contact_n int := 0;
  v_portal_n int := 0;
  v_record_name_n int := 0;
  v_profile record;
  v_id uuid;
begin
  if p_tenant is null or not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'item1_seed_clients: unknown tenant %', p_tenant;
  end if;

  select data into v_blob from public.workspace_sync where code = p_sync_code;
  if v_blob is null then
    raise exception 'item1_seed_clients: no workspace_sync row for code %', p_sync_code;
  end if;

  -- Each key is stored as a JSON string holding the array (tools/sync.js).
  v_registry := coalesce((v_blob ->> 'th_clients')::jsonb, '[]'::jsonb);
  v_contacts := coalesce((v_blob ->> 'th_tracker_contacts')::jsonb, '[]'::jsonb);
  v_client_tombstones := coalesce((v_blob ->> 'th_client_tombstones')::jsonb, '[]'::jsonb);
  v_contact_tombstones := coalesce((v_blob ->> 'th_contact_tombstones')::jsonb, '[]'::jsonb);
  if jsonb_typeof(v_registry) <> 'array' then v_registry := '[]'; end if;
  if jsonb_typeof(v_contacts) <> 'array' then v_contacts := '[]'; end if;
  if jsonb_typeof(v_client_tombstones) <> 'array' then v_client_tombstones := '[]'; end if;
  if jsonb_typeof(v_contact_tombstones) <> 'array' then v_contact_tombstones := '[]'; end if;

  drop table if exists item1_live_client_tombstones;
  create temp table item1_live_client_tombstones on commit drop as
    select t ->> 'id' as id, t ->> 'normalizedName' as name_norm
    from jsonb_array_elements(v_client_tombstones) t
    where jsonb_typeof(t) = 'object'
      and (t ->> 'restoredAt' is null
           or public.item1_try_timestamptz(t ->> 'restoredAt') is null
           or public.item1_try_timestamptz(t ->> 'deletedAt') > public.item1_try_timestamptz(t ->> 'restoredAt'));

  -- 1. registry
  insert into public.clients (tenant_id, display_name, email, phone, address, legacy_id, seed_source, created_at)
  select p_tenant,
         btrim(c ->> 'name'),
         nullif(btrim(coalesce(c ->> 'email', '')), ''),
         nullif(btrim(coalesce(c ->> 'phone', '')), ''),
         nullif(btrim(coalesce(c ->> 'address', '')), ''),
         c ->> 'id',
         'registry',
         coalesce(public.item1_try_timestamptz(c ->> 'createdAt'), now())
  from jsonb_array_elements(v_registry) c
  where jsonb_typeof(c) = 'object'
    and nullif(btrim(coalesce(c ->> 'id', '')), '') is not null
    and btrim(coalesce(c ->> 'name', '')) <> ''
    and not exists (select 1 from item1_live_client_tombstones t where t.id = c ->> 'id')
  on conflict (tenant_id, legacy_id) where legacy_id is not null do nothing;
  get diagnostics v_registry_n = row_count;

  -- 2. contacts
  insert into public.clients (tenant_id, display_name, email, phone, role, notes, legacy_contact_id, seed_source, created_at)
  select p_tenant,
         btrim(c ->> 'name'),
         nullif(btrim(coalesce(c ->> 'email', '')), ''),
         nullif(btrim(coalesce(c ->> 'phone', '')), ''),
         nullif(btrim(coalesce(c ->> 'role', '')), ''),
         nullif(btrim(coalesce(c ->> 'notes', '')), ''),
         (c ->> 'id')::bigint,
         'contact',
         to_timestamp((c ->> 'id')::bigint / 1000.0)  -- ids are Date.now()
  from jsonb_array_elements(v_contacts) c
  where jsonb_typeof(c) = 'object'
    and coalesce(c ->> 'id', '') ~ '^\d{1,18}$'
    and btrim(coalesce(c ->> 'name', '')) <> ''
    and not exists (
      select 1 from jsonb_array_elements(v_contact_tombstones) t
      where jsonb_typeof(t) = 'object'
        and t ->> 'id' = c ->> 'id'
        and (t ->> 'restoredAt' is null
             or public.item1_try_timestamptz(t ->> 'restoredAt') is null
             or public.item1_try_timestamptz(t ->> 'deletedAt') > public.item1_try_timestamptz(t ->> 'restoredAt')))
  on conflict (tenant_id, legacy_contact_id) where legacy_contact_id is not null do nothing;
  get diagnostics v_contact_n = row_count;

  -- 3. portal accounts not linked yet
  for v_profile in
    select client_email, display_name, phone, updated_at
    from public.client_profiles
    where tenant_id = p_tenant and client_id is null and btrim(coalesce(client_email, '')) <> ''
    order by client_email
  loop
    insert into public.clients (tenant_id, display_name, email, phone, seed_source, created_at)
    values (p_tenant,
            coalesce(nullif(btrim(coalesce(v_profile.display_name, '')), ''), btrim(v_profile.client_email)),
            btrim(v_profile.client_email),
            nullif(btrim(coalesce(v_profile.phone, '')), ''),
            'portal',
            coalesce(v_profile.updated_at, now()))
    returning id into v_id;
    update public.client_profiles set client_id = v_id
      where client_email = v_profile.client_email and tenant_id = p_tenant;
    v_portal_n := v_portal_n + 1;
  end loop;

  -- 4. names on records that nothing above covers. The most recent record's
  -- spelling and details win: they're the most likely to be current.
  with raw as (
    select client as name, client_email as email, phone, address, legacy_client_id, created_at
      from public.jobs where tenant_id = p_tenant
    union all
    select client_name, client_email, null, null, legacy_client_id, created_at
      from public.invoices where tenant_id = p_tenant
    union all
    select client_name, client_email, null, null, legacy_client_id, created_at
      from public.quotes where tenant_id = p_tenant
    union all
    -- contract fields use these keys (inventory bug: the app reads
    -- clientEmail/clientPhone/clientAddress, which don't exist).
    select fields ->> 'clientName', fields ->> 'email', fields ->> 'phone', fields ->> 'serviceAddress',
           legacy_client_id, created_at
      from public.contracts where tenant_id = p_tenant
  ), named as (
    select btrim(name) as name,
           lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) as name_norm,
           nullif(btrim(coalesce(email, '')), '') as email,
           nullif(btrim(coalesce(phone, '')), '') as phone,
           nullif(btrim(coalesce(address, '')), '') as address,
           created_at
    from raw r
    where btrim(coalesce(name, '')) <> ''
      -- tied to a registry id we seeded: matched by id in the FK backfill
      and not exists (select 1 from public.clients c
                      where c.tenant_id = p_tenant and c.legacy_id = r.legacy_client_id)
      -- tied to a deleted registry id: deliberately deleted
      and not exists (select 1 from item1_live_client_tombstones t where t.id = r.legacy_client_id)
  ), grouped as (
    select name_norm,
           (array_agg(name order by created_at desc nulls last))[1] as display_name,
           (array_agg(email order by created_at desc nulls last) filter (where email is not null))[1] as email,
           (array_agg(phone order by created_at desc nulls last) filter (where phone is not null))[1] as phone,
           (array_agg(address order by created_at desc nulls last) filter (where address is not null))[1] as address,
           min(created_at) as created_at  -- the client existed from the first record
    from named
    group by name_norm
  )
  insert into public.clients (tenant_id, display_name, email, phone, address, seed_source, created_at)
  select p_tenant, g.display_name, g.email, g.phone, g.address, 'record_name', coalesce(g.created_at, now())
  from grouped g
  where not exists (select 1 from public.clients c where c.tenant_id = p_tenant and c.name_norm = g.name_norm)
    and not exists (select 1 from item1_live_client_tombstones t where t.name_norm = g.name_norm);
  get diagnostics v_record_name_n = row_count;

  drop table item1_live_client_tombstones;

  return jsonb_build_object(
    'registry', v_registry_n,
    'contact', v_contact_n,
    'portal', v_portal_n,
    'record_name', v_record_name_n,
    'total_clients', (select count(*) from public.clients where tenant_id = p_tenant));
end;
$$;
revoke execute on function public.item1_seed_clients(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Candidate pairs among live (not merged) clients: same email, same phone
-- (last 10 digits, so a leading 1 doesn't matter; 7+ digits only), or same
-- normalized name. A re-run adds new pairs and refreshes the reasons on open
-- ones; a decided pair keeps its decision. Phase 3.5 reuses this after an
-- offline client create drains.
create or replace function public.refresh_client_duplicate_candidates(p_tenant uuid)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_n int;
begin
  with live as (
    select id, email_norm, name_norm,
           case when length(phone_digits) >= 7 then right(phone_digits, 10) end as phone_key
    from public.clients
    where tenant_id = p_tenant and merged_into_id is null
  ), pairs as (
    select a.id as client_a, b.id as client_b, 'email' as reason
      from live a join live b on a.id < b.id and a.email_norm = b.email_norm
    union all
    select a.id, b.id, 'phone'
      from live a join live b on a.id < b.id and a.phone_key = b.phone_key
    union all
    select a.id, b.id, 'name'
      from live a join live b on a.id < b.id and a.name_norm = b.name_norm
  ), agg as (
    select client_a, client_b, array_agg(distinct reason order by reason) as reasons
    from pairs group by client_a, client_b
  )
  insert into public.client_duplicate_candidates as d (tenant_id, client_a, client_b, reasons)
  select p_tenant, client_a, client_b, reasons from agg
  on conflict (client_a, client_b) do update
    set reasons = excluded.reasons
    where d.status = 'open' and d.reasons is distinct from excluded.reasons;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.refresh_client_duplicate_candidates(uuid) from public, anon, authenticated;
