-- In-house replacement for HetrixTools uptime monitoring, requested
-- directly. A GitHub Actions scheduled workflow (external to Supabase
-- entirely, not pg_cron) checks the live site and logs results here --
-- deliberately external rather than a pg_cron job, since pg_cron runs
-- inside the database itself: if the project ever did pause for any
-- reason, a paused database can't run its own scheduled jobs to wake
-- itself back up. An external check has no such blind spot, and also
-- tests the site the way a real visitor's network actually would,
-- rather than checking from inside Supabase's own network.

create table public.th_uptime_checks (
  id bigint generated always as identity primary key,
  checked_at timestamptz not null default now(),
  target text not null,
  status text not null check (status in ('up', 'down')),
  status_code integer,
  response_time_ms integer,
  error_message text
);

create index th_uptime_checks_target_checked_at_idx
  on public.th_uptime_checks (target, checked_at desc);

alter table public.th_uptime_checks enable row level security;

-- No insert policy for anon/authenticated at all, on purpose: the only
-- writer is the GitHub Actions workflow's service_role key, which
-- bypasses RLS entirely regardless of policies defined here. This
-- table simply isn't reachable for anon/authenticated inserts.
create policy "Staff can read uptime history"
  on public.th_uptime_checks
  for select
  to authenticated
  using (true);
