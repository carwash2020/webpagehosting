-- The new Applicants panel on workspace.html (2026-09-19) subscribes to
-- postgres_changes on th_job_applications via startApplicantsRealtime()
-- (tools/sync.js), same pattern as th_leads's own realtime channel --
-- but a table has to be explicitly added to the supabase_realtime
-- publication before Postgres will actually emit change events for it
-- (see add_workspace_sync_and_leads_to_realtime.sql, the same gap
-- found and fixed for workspace_sync/th_leads on 2026-08-15).

alter publication supabase_realtime add table public.th_job_applications;
