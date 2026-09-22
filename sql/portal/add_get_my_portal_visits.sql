-- A client's own appointments, readable from the portal (2026-09-22).
--
-- Found during a portal audit: every self-scheduling path the portal
-- offers -- scheduling an approved quote (schedule-quote-job), a
-- check-up visit (schedule-checkup-visit), and the public booking.html
-- flow -- writes a real row into th_bookings. But th_bookings' SELECT
-- policy is internal-accounts-only (it has to be: it carries lead
-- source/UTM/referral columns and every other client's appointments),
-- so the moment a client picked a time, the portal lost track of it:
--
--   * client_portal_quotes.scheduled_at records WHEN the scheduling
--     happened (schedule-quote-job writes new Date()), not the
--     appointment time, so the quote card could only say "Job
--     scheduled. We'll see you then!" with no date at all.
--   * portal/home.html's "Next appointment" hero read only
--     client_portal_work_orders, so a quote- or check-up-scheduled
--     visit never appeared there.
--   * portal/jobs.html's check-up banner went straight back to
--     "Schedule this visit" on the next page load, inviting a second
--     booking for the same reminder.
--   * The reschedule/cancel link (manage-booking.html?token=) only
--     ever existed inside the confirmation email.
--
-- A SECURITY DEFINER function returning a fixed, client-safe column
-- list, rather than a new client SELECT policy on th_bookings: RLS is
-- row-level, not column-level, so a policy would hand a client every
-- column on their own rows (notes, utm_*, referred_by, source). Same
-- shape as the existing get_booking_by_cancel_token().
--
-- Scoped by the caller's own verified session email, case-insensitive
-- (th_bookings.email is typed by hand on booking.html; portal emails
-- come from Supabase Auth). manage_token is th_bookings.cancel_token,
-- the same token send-booking-email and send-appointment-reminder
-- already email to this exact address -- the portal showing it to the
-- signed-in owner of that address grants nothing the inbox didn't. It
-- is only returned while the booking is still confirmed.
--
-- Window: anything ending in the last 120 days or later. The Home hero
-- only uses confirmed future visits; the quote card also needs a
-- recently-past or cancelled booking to say "your visit on X" or "that
-- visit was cancelled -- pick a new time" instead of a bare "scheduled".

create or replace function public.get_my_portal_visits()
returns table (
  id bigint,
  service_label text,
  start_at timestamptz,
  end_at timestamptz,
  address text,
  status text,
  visit_kind text,
  quote_id bigint,
  checkup_id bigint,
  manage_token uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id,
    b.service_label,
    b.start_at,
    b.end_at,
    b.address,
    b.status,
    case
      when b.quote_id is not null then 'quote'
      when b.checkup_id is not null then 'checkup'
      else 'booking'
    end as visit_kind,
    b.quote_id,
    b.checkup_id,
    case when b.status = 'confirmed' then b.cancel_token else null end as manage_token
  from public.th_bookings b
  where (select auth.email()) is not null
    and b.email is not null
    and lower(b.email) = lower((select auth.email()))
    and b.end_at >= now() - interval '120 days'
  order by b.start_at asc
  limit 50;
$$;

-- Signed-in callers only. anon has no email to match on anyway (the
-- where clause above already returns nothing for it), but there's no
-- reason to leave it callable.
--
-- Expected advisor finding: Supabase's "Signed-In Users Can Execute
-- SECURITY DEFINER Function" (lint 0029) lists this function, and that
-- is intentional -- the same class as get_booking_by_cancel_token().
-- SECURITY INVOKER isn't an option without giving clients a SELECT
-- policy on th_bookings, which is exactly the column exposure this
-- function exists to avoid. Confirmed NOT in the anon lint (0028).
revoke all on function public.get_my_portal_visits() from public;
revoke all on function public.get_my_portal_visits() from anon;
grant execute on function public.get_my_portal_visits() to authenticated;
