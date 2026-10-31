-- Bug: 34 open Cron Health alerts that are all false alarms.
--
-- check_cron_health() (see fix_cron_health_false_positives.sql) flagged
-- any cron.job_run_details row whose status was not in
-- (succeeded, starting, running). pg_cron also reports 'connecting' and
-- 'sending' while a job is still in flight. The watchdog itself runs
-- */30, i.e. at :00 and :30, exactly when jobs 3, 10, 11, 12, 13 and 14
-- fire, so it read them mid-run, logged "run failed at : sending (no
-- message)", and then moved last_job_run_id past them, so they were
-- never looked at again once they finished. cron.job_run_details shows
-- 0 real failures in 35 days for every job.
--
-- Fix, two parts:
--   1. Only alert on status = 'failed'.
--   2. Never move the cursor past a run that hasn't reached a terminal
--      state (succeeded / failed): it stops at min(runid) - 1 of the
--      unfinished runs, so they are looked at again next time. A run
--      still unfinished after an hour is treated as abandoned and no
--      longer holds the cursor back.
--   Because the cursor can now stay behind runs that were already
--   scanned, a failed run is alerted at most once: its run id is in the
--   alert text and checked before inserting.
--
-- Plus a one-time acknowledge of the existing false alarms.
--
-- Needs applying by the manager (not applied by the PR).

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
  oldest_unfinished_run_id bigint;
begin
  select * into state from cron_watchdog_state where id = true;

  -- Unchanged from fix_cron_health_false_positives.sql: only responses
  -- to calls a pg_cron job actually made.
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

  -- Only a run that actually failed is an alert. connecting / sending /
  -- starting / running are in flight, not failures.
  for bad_run in
    select runid, jobid, status, return_message, start_time
    from cron.job_run_details
    where runid > state.last_job_run_id
      and status = 'failed'
    order by runid
  loop
    -- The cursor may sit behind this run (an older run is still in
    -- flight), so this run may already have been reported.
    if not exists (
      select 1 from cron_alerts
      where alert_type = 'job_run_failed'
        and detail like format('Cron job #%s run #%s failed at %%', bad_run.jobid, bad_run.runid)
    ) then
      insert into cron_alerts (alert_type, detail)
      values (
        'job_run_failed',
        format('Cron job #%s run #%s failed at %s: %s (%s)', bad_run.jobid, bad_run.runid, bad_run.start_time, bad_run.status, coalesce(bad_run.return_message, 'no message'))
      );
    end if;
  end loop;

  -- Advance the cursor only up to the run before the oldest one that
  -- hasn't finished. Unfinished runs older than an hour are abandoned.
  select max(runid) into max_run_id from cron.job_run_details;
  select min(runid) into oldest_unfinished_run_id
  from cron.job_run_details
  where runid > state.last_job_run_id
    and status not in ('succeeded', 'failed')
    and start_time > now() - interval '1 hour';

  if max_run_id is not null then
    max_run_id := least(max_run_id, coalesce(oldest_unfinished_run_id - 1, max_run_id));
    if max_run_id > state.last_job_run_id then
      update cron_watchdog_state set last_job_run_id = max_run_id where id = true;
    end if;
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

-- One-time: acknowledge the false alarms the old logic already logged
-- (runs that were still connecting/sending when the watchdog read them).
update cron_alerts
set acknowledged = true, acknowledged_at = now(), acknowledged_by = 'system (in-flight false-alarm cleanup, 2026-10-31)'
where alert_type = 'job_run_failed'
  and not acknowledged
  and detail ~ ': (sending|connecting) ';
