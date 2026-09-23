-- Security audit finding (2026-09-23, CRITICAL): applied directly via the
-- Supabase MCP migration tool, mirrored here after the fact per this
-- repo's convention (same as restrict_job_photos_bucket_to_internal_accounts.sql).
--
-- THE HOLE. Supabase Auth on this project has public signup enabled
-- (`disable_signup: false`, read from the live /auth/v1/settings endpoint;
-- email confirmation is required, but any real mailbox satisfies that).
-- Every confirmed account holds the `authenticated` role. These policies
-- granted access to ANY `authenticated` session, a leftover from before
-- the client portal existed, when SECURITY.md could say "exactly two
-- accounts will ever be authenticated". That stopped being true once
-- portal accounts shipped, and was never true for a self-signed-up
-- stranger:
--
--   - public.site_content / site_faq / site_terms: INSERT, UPDATE, DELETE
--     with `true`. These drive the phone number, email, hours, banners,
--     FAQ, and Terms on every public page. A stranger could replace the
--     phone number site-wide and receive every inbound lead.
--   - public.site_content_history / site_faq_history / site_terms_history:
--     SELECT with `true` (includes internal staff emails in changed_by).
--   - storage `receipts`: SELECT (two duplicate policies), INSERT, DELETE
--     on bucket_id alone.
--   - storage `secure-documents`: SELECT, INSERT, DELETE on bucket_id
--     alone. This bucket holds the business-formation, insurance, and tax
--     documents.
--
-- Reproduced live before fixing: a simulated JWT for a fresh stranger
-- (no account_roles row, no client rows) could see all 6 secure-documents
-- objects and both receipts, and could UPDATE every site_content,
-- site_faq, and site_terms row. Correctly scoped tables (th_leads,
-- invoices, workspace_sync, job-photos, invoice-pdfs) returned 0.
--
-- THE FIX. Every real caller of these tables and buckets is an internal
-- /tools/ page (tools/site-content.html, tools/sync.js,
-- tools/workspace.html, tools/dev-tools.html). No portal page and no edge
-- function touches them (edge functions use the service role, which
-- bypasses RLS anyway). The public site only ever SELECTs site_content,
-- site_faq, and site_terms as anon; those read policies are unchanged.
--
--   - CMS writes require account_roles.can_manage_site_content, the same
--     permission tools/site-content.html already gates its UI on
--     (canManageSiteContent()). Both current internal accounts have it.
--   - History reads and both storage buckets require
--     current_user_has_any_role(), the project-wide staff-vs-client check.
--
-- The history triggers (log_site_content_change / log_site_faq_change /
-- log_site_terms_change) are SECURITY DEFINER, so they keep writing
-- history rows regardless of these policies.
--
-- Root cause still needs a dashboard change: turn public signup OFF
-- (Authentication -> Sign In / Providers -> "Allow new users to sign up").
-- Portal accounts are created by send-invite with the service role, which
-- keeps working with signup disabled. These policies are correct either
-- way: an invited portal client shouldn't be able to edit the website or
-- read internal documents either.

-- ---------------------------------------------------------------------
-- site_content / site_faq / site_terms: writes need can_manage_site_content
-- ---------------------------------------------------------------------
drop policy if exists "Only logged-in can edit site content" on public.site_content;
drop policy if exists "Only logged-in can update site content" on public.site_content;
drop policy if exists "Only logged-in can delete site content" on public.site_content;

create policy "Site content managers can insert site content"
  on public.site_content for insert to authenticated
  with check (exists (select 1 from public.account_roles ar
                      where ar.email = (select auth.email()) and ar.can_manage_site_content));
create policy "Site content managers can update site content"
  on public.site_content for update to authenticated
  using (exists (select 1 from public.account_roles ar
                 where ar.email = (select auth.email()) and ar.can_manage_site_content))
  with check (exists (select 1 from public.account_roles ar
                      where ar.email = (select auth.email()) and ar.can_manage_site_content));
create policy "Site content managers can delete site content"
  on public.site_content for delete to authenticated
  using (exists (select 1 from public.account_roles ar
                 where ar.email = (select auth.email()) and ar.can_manage_site_content));

