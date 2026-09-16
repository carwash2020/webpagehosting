-- Automated client-facing payment reminder emails (2026-09-16), from
-- an audit of what's already automated for invoices/reviews/schedules/
-- emails/reports: overdue invoices already produced an internal push
-- notification (checkOverdueInvoices in send-push) and the Dashboard's
-- Outstanding/Overdue cards, but nothing ever told the CLIENT their
-- invoice was overdue -- Steve had to notice and follow up by hand
-- every time. See edge-functions/send-payment-reminder-index.ts for
-- the full reasoning behind the 3/7/14-day escalation ladder.
--
-- Runs once daily (not hourly like the appointment reminder) -- being
-- overdue is a date-level condition, not a time-of-day one, so there's
-- no equivalent reason to check more often. Same vault-secret pattern
-- every other cron job in this project already uses -- no new secret.

select cron.schedule(
  'send-payment-reminders-daily',
  '0 15 * * *', -- 15:00 UTC = 8am Mountain Standard / 9am Mountain Daylight -- late enough that it doesn't land before business hours either way
  $cron$
  select net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-payment-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $cron$
);
