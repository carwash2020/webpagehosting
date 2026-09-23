-- Bug (reported directly, with a screenshot of Dev Tools' Cron Health
-- panel showing a run of "HTTP call failed -- status 401" alerts on
-- 2026-09-23): Cron Health was flagging failures that had nothing to
-- do with any pg_cron job. Confirmed live: every actual pg_cron job
-- run in the affected window (jobs 11, 12, 13, 14) succeeded --
-- cron.job_run_details shows no failures at all -- while the alerted
-- timestamps didn't line up with any job's schedule (:00/:30 for the
-- hourly/half-hourly jobs) and the response bodies were things like
-- "Must be signed in." and an RLS violation on th_bookings, which are
-- never returned by any of this project's own cron-driven Edge
-- Function calls.
--
-- Root cause: check_cron_health() (see add_cron_watchdog.sql) scans
-- ALL of net._http_response for a non-2xx row and reports every one
-- as a cron failure. But net.http_post is granted to postgres, anon,
-- authenticated AND service_role (see grant_pg_net_access in the
-- pg_net extension's own install hook), and this project's own DB
-- triggers (notify_new_lead, notify_booking_status_change, and every
-- other notify_* function in this directory) call net.http_post too,
-- same as the pg_cron jobs do. Anything else in this project that
-- ever calls net.http_post -- a trigger hitting an Edge Function that
-- rejects the request for its own good reasons, or any future direct
-- caller -- got misattributed to "cron" the moment it returned
-- anything but a clean 2xx. The watchdog was never wrong that SOME
-- net.http_post call failed; it was wrong to assume every one of them
-- came from a cron job.
--
-- Fix: only cron.job-initiated net.http_post calls should ever be
-- able to set off a Cron Health alert. Each pg_cron job's
-- net.http_post is replaced with cron_tracked_http_post(...), a thin
-- wrapper that records which pg_cron jobid made the call before
-- returning the same request id net.http_post would have. Cron
-- Health then joins net._http_response against that mapping instead
-- of scanning every row in the table, so it can only ever alert on a
-- response to a call a cron job actually made -- and the alert now
-- names which job, instead of a bare "HTTP call failed."
--
-- Applied directly via the Supabase MCP migration tool; recorded here
-- after the fact, same convention as every other file in this
-- directory.

-- ---------------------------------------------------------------
-- cron_tracked_http_requests: maps a pg_net request id back to the
-- pg_cron jobid that made it. Internal bookkeeping only -- nothing
-- outside cron_tracked_http_post()/check_cron_health() ever needs to
-- read or write it, so it gets RLS with no policies at all (same
-- "no anon/authenticated reason to touch this" reasoning already used
-- for th_uptime_checks and portal_client_errors), rather than the
-- internal-accounts-can-select policy cron_alerts has, since Dev
-- Tools never queries this table directly.
-- ---------------------------------------------------------------
create table cron_tracked_http_requests (
  request_id bigint primary key,
  jobid bigint not null,
  created_at timestamptz not null default now()
);

alter table cron_tracked_http_requests enable row level security;

-- ---------------------------------------------------------------
-- cron_tracked_http_post(): every pg_cron job below calls this
-- instead of net.http_post directly. Same signature plus a jobid,
-- same return value (the request id), so it's a drop-in swap.
-- ---------------------------------------------------------------
create or replace function cron_tracked_http_post(
  url text,
  headers jsonb,
  body jsonb,
  timeout_milliseconds integer,
  jobid bigint
)
returns bigint
language plpgsql
security definer
set search_path = public, net
as $$
declare
  req_id bigint;
begin
  req_id := net.http_post(
    url := url,
    headers := headers,
    body := body,
    timeout_milliseconds := timeout_milliseconds
  );
  insert into cron_tracked_http_requests (request_id, jobid) values (req_id, jobid);
  return req_id;
end;
$$;

revoke all on function cron_tracked_http_post(text, jsonb, jsonb, integer, bigint) from public;
grant execute on function cron_tracked_http_post(text, jsonb, jsonb, integer, bigint) to postgres;

-- Supabase grants EXECUTE on every new public-schema function to anon
-- and authenticated by default privileges -- separate from, and not
-- removed by, the "revoke all ... from public" above. Caught live by
-- get_advisors immediately after first applying this migration
-- (anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable both flagged
-- this function): left as-is, this would have been a SECURITY
-- DEFINER function, callable by anyone via
-- /rest/v1/rpc/cron_tracked_http_post, that does net.http_post to a
-- caller-controlled url/headers/body -- an open SSRF and
-- junk-row-insertion primitive. Only postgres (pg_cron's own
-- execution role) may ever call this.
revoke execute on function cron_tracked_http_post(text, jsonb, jsonb, integer, bigint) from anon, authenticated;

-- ---------------------------------------------------------------
-- Swap each cron job's raw net.http_post for the tracked wrapper,
-- passing its own jobid through. cron.alter_job keeps the existing
-- jobid/schedule/name -- only the command text changes.
-- ---------------------------------------------------------------
select cron.alter_job(
  (select jobid from cron.job where jobname = 'daily-reminder-check'),
  command := $cmd$
  select cron_tracked_http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/Send-Push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := jsonb_build_object('type', 'reminder-check'),
    timeout_milliseconds := 15000,
    jobid := (select jobid from cron.job where jobname = 'daily-reminder-check')
  );
  $cmd$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'weekly-business-digest'),
  command := $cmd$
  select cron_tracked_http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/Send-Push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := jsonb_build_object('type', 'weekly-digest'),
    timeout_milliseconds := 15000,
    jobid := (select jobid from cron.job where jobname = 'weekly-business-digest')
  );
  $cmd$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'daily-stripe-reconciliation-check'),
  command := $cmd$
  select cron_tracked_http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/reconcile-stripe-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000,
    jobid := (select jobid from cron.job where jobname = 'daily-stripe-reconciliation-check')
  );
  $cmd$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'send-appointment-reminders-hourly'),
  command := $cmd$
  select cron_tracked_http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-appointment-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000,
    jobid := (select jobid from cron.job where jobname = 'send-appointment-reminders-hourly')
  );
  $cmd$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'send-payment-reminders-daily'),
  command := $cmd$
  select cron_tracked_http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-payment-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000,
    jobid := (select jobid from cron.job where jobname = 'send-payment-reminders-daily')
  );
  $cmd$
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'send-quote-followup-daily'),
  command := $cmd$
  select cron_tracked_http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-quote-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000,
    jobid := (select jobid from cron.job where jobname = 'send-quote-followup-daily')
  );
  $cmd$
);

