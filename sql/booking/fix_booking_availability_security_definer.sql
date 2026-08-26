-- Fixes a real Supabase Advisor CRITICAL finding: th_bookings_availability
-- was a bare view with no security_invoker set, which defaults to
-- running with the view owner's privileges rather than the querying
-- role's own -- exactly the pattern the Advisor's "Security Definer
-- View" lint exists to catch. The view itself was already scoped
-- narrowly (only start_at/end_at, no PII at all -- confirmed directly
-- via pg_get_viewdef before making this change), so the actual data
-- exposure was never the problem. The mechanism was: a bare view is a
-- less explicit, less auditable way to grant this bypass than the
-- SECURITY DEFINER function pattern already used correctly elsewhere
-- in this system (get_booking_by_cancel_token, cancel_booking_by_token,
-- reschedule_booking_by_token) for the same underlying need -- letting
-- anon read something narrow despite th_bookings having no anon SELECT
-- policy at all (real customer PII).
-- Run 2026-08-25.

drop view if exists public.th_bookings_availability;

create or replace function public.get_booking_availability(p_range_start timestamptz, p_range_end timestamptz)
returns table (start_at timestamptz, end_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select b.start_at, b.end_at
  from public.th_bookings b
  where b.status = 'confirmed'
    and b.start_at >= p_range_start
    and b.start_at < p_range_end;
$$;

grant execute on function public.get_booking_availability(timestamptz, timestamptz) to anon, authenticated;
