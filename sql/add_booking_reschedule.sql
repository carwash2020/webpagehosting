-- Guest self-service rescheduling, continuing the cancel work
-- (sql/add_booking_cancellation.sql). Run 2026-08-25.

create or replace function public.reschedule_booking_by_token(p_token uuid, p_new_start timestamptz)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found_status text;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_duration interval;
  v_new_end timestamptz;
begin
  select status, start_at, end_at into v_found_status, v_start_at, v_end_at
  from public.th_bookings where cancel_token = p_token;

  if v_found_status is null then
    return query select false, 'not-found'::text;
    return;
  end if;

  if v_found_status = 'cancelled' then
    return query select false, 'already-cancelled'::text;
    return;
  end if;

  if p_new_start < now() then
    return query select false, 'in-the-past'::text;
    return;
  end if;

  -- Duration comes from the EXISTING booking, never from the client --
  -- a guest could otherwise submit a mismatched end time (e.g. a
  -- 45-minute Inspection stretched into a 3-hour block), silently
  -- changing what was actually booked.
  v_duration := v_end_at - v_start_at;
  v_new_end := p_new_start + v_duration;

  begin
    update public.th_bookings
    set start_at = p_new_start, end_at = v_new_end
    where cancel_token = p_token and status = 'confirmed';
    return query select true, 'rescheduled'::text;
  exception when exclusion_violation then
    -- The real, race-condition-safe protection doing its job -- someone
    -- else took the new slot between the guest loading the page and
    -- clicking confirm. Reported clearly rather than as a raw 23P01.
    return query select false, 'slot-taken'::text;
  end;
end;
$$;

grant execute on function public.reschedule_booking_by_token(uuid, timestamptz) to anon, authenticated;

-- Consolidates what were originally two separate AFTER UPDATE triggers
-- (notify_booking_cancelled, notify_booking_rescheduled) into one.
-- "Cancelled" and "rescheduled" are mutually exclusive outcomes of the
-- same UPDATE event, so there's never a need for more than one
-- net.http_post call per update -- and having two separate triggers
-- both attempting one was worth eliminating on general principle even
-- though direct debugging traced the actual missing-notification bug
-- to something else entirely (see below).
drop trigger if exists on_booking_cancelled on public.th_bookings;
drop function if exists public.notify_booking_cancelled();
drop trigger if exists on_booking_rescheduled on public.th_bookings;
drop function if exists public.notify_booking_rescheduled();

create or replace function public.notify_booking_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  is_cancellation boolean;
  is_reschedule boolean;
begin
  is_cancellation := (OLD.status = 'confirmed' and NEW.status = 'cancelled');
  is_reschedule := (OLD.status = 'confirmed' and NEW.status = 'confirmed' and OLD.start_at is distinct from NEW.start_at);

  if not (is_cancellation or is_reschedule) then
    return NEW;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'send_push_service_role_key'
  limit 1;

  if service_key is null then
    raise warning 'notify_booking_status_change: send_push_service_role_key not found in Vault; push notification not sent for booking id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/Send-Push',
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

drop trigger if exists on_booking_status_change on public.th_bookings;
create trigger on_booking_status_change
  after update on public.th_bookings
  for each row
  execute function public.notify_booking_status_change();

-- REAL BUG, FOUND VIA DIRECT DEBUGGING (a temporary table logging each
-- step of the trigger function, since this project's log querying
-- didn't reliably surface RAISE WARNING output): the reschedule
-- notification wasn't a database-side problem at all. The trigger
-- fired correctly and successfully called net.http_post every time --
-- confirmed directly. The actual bug was in Send-Push's own UPDATE/
-- th_bookings handler (edge-functions/send-push-index.ts), which only
-- ever checked for the confirmed->cancelled transition and silently
-- skipped every other UPDATE, including a genuine reschedule. Fixed
-- there, not here -- see that file's own updated comment.
