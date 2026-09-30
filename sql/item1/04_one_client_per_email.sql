-- Item 1 Phase 1b, part 3: one client per email.
--
-- Connor, 2026-09-30, after the three Connor Dodart cards were merged into
-- one: "make sure we can't have duplicates in the future." Decided: the same
-- email is always the same client, and is blocked outright; the same phone
-- is checked (the app reuses the existing client, and asks on Add, since a
-- couple or family can share a number); the same name is only flagged for
-- review, since two different people can share one.
--
-- This file:
--   1. A unique index: no two live clients in a tenant share an email.
--      "Live" means not merged into another client and not marked not a
--      client. A merged row keeps its email (and its legacy ids), so the
--      index leaves merged rows out.
--   2. merge_client_candidate() marks the merged client as merged BEFORE it
--      fills the kept client's blank email, so the fill can't trip the index.
--   3. item1_seed_clients() folds a new row whose email is already on a live
--      client into that client instead of creating a second live one. The
--      row is still written, already merged, so its legacy id reaches the
--      step 2 backfill through merged_into_id; the fold is recorded as a
--      decided pair (decided_by 'automatic: same email') with merge_detail,
--      the same as a merge from the review queue. A portal account whose
--      email is already on file is linked to that client.
-- The app side of the same rule is in tools/data-layer.js
-- (thFindExistingClient, used by thEnsureClient and thBackfillClients).

-- ---------------------------------------------------------------------------
-- 1. Fails if two live clients already share an email; that's deliberate:
--    merge them in the review queue first. (Production had none on
--    2026-09-30 after the Connor Dodart merge.)
create unique index if not exists clients_tenant_email_live_key
  on public.clients (tenant_id, email_norm)
  where email_norm is not null and merged_into_id is null and not not_a_client;

-- ---------------------------------------------------------------------------
-- Fills blanks on a live client from another row. Never overwrites.
-- Returns the names of the fields it filled.
create or replace function public.item1_fill_client_blanks(p_keep uuid, p_from public.clients)
returns text[]
language plpgsql
set search_path = public
as $$
declare
  v_keep public.clients%rowtype;
  v_filled text[] := '{}';
begin
  select * into v_keep from public.clients where id = p_keep;
  if v_keep.email is null and p_from.email is not null then v_filled := v_filled || 'email'::text; end if;
  if v_keep.phone is null and p_from.phone is not null then v_filled := v_filled || 'phone'::text; end if;
  if v_keep.address is null and p_from.address is not null then v_filled := v_filled || 'address'::text; end if;
  if v_keep.role is null and p_from.role is not null then v_filled := v_filled || 'role'::text; end if;
  if v_keep.notes is null and p_from.notes is not null then v_filled := v_filled || 'notes'::text; end if;
  if cardinality(v_filled) > 0 then
    update public.clients set
      email = coalesce(email, p_from.email),
      phone = coalesce(phone, p_from.phone),
      address = coalesce(address, p_from.address),
      role = coalesce(role, p_from.role),
      notes = coalesce(notes, p_from.notes)
    where id = p_keep;
  end if;
  return v_filled;
