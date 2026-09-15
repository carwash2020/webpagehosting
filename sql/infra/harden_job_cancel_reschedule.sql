-- Hardens the job cancel/reschedule RPCs (add_job_cancel_reschedule.sql,
-- 2026-09-11) against two real gaps found in a later audit pass:
--
-- 1. Neither cancel_job_by_token() nor request_job_reschedule_by_token()
--    ever checked jobs.status. A customer who kept an old manage-job.html
--    link from a job already marked 'done' (completed, likely invoiced)
--    could still open it and successfully cancel or request a reschedule
--    on a job that's already finished -- manage-booking.html's own
--    equivalent RPCs correctly reject an already-past/cancelled booking,
--    but this sibling flow, added later, never got the same guard.
-- 2. request_job_reschedule_by_token() never validated p_new_date at
--    all -- no past-date check (unlike reschedule_booking_by_token's own
--    `if p_new_start < now()` guard in add_booking_reschedule.sql), and
--    no format check, so a malformed date string would surface as a raw
--    Postgres cast error instead of a clean 'invalid-date' response.
--    manage-job.html's own client-side `input.min` guard is the only
--    thing stopping a normal user from picking a past date, and that
--    guard itself was computed in UTC rather than the business's own
--    America/Denver time (fixed separately in manage-job.html) -- either
--    way, a client-side-only guard is trivially bypassed (devtools, or
--    calling the RPC directly), so the real check belongs here too.

create or replace function public.cancel_job_by_token(p_token uuid)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled_at timestamptz;
  v_status text;
  v_found boolean;
begin
  select exists(select 1 from public.jobs where cancel_token = p_token) into v_found;
  if not v_found then
    return query select false, 'not-found'::text;
    return;
  end if;

  select cancelled_at, status into v_cancelled_at, v_status from public.jobs where cancel_token = p_token;
  if v_cancelled_at is not null then
    return query select false, 'already-cancelled'::text;
    return;
  end if;
  if v_status = 'done' then
    return query select false, 'already-completed'::text;
    return;
  end if;

  update public.jobs set cancelled_at = now() where cancel_token = p_token;
  return query select true, 'cancelled'::text;
end;
$$;

create or replace function public.request_job_reschedule_by_token(p_token uuid, p_new_date text)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled_at timestamptz;
  v_status text;
  v_found boolean;
  v_new_date date;
begin
  select exists(select 1 from public.jobs where cancel_token = p_token) into v_found;
  if not v_found then
    return query select false, 'not-found'::text;
    return;
  end if;

  select cancelled_at, status into v_cancelled_at, v_status from public.jobs where cancel_token = p_token;
  if v_cancelled_at is not null then
    return query select false, 'already-cancelled'::text;
    return;
  end if;
  if v_status = 'done' then
    return query select false, 'already-completed'::text;
    return;
  end if;

  begin
    v_new_date := p_new_date::date;
  exception when others then
    return query select false, 'invalid-date'::text;
    return;
  end;

  -- Compared in the business's own timezone (America/Denver), matching
  -- reschedule_booking_by_token's own past-date guard in intent -- a
  -- plain `current_date` here would be UTC, which can disagree with
  -- what day it actually is for the business by several hours.
  if v_new_date < (now() at time zone 'America/Denver')::date then
    return query select false, 'in-the-past'::text;
    return;
  end if;

  update public.jobs
  set reschedule_requested_date = p_new_date, reschedule_requested_at = now()
  where cancel_token = p_token;
  return query select true, 'requested'::text;
end;
$$;
