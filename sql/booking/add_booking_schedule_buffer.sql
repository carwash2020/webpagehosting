-- Adds a real scheduling buffer between bookings, requested directly:
-- "block off enough time for me to meet with them and complete a job
-- prior [to] someone else being able to schedule." The original
-- exclusion constraint only prevented exact time overlap -- a booking
-- could end at 4:00pm and another begin at 4:00pm with zero gap for
-- wrap-up or travel between job sites.
--
-- 15-minute padding on EACH side of every confirmed booking produces
-- exactly a 30-minute real-world gap between any two adjacent
-- bookings, not 60 -- verified by direct simulation before writing
-- this (a booking starting exactly 30 min after another ends is
-- allowed; one starting only 15 min after is correctly rejected).
-- Run 2026-08-25.

alter table public.th_bookings drop constraint no_overlapping_confirmed_bookings;

alter table public.th_bookings add column padded_range tstzrange;

-- Computed server-side via trigger, not a generated column -- Postgres
-- requires generated-column expressions to be IMMUTABLE, and
-- timestamptz +/- interval is marked STABLE in its catalog (even for
-- a fixed-duration interval like minutes), so a generated column
-- expression using it is rejected outright. A trigger has no such
-- restriction, and -- just as importantly -- keeps this fully
-- server-side and trusted: if this were a plain, client-writable
-- column, a client could submit a mismatched padded_range and bypass
-- the buffer protection entirely.
create or replace function public.set_th_bookings_padded_range()
returns trigger
language plpgsql
as $$
begin
  NEW.padded_range := tstzrange(NEW.start_at - interval '15 minutes', NEW.end_at + interval '15 minutes');
  return NEW;
end;
$$;

drop trigger if exists set_padded_range on public.th_bookings;
create trigger set_padded_range
  before insert or update on public.th_bookings
  for each row
  execute function public.set_th_bookings_padded_range();

alter table public.th_bookings
  add constraint no_overlapping_confirmed_bookings
  exclude using gist (padded_range with &&)
  where (status = 'confirmed');
