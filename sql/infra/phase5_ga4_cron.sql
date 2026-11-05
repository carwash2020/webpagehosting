-- Phase 5 (2026-11-04): the two daily Google Analytics jobs. Apply only
-- after ga4-report and ga4-conversion are deployed AND the Edge Function
-- secrets GA4_SERVICE_ACCOUNT_JSON, GA4_PROPERTY_ID and GA4_MP_API_SECRET
-- are set: until then both functions answer 503, and the cron watchdog would
-- (rightly) raise an alert every day.
--
-- Same shape as the other tracked jobs (cron_tracked_http_post, Vault key).
-- 13:17 UTC is early morning in Utah, after GA has mostly settled
-- yesterday's numbers; the sale retry runs half an hour later.

select cron.unschedule(jobid) from cron.job where jobname in ('ga4-report-daily', 'ga4-conversion-retry-daily');

select cron.schedule(
  'ga4-report-daily',
  '17 13 * * *',
  $$
  select cron_tracked_http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/ga4-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000,
    jobid := (select jobid from cron.job where jobname = 'ga4-report-daily')
  );
  $$
);

select cron.schedule(
  'ga4-conversion-retry-daily',
  '47 13 * * *',
  $$
  select cron_tracked_http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/ga4-conversion',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{"retry_pending": true}'::jsonb,
    timeout_milliseconds := 30000,
    jobid := (select jobid from cron.job where jobname = 'ga4-conversion-retry-daily')
  );
  $$
);
