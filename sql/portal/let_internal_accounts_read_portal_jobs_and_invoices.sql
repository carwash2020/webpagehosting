-- Internal accounts can read client_portal_jobs and client_portal_invoices
-- (2026-09-22).
--
-- Both tables were created with a single client-only SELECT policy
-- ((select auth.email()) = client_email) -- reasonable at the time
-- ("Steve already sees jobs directly in Job Tracker", per
-- docs/CLIENT-PORTAL.md), before anything internal read them. Since
-- then tools/clients.html reads both with the staff member's own login:
--
--   * renderPortalJobsForMessages() lists client_portal_jobs so Steve
--     can open and reply to a client's job thread. Under the client-only
--     policy that list is always empty ("No jobs have synced to the
--     portal yet") the moment real jobs exist -- a client could ask a
--     question about a finished job and nobody could see the job to
--     answer it (the thread's own messages ARE visible to staff; the
--     parent row wasn't).
--   * loadPortalAccounts() counts each client's invoices/quotes/jobs.
--     Only quotes (merged policy) ever counted; invoices and jobs read
--     as zero for every client.
--   * renderPortalInvoices() (the "Portal invoices" panel -- "what the
--     client sees and what payment actually updates"),
--     findMatchingClientEmails() (client search) and the per-client
--     summary all query client_portal_invoices too, and all silently
--     came back empty for the same reason.
--
-- Fixed the same way client_portal_quotes/_contracts/_work_orders
-- already work: ONE merged permissive SELECT policy per table, never a
-- second one alongside (see
-- sql/infra/audit_round3_security_and_performance_fixes.sql for why
-- duplicate permissive policies were merged away). Read-only: no
-- insert/update/delete policy is added for anyone; writes still happen
-- only through the service-role edge functions.
--
-- Applied directly via the Supabase MCP migration tool; recorded here
-- after the fact.

drop policy if exists "clients can only view their own jobs" on public.client_portal_jobs;
create policy "clients or internal accounts can view jobs"
  on public.client_portal_jobs for select
  to authenticated
  using ((select auth.email()) = client_email or public.current_user_has_any_role());

drop policy if exists "clients can only view their own invoices" on public.client_portal_invoices;
create policy "clients or internal accounts can view invoices"
  on public.client_portal_invoices for select
  to authenticated
  using ((select auth.email()) = client_email or public.current_user_has_any_role());
