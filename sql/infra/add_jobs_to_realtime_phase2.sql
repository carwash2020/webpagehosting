-- Relational tables Phase 2, step 1 (2026-09-09): calendar.html becomes
-- the first page to read jobs from the real `jobs` table instead of the
-- localStorage/workspace_sync blob copy. Deliberately the safest
-- possible starting page: read-only (calendar.html never writes
-- th_tracker_jobs), so a mistake here can only show wrong/stale data,
-- never corrupt anything. th_bookings and th_leads already needed the
-- same fix (see sql/booking/add_bookings_to_realtime.sql) -- exact same
-- reasoning applies to jobs: without this, a job added on Steve's phone
-- is invisible on Connor's calendar until a manual reload.
alter publication supabase_realtime add table public.jobs;
