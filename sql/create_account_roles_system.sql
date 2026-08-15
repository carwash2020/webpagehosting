-- Replaces the old hardcoded "only connor@ gets dev tools" gate with a
-- real, extensible role system. Two roles seeded (Owner for Steve,
-- Developer for Connor) with identical functional access in the app --
-- Developer's only extra capability is managing this role system
-- itself, tracked as can_manage_roles rather than hardcoded to a
-- specific role name. Run 2026-08-15.

create table public.role_definitions (
  name text primary key,
  description text not null default '',
  can_manage_roles boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text
);

create table public.account_roles (
  email text primary key,
  role_name text not null references public.role_definitions(name) on update cascade,
  assigned_at timestamptz not null default now(),
  assigned_by text
);

create or replace function public.current_user_can_manage_roles()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select rd.can_manage_roles
     from public.account_roles ar
     join public.role_definitions rd on rd.name = ar.role_name
     where ar.email = (select auth.jwt() ->> 'email')),
    false
  );
$$;

alter table public.role_definitions enable row level security;
alter table public.account_roles enable row level security;

create policy "Authenticated can view roles" on public.role_definitions
  for select to authenticated using (true);
create policy "Authenticated can view account roles" on public.account_roles
  for select to authenticated using (true);

create policy "Only role managers can create roles" on public.role_definitions
  for insert to authenticated with check ((select public.current_user_can_manage_roles()));
create policy "Only role managers can edit roles" on public.role_definitions
  for update to authenticated using ((select public.current_user_can_manage_roles()));
create policy "Only role managers can delete roles" on public.role_definitions
  for delete to authenticated using ((select public.current_user_can_manage_roles()));

create policy "Only role managers can assign roles" on public.account_roles
  for insert to authenticated with check ((select public.current_user_can_manage_roles()));
create policy "Only role managers can update assignments" on public.account_roles
  for update to authenticated using ((select public.current_user_can_manage_roles()));
create policy "Only role managers can remove assignments" on public.account_roles
  for delete to authenticated using ((select public.current_user_can_manage_roles()));

create or replace function public.prevent_removing_last_role_manager()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  remaining_managers int;
begin
  if TG_OP = 'DELETE' then
    if exists (select 1 from public.role_definitions where name = OLD.role_name and can_manage_roles) then
      select count(*) into remaining_managers
      from public.account_roles ar join public.role_definitions rd on rd.name = ar.role_name
      where rd.can_manage_roles and ar.email <> OLD.email;
      if remaining_managers = 0 then
        raise exception 'Cannot remove the last remaining role manager -- assign another account a role-management-capable role first.';
      end if;
    end if;
    return OLD;
  elsif TG_OP = 'UPDATE' then
    if exists (select 1 from public.role_definitions where name = OLD.role_name and can_manage_roles)
       and not exists (select 1 from public.role_definitions where name = NEW.role_name and can_manage_roles) then
      select count(*) into remaining_managers
      from public.account_roles ar join public.role_definitions rd on rd.name = ar.role_name
      where rd.can_manage_roles and ar.email <> OLD.email;
      if remaining_managers = 0 then
        raise exception 'Cannot change the last remaining role manager to a non-manager role -- assign another account a role-management-capable role first.';
      end if;
    end if;
    return NEW;
  end if;
  return NEW;
end;
$$;

create trigger guard_last_role_manager
before update or delete on public.account_roles
for each row execute function public.prevent_removing_last_role_manager();

create or replace function public.prevent_disabling_last_role_manager_capability()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  other_manager_roles int;
begin
  if TG_OP = 'UPDATE' and OLD.can_manage_roles and not NEW.can_manage_roles then
    if exists (select 1 from public.account_roles where role_name = OLD.name) then
      select count(*) into other_manager_roles
      from public.role_definitions rd
      where rd.can_manage_roles and rd.name <> OLD.name
        and exists (select 1 from public.account_roles ar where ar.role_name = rd.name);
      if other_manager_roles = 0 then
        raise exception 'Cannot remove role-management capability from % -- no other currently-assigned role would be able to manage roles afterward.', OLD.name;
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

create trigger guard_role_manager_capability
before update on public.role_definitions
for each row execute function public.prevent_disabling_last_role_manager_capability();

insert into public.role_definitions (name, description, can_manage_roles, created_by) values
  ('Developer', 'Full technical access to Dev Tools, plus the ability to create and assign roles.', true, 'system'),
  ('Owner', 'Full access to Dev Tools. New roles and role assignments are managed by a Developer.', false, 'system');

insert into public.account_roles (email, role_name, assigned_by) values
  ('connor@triplehenterprisesllc.biz', 'Developer', 'system'),
  ('steve@triplehenterprisesllc.biz', 'Owner', 'system');

create index idx_account_roles_role_name on public.account_roles(role_name);
