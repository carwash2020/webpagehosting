-- Security advisor / external audit finding (2026-09-21): applied
-- directly via the Supabase MCP migration tool, mirrored here after the
-- fact per this repo's convention.
--
-- The job-photos Storage bucket's policies only checked
-- `bucket_id = 'job-photos'` for the `authenticated` role -- no further
-- scoping by owner or path. This gap was already known and documented
-- (get-job-photo-urls-index.ts, sql/portal/add_job_photo_paths_column.sql
-- both call it out) but explicitly left "out of scope" at the time,
-- since the client-portal feature itself was closed by routing photo
-- access through get-job-photo-urls, which checks
-- client_portal_jobs.client_email before signing with the service role
-- (bypassing these policies entirely). That left the underlying bucket
-- policy itself still open: any authenticated Supabase session --
-- including a client portal account, not just internal staff -- could
-- call `/storage/v1/object/sign/job-photos/<any-path>` directly and
-- potentially get a signed URL for a job that wasn't theirs, or
-- upload/delete objects in any job's folder.
--
-- Confirmed via grep that no client-portal code path ever calls Storage
-- directly for this bucket -- portal/jobs.html's loadJobPhotos always
-- goes through the edge function. The only real caller of these
-- policies is internal staff via tools/job-tracker.html's own session.
-- Restricting to internal accounts only (current_user_has_any_role(),
-- the same check used project-wide for this exact staff-vs-client
-- distinction) closes the gap with no effect on any real usage.
drop policy if exists "Allow authenticated deletes from job-photos" on storage.objects;
drop policy if exists "Allow authenticated uploads to job-photos" on storage.objects;
drop policy if exists "Authenticated can view job-photos" on storage.objects;

create policy "Internal accounts can view job-photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and public.current_user_has_any_role());

create policy "Internal accounts can upload job-photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and public.current_user_has_any_role());

create policy "Internal accounts can delete job-photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and public.current_user_has_any_role());
