-- Notification triggers for new bookings, requested directly as part
-- of the in-house Cal.com replacement. Follows the exact same pattern
-- already proven for th_leads (notify_new_lead / notify_new_lead_email)
-- -- two separate triggers, not one function doing both, so a Resend
-- outage never blocks the push notification and vice versa.
-- Run 2026-08-25.

-- PREREQUISITES (do these first):
--   1. Deploy the new Edge Function: supabase functions deploy send-booking-email
--   2. That function reuses RESEND_API_KEY, LEAD_EMAIL_TO, and LEAD_EMAIL_FROM,
--      already configured for the lead-email pipeline -- no new secrets needed.
--   3. Send-Push needs no new secrets either -- reuses its existing VAPID keys.

create or replace function public.notify_new_booking_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'send_push_service_role_key'
  limit 1;

  if service_key is null then
    raise warning 'notify_new_booking_push: send_push_service_role_key not found in Vault; push notification not sent for booking id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/Send-Push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'th_bookings',
      'record', row_to_json(NEW)
    ),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;

create or replace function public.notify_new_booking_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
begin
  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'send_push_service_role_key'
  limit 1;

  if service_key is null then
    raise warning 'notify_new_booking_email: send_push_service_role_key not found in Vault; booking email not sent for booking id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-booking-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'th_bookings',
      'record', row_to_json(NEW)
    ),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;

drop trigger if exists on_new_booking_send_push on public.th_bookings;
create trigger on_new_booking_send_push
  after insert on public.th_bookings
  for each row
  when (NEW.status = 'confirmed')
  execute function public.notify_new_booking_push();

drop trigger if exists on_new_booking_send_email on public.th_bookings;
create trigger on_new_booking_send_email
  after insert on public.th_bookings
  for each row
  when (NEW.status = 'confirmed')
  execute function public.notify_new_booking_email();

-- Confirm: should show both triggers on th_bookings.
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_table = 'th_bookings';
