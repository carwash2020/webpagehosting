-- Security/performance review finding (independent second-pass, 2026-09-08):
-- an earlier session wrapped auth.role() in (select auth.role()) across 5
-- tables to fix "Auth RLS Initialization Plan" -- but the SAME policies
-- also reference auth.email() inside a nested EXISTS subquery, which was
-- left unwrapped. The advisor flags the whole policy either way, so this
-- was still showing as unresolved for these tables plus several added
-- since. Matched drop/create pairs, same policy name/command/role list as
-- before -- only auth.email() -> (select auth.email()) changes; nothing
-- about who is allowed to do what changes.

-- notification_log
drop policy "Require login" on public.notification_log;
create policy "Require login" on public.notification_log for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- push_subscriptions
drop policy "Require login" on public.push_subscriptions;
create policy "Require login" on public.push_subscriptions for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- th_job_photos
drop policy "Require login" on public.th_job_photos;
create policy "Require login" on public.th_job_photos for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- workspace_sync
drop policy "Require login" on public.workspace_sync;
create policy "Require login" on public.workspace_sync for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- workspace_sync_wiki
drop policy "Require login" on public.workspace_sync_wiki;
create policy "Require login" on public.workspace_sync_wiki for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- th_bookings (3 policies; "Anyone can submit a booking" INSERT left untouched -- no auth.* call in it)
drop policy "Only logged-in can view or manage bookings" on public.th_bookings;
create policy "Only logged-in can view or manage bookings" on public.th_bookings for select to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

drop policy "Only logged-in can update bookings" on public.th_bookings;
create policy "Only logged-in can update bookings" on public.th_bookings for update to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

drop policy "Only logged-in can delete bookings" on public.th_bookings;
create policy "Only logged-in can delete bookings" on public.th_bookings for delete to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- th_leads (3 policies; "Anyone can submit a lead" INSERT left untouched -- no auth.* call in it)
drop policy "Only logged-in can view or manage leads" on public.th_leads;
create policy "Only logged-in can view or manage leads" on public.th_leads for select to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

drop policy "Only logged-in can update leads" on public.th_leads;
create policy "Only logged-in can update leads" on public.th_leads for update to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

drop policy "Only logged-in can delete leads" on public.th_leads;
create policy "Only logged-in can delete leads" on public.th_leads for delete to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- portal_bug_reports (2 policies; "Anyone can submit a bug report" INSERT left untouched)
drop policy "Internal accounts can view bug reports" on public.portal_bug_reports;
create policy "Internal accounts can view bug reports" on public.portal_bug_reports for select to authenticated
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

drop policy "Internal accounts can resolve bug reports" on public.portal_bug_reports;
create policy "Internal accounts can resolve bug reports" on public.portal_bug_reports for update to authenticated
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- portal_client_errors (1 policy; "Anyone can log a client error" INSERT left untouched)
drop policy "Internal accounts can view portal client errors" on public.portal_client_errors;
create policy "Internal accounts can view portal client errors" on public.portal_client_errors for select to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));
