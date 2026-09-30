-- Multi-tenant Tier 0 follow-up (batch 7): tenant_id for inserts that have
-- no staff session.
--
-- THE BUG (found 2026-09-30 while verifying batch 06 live): batch 06's
-- trigger fills tenant_id from current_tenant_id(), which reads the staff
-- email from the JWT. Some inserts into those tables never have one:
--   - public bookings: create_booking() RPC, called as anon
--   - portal scheduling: schedule-checkup-visit and schedule-quote-job
--     edge functions insert th_bookings as service_role
--   - client codes: send-invite and ensure-my-referral-code edge functions
--     insert client_account_codes as service_role
--   - portal push: a client's own push_subscriptions row (the
--     user_id = auth.uid() policy branch; a client isn't in account_roles)
-- All of those land with tenant_id null. Staff SELECT policies require
-- tenant_id = current_tenant_id(), so staff never see them: a new public
-- booking would be invisible to Steve. Confirmed live in a rolled-back
-- transaction: anon create_booking() succeeded and the row's tenant_id was
-- null. No real rows were affected yet (every null-tenant count was 0 and
-- th_bookings was empty on 2026-09-30).
--
-- THE FIX: when the session resolves no tenant, fall back to Triple H,
-- the same default batch 04 gives th_leads, portal_bug_reports and
-- portal_client_errors. One SQL change covers every path above without
-- redeploying edge functions or touching create_booking().
--
-- What doesn't change:
--   - A staff session still resolves its own tenant first.
--   - An explicitly supplied tenant_id is never overwritten, so a
--     wrong-tenant staff write is still rejected by RLS.
--   - The fallback only fills in rows the caller could already insert.
--     RLS WITH CHECKs are unchanged, so nobody gains write access.
--     The row just becomes visible to Triple H staff, which is the point.
--
-- REVISIT WHEN A SECOND TENANT EXISTS: like batch 04's defaults, this
-- assumes every sessionless insert belongs to Triple H. Before a second
-- tenant's public site or portal goes live, resolve the tenant from that
-- caller's context (site, portal or edge function) instead.

create or replace function public.set_tenant_id_from_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := coalesce(public.current_tenant_id(), public.default_tenant_id_triple_h());
  end if;
  return new;
end;
$$;

comment on function public.set_tenant_id_from_session() is
  'BEFORE INSERT on the batch 06 tables. Fills a null tenant_id from the staff session, else Triple H (sessionless inserts: public booking, edge functions, portal push). Replace the Triple H fallback before a second tenant goes live (sql/multi-tenant/07).';

-- create or replace keeps the existing ACL, but restate it so this file is
-- correct on its own (same as batch 05/06).
revoke execute on function public.set_tenant_id_from_session() from public, anon, authenticated;
