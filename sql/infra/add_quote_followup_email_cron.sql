-- Automated client-facing quote follow-up emails (2026-09-16), same
-- audit pass that added send-payment-reminder. An unconverted quote
-- already produced an internal push notification to Steve after 14
-- days (checkUnconvertedQuotes in send-push) -- but nothing ever told
-- the CLIENT their quote was still sitting there waiting on a
-- decision. See edge-functions/send-quote-followup-index.ts for the
-- full reasoning.
--
-- Runs once daily, same reasoning as the payment-reminder cron: this
-- is a date-level condition, not a time-of-day one. Same vault-secret
-- pattern every other cron job in this project already uses.

select cron.schedule(
  'send-quote-followup-daily',
  '0 16 * * *', -- 16:00 UTC = 9am Mountain Standard / 10am Mountain Daylight -- an hour after the payment-reminder cron, spreading the two sends apart rather than bunching every daily job at the same minute
  $cron$
  select net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-quote-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $cron$
);
