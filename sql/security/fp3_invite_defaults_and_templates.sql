-- Fix plan FP3.3 + FP3.4 + FP3.5 (2026-11-06, decision D3: Clients ON).
--
-- 1. The starting templates (role_definitions) gain the two Phase 4
--    switches, so Dev Tools' account panel, its Starting templates table
--    and "Add account" cover all eleven, not nine:
--      Developer, Owner: both on (they ran the business before Phase 4
--      added these switches, and every existing account got Clients then);
--      Employee: Clients on (D3), Manage jobs for others off.
-- 2. A fresh Team invite (team_add_invited) starts with Clients on (D3), so
--    a field hire can look up a client's phone and address on day one.
--    Manage jobs for others stays off. Everything else is unchanged: same
--    checks, same tenant, same "already on the team" refusals.
--
-- Additive: two columns with defaults, three rows updated, one function
-- body replaced (same signature). No account_roles row changes. Re-runnable.
--
-- APPLIED 2026-11-06 to the live project (one transaction, SQL tool). Checked:
-- the three templates read Developer/Owner both on, Employee Clients only; a
-- rolled-back dry-run invite as Steve came out Clients on, Manage jobs for
-- others off, Invoices off.

begin;

alter table public.role_definitions
  add column if not exists can_manage_clients boolean not null default false,
  add column if not exists can_manage_others_jobs boolean not null default false;

update public.role_definitions set can_manage_clients = true, can_manage_others_jobs = true where name in ('Developer', 'Owner');
update public.role_definitions set can_manage_clients = true, can_manage_others_jobs = false where name = 'Employee';

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
  -- Clients on from the start (D3, fix plan FP3.3).
  insert into public.account_roles (email, display_name, invited_at, invited_by, assigned_by, tenant_id, can_manage_clients)
  values (v_email, nullif(trim(p_name), ''), now(), auth.jwt() ->> 'email', auth.jwt() ->> 'email',
          (select ar.tenant_id from public.account_roles ar where lower(ar.email) = lower(auth.jwt() ->> 'email')),
          true);
end;
$$;

revoke execute on function public.team_add_invited(text, text) from public, anon;
grant execute on function public.team_add_invited(text, text) to authenticated;

commit;
