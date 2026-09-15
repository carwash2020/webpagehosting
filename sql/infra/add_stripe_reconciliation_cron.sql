-- Real gap found in a full-repo audit: every other pg_cron schedule in
-- this project has a matching file here (daily-reminder-check,
-- weekly-business-digest, the notification/uptime/portal-error cleanup
-- jobs, send-appointment-reminders-hourly, cron-watchdog) -- but
-- daily-stripe-reconciliation-check, which calls
-- reconcile-stripe-payments (see that function's own header comment
-- for what it does and why), was scheduled directly via the Supabase
-- dashboard/MCP tools at the time and never recorded in this repo at
-- all. Confirmed live and active via `select * from cron.job` before
-- writing this file -- this is documentation of the real, already-
-- running schedule, not a new migration to apply.
--
-- 6am UTC: after daily-reminder-check (1am UTC) and well clear of
-- weekly-business-digest (Monday 14:00 UTC) and the hourly appointment-
-- reminder job, so this doesn't compete with them for the same
-- send_push_service_role_key Vault secret lookup at the same moment.
select cron.schedule(
  'daily-stripe-reconciliation-check',
  '0 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/reconcile-stripe-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $cron$
);
