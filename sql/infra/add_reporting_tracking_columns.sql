-- Real tracking columns needed to build meaningful weekly reports,
-- requested directly. Without a timestamp of WHEN a cancellation,
-- reschedule, or "marked handled" actually happened, "this week" has
-- nothing to measure against -- created_at alone only tells you when
-- the booking/lead was first created, not when its status changed.
-- Run 2026-08-25.

alter table public.th_bookings add column cancelled_at timestamptz;
alter table public.th_bookings add column reschedule_count integer not null default 0;
alter table public.th_bookings add column last_rescheduled_at timestamptz;

alter table public.th_leads add column handled_at timestamptz;

-- Trigger-based rather than modifying cancel_booking_by_token/
-- reschedule_booking_by_token individually -- catches the state
-- change regardless of which code path causes it, same principle as
-- notify_booking_status_change already uses.
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
  end if;

  return NEW;
end;
$$;

drop trigger if exists track_booking_changes_trigger on public.th_bookings;
create trigger track_booking_changes_trigger
  before update on public.th_bookings
  for each row
  execute function public.track_booking_changes();

-- Same idea for th_leads -- handled_at set the moment `handled`
-- actually transitions to true, regardless of which UI action does it.
create or replace function public.track_lead_handled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (OLD.handled is distinct from true) and NEW.handled = true then
    NEW.handled_at := now();
  end if;
  return NEW;
end;
$$;

drop trigger if exists track_lead_handled_trigger on public.th_leads;
create trigger track_lead_handled_trigger
  before update on public.th_leads
  for each row
  execute function public.track_lead_handled();
