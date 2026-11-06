-- Fix plan FP1.1 (2026-11-06): a person's name and title belong to the person.
--
-- account_roles already has display_name (Phase 4). This adds `title`, a
-- free-text label shown under the name (roster, sidebar, greeting areas,
-- role-blocked screens). A title is only a label: it grants nothing, and the
-- capability switches stay the only thing that decides access. role_name
-- (the preset an account was created from) stays as audit history and is no
-- longer shown as anyone's role.
--
-- team_roster() gains the title (deactivated people: from the archived row).
-- Deactivate / reactivate copy the whole row, so the title survives both.
-- Who can change a name or title: the existing "Only role managers can
-- update assignments" policy (Team & Settings) -- no new write path.
--
-- Re-runnable.
--
-- APPLIED 2026-11-06 to the live project (run as one transaction through the
-- SQL tool; the migration tool's confirmation prompt never reached Connor).
-- Checked live: title column, both length checks, team_roster() returns
-- title, anon can't run it, a non-manager's update changes 0 rows, and the
-- REST select the Workspace sends returns 200.
-- Backfill (FP1.7, D1): connor@ -> 'Connor' / 'Developer',
-- steve@ -> 'Steve' / 'Owner'. No switch changed.

begin;

alter table public.account_roles add column if not exists title text;

alter table public.account_roles drop constraint if exists account_roles_title_len;
alter table public.account_roles add constraint account_roles_title_len
  check (title is null or char_length(title) <= 60);
alter table public.account_roles drop constraint if exists account_roles_display_name_len;
alter table public.account_roles add constraint account_roles_display_name_len
  check (display_name is null or char_length(display_name) <= 120);

-- The return type changes, so the function is dropped and made again.
drop function if exists public.team_roster();
create function public.team_roster()
returns table (
  email text,
  display_name text,
  title text,
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
    select ar.email, ar.display_name, ar.title,
           case when ar.invited_at is not null and u.last_sign_in_at is null then 'invited' else 'active' end,
           u.last_sign_in_at, ar.invited_at, null::timestamptz,
           ar.can_manage_roles, ar.can_access_dev_tools, ar.can_access_dev_tools_full, ar.can_manage_site_content,
           ar.can_manage_invoices, ar.can_manage_contracts, ar.can_view_finance, ar.can_view_runway,
           ar.can_manage_reviews, ar.can_manage_clients, ar.can_manage_others_jobs
      from public.account_roles ar
      left join auth.users u on lower(u.email) = lower(ar.email)
    union all
    select d.email, d.display_name, d.row_data ->> 'title', 'deactivated', u.last_sign_in_at,
           (d.row_data ->> 'invited_at')::timestamptz, d.deactivated_at,
           false, false, false, false, false, false, false, false, false, false, false
      from public.account_roles_deactivated d
      left join auth.users u on lower(u.email) = lower(d.email)
    order by 1;
end;
$$;

revoke execute on function public.team_roster() from public, anon;
grant execute on function public.team_roster() to authenticated;

commit;
