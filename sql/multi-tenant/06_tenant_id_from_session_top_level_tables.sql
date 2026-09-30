-- Multi-tenant Tier 0 follow-up (batch 6): tenant_id on INSERT for the
-- top-level tables staff write to directly.
--
-- THE BUG (found 2026-09-30 during Item 1 Phase 0d, the mirror audit in
-- docs/ITEM-1-MIGRATION-PLAN.md): batches 02/03 ANDed
-- `tenant_id = current_tenant_id()` onto every staff RLS policy, including
-- the WITH CHECK. The app never sends tenant_id, and these tables have no
-- default and no trigger, so every staff INSERT lands with tenant_id null
-- and fails with 42501. This is the same failure shape batch 03 fixed for
-- child tables (invoice_line_items etc.); the top-level tables were missed.
--
-- It also breaks UPDATES made through upsert. `resolution=merge-duplicates`
-- is INSERT ... ON CONFLICT DO UPDATE, and Postgres applies the INSERT
-- policy's WITH CHECK to the proposed row even when it conflicts. So
-- tools/sync.js's relational mirror has been failing for every save
-- (new rows AND edits, e.g. Mark paid) since batch 02 went live. The mirror
-- swallows the error, so nothing surfaced.
--
-- Verified live before writing this file, in rolled-back transactions as a
-- real staff account:
--   - insert into invoices without tenant_id          -> 42501
--   - upsert of an EXISTING invoice without tenant_id -> 42501
--   - same insert with this trigger in place          -> succeeds, tenant
--     resolves to the staff account's tenant
--
-- Affected tables: every table with a staff INSERT/ALL policy checking
-- current_tenant_id(), no tenant_id default, and no tenant trigger (live
-- audit query in the header of tests/sync/tenant-id-from-session-db.test.js).
--
-- THE FIX: a BEFORE INSERT trigger that fills tenant_id from the session
-- when it's null. An explicitly supplied tenant_id is never overwritten.
--
-- SECURITY DEFINER is required, not optional: current_tenant_id() is
-- revoked from anon (and was never granted to service_role). Some of these
-- tables also take anon or service-role inserts (th_bookings from the public
-- booking page, edge functions). A SECURITY INVOKER trigger would raise
-- "permission denied for function current_tenant_id" on those inserts and
-- break them. As definer, current_tenant_id() just returns null for a
-- session with no staff email, so those inserts behave exactly as before.
--
-- EXECUTE is revoked afterwards, same as batch 05: trigger firing doesn't
-- need it, and it keeps the function off the PostgREST RPC surface.
--
-- NOT a fix for rows that already failed. Those are still only in the
-- workspace_sync blob. See sql/infra/reconcile_blob_vs_relational.sql
-- (read-only) to list them, and backfill afterwards with tenant_id set
-- explicitly. A backfill run as postgres has no JWT, so this trigger
-- would leave its rows null and RLS would hide them.

create or replace function public.set_tenant_id_from_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'jobs', 'invoices', 'quotes', 'contracts',
    'referrals', 'th_job_photos', 'th_bookings',
    'push_subscriptions', 'notification_recipients', 'client_account_codes'
  ] loop
    execute format('drop trigger if exists set_tenant_id on public.%I', t);
    execute format(
      'create trigger set_tenant_id before insert on public.%I '
      'for each row execute function public.set_tenant_id_from_session()', t);
  end loop;
end;
$$;

revoke execute on function public.set_tenant_id_from_session() from public, anon, authenticated;
