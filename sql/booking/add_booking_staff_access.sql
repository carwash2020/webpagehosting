-- Staff access to th_bookings, requested directly as part of the Job
-- Tracker/Dev Tools integration. Matches th_leads' own, already-proven
-- policy pattern exactly. Anon still has no SELECT policy at all --
-- unchanged from the original schema, for the same reason (real
-- customer PII) -- this only opens read/update access to a genuinely
-- authenticated staff session.
-- Run 2026-08-25.

create policy "Only logged-in can view or manage bookings"
  on public.th_bookings for select
  to public
  using ((select auth.role()) = 'authenticated');

create policy "Only logged-in can update bookings"
  on public.th_bookings for update
  to public
  using ((select auth.role()) = 'authenticated');

select policyname, roles, cmd from pg_policies where tablename = 'th_bookings';
