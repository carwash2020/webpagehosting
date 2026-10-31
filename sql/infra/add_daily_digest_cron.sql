-- Cron for daily-digest. NOT APPLIED. Apply only after the migration
-- (add_daily_digest.sql) and the function deploy. Safe to apply while
-- digest_settings.enabled = false: the function returns without sending.
--
-- Hourly; the function itself only sends when the America/Denver local hour
-- is within [send_hour_local, send_hour_local + 3] and today's run isn't
-- already sent (so a failed 8 PM send retries at 9, 10, 11 PM, DST-safe).
select cron.schedule(
  'daily-digest-hourly',
  '0 * * * *',
  $cron$
  select cron_tracked_http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/daily-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000,
    jobid := (select jobid from cron.job where jobname = 'daily-digest-hourly')
  );
  $cron$
);
