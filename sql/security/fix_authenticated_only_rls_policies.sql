-- CRITICAL security fix. Run 2026-09-01, found during a deliberate
-- audit of the client portal.
--
-- Seven tables had RLS policies checking only
-- auth.role() = 'authenticated', with no check for whether that
-- account was actually internal (Connor/Steve/Employee). That was
-- safe for exactly as long as only internal accounts could ever be
-- authenticated at all.
--
-- It became a live vulnerability the moment client portal accounts
-- started existing (2026-08-31), because a client's own legitimate
-- session is ALSO role "authenticated". Any signed-in client could
-- have read -- and in most cases written or deleted -- the entire
-- internal business dataset via a direct REST call, workspace_sync
-- most severely, since that's the whole workspace blob (clients,
-- invoices, jobs, everything). The portal's own UI never showed any
-- of this, but the UI was never the boundary; RLS was, and it was
-- checking the wrong thing.
--
-- Fix below: every one of these also requires a row in account_roles
-- now, the same real boundary already used throughout this project's
-- edge functions. Each policy keeps its exact original name, command,
-- and roles -- purely a tightening, not a reshape.
--
-- Verified in BOTH directions with simulated JWTs before this was
-- considered closed: an internal account still sees real data, a
-- client-shaped account sees zero rows. No real client account had
-- ever been created at the time of the fix, so this was very likely
-- never actually exploited.
--
-- THE GENERAL LESSON, worth re-reading before adding any new class of
-- authenticated user to this project: a bare
-- auth.role() = 'authenticated' check silently widens to include that
-- new user class the instant it exists. Audit every such policy then.

-- notification_log
drop policy "Require login" on notification_log;
create policy "Require login" on notification_log for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

-- push_subscriptions
drop policy "Require login" on push_subscriptions;
create policy "Require login" on push_subscriptions for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

-- th_job_photos
drop policy "Require login" on th_job_photos;
create policy "Require login" on th_job_photos for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

-- workspace_sync
drop policy "Require login" on workspace_sync;
create policy "Require login" on workspace_sync for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

-- workspace_sync_wiki
drop policy "Require login" on workspace_sync_wiki;
create policy "Require login" on workspace_sync_wiki for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

-- th_bookings. SELECT/UPDATE/DELETE only -- the INSERT policy stays
-- open to anon on purpose, since that's the public booking form.
drop policy "Only logged-in can view or manage bookings" on th_bookings;
create policy "Only logged-in can view or manage bookings" on th_bookings for select to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

drop policy "Only logged-in can update bookings" on th_bookings;
create policy "Only logged-in can update bookings" on th_bookings for update to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

drop policy "Only logged-in can delete bookings" on th_bookings;
create policy "Only logged-in can delete bookings" on th_bookings for delete to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

-- th_leads. Same shape as th_bookings -- public INSERT stays open,
-- since that's the public contact form.
drop policy "Only logged-in can view or manage leads" on th_leads;
create policy "Only logged-in can view or manage leads" on th_leads for select to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

drop policy "Only logged-in can update leads" on th_leads;
create policy "Only logged-in can update leads" on th_leads for update to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

drop policy "Only logged-in can delete leads" on th_leads;
create policy "Only logged-in can delete leads" on th_leads for delete to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));


-- Related, lower-severity finding from the same audit: account_roles'
-- own SELECT policy was fully open (qual: true) to any authenticated
-- user, so a future client account could have read the internal role
-- roster. Harmless in itself, but no reason to leave it open.
--
-- IMPORTANT, learned the hard way here: a table's own SELECT policy
-- CANNOT query that same table in its using clause, even via a helper
-- function, unless that function is SECURITY DEFINER. Doing it
-- directly causes infinite recursion and breaks ALL access to the
-- table, including for legitimate internal accounts. That happened
-- during this fix and was reverted within about a minute.
--
-- Note the pre-existing current_user_can_manage_roles() on this same
-- table is NOT security definer and works fine, but only because it's
-- called from account_roles' UPDATE/DELETE policies, never its own
-- SELECT policy. Easy distinction to miss.
create or replace function public.current_user_has_any_role()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.account_roles
    where email = (select auth.jwt() ->> 'email')
  );
$function$;

drop policy "Authenticated can view account roles" on account_roles;
create policy "Authenticated can view account roles" on account_roles for select to authenticated
  using ((select public.current_user_has_any_role()));