-- ---------------------------------------------------------------
-- check_cron_health(): only look at responses to calls this project
-- can prove came from a pg_cron job (an inner join against
-- cron_tracked_http_requests, instead of scanning net._http_response
-- unfiltered). Everything else about the function -- the
-- cron.job_run_details half, the cursor, the best-effort alert push
-- -- is unchanged.
-- ---------------------------------------------------------------
create or replace function check_cron_health()
returns void
language plpgsql
security definer
set search_path = public, net, cron
as $$
declare
  state record;
  bad_response record;
  bad_run record;
  max_http_id bigint;
  max_run_id bigint;
begin
  select * into state from cron_watchdog_state where id = true;

  -- Only responses to calls a pg_cron job actually made (tracked via
  -- cron_tracked_http_post at call time) -- not every net.http_post
  -- caller in the project, so a trigger-fired notification Edge
  -- Function rejecting a request for its own reasons can never show
  -- up here as a false "cron" failure.
  for bad_response in
    select r.id, r.status_code, r.timed_out, r.error_msg, r.created, t.jobid
    from net._http_response r
    join cron_tracked_http_requests t on t.request_id = r.id
    where r.id > state.last_http_response_id
      and (r.status_code is null or r.status_code < 200 or r.status_code >= 300 or r.timed_out = true)
    order by r.id
  loop
    insert into cron_alerts (alert_type, detail)
    values (
      'http_response_failed',
      format(
        'Cron job #%s HTTP call failed at %s -- status %s%s%s',
        bad_response.jobid,
        bad_response.created,
        coalesce(bad_response.status_code::text, 'none'),
        case when bad_response.timed_out then ' (timed out)' else '' end,
        case when bad_response.error_msg is not null then ': ' || bad_response.error_msg else '' end
      )
    );
  end loop;

  select max(id) into max_http_id from net._http_response;
  if max_http_id is not null and max_http_id > state.last_http_response_id then
    update cron_watchdog_state set last_http_response_id = max_http_id where id = true;
  end if;

  for bad_run in
    select runid, jobid, status, return_message, start_time
    from cron.job_run_details
    where runid > state.last_job_run_id
      and status not in ('succeeded', 'starting', 'running')
    order by runid
  loop
    insert into cron_alerts (alert_type, detail)
    values (
      'job_run_failed',
      format('Cron job #%s run failed at %s: %s (%s)', bad_run.jobid, bad_run.start_time, bad_run.status, coalesce(bad_run.return_message, 'no message'))
    );
  end loop;

  select max(runid) into max_run_id from cron.job_run_details;
  if max_run_id is not null and max_run_id > state.last_job_run_id then
    update cron_watchdog_state set last_job_run_id = max_run_id where id = true;
  end if;

  if exists (select 1 from cron_alerts where created_at > now() - interval '31 minutes' and not acknowledged) then
    perform net.http_post(
      url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/Send-Push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
      ),
      body := jsonb_build_object('type', 'cron-health-alert'),
      timeout_milliseconds := 15000
    );
  end if;
end;
$$;

-- The false positives already sitting in cron_alerts from before this
-- fix aren't real cron failures -- acknowledge them so they stop
-- showing as open alerts. Genuine future cron failures still insert
-- fresh, unacknowledged rows same as always.
update cron_alerts
set acknowledged = true, acknowledged_at = now(), acknowledged_by = 'system (false-positive cleanup, 2026-09-23)'
where not acknowledged
  and alert_type = 'http_response_failed';
