-- Phase 4: Team roster, invites and deactivate (2026-11-04).
--
-- NOT APPLIED. A change to live permissions: it waits for Connor's
-- approval, like every DB change in this build.
--
-- Connor's decisions (2026-11-04):
--   * Deactivate is a full block, done by MOVING the person's account_roles
--     row into account_roles_deactivated (plus a sign-in ban and sign-out,
--     done by the team-deactivate edge function). Every internal access rule
--     (about 38 RLS policies) and every internal edge function (25) already
--     treats "no account_roles row" as "not staff", so access stops at once
--     with no rule rewrites. Reactivate moves the row back exactly as it was.
--     Jobs, invoices and history keep the person's email/name: nothing that
--     references them is touched.
--   * Capabilities: the nine switches stay; two are added. Clients
--     (can_manage_clients) and "Manage jobs for others"
--     (can_manage_others_jobs). Every account that exists when this runs
--     gets both ON, so nobody loses anything; a newly invited person starts
--     with every switch OFF.
--   * Team invites are new (team-invite edge function). The row an invite
--     creates is written here, by RPC, as the caller: the database itself
--     checks the caller may manage the team.
--
-- What this file does NOT change: any existing function body, policy or
-- trigger. The last-admin guard (guard_last_role_manager_permission, a
-- BEFORE UPDATE OR DELETE trigger on account_roles) keeps working as is:
-- deactivating moves the row with a DELETE, so the guard refuses to
-- deactivate the last person who can manage the team.
--
-- Safe to run twice.

begin;

-- 1. New columns -------------------------------------------------------------

do $$
declare
  v_had_clients boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'account_roles' and column_name = 'can_manage_clients'
  ) into v_had_clients;

  alter table public.account_roles
    add column if not exists display_name text,
    add column if not exists invited_at timestamptz,
    add column if not exists invited_by text,
    add column if not exists can_manage_clients boolean not null default false,
    add column if not exists can_manage_others_jobs boolean not null default false;

  -- Only on the first run: everyone already on the team keeps what they
  -- can do today (the Clients page and every job are open to all of them).
  if not v_had_clients then
    update public.account_roles
       set can_manage_clients = true,
           can_manage_others_jobs = true;
  end if;
end;
$$;

-- 2. The archive a deactivated account's row moves to -------------------------

create table if not exists public.account_roles_deactivated (
  email text primary key,
  row_data jsonb not null,          -- the whole account_roles row, as it was
  display_name text,
  deactivated_at timestamptz not null default now(),
  deactivated_by text
);

alter table public.account_roles_deactivated enable row level security;

drop policy if exists "Internal accounts can view deactivated accounts" on public.account_roles_deactivated;
create policy "Internal accounts can view deactivated accounts" on public.account_roles_deactivated
  for select to authenticated
  using (public.current_user_has_any_role());

-- Read by internal accounts (the policy above); written only through
-- team_deactivate / team_reactivate below.
grant select on public.account_roles_deactivated to authenticated;
revoke insert, update, delete on public.account_roles_deactivated from anon, authenticated;
revoke all on public.account_roles_deactivated from anon;

-- 3. RPCs --------------------------------------------------------------------
-- All four check, as the database, that the caller is an internal account
-- (current_user_has_any_role(): a row exists, and the 2FA rule) AND may
-- manage the team (can_manage_roles). SECURITY DEFINER so they can move rows
-- between the two tables; search_path pinned.

create or replace function public.team_require_manager()
returns void
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.current_user_has_any_role() then
    raise exception 'Not allowed: not an internal account.' using errcode = '42501';
  end if;
  if not coalesce((select ar.can_manage_roles from public.account_roles ar
                   where lower(ar.email) = lower(auth.jwt() ->> 'email')), false) then
    raise exception 'Not allowed: you can''t manage the team.' using errcode = '42501';
  end if;
end;
$$;

