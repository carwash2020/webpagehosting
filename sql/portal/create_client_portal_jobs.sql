-- Phase 4 of the client-portal roadmap (docs/CLIENT-PORTAL.md):
-- job history + warranty status. Applied directly via the Supabase
-- MCP migration tool; recorded here after the fact, same convention
-- as the other files in sql/portal/.

-- Mirrors client_portal_invoices' simpler shape (no internal SELECT
-- policy needed here, unlike client_portal_quotes -- Steve already
-- sees jobs directly in tools/job-tracker.html, there's no separate
-- client-driven state change to observe via the portal the way quote
-- approval/questions needed).
--
-- Deliberately does NOT store the internal jobNotes field -- that's
-- for internal use (access instructions, difficult-customer flags,
-- etc.), never something to expose to a client. Only title, date, and
-- client identity are synced.
--
-- Warranty status is NOT stored here at all -- it's a computed rule
-- (30 days from job_date), the exact same formula
-- tools/job-tracker.html's warrantyBadgeHtml() already uses
-- internally, computed fresh client-side in the portal from job_date
-- rather than stored and going stale.
create table client_portal_jobs (
  id bigint generated always as identity primary key,
  source_job_id bigint not null,
  client_email text not null,
  client_name text not null,
  title text not null,
  job_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lets sync-job-to-portal upsert -- re-saving the same completed job
-- (e.g. a title correction after marking Done) updates rather than
-- duplicates.
alter table client_portal_jobs
  add constraint client_portal_jobs_source_job_id_key
  unique (source_job_id);

alter table client_portal_jobs enable row level security;

-- Clients see only their own jobs -- (select ...) wraps auth.email()
-- for the same per-query-not-per-row performance reason already
-- applied to the other portal tables in this project.
create policy "clients can only view their own jobs"
  on client_portal_jobs for select
  to authenticated
  using ((select auth.email()) = client_email);

-- No insert/update/delete policy for the authenticated role at all --
-- every write goes through sync-job-to-portal using the service role
-- key, never from the browser, matching every other portal table.
