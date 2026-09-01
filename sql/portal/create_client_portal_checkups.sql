-- Phase 5 of the client-portal roadmap (docs/CLIENT-PORTAL.md):
-- return-service / check-up reminders. Applied directly via the
-- Supabase MCP migration tool; recorded here after the fact, same
-- convention as the other files in sql/portal/.

-- Surfaces existing Recurring Job Templates data (th_job_templates,
-- already built in tools/job-tracker.html) as a read-only banner --
-- no scheduling action from here yet (see docs/CLIENT-PORTAL.md's own
-- phrasing: self-scheduling against this is an explicit future step,
-- not part of this phase).
--
-- Mirrors client_portal_jobs' simple shape: no internal SELECT policy
-- needed, Steve already manages templates directly in Job Tracker.
-- "Due" status is NEVER stored here, same reasoning as job warranty --
-- interval_months and last_created_date are the raw inputs, computed
-- fresh client-side in the portal using the exact same formula
-- templateDueInfo() already uses internally.
create table client_portal_checkups (
  id bigint generated always as identity primary key,
  source_template_id bigint not null,
  client_email text not null,
  client_name text not null,
  title text not null,
  interval_months integer not null,
  last_created_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lets sync-checkup-to-portal upsert -- editing a template or creating
-- a job from it (which advances last_created_date) updates rather
-- than duplicates.
alter table client_portal_checkups
  add constraint client_portal_checkups_source_template_id_key
  unique (source_template_id);

alter table client_portal_checkups enable row level security;

create policy "clients can only view their own checkup reminders"
  on client_portal_checkups for select
  to authenticated
  using ((select auth.email()) = client_email);

-- No insert/update/delete policy for the authenticated role at all --
-- every write (including deletion, when a template is removed
-- internally) goes through sync-checkup-to-portal using the service
-- role key, matching every other portal table.
