-- create_booking(): a manage link for EVERY booker (2026-09-22,
-- booking-flow pass, round 3).
--
-- booking.html used to POST straight into th_bookings. That works, but
-- anon has no SELECT on th_bookings (real PII), so the insert can't hand
-- anything back -- and the only way a guest ever learned their booking's
-- cancel_token was the confirmation EMAIL. Email is optional, so a
-- phone-only booker had no way at all to reschedule or cancel online, and
-- nobody could get to their booking from the confirmation screen itself.
--
-- This function does the same insert (same row, same BEFORE/AFTER
-- triggers -- padded_range, the new-booking push and email -- and the same
-- no_overlapping_confirmed_bookings exclusion constraint, whose 23P01 the
-- page already turns into "that time was just taken") and returns the
-- booking's id and its cancel_token. The token is still generated
-- server-side by the column default and is still never client-settable
-- (see add_booking_cancellation.sql's reasoning); returning it to the
-- person who just created the booking grants nothing their confirmation
-- email doesn't already carry.
--
-- It is also STRICTER than the direct insert, on purpose:
--   - status is always 'confirmed' (the column default) -- a caller can't
--     insert a pre-cancelled row;
--   - quote_id / checkup_id / job_id / reminder_sent_at / cancel_token /
--     reschedule counters can't be set at all (only the allowlisted
--     columns below are read from the payload);
--   - start/end must parse, end must be after start, the visit can't be
--     longer than 8 hours, and it can't start in the past (5-minute grace
--     for clock skew) -- errcode 22023 with a short message;
--   - a blank or whitespace-only name is rejected (the page already
--     trims and checks; this closes the same gap for a direct caller);
--   - every text field is trimmed/capped at the same lengths the page's
--     own maxlength attributes already enforce.
--
-- The direct-insert policy ("Anyone can submit a booking") is left as it
-- is: booking.html falls back to it if this function is ever missing
-- (a 404 -- which can never mean a booking was created, so the fallback
-- can't double-book), and the Dev Tools booking test and the portal's
-- schedule-quote-job/schedule-checkup-visit (service role) still use it.
--
-- SECURITY DEFINER because anon has no SELECT on th_bookings and the
-- RETURNING needs to read the new row's token. The advisor will list it
-- under lint 0028/0029 (anon can execute a SECURITY DEFINER function) --
-- expected, same class as get_booking_by_cancel_token() and the other
-- booking token functions.

create or replace function public.create_booking(p_booking jsonb)
returns table (booking_id bigint, manage_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_name text := nullif(trim(coalesce(p_booking->>'name', '')), '');
  v_id bigint;
  v_token uuid;
begin
  begin
    v_start := (p_booking->>'start_at')::timestamptz;
    v_end := (p_booking->>'end_at')::timestamptz;
  exception when others then
    raise exception 'invalid-time' using errcode = '22023';
  end;
  if v_start is null or v_end is null or v_end <= v_start or v_end - v_start > interval '8 hours' then
    raise exception 'invalid-time' using errcode = '22023';
  end if;
  if v_start < now() - interval '5 minutes' then
    raise exception 'in-the-past' using errcode = '22023';
  end if;
  if v_name is null then
    raise exception 'name-required' using errcode = '22023';
  end if;

  insert into public.th_bookings (
    service_key, service_label, start_at, end_at, name, phone, email, address, notes,
    referred_by, referred_by_code, source, utm_source, utm_medium, utm_campaign, utm_term, utm_content
  ) values (
    left(p_booking->>'service_key', 50),
    left(p_booking->>'service_label', 100),
    v_start,
    v_end,
    left(v_name, 100),
    left(nullif(trim(coalesce(p_booking->>'phone', '')), ''), 30),
    left(nullif(trim(coalesce(p_booking->>'email', '')), ''), 200),
    left(nullif(trim(coalesce(p_booking->>'address', '')), ''), 200),
    left(nullif(p_booking->>'notes', ''), 1000),
    left(nullif(trim(coalesce(p_booking->>'referred_by', '')), ''), 200),
    left(nullif(trim(coalesce(p_booking->>'referred_by_code', '')), ''), 50),
    left(nullif(p_booking->>'source', ''), 100),
    left(nullif(p_booking->>'utm_source', ''), 200),
    left(nullif(p_booking->>'utm_medium', ''), 200),
    left(nullif(p_booking->>'utm_campaign', ''), 200),
    left(nullif(p_booking->>'utm_term', ''), 200),
    left(nullif(p_booking->>'utm_content', ''), 200)
  )
  returning id, cancel_token into v_id, v_token;

  return query select v_id, v_token;
end;
$$;

grant execute on function public.create_booking(jsonb) to anon, authenticated;
