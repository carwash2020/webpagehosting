-- Adds the missing DELETE policy for staff on th_bookings, found via
-- direct testing while building the Dev Tools "Booking notification
-- test" panel: SELECT and UPDATE policies existed for authenticated
-- staff, but no DELETE policy at all -- confirmed directly (not
-- assumed) by simulating a real authenticated session (see the note
-- below on how) and watching a DELETE silently affect zero rows due
-- to RLS, leaving the test's own cleanup step unable to actually
-- clean up. Matches th_leads' own, already-existing DELETE policy.
--
-- Note on testing RLS as authenticated in the SQL editor: `set role
-- authenticated` alone is NOT sufficient -- auth.role() specifically
-- reads from the request.jwt.claim.role setting (or the jwt.claims
-- JSON blob), which a plain role switch never populates. A genuine
-- test needs `set request.jwt.claim.role = 'authenticated';` too, or
-- every authenticated-gated policy will silently behave as if
-- unauthenticated (returning zero rows on SELECT, silently affecting
-- zero rows on UPDATE/DELETE) even though the Postgres role itself is
-- correct.
-- Run 2026-08-25.

create policy "Only logged-in can delete bookings"
  on public.th_bookings for delete
  to public
  using ((select auth.role()) = 'authenticated');

select policyname, roles, cmd from pg_policies where tablename = 'th_bookings';
