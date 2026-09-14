-- Job cancel/reschedule links for manually-scheduled jobs (direct
-- follow-up, 2026-09-11): "do the reschedule/cancel link" -- self-
-- service bookings (th_bookings) already have this via cancel_token +
-- manage-booking.html; manually-scheduled jobs (public.jobs, added by
-- staff for a phone-in customer) had no equivalent at all.
--
-- Reschedule is REQUEST-ONLY here, not instant like booking's own
-- reschedule (direct decision, 2026-09-11, asked and confirmed
-- explicitly): th_bookings' reschedule is checked against a real
-- time-slot exclusion constraint (only one booking can hold a given
-- time range), so it's safe to move instantly -- see
-- reschedule_booking_by_token in add_booking_reschedule.sql.
-- jobs.job_date is a plain date with no time-of-day and no such
-- constraint -- staff schedule these by hand, so an unattended
-- instant move could silently double-book a day already committed to
-- another job. Instead the customer submits a new date here, and
-- notify_job_status_change (below) emails staff so a human reviews
-- and applies it in Job Tracker.

alter table public.jobs add column if not exists cancel_token uuid not null default gen_random_uuid();
create unique index if not exists jobs_cancel_token_idx on public.jobs (cancel_token);
alter table public.jobs add column if not exists cancelled_at timestamptz;
alter table public.jobs add column if not exists reschedule_requested_date text;
alter table public.jobs add column if not exists reschedule_requested_at timestamptz;

-- Read-only lookup for manage-job.html. SECURITY DEFINER since anon
-- has no SELECT policy on jobs at all; returns only what's needed to
-- render the page (never phone/client_email/notes/client_id), and
-- returns nothing at all for an unknown token rather than
-- distinguishing "wrong token" from "no such job" -- same reasoning as
-- get_booking_by_cancel_token.
create or replace function public.get_job_by_cancel_token(p_token uuid)
returns table (title text, job_date text, address text, cancelled_at timestamptz, reschedule_requested_date text)
language sql
security definer
set search_path = public
stable
as $$
  select j.title, j.job_date, j.address, j.cancelled_at, j.reschedule_requested_date
  from public.jobs j
  where j.cancel_token = p_token;
$$;

grant execute on function public.get_job_by_cancel_token(uuid) to anon, authenticated;

-- Mirrors cancel_booking_by_token: no-ops (rather than erroring) for
-- an unknown token or one already cancelled, so the page can show a
-- clear state without the RPC call itself failing.
create or replace function public.cancel_job_by_token(p_token uuid)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled_at timestamptz;
  v_found boolean;
begin
  select exists(select 1 from public.jobs where cancel_token = p_token) into v_found;
  if not v_found then
    return query select false, 'not-found'::text;
    return;
  end if;

  select cancelled_at into v_cancelled_at from public.jobs where cancel_token = p_token;
  if v_cancelled_at is not null then
    return query select false, 'already-cancelled'::text;
    return;
  end if;

  update public.jobs set cancelled_at = now() where cancel_token = p_token;
  return query select true, 'cancelled'::text;
end;
$$;

grant execute on function public.cancel_job_by_token(uuid) to anon, authenticated;

-- Request-only reschedule: never touches job_date itself, just
-- records what the customer asked for so staff can review and update
-- the job by hand (see the file header comment for why this isn't
-- instant like a booking reschedule).
create or replace function public.request_job_reschedule_by_token(p_token uuid, p_new_date text)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled_at timestamptz;
  v_found boolean;
begin
  select exists(select 1 from public.jobs where cancel_token = p_token) into v_found;
  if not v_found then
    return query select false, 'not-found'::text;
    return;
  end if;

  select cancelled_at into v_cancelled_at from public.jobs where cancel_token = p_token;
  if v_cancelled_at is not null then
    return query select false, 'already-cancelled'::text;
    return;
  end if;

  update public.jobs
  set reschedule_requested_date = p_new_date, reschedule_requested_at = now()
  where cancel_token = p_token;
  return query select true, 'requested'::text;
end;
$$;

grant execute on function public.request_job_reschedule_by_token(uuid, text) to anon, authenticated;

-- Staff notification: fires only on the two customer-initiated
-- transitions (cancelled_at or reschedule_requested_at newly set),
-- never on an ordinary job edit staff make themselves -- same
-- targeted-transition shape as th_bookings' own
-- notify_booking_status_change. Reuses the same vaulted service-role
-- secret that trigger already relies on to call its own edge function.
create or replace function public.notify_job_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  is_cancellation boolean;
  is_reschedule_request boolean;
begin
  is_cancellation := (OLD.cancelled_at is null and NEW.cancelled_at is not null);
  is_reschedule_request := (OLD.reschedule_requested_at is null and NEW.reschedule_requested_at is not null);

  if not (is_cancellation or is_reschedule_request) then
    return NEW;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'send_push_service_role_key'
  limit 1;

  if service_key is null then
    raise warning 'notify_job_status_change: send_push_service_role_key not found in Vault; notification not sent for job id %', NEW.id;
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://csvfqdjuobylgafgolho.supabase.co/functions/v1/send-job-status-change-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'jobs',
      'record', row_to_json(NEW),
      'old_record', row_to_json(OLD)
    ),
    timeout_milliseconds := 15000
  );
  return NEW;
end;
$$;

drop trigger if exists on_job_status_change on public.jobs;
create trigger on_job_status_change
  after update on public.jobs
  for each row
  execute function public.notify_job_status_change();
