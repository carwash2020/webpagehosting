-- Automated appointment reminder emails (direct request, 2026-09-09):
-- "How could we make this site more live... appointment reminders."
-- Reuses the SAME Resend account/secrets already configured for
-- send-booking-email/send-lead-email -- no new signup, no new secrets.
-- See edge-functions/send-appointment-reminder-index.ts for the
-- reasoning behind the hourly rolling-window approach (a fixed daily
-- send time would give some bookings 25 hours' notice and others 49).

alter table public.th_bookings add column if not exists reminder_sent_at timestamptz;

select cron.schedule(
  'send-appointment-reminders-hourly',
  '0 * * * *',
  $cron$
  select net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-appointment-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'send_push_service_role_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $cron$
);
