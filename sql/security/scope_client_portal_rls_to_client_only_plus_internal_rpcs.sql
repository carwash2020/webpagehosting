-- Root-cause fix for the cross-account portal data leak (2026-09-29).
-- See docs/specialist-logs/security.md, 2026-09-29 (follow-up entry), for
-- the full write-up. This is the migration applied live via Supabase MCP
-- apply_migration; kept here so the schema change is tracked in source
-- control, not just live in the project.
--
-- Previously, SELECT on these tables was granted to EITHER the matching
-- client OR any internal account (added 2026-09-22,
-- sql/portal/let_internal_accounts_read_portal_jobs_and_invoices.sql),
-- relying on every caller -- portal pages included -- to remember to add
-- an explicit client_email filter on top. One portal page didn't, and any
-- internal account signed into the portal with its own real credentials
-- saw every client's data (docs/specialist-logs/security.md, 2026-09-29,
-- first entry -- fixed there at the app layer only).
--
-- This migration removes the internal-account bypass from the base table
-- policies entirely, so direct SELECT is client-only, unconditionally,
-- regardless of which app queries it or whether that app remembers a
-- filter. The internal Workspace tool's genuine need to read across
-- clients moves to dedicated SECURITY DEFINER functions that re-check
-- current_user_has_any_role() (the same staff+MFA gate used elsewhere)
-- inside the function body, then bypass RLS as the table owner (these
-- tables have no FORCE ROW LEVEL SECURITY, so the postgres-owned function
-- bypasses RLS per ordinary Postgres semantics). App code call sites in
-- tools/clients.html, tools/contract-generator.html,
-- tools/invoice-generator.html and tools/workspace.html were updated in
-- the same commit to hit /rest/v1/rpc/<function> instead of
-- /rest/v1/<table> for these reads -- PostgREST applies the same
-- select=/order=/filter query params to a STABLE function's result set as
-- it does to a table, so no query-shape changes were needed at the call
-- sites, only the URL path.

-- 1. Internal-read RPCs, one per table the internal tools query directly.
create or replace function public.internal_read_client_portal_invoices()
returns setof public.client_portal_invoices
language sql stable security definer set search_path = public as $$
  select * from public.client_portal_invoices where public.current_user_has_any_role();
$$;

create or replace function public.internal_read_client_portal_quotes()
returns setof public.client_portal_quotes
language sql stable security definer set search_path = public as $$
  select * from public.client_portal_quotes where public.current_user_has_any_role();
$$;

create or replace function public.internal_read_client_portal_jobs()
returns setof public.client_portal_jobs
language sql stable security definer set search_path = public as $$
  select * from public.client_portal_jobs where public.current_user_has_any_role();
$$;

create or replace function public.internal_read_client_portal_work_orders()
returns setof public.client_portal_work_orders
language sql stable security definer set search_path = public as $$
  select * from public.client_portal_work_orders where public.current_user_has_any_role();
$$;

create or replace function public.internal_read_client_portal_contracts()
returns setof public.client_portal_contracts
language sql stable security definer set search_path = public as $$
  select * from public.client_portal_contracts where public.current_user_has_any_role();
$$;

create or replace function public.internal_read_client_profiles()
returns setof public.client_profiles
language sql stable security definer set search_path = public as $$
  select * from public.client_profiles where public.current_user_has_any_role();
$$;

create or replace function public.internal_read_client_portal_job_messages()
returns setof public.client_portal_job_messages
language sql stable security definer set search_path = public as $$
  select * from public.client_portal_job_messages where public.current_user_has_any_role();
$$;

create or replace function public.internal_read_client_portal_work_order_messages()
returns setof public.client_portal_work_order_messages
language sql stable security definer set search_path = public as $$
  select * from public.client_portal_work_order_messages where public.current_user_has_any_role();
$$;

-- These are staff-only RPCs. This project's schema-level default
-- privileges grant EXECUTE to anon on newly created functions, so it has
-- to be revoked explicitly (get_advisors flags this correctly; not
-- exploitable either way since an anon caller has no matching
-- account_roles row and the gate returns zero rows, but anon should never
-- have had the grant for a staff-only function).
revoke execute on function
  public.internal_read_client_portal_invoices(),
  public.internal_read_client_portal_quotes(),
  public.internal_read_client_portal_jobs(),
  public.internal_read_client_portal_work_orders(),
  public.internal_read_client_portal_contracts(),
  public.internal_read_client_profiles(),
  public.internal_read_client_portal_job_messages(),
  public.internal_read_client_portal_work_order_messages()
from public, anon;

grant execute on function
  public.internal_read_client_portal_invoices(),
  public.internal_read_client_portal_quotes(),
  public.internal_read_client_portal_jobs(),
  public.internal_read_client_portal_work_orders(),
  public.internal_read_client_portal_contracts(),
  public.internal_read_client_profiles(),
  public.internal_read_client_portal_job_messages(),
  public.internal_read_client_portal_work_order_messages()
to authenticated;

-- 2. Strip the internal-account bypass from each base table's own SELECT
--    policy. Direct table access is now client-scoped, period.
alter policy "clients or internal accounts can view invoices" on public.client_portal_invoices
  using (( select auth.email() ) = client_email);

alter policy "clients or internal accounts can view quotes" on public.client_portal_quotes
  using (( select auth.email() ) = client_email);

alter policy "clients or internal accounts can view jobs" on public.client_portal_jobs
  using (( select auth.email() ) = client_email);

alter policy "clients or internal accounts view work orders" on public.client_portal_work_orders
  using (( select auth.email() ) = client_email);

alter policy "clients or internal accounts can view contracts" on public.client_portal_contracts
  using (( select auth.email() ) = client_email);

alter policy "clients or internal accounts can view client profiles" on public.client_profiles
  using (client_email = ( select auth.email() ));

alter policy "clients or internal accounts view job messages" on public.client_portal_job_messages
  using (exists ( select 1 from public.client_portal_jobs j
                  where j.id = client_portal_job_messages.job_id
                    and j.client_email = ( select auth.email() ) ));

alter policy "clients or internal accounts view work order messages" on public.client_portal_work_order_messages
  using (exists ( select 1 from public.client_portal_work_orders wo
                  where wo.id = client_portal_work_order_messages.work_order_id
                    and wo.client_email = ( select auth.email() ) ));

alter policy "clients or internal accounts can view notification preferences" on public.client_notification_preferences
  using (client_email = ( select auth.email() ));
