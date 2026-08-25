-- In-house booking system, requested directly, replacing Cal.com.
-- Run 2026-08-25.

create table public.th_bookings (
  id bigint generated always as identity primary key,
  service_key text not null,
  service_label text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  job_id bigint
);

create index th_bookings_start_at_idx on public.th_bookings (start_at);

-- The actual guarantee against double-booking. A single-technician
-- business is one resource -- two confirmed bookings can never have
-- overlapping time ranges, full stop, enforced by Postgres itself
-- rather than trusted to application code. Range types have built-in
-- GiST operator support in core Postgres, no extension needed here.
-- Scoped to status = 'confirmed' via a partial constraint, so a
-- cancelled booking's old time range never blocks a new one from
-- reusing that slot.
alter table public.th_bookings
  add constraint no_overlapping_confirmed_bookings
  exclude using gist (tstzrange(start_at, end_at) with &&)
  where (status = 'confirmed');

alter table public.th_bookings enable row level security;

-- Anyone can submit a booking -- same reasoning as th_leads' own
-- policy (see fix_th_leads_insert_policy.sql): this table's whole
-- purpose is capturing a booking from any site visitor, logged in or
-- not, so a restrictive WITH CHECK here has no legitimate purpose.
create policy "Anyone can submit a booking"
  on public.th_bookings for insert
  to anon, authenticated
  with check (true);

-- Deliberately NO anon/authenticated SELECT policy on the base table
-- at all -- it holds real customer PII (name, phone, email, address,
-- notes). Staff management reads happen through the service_role key
-- (bypasses RLS), same pattern as every other staff-only table this
-- session. The public availability check reads through the view
-- below instead, which exposes only what's needed to compute open
-- slots and nothing else.
create view public.th_bookings_availability as
  select start_at, end_at
  from public.th_bookings
  where status = 'confirmed';

-- Deliberately NOT security_invoker -- a view defaults to running as
-- its owner, which is exactly what's needed here: anon has no SELECT
-- policy on the base table at all, so security_invoker would make
-- this view enforce that same lack of access and return zero rows for
-- everyone, the opposite of the intent. Running as owner lets the view
-- itself bypass the base table's RLS for just these two columns,
-- while the base table's own RLS still fully blocks any direct read
-- of the real, PII-bearing columns.

grant select on public.th_bookings_availability to anon, authenticated;
