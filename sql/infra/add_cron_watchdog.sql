-- Cron fire-and-forget watchdog, closing a real audit gap: all of this
-- project's pg_cron jobs that call an Edge Function do so via
-- net.http_post inside a bare `select`, with nothing anywhere reading
-- the actual response (net._http_response) or checking
-- cron.job_run_details for a failed run. pg_net is asynchronous -- a
-- cron job shows "succeeded" in cron.job_run_details the instant the
-- HTTP request is successfully QUEUED, regardless of whether the Edge
-- Function it called actually returned 200. If a function starts
-- 500ing, times out, or a Vault secret rotates and breaks auth, the
-- cron job keeps reporting success forever while its real work
-- silently stops happening -- the exact same class of bug the
-- notification_log on_conflict fix and the Stripe reconciliation check
-- already closed for two OTHER specific silent-failure modes in this
-- project.
--
-- This closes the general case: a periodic health check (itself a
-- plain, synchronous SQL function call from cron, not another
-- net.http_post -- so its own success/failure is fully visible in
-- cron.job_run_details with no async blind spot of its own) that scans
-- both signals and writes any real problem into a plain table Dev
-- Tools can display, the same "dedicated table + direct query" pattern
-- already proven for client_portal_quotes/contracts status instead of
-- writing into the workspace_sync JSON blob (which risks the exact
-- clobbered-write bug DISASTER_RECOVERY.md already documents once).
--
-- Applied directly via the Supabase MCP migration tool; recorded here
-- after the fact so the schema is reproducible from this repo, same
-- convention as every other file in this directory.

-- ---------------------------------------------------------------
-- cron_alerts: what Dev Tools actually displays
-- ---------------------------------------------------------------
create table cron_alerts (
  id bigint generated always as identity primary key,
  alert_type text not null,
  detail text not null,
  created_at timestamptz not null default now(),
  acknowledged boolean not null default false,
  acknowledged_at timestamptz,
  acknowledged_by text,
  constraint cron_alerts_alert_type_check check (alert_type in ('job_run_failed', 'http_response_failed'))
);

alter table cron_alerts enable row level security;

-- Internal-only: this is operational monitoring data, no client-facing
-- reason to ever expose it, same reasoning as th_uptime_checks and
-- portal_client_errors having no anon policy at all.
create policy "internal accounts can view cron alerts"
  on cron_alerts for select
  to authenticated
  using (exists (select 1 from account_roles where email = (select auth.email())));

create policy "internal accounts can acknowledge cron alerts"
  on cron_alerts for update
  to authenticated
  using (exists (select 1 from account_roles where email = (select auth.email())));

-- ---------------------------------------------------------------
-- cron_watchdog_state: a single-row cursor so each check only looks at
-- what's genuinely new since the last run, rather than re-alerting on
-- the same already-reported failure every 30 minutes forever.
-- ---------------------------------------------------------------
create table cron_watchdog_state (
  id boolean primary key default true,
  last_http_response_id bigint not null default 0,
  last_job_run_id bigint not null default 0,
  constraint cron_watchdog_state_singleton check (id)
);
insert into cron_watchdog_state (id) values (true);

-- ---------------------------------------------------------------
-- check_cron_health(): the actual watchdog logic
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

  -- Any HTTP response this project's own pg_net calls received that
  -- wasn't a clean 2xx -- a non-2xx status, a timeout, or a transport-
  -- level error. Covers every net.http_post caller in this project
  -- (the cron jobs above, notify_new_lead, and any future one) without
  -- needing to touch or modify any of their existing definitions.
  for bad_response in
    select id, status_code, timed_out, error_msg, created
    from net._http_response
    where id > state.last_http_response_id
      and (status_code is null or status_code < 200 or status_code >= 300 or timed_out = true)
    order by id
  loop
    insert into cron_alerts (alert_type, detail)
    values (
      'http_response_failed',
      format(
        'HTTP call failed at %s -- status %s%s%s',
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

  -- A cron job's own run genuinely failing or erroring -- distinct from
  -- the async-response check above, since this catches a failure in
  -- the scheduled SQL statement itself (e.g. a syntax error after an
  -- edit, or a plain-SQL job like the monthly cleanup jobs failing).
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

  -- Best-effort immediate push, on top of the reliable cron_alerts row
  -- above -- if this specific net.http_post itself fails, the alert is
  -- still not lost, since the table write already happened first.
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

select cron.schedule(
  'cron-watchdog',
  '*/30 * * * *',
  $$select check_cron_health();$$
);

-- Seed the cursor to the CURRENT max ids immediately after creation --
-- without this, the very first run would treat this project's entire
-- history of net._http_response/cron.job_run_details rows as "new,"
-- flooding cron_alerts with old, already-resolved noise instead of
-- only alerting on genuinely new failures going forward.
update cron_watchdog_state
set last_http_response_id = coalesce((select max(id) from net._http_response), 0),
    last_job_run_id = coalesce((select max(runid) from cron.job_run_details), 0)
where id = true;
