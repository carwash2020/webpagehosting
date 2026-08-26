-- Two new pg_cron jobs, added 2026-08-15 alongside the 11th
-- reminder-check and the storage security fix.

-- Weekly business digest -- Monday mornings, trend awareness rather
-- than a specific alert. Uses the Vault-based key lookup from the
-- start (the correct, established pattern in this project -- no
-- hardcoded key, ever).
select cron.schedule(
  'weekly-business-digest',
  '0 14 * * 1',
  $cron$
  select net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/Send-Push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := jsonb_build_object('type', 'weekly-digest'),
    timeout_milliseconds := 15000
  );
  $cron$
);

-- notification_log auto-archive -- monthly. Retention MUST stay above
-- 3650 days: two of the 11 daily reminder-check categories
-- (job-no-photos, warranty-checkin) deliberately use a 3650-day resend
-- interval to nudge only once, ever. A shorter retention here would
-- delete their log row and make wasRecentlyNotified() find nothing on
-- the next run, silently turning a one-time nudge into a repeating
-- one -- this was caught and fixed before it ever ran for real (an
-- earlier draft of this migration used 120 days).
select cron.schedule(
  'archive-old-notification-log',
  '30 8 1 * *',
  $cron$
  delete from public.notification_log where sent_at < now() - interval '3700 days';
  $cron$
);
