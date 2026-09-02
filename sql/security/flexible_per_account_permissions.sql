-- Permission model redesign (2026-09-02). Applied directly via the
-- Supabase MCP migration tool; recorded here after the fact, same
-- convention as every other file in sql/.
--
-- Requested directly: replace role-locked permissions (fixed
-- Owner/Developer/Employee tiers, each account entirely bound to one
-- tier's fixed bundle) with per-account, individually-toggleable
-- permissions that take effect immediately -- no code deploy, no role
-- reassignment ritual, no waiting.
--
-- The 4 booleans move from role_definitions (shared by every account
-- on that role) onto account_roles itself (one row per real account).
-- role_definitions stops being read at authorization time anywhere --
-- it becomes a PRESETS table only, for the "start from this preset"
-- convenience in the management UI (Dev Tools -> Access -> Account
-- permissions). Nothing about its own rows changes here; only what
-- reads them does.

alter table account_roles
  add column can_manage_roles boolean,
  add column can_access_dev_tools boolean,
  add column can_manage_site_content boolean,
  add column can_manage_business_finances boolean;

-- Backfill from each account's CURRENT role's definition, so this
-- migration itself changes nobody's effective permissions -- every
-- account keeps exactly what it already had, just now stored directly
-- rather than via the role_name join.
update account_roles ar
set can_manage_roles = rd.can_manage_roles,
    can_access_dev_tools = rd.can_access_dev_tools,
    can_manage_site_content = rd.can_manage_site_content,
    can_manage_business_finances = rd.can_manage_business_finances
from role_definitions rd
where rd.name = ar.role_name;

alter table account_roles
  alter column can_manage_roles set default false,
  alter column can_access_dev_tools set default false,
  alter column can_manage_site_content set default false,
  alter column can_manage_business_finances set default false;

update account_roles set
  can_manage_roles = coalesce(can_manage_roles, false),
  can_access_dev_tools = coalesce(can_access_dev_tools, false),
  can_manage_site_content = coalesce(can_manage_site_content, false),
  can_manage_business_finances = coalesce(can_manage_business_finances, false);

alter table account_roles
  alter column can_manage_roles set not null,
  alter column can_access_dev_tools set not null,
  alter column can_manage_site_content set not null,
  alter column can_manage_business_finances set not null;

-- role_name becomes an optional display label ("started from the
-- Owner preset") rather than the authoritative source -- so it can be
-- nullable now (a brand-new account built entirely from scratch via
-- checkboxes, with no preset applied, has no role_name at all).
alter table account_roles alter column role_name drop not null;


-- ---------------------------------------------------------------
-- current_user_can_manage_roles(): the RLS gate itself. Previously
-- joined account_roles -> role_definitions; now reads the column
-- directly off account_roles. This is the single most safety-critical
-- change in this migration -- it's what the INSERT/UPDATE/DELETE
-- policies on BOTH account_roles and role_definitions call to decide
-- who's allowed to touch permissions at all.
-- ---------------------------------------------------------------
create or replace function current_user_can_manage_roles()
returns boolean
language sql
stable
set search_path = 'public'
as $$
  select coalesce(
    (select ar.can_manage_roles
     from public.account_roles ar
     where ar.email = (select auth.jwt() ->> 'email')),
    false
  );
$$;


-- ---------------------------------------------------------------
-- Replaces BOTH old guard triggers (prevent_removing_last_role_manager
-- on account_roles, prevent_disabling_last_role_manager_capability on
-- role_definitions) with one. The old pair existed because
-- permissions used to live in two places (which account has which
-- role_name, and which role_names can manage roles) -- now there's
-- only one place, so there only needs to be one guard: never let an
-- UPDATE or DELETE on account_roles leave zero accounts with
-- can_manage_roles = true, which would permanently lock everyone out
-- of ever granting anyone anything again.
--
-- Verified directly (not assumed) at migration time: attempted to
-- remove the last can_manage_roles=true account and confirmed the
-- trigger blocked it with the expected error message.
-- ---------------------------------------------------------------
create or replace function guard_last_role_manager_permission()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  remaining_managers int;
begin
  if TG_OP = 'DELETE' then
    if OLD.can_manage_roles then
      select count(*) into remaining_managers
      from public.account_roles
      where can_manage_roles and email <> OLD.email;
      if remaining_managers = 0 then
        raise exception 'Cannot remove the last remaining account with permission management access -- grant another account that permission first.';
      end if;
    end if;
    return OLD;
  elsif TG_OP = 'UPDATE' then
    if OLD.can_manage_roles and not NEW.can_manage_roles then
      select count(*) into remaining_managers
      from public.account_roles
      where can_manage_roles and email <> OLD.email;
      if remaining_managers = 0 then
        raise exception 'Cannot remove permission management access from the last account that has it -- grant another account that permission first.';
      end if;
    end if;
    return NEW;
  end if;
  return NEW;
end;
$$;

drop trigger if exists guard_last_role_manager on account_roles;
create trigger guard_last_role_manager_permission
  before update or delete on account_roles
  for each row execute function guard_last_role_manager_permission();

-- The role_definitions-side guard is now obsolete -- editing a preset
-- no longer affects anyone's actual permissions, so there's nothing
-- left for it to protect.
drop trigger if exists guard_role_manager_capability on role_definitions;
drop function if exists prevent_disabling_last_role_manager_capability();
drop function if exists prevent_removing_last_role_manager();
