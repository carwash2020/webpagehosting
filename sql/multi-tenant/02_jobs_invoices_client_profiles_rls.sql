-- Multi-tenant Tier 0 (batch 2/5): extend jobs/invoices RLS and the
-- internal_read_client_profiles() RPC with a tenant check, ANDed onto
-- the existing condition. Behavior for Triple H's own staff unchanged
-- -- verified live against real production data (exact row-count
-- parity with pre-migration counts) before this file was committed.

drop policy "internal accounts can manage jobs" on public.jobs;
create policy "internal accounts can manage jobs" on public.jobs
  for all to authenticated
  using (
    exists (select 1 from public.account_roles where account_roles.email = (select auth.email()))
    and tenant_id = (select public.current_tenant_id())
  )
  with check (
    exists (select 1 from public.account_roles where account_roles.email = (select auth.email()))
    and tenant_id = (select public.current_tenant_id())
  );

drop policy "internal accounts can manage invoices" on public.invoices;
create policy "internal accounts can manage invoices" on public.invoices
  for all to authenticated
  using (
    exists (select 1 from public.account_roles where account_roles.email = (select auth.email()))
    and tenant_id = (select public.current_tenant_id())
  )
  with check (
    exists (select 1 from public.account_roles where account_roles.email = (select auth.email()))
    and tenant_id = (select public.current_tenant_id())
  );

create or replace function public.internal_read_client_profiles()
returns setof public.client_profiles
language sql
security definer
set search_path = public
stable
as $$
  select *
  from public.client_profiles
  where public.current_user_has_any_role()
    and tenant_id = public.current_tenant_id();
$$;

revoke execute on function public.internal_read_client_profiles() from public, anon;
grant execute on function public.internal_read_client_profiles() to authenticated;