-- Add an invited person: every switch off, invited_at set. Refuses an email
-- already on the team, and one that was deactivated (reactivate them
-- instead, so their history and switches come back).
create or replace function public.team_add_invited(p_email text, p_name text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_email text := lower(trim(p_email));
begin
  perform public.team_require_manager();
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right.' using errcode = '22023';
  end if;
  if exists (select 1 from public.account_roles where lower(email) = v_email) then
    raise exception 'That person is already on the team.' using errcode = '23505';
  end if;
  if exists (select 1 from public.account_roles_deactivated where lower(email) = v_email) then
    raise exception 'That person was deactivated. Reactivate them instead.' using errcode = '23505';
  end if;
  -- Same business (tenant) as the person inviting them: current_tenant_id()
  -- reads this column, and the multi-tenant policies compare against it.
  insert into public.account_roles (email, display_name, invited_at, invited_by, assigned_by, tenant_id)
  values (v_email, nullif(trim(p_name), ''), now(), auth.jwt() ->> 'email', auth.jwt() ->> 'email',
          (select ar.tenant_id from public.account_roles ar where lower(ar.email) = lower(auth.jwt() ->> 'email')));
end;
$$;

-- Revoke an invite nobody has used yet. Refuses once they have signed in
-- (deactivate them then), and for anyone who was never invited.
create or replace function public.team_revoke_invite(p_email text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_email text := lower(trim(p_email));
begin
  perform public.team_require_manager();
  if not exists (select 1 from public.account_roles where lower(email) = v_email and invited_at is not null) then
    raise exception 'No pending invite for that email.' using errcode = 'P0002';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email and last_sign_in_at is not null) then
    raise exception 'They have already signed in. Deactivate them instead.' using errcode = '55000';
  end if;
  delete from public.account_roles where lower(email) = v_email;
end;
$$;

-- Deactivate: move the row to the archive. The last-admin trigger fires on
-- the DELETE and refuses the last person who can manage the team.
create or replace function public.team_deactivate(p_email text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_email text := lower(trim(p_email));
  v_row public.account_roles;
begin
  perform public.team_require_manager();
  if v_email = lower(auth.jwt() ->> 'email') then
    raise exception 'You can''t deactivate yourself.' using errcode = '42501';
  end if;
  select * into v_row from public.account_roles where lower(email) = v_email;
  if not found then
    raise exception 'No active account with that email.' using errcode = 'P0002';
  end if;
  insert into public.account_roles_deactivated (email, row_data, display_name, deactivated_by)
  values (v_row.email, to_jsonb(v_row), v_row.display_name, auth.jwt() ->> 'email')
  on conflict (email) do update
    set row_data = excluded.row_data, display_name = excluded.display_name,
        deactivated_at = now(), deactivated_by = excluded.deactivated_by;
  delete from public.account_roles where email = v_row.email;
end;
$$;

-- Reactivate: put the row back exactly as it was.
create or replace function public.team_reactivate(p_email text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_email text := lower(trim(p_email));
  v_data jsonb;
begin
  perform public.team_require_manager();
  select row_data into v_data from public.account_roles_deactivated where lower(email) = v_email;
  if v_data is null then
    raise exception 'No deactivated account with that email.' using errcode = 'P0002';
  end if;
  insert into public.account_roles
  select * from jsonb_populate_record(null::public.account_roles, v_data);
  delete from public.account_roles_deactivated where lower(email) = v_email;
end;
$$;

-- The roster: everyone, with status and last sign-in (auth.users is not
-- readable by authenticated, so this reads it as the definer). Any internal
-- account may read it, as any internal account may read account_roles today.
create or replace function public.team_roster()
returns table (
  email text,
  display_name text,
  status text,
  last_sign_in_at timestamptz,
  invited_at timestamptz,
  deactivated_at timestamptz,
  can_manage_roles boolean,
  can_access_dev_tools boolean,
  can_access_dev_tools_full boolean,
  can_manage_site_content boolean,
  can_manage_invoices boolean,
  can_manage_contracts boolean,
  can_view_finance boolean,
  can_view_runway boolean,
  can_manage_reviews boolean,
  can_manage_clients boolean,
  can_manage_others_jobs boolean
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.current_user_has_any_role() then
    raise exception 'Not allowed: not an internal account.' using errcode = '42501';
  end if;
  return query
    select ar.email, ar.display_name,
           case when ar.invited_at is not null and u.last_sign_in_at is null then 'invited' else 'active' end,
           u.last_sign_in_at, ar.invited_at, null::timestamptz,
           ar.can_manage_roles, ar.can_access_dev_tools, ar.can_access_dev_tools_full, ar.can_manage_site_content,
           ar.can_manage_invoices, ar.can_manage_contracts, ar.can_view_finance, ar.can_view_runway,
           ar.can_manage_reviews, ar.can_manage_clients, ar.can_manage_others_jobs
      from public.account_roles ar
      left join auth.users u on lower(u.email) = lower(ar.email)
    union all
    select d.email, d.display_name, 'deactivated', u.last_sign_in_at,
           (d.row_data ->> 'invited_at')::timestamptz, d.deactivated_at,
           false, false, false, false, false, false, false, false, false, false, false
      from public.account_roles_deactivated d
      left join auth.users u on lower(u.email) = lower(d.email)
    order by 1;
end;
$$;

revoke execute on function public.team_require_manager() from public, anon, authenticated;
revoke execute on function public.team_add_invited(text, text) from public, anon;
revoke execute on function public.team_revoke_invite(text) from public, anon;
revoke execute on function public.team_deactivate(text) from public, anon;
revoke execute on function public.team_reactivate(text) from public, anon;
revoke execute on function public.team_roster() from public, anon;
grant execute on function public.team_add_invited(text, text) to authenticated;
grant execute on function public.team_revoke_invite(text) to authenticated;
grant execute on function public.team_deactivate(text) to authenticated;
grant execute on function public.team_reactivate(text) to authenticated;
grant execute on function public.team_roster() to authenticated;

commit;
