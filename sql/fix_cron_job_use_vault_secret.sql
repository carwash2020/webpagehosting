-- The daily-reminder-check cron job had the service_role key hardcoded
-- in plaintext directly in cron.job.command -- same class of issue as
-- notify_new_lead() before its Vault migration. Re-scheduling under
-- the same job name replaces it in place. Run 2026-08-15.

select cron.schedule(
  'daily-reminder-check',
  '0 1 * * *',
  $cron$
  select net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/Send-Push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := jsonb_build_object('type', 'reminder-check'),
    timeout_milliseconds := 15000
  );
  $cron$
);
