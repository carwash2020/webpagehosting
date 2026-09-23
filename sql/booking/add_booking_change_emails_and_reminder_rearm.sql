-- Booking-flow pass (2026-09-22): two gaps in what happens AFTER a
-- booking changes.
--
-- 1. A reschedule never re-armed the day-before reminder.
--    send-appointment-reminder only emails bookings whose
--    reminder_sent_at is null, and nothing ever cleared it. A guest
--    reminded Monday about Tuesday who then moved to Friday never heard
--    about Friday. track_booking_changes() (the existing BEFORE UPDATE
--    trigger that already stamps reschedule_count/last_rescheduled_at on
--    exactly this transition) now also clears reminder_sent_at. A move to
--    under 23 hours out simply misses the rolling [23h, 25h) window --
--    the guest just got the "your visit moved" email below, same as a
--    booking made less than a day ahead gets no separate reminder.
--
-- 2. A guest who rescheduled or cancelled got no email about it. The
--    only guest email was the INSERT-time confirmation, so their inbox
--    kept showing the OLD time. A new AFTER UPDATE trigger calls
--    send-booking-email with the same UPDATE payload shape Send-Push's
--    booking trigger already uses, gated in the trigger's own WHEN clause
--    to the two real transitions (confirmed -> cancelled, or a confirmed
--    booking's start_at moving). Any other update -- the reminder
--    function stamping reminder_sent_at, staff converting a booking to a
--    job -- never fires it. The function re-checks the transition itself.
--    Kept as its own trigger rather than folded into
--    notify_booking_status_change, so a Resend problem and a push problem
--    stay independent failure modes, the same reasoning as the separate
--    INSERT email/push triggers.
--
-- Deploy order: send-booking-email must be deployed with its UPDATE
-- handling BEFORE this trigger exists (the old version answered an
-- UPDATE payload with a harmless 400, sending nothing).

create or replace function public.track_booking_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.status = 'confirmed' and NEW.status = 'cancelled' then
    NEW.cancelled_at := now();
  end if;

  if OLD.status = 'confirmed' and NEW.status = 'confirmed' and OLD.start_at is distinct from NEW.start_at then
    NEW.reschedule_count := OLD.reschedule_count + 1;
    NEW.last_rescheduled_at := now();
    -- Re-arm the day-before reminder for the new time (see header).
    NEW.reminder_sent_at := null;
  end if;

  return NEW;
end;
$$;

create or replace function public.notify_booking_change_email()
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
    raise warning 'notify_booking_change_email: send_push_service_role_key not found in Vault; change email not sent for booking id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-booking-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'th_bookings',
      'record', row_to_json(NEW),
      'old_record', row_to_json(OLD)
    ),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;

-- Deliberately NO revoke on this trigger function, matching the existing
-- notify_new_booking_email/notify_booking_status_change: a `returns
-- trigger` function can't be called over the API at all, and revoking
-- EXECUTE on notify_new_lead() once broke live lead notifications
-- (2026-08-13, see the tripleh-business notes) -- not a risk worth taking
-- on the booking path for no real gain.

drop trigger if exists on_booking_change_send_email on public.th_bookings;
create trigger on_booking_change_send_email
  after update on public.th_bookings
  for each row
  when (
    (old.status = 'confirmed' and new.status = 'cancelled')
    or (old.status = 'confirmed' and new.status = 'confirmed' and old.start_at is distinct from new.start_at)
  )
  execute function public.notify_booking_change_email();
