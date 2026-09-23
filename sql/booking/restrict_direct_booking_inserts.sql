-- Booking-flow pass (2026-09-23): close the direct-insert side door.
--
-- create_booking_system.sql let anyone INSERT straight into th_bookings
-- ("Anyone can submit a booking", anon + authenticated, WITH CHECK
-- (true)). That was the only way the public booking page could book
-- until create_booking() (add_create_booking_rpc.sql, round 3) replaced
-- it. With the public anon key a direct insert can still set any column:
-- a row that is already 'cancelled', a job_id / quote_id / checkup_id
-- pointing at someone else's record, reminder_sent_at (so no reminder
-- ever goes out), and it skips every check create_booking() makes (times
-- in order and not in the past, at most 8 hours, a name, capped lengths).
-- Any signed-in client account could do the same. Checked on the live
-- project before this ran, in a rolled-back block: anon inserted a row
-- with status 'cancelled', and a non-staff signed-in account inserted
-- one too.
--
-- Every legitimate writer already goes another way:
--   - booking.html -> create_booking() (SECURITY DEFINER, so it doesn't
--     need this policy). Its direct insert only runs if that function
--     answers 404 -- i.e. is missing -- and nothing creates a booking on
--     a 404, so it can't double-book (see "Rolling back" below).
--   - schedule-quote-job / schedule-checkup-visit (portal) insert with
--     the service role, which bypasses RLS.
--   - tools/dev-tools.html's booking test inserts as a signed-in staff
--     account -- kept working by the policy below.
-- Nothing else in the repo inserts into th_bookings.
--
-- So: drop the open policy; staff (an account_roles email, the same test
-- th_bookings' own SELECT/UPDATE/DELETE policies use) may still insert
-- directly. Everyone else books through create_booking().
--
-- Rolling back: if create_booking() is ever dropped, restore the original
-- policy in the same change (the create statement is at the bottom of
-- this file, commented out) -- booking.html then falls back to the direct
-- insert exactly as it did before round 3.

drop policy if exists "Anyone can submit a booking" on public.th_bookings;

drop policy if exists "Staff can add bookings directly" on public.th_bookings;
create policy "Staff can add bookings directly"
  on public.th_bookings for insert
  to authenticated
  with check (
    (select auth.role()) = 'authenticated'
    and exists (
      select 1 from public.account_roles
      where account_roles.email = (select auth.email())
    )
  );

-- Rollback (only together with dropping create_booking()):
-- create policy "Anyone can submit a booking"
--   on public.th_bookings for insert
--   to anon, authenticated
--   with check (true);
