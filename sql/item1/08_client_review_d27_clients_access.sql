-- Fix plan RP6.8 / D27 (2026-11-07): portal admin also accepts the Clients
-- switch (can_manage_clients). The Workspace now shows the Portal tab and
-- its duplicate-client review to an account with Invoices OR Clients;
-- client_review_tenant() (sql/item1/03) still asked for Invoices only, so a
-- Clients-only account would see the review and be refused on every
-- action. This widens the review to Invoices or Clients, same tenant.
-- Nothing else changes; the review actions themselves are untouched.
--
-- UNDO: re-run client_review_tenant() from 03_client_review_actions.sql.

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
    where email = (select auth.email()) and tenant_id = v_tenant
      and (can_manage_invoices or can_manage_clients)
  ) then
    raise exception 'not allowed to review clients' using errcode = '42501';
  end if;
  return v_tenant;
end;
$$;
revoke execute on function public.client_review_tenant() from public, anon, authenticated;