drop policy if exists "Only logged-in can edit FAQ" on public.site_faq;
drop policy if exists "Only logged-in can update FAQ" on public.site_faq;
drop policy if exists "Only logged-in can delete FAQ" on public.site_faq;

create policy "Site content managers can insert FAQ"
  on public.site_faq for insert to authenticated
  with check (exists (select 1 from public.account_roles ar
                      where ar.email = (select auth.email()) and ar.can_manage_site_content));
create policy "Site content managers can update FAQ"
  on public.site_faq for update to authenticated
  using (exists (select 1 from public.account_roles ar
                 where ar.email = (select auth.email()) and ar.can_manage_site_content))
  with check (exists (select 1 from public.account_roles ar
                      where ar.email = (select auth.email()) and ar.can_manage_site_content));
create policy "Site content managers can delete FAQ"
  on public.site_faq for delete to authenticated
  using (exists (select 1 from public.account_roles ar
                 where ar.email = (select auth.email()) and ar.can_manage_site_content));

drop policy if exists "Only logged-in can edit terms" on public.site_terms;
drop policy if exists "Only logged-in can update terms" on public.site_terms;
drop policy if exists "Only logged-in can delete terms" on public.site_terms;

create policy "Site content managers can insert terms"
  on public.site_terms for insert to authenticated
  with check (exists (select 1 from public.account_roles ar
                      where ar.email = (select auth.email()) and ar.can_manage_site_content));
create policy "Site content managers can update terms"
  on public.site_terms for update to authenticated
  using (exists (select 1 from public.account_roles ar
                 where ar.email = (select auth.email()) and ar.can_manage_site_content))
  with check (exists (select 1 from public.account_roles ar
                      where ar.email = (select auth.email()) and ar.can_manage_site_content));
create policy "Site content managers can delete terms"
  on public.site_terms for delete to authenticated
  using (exists (select 1 from public.account_roles ar
                 where ar.email = (select auth.email()) and ar.can_manage_site_content));

-- ---------------------------------------------------------------------
-- History tables: internal accounts only
-- ---------------------------------------------------------------------
drop policy if exists "Only logged-in can read history" on public.site_content_history;
create policy "Internal accounts can read site content history"
  on public.site_content_history for select to authenticated
  using ((select public.current_user_has_any_role()));

drop policy if exists "Only logged-in can read FAQ history" on public.site_faq_history;
create policy "Internal accounts can read FAQ history"
  on public.site_faq_history for select to authenticated
  using ((select public.current_user_has_any_role()));

drop policy if exists "Only logged-in can read terms history" on public.site_terms_history;
create policy "Internal accounts can read terms history"
  on public.site_terms_history for select to authenticated
  using ((select public.current_user_has_any_role()));

-- ---------------------------------------------------------------------
-- Storage: receipts and secure-documents, internal accounts only
-- ---------------------------------------------------------------------
drop policy if exists "Allow authenticated downloads from receipts" on storage.objects;
drop policy if exists "Authenticated can view receipts" on storage.objects;
drop policy if exists "Allow authenticated uploads to receipts" on storage.objects;
drop policy if exists "Allow authenticated deletes from receipts" on storage.objects;

create policy "Internal accounts can view receipts"
  on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.current_user_has_any_role());
create policy "Internal accounts can upload receipts"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.current_user_has_any_role());
create policy "Internal accounts can delete receipts"
  on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and public.current_user_has_any_role());

drop policy if exists "Allow authenticated downloads from secure-documents" on storage.objects;
drop policy if exists "Allow authenticated uploads to secure-documents" on storage.objects;
drop policy if exists "Allow authenticated deletes from secure-documents" on storage.objects;

create policy "Internal accounts can view secure-documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'secure-documents' and public.current_user_has_any_role());
create policy "Internal accounts can upload secure-documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'secure-documents' and public.current_user_has_any_role());
create policy "Internal accounts can delete secure-documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'secure-documents' and public.current_user_has_any_role());
