-- Item 1 Phase 1b, part 2: the review actions behind the "Possible
-- duplicates" queue in tools/clients.html (docs/ITEM-1-MIGRATION-PLAN.md
-- "1b. Seeding and dedup").
--
-- Three actions, each an RPC for staff who can manage invoices (the same
-- permission as the Clients page's Portal tab):
--   merge_client_candidate(candidate, keep)   the two are one person
--   keep_client_candidate_separate(candidate) they're different people
--   mark_client_not_a_client(client)          a supplier or trade, not a client
-- Editing a client's details is a plain PATCH on `clients` under its
-- existing staff policy; it needs no function.
--
-- A MERGE:
--   - fills the kept client's blank email, phone, address, role and notes
--     from the other one (never overwrites a value that's there);
--   - repoints every uuid FK to the merged client (contracts.client_id,
--     client_profiles.client_id), and any client already merged into it;
--   - sets merged_into_id on the merged client. Its legacy ids stay on it,
--     so the step 2 backfill resolves old 'c_…' ids through merged_into_id;
--   - records what it changed on the candidate row (merge_detail), so a
--     mistaken merge can be traced and undone by hand;
--   - drops the merged client's other open pairs and re-runs
--     refresh_client_duplicate_candidates(), so the kept client is paired
--     afresh with anyone else it matches.
-- Nothing merges on its own. Every merge is one of these calls.
--
-- jobs, invoices and quotes still point at clients through the text
-- legacy_client_id until Phase 1a step 2, so a merge has nothing to repoint
-- there yet.

-- ---------------------------------------------------------------------------
alter table public.clients add column if not exists not_a_client boolean not null default false;
comment on column public.clients.not_a_client is
  'Marked in the review queue as a supplier or trade, not a client. Left out of duplicate candidates. The blob contact it came from stays in the Job Tracker contact list.';

alter table public.client_duplicate_candidates add column if not exists merge_detail jsonb;
alter table public.client_duplicate_candidates drop constraint if exists client_duplicate_candidates_status_check;
alter table public.client_duplicate_candidates add constraint client_duplicate_candidates_status_check
  check (status in ('open', 'merged', 'kept_separate', 'dismissed'));
comment on column public.client_duplicate_candidates.status is
  'open: waiting for review. merged / kept_separate: decided. dismissed: one side was marked not a client.';

-- Candidates leave out clients marked not a client. Same function as
-- 02 otherwise.
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
    where tenant_id = p_tenant and merged_into_id is null and not not_a_client
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

-- ---------------------------------------------------------------------------
-- Who may review: a staff account in this tenant that can manage invoices.
-- Returns the tenant; raises otherwise.
create or replace function public.client_review_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or not exists (
    select 1 from public.account_roles
    where email = (select auth.email()) and tenant_id = v_tenant and can_manage_invoices
  ) then
    raise exception 'not allowed to review clients' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;
revoke execute on function public.client_review_tenant() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
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
  v_filled text[] := '{}';
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

  -- Fill blanks on the kept client, never overwrite.
  if v_keep.email is null and v_gone.email is not null then v_filled := v_filled || 'email'::text; end if;
  if v_keep.phone is null and v_gone.phone is not null then v_filled := v_filled || 'phone'::text; end if;
  if v_keep.address is null and v_gone.address is not null then v_filled := v_filled || 'address'::text; end if;
  if v_keep.role is null and v_gone.role is not null then v_filled := v_filled || 'role'::text; end if;
  if v_keep.notes is null and v_gone.notes is not null then v_filled := v_filled || 'notes'::text; end if;
  update public.clients set
    email = coalesce(email, v_gone.email),
    phone = coalesce(phone, v_gone.phone),
    address = coalesce(address, v_gone.address),
    role = coalesce(role, v_gone.role),
    notes = coalesce(notes, v_gone.notes)
  where id = v_keep.id and cardinality(v_filled) > 0;

  -- Repoint every uuid FK.
  with u as (update public.contracts set client_id = v_keep.id where client_id = v_gone.id returning id)
    select coalesce(array_agg(id order by id), '{}') into v_contracts from u;
  with u as (update public.client_profiles set client_id = v_keep.id where client_id = v_gone.id returning client_email)
    select coalesce(array_agg(client_email order by client_email), '{}') into v_profiles from u;
  with u as (update public.clients set merged_into_id = v_keep.id where merged_into_id = v_gone.id returning id)
    select coalesce(array_agg(id order by id), '{}') into v_chained from u;

  update public.clients set merged_into_id = v_keep.id where id = v_gone.id;

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

  -- The merged client is gone from review: its other open pairs go, and
  -- the kept client is paired afresh with anyone it now matches.
  delete from public.client_duplicate_candidates
    where status = 'open' and (client_a = v_gone.id or client_b = v_gone.id);
  perform public.refresh_client_duplicate_candidates(v_tenant);

  return v_detail;
end;
$$;
revoke execute on function public.merge_client_candidate(bigint, uuid) from public, anon;
grant execute on function public.merge_client_candidate(bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.keep_client_candidate_separate(p_candidate bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.client_review_tenant();
begin
  update public.client_duplicate_candidates
    set status = 'kept_separate', decided_by = (select auth.email()), decided_at = now()
    where id = p_candidate and tenant_id = v_tenant and status = 'open';
  if not found then
    raise exception 'no open candidate %', p_candidate using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.keep_client_candidate_separate(bigint) from public, anon;
grant execute on function public.keep_client_candidate_separate(bigint) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.mark_client_not_a_client(p_client uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.client_review_tenant();
  v_n int;
begin
  update public.clients set not_a_client = true
    where id = p_client and tenant_id = v_tenant and merged_into_id is null;
  if not found then
    raise exception 'no such client %', p_client using errcode = 'P0002';
  end if;
  update public.client_duplicate_candidates
    set status = 'dismissed', decided_by = (select auth.email()), decided_at = now()
    where status = 'open' and (client_a = p_client or client_b = p_client);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.mark_client_not_a_client(uuid) from public, anon;
grant execute on function public.mark_client_not_a_client(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The review queue calls this when it opens, so pairs reflect any edits
-- and any clients added since the last look.
create or replace function public.refresh_my_client_candidates()
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.refresh_client_duplicate_candidates(public.client_review_tenant());
end;
$$;
revoke execute on function public.refresh_my_client_candidates() from public, anon;
grant execute on function public.refresh_my_client_candidates() to authenticated;