end;
$$;
revoke execute on function public.item1_fill_client_blanks(uuid, public.clients) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The merge, with the merged client marked merged before the fill.
--    Otherwise the same as sql/item1/03.
create or replace function public.merge_client_candidate(p_candidate bigint, p_keep uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.client_review_tenant();
  v_cand public.client_duplicate_candidates%rowtype;
  v_keep public.clients%rowtype;
  v_gone public.clients%rowtype;
  v_filled text[];
  v_contracts bigint[];
  v_profiles text[];
  v_chained uuid[];
  v_detail jsonb;
begin
  select * into v_cand from public.client_duplicate_candidates
    where id = p_candidate and tenant_id = v_tenant for update;
  if not found then
    raise exception 'no such candidate' using errcode = 'P0002';
  end if;
  if v_cand.status <> 'open' then
    raise exception 'this pair was already reviewed (%)', v_cand.status using errcode = '55000';
  end if;
  if p_keep is distinct from v_cand.client_a and p_keep is distinct from v_cand.client_b then
    raise exception 'the client to keep must be one of the pair' using errcode = '22023';
  end if;

  -- Lock both, in id order so two reviewers can't deadlock.
  perform 1 from public.clients where id in (v_cand.client_a, v_cand.client_b) order by id for update;
  select * into v_keep from public.clients where id = p_keep;
  select * into v_gone from public.clients
    where id = case when p_keep = v_cand.client_a then v_cand.client_b else v_cand.client_a end;
  if v_keep.merged_into_id is not null or v_gone.merged_into_id is not null then
    raise exception 'one of these clients was already merged' using errcode = '55000';
  end if;

  -- Merged first, so its email is free for the kept client to take.
  with u as (update public.clients set merged_into_id = v_keep.id where merged_into_id = v_gone.id returning id)
    select coalesce(array_agg(id order by id), '{}') into v_chained from u;
  update public.clients set merged_into_id = v_keep.id where id = v_gone.id;

  v_filled := public.item1_fill_client_blanks(v_keep.id, v_gone);

  with u as (update public.contracts set client_id = v_keep.id where client_id = v_gone.id returning id)
    select coalesce(array_agg(id order by id), '{}') into v_contracts from u;
  with u as (update public.client_profiles set client_id = v_keep.id where client_id = v_gone.id returning client_email)
    select coalesce(array_agg(client_email order by client_email), '{}') into v_profiles from u;

  v_detail := jsonb_build_object(
    'kept', v_keep.id, 'merged', v_gone.id,
    'filled', to_jsonb(v_filled),
    'kept_before', jsonb_build_object('email', v_keep.email, 'phone', v_keep.phone, 'address', v_keep.address,
                                      'role', v_keep.role, 'notes', v_keep.notes),
    'contracts', to_jsonb(v_contracts), 'client_profiles', to_jsonb(v_profiles),
    'already_merged_into_it', to_jsonb(v_chained));

  update public.client_duplicate_candidates
    set status = 'merged', decided_by = (select auth.email()), decided_at = now(), merge_detail = v_detail
    where id = v_cand.id;

  delete from public.client_duplicate_candidates
    where status = 'open' and (client_a = v_gone.id or client_b = v_gone.id);
  perform public.refresh_client_duplicate_candidates(v_tenant);

  return v_detail;
end;
$$;
revoke execute on function public.merge_client_candidate(bigint, uuid) from public, anon;
grant execute on function public.merge_client_candidate(bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. One seeded row. If its email is already on a live client, the row is
--    written already merged into that client, the client's blanks are
--    filled from it, and the fold is recorded as a decided pair. Returns
--    the live client the row now belongs to, and whether it was folded.
create or replace function public.item1_seed_one_client(
  p_tenant uuid, p_name text, p_email text, p_phone text, p_address text, p_role text, p_notes text,
  p_legacy_id text, p_legacy_contact_id bigint, p_source text, p_created_at timestamptz,
  out client_id uuid, out folded boolean)
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
  v_new public.clients%rowtype;
  v_owner_before public.clients%rowtype;
  v_filled text[];
begin
  if nullif(lower(btrim(coalesce(p_email, ''))), '') is not null then
    select * into v_owner_before from public.clients
      where tenant_id = p_tenant and email_norm = lower(btrim(p_email))
        and merged_into_id is null and not not_a_client
      for update;
    v_owner := v_owner_before.id;
  end if;

  insert into public.clients (tenant_id, display_name, email, phone, address, role, notes,
                              legacy_id, legacy_contact_id, seed_source, created_at, merged_into_id)
  values (p_tenant, p_name, p_email, p_phone, p_address, p_role, p_notes,
          p_legacy_id, p_legacy_contact_id, p_source, p_created_at, v_owner)
  returning * into v_new;

  if v_owner is null then
    client_id := v_new.id;
    folded := false;
    return;
  end if;

  v_filled := public.item1_fill_client_blanks(v_owner, v_new);
  insert into public.client_duplicate_candidates (tenant_id, client_a, client_b, reasons, status, decided_by, decided_at, merge_detail)
  values (p_tenant, least(v_owner, v_new.id), greatest(v_owner, v_new.id), '{email}', 'merged',
          'automatic: same email', now(),
          jsonb_build_object('kept', v_owner, 'merged', v_new.id, 'filled', to_jsonb(v_filled),
            'kept_before', jsonb_build_object('email', v_owner_before.email, 'phone', v_owner_before.phone,
              'address', v_owner_before.address, 'role', v_owner_before.role, 'notes', v_owner_before.notes),
            'contracts', '[]'::jsonb, 'client_profiles', '[]'::jsonb, 'already_merged_into_it', '[]'::jsonb))
  on conflict (client_a, client_b) do nothing;
  client_id := v_owner;
  folded := true;
end;
$$;
revoke execute on function public.item1_seed_one_client(uuid, text, text, text, text, text, text, text, bigint, text, timestamptz)
  from public, anon, authenticated;

-- The seed, now one row at a time through item1_seed_one_client(). Sources,
-- order and tombstone rules are unchanged from sql/item1/02; the result
-- adds 'folded' (rows whose email was already on file).
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
  v_folded_n int := 0;
  v_row record;
  v_res record;
  v_owner uuid;
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
  for v_row in
    select distinct on (c ->> 'id')
           btrim(c ->> 'name') as name,
           nullif(btrim(coalesce(c ->> 'email', '')), '') as email,
           nullif(btrim(coalesce(c ->> 'phone', '')), '') as phone,
           nullif(btrim(coalesce(c ->> 'address', '')), '') as address,
           c ->> 'id' as legacy_id,
           coalesce(public.item1_try_timestamptz(c ->> 'createdAt'), now()) as created_at
    from jsonb_array_elements(v_registry) with ordinality as e(c, n)
    where jsonb_typeof(c) = 'object'
      and nullif(btrim(coalesce(c ->> 'id', '')), '') is not null
      and btrim(coalesce(c ->> 'name', '')) <> ''
      and not exists (select 1 from item1_live_client_tombstones t where t.id = c ->> 'id')
      and not exists (select 1 from public.clients x where x.tenant_id = p_tenant and x.legacy_id = c ->> 'id')
    order by c ->> 'id', n
  loop
    select * into v_res from public.item1_seed_one_client(p_tenant, v_row.name, v_row.email, v_row.phone, v_row.address,
      null, null, v_row.legacy_id, null, 'registry', v_row.created_at);
    v_registry_n := v_registry_n + 1;
    if v_res.folded then v_folded_n := v_folded_n + 1; end if;
  end loop;

  -- 2. contacts
  for v_row in
    select distinct on ((c ->> 'id')::bigint)
           btrim(c ->> 'name') as name,
           nullif(btrim(coalesce(c ->> 'email', '')), '') as email,
           nullif(btrim(coalesce(c ->> 'phone', '')), '') as phone,
           nullif(btrim(coalesce(c ->> 'role', '')), '') as role,
           nullif(btrim(coalesce(c ->> 'notes', '')), '') as notes,
           (c ->> 'id')::bigint as legacy_contact_id
    from jsonb_array_elements(v_contacts) with ordinality as e(c, n)
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
      and not exists (select 1 from public.clients x
                      where x.tenant_id = p_tenant and x.legacy_contact_id = (c ->> 'id')::bigint)
    order by (c ->> 'id')::bigint, n
  loop
    select * into v_res from public.item1_seed_one_client(p_tenant, v_row.name, v_row.email, v_row.phone, null,
      v_row.role, v_row.notes, null, v_row.legacy_contact_id, 'contact',
      to_timestamp(v_row.legacy_contact_id / 1000.0));  -- ids are Date.now()
    v_contact_n := v_contact_n + 1;
    if v_res.folded then v_folded_n := v_folded_n + 1; end if;
  end loop;

  -- 3. portal accounts not linked yet. One already on file by email is
  --    linked to that client; no row is written for it.
  for v_row in
    select client_email, display_name, phone, updated_at
    from public.client_profiles
    where tenant_id = p_tenant and client_id is null and btrim(coalesce(client_email, '')) <> ''
    order by client_email
  loop
    select id into v_owner from public.clients
      where tenant_id = p_tenant and email_norm = lower(btrim(v_row.client_email))
        and merged_into_id is null and not not_a_client;
    if v_owner is null then
      select * into v_res from public.item1_seed_one_client(p_tenant,
        coalesce(nullif(btrim(coalesce(v_row.display_name, '')), ''), btrim(v_row.client_email)),
        btrim(v_row.client_email), nullif(btrim(coalesce(v_row.phone, '')), ''), null, null, null,
        null, null, 'portal', coalesce(v_row.updated_at, now()));
      v_owner := v_res.client_id;
    else
      v_folded_n := v_folded_n + 1;
    end if;
    update public.client_profiles set client_id = v_owner
      where client_email = v_row.client_email and tenant_id = p_tenant;
    v_portal_n := v_portal_n + 1;
  end loop;

  -- 4. names on records that nothing above covers. The most recent record's
  --    spelling and details win: they're the most likely to be current.
  for v_row in
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
        and not exists (select 1 from public.clients c
                        where c.tenant_id = p_tenant and c.legacy_id = r.legacy_client_id)
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
    select g.* from grouped g
    where not exists (select 1 from public.clients c where c.tenant_id = p_tenant and c.name_norm = g.name_norm)
      and not exists (select 1 from item1_live_client_tombstones t where t.name_norm = g.name_norm)
    order by g.created_at nulls last, g.name_norm
  loop
    select * into v_res from public.item1_seed_one_client(p_tenant, v_row.display_name, v_row.email, v_row.phone,
      v_row.address, null, null, null, null, 'record_name', coalesce(v_row.created_at, now()));
    v_record_name_n := v_record_name_n + 1;
    if v_res.folded then v_folded_n := v_folded_n + 1; end if;
  end loop;

  drop table item1_live_client_tombstones;

  return jsonb_build_object(
    'registry', v_registry_n,
    'contact', v_contact_n,
    'portal', v_portal_n,
    'record_name', v_record_name_n,
    'folded', v_folded_n,
    'total_clients', (select count(*) from public.clients where tenant_id = p_tenant),
    'live_clients', (select count(*) from public.clients where tenant_id = p_tenant and merged_into_id is null));
end;
$$;
revoke execute on function public.item1_seed_clients(uuid, text) from public, anon, authenticated;
