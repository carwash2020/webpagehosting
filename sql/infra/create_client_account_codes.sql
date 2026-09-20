-- Client account codes (direct request, 2026-09-20): "unique IDs
-- connected to accounts" to fix the referral promo's biggest weak
-- point -- referral attribution today is a free-text "Who referred
-- you?" field, matched by staff after the fact against a typed name
-- that can be misspelled or ambiguous (two "John"s, etc).
--
-- Keyed by email, not the Client Registry's local client_id: a
-- portal account is ALSO identified by email (Supabase Auth), so a
-- code generated before someone ever has a portal login still
-- connects automatically the moment they get one -- auth.email() on
-- their first login is the exact same string this table already
-- keyed the code to. See send-invite/index.ts for where a code is
-- generated automatically, the moment a portal account is actually
-- created (never on a resend of an existing invite).
--
-- One code per email doubles as a general per-account tracking ID
-- (requested directly, "help for tracking"), not just a referral
-- code -- same value, two uses. A short, easy-to-read/type/text code
-- (see generateAccountCode() in send-invite and client-detail.html),
-- not a UUID.

create table if not exists public.client_account_codes (
  id bigint generated always as identity primary key,
  email text not null unique,
  code text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.client_account_codes enable row level security;

-- Same "any account_roles row grants full access" pattern already
-- used on referrals/jobs/invoices -- staff can generate/view/manage
-- any client's code from client-detail.html or the Referral Credits
-- panel.
create policy "internal accounts can manage client account codes"
  on public.client_account_codes
  for all
  to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

-- A logged-in portal client can read (never write -- codes are only
-- ever created by send-invite or staff) their OWN row, so the portal
-- can show "Your referral link" without staff having to hand it to
-- them. auth.email() is wrapped in (select ...) deliberately -- the
-- same per-row-re-evaluation perf fix already applied to every other
-- client-scoped portal policy in this project.
create policy "portal clients can view their own account code"
  on public.client_account_codes
  for select
  to authenticated
  using (email = (select auth.email()));

-- Deliberately NO anon/public policy. A booking-page visitor resolving
-- a ?ref=CODE param never reads this table directly (that would expose
-- every code + email to anyone) -- resolution goes through the
-- resolve-referral-code edge function instead, using the service role,
-- which returns only the referrer's display name.

-- Matches the free-text referred_by columns already added by
-- create_referral_program.sql: when a booking/lead is captured via a
-- resolved ?ref=CODE link, the raw code is stored alongside the
-- resolved name, so staff can always trace a credit back to the exact
-- code used (unambiguous) rather than relying on name-matching alone.
alter table public.th_leads add column if not exists referred_by_code text;
alter table public.th_bookings add column if not exists referred_by_code text;
