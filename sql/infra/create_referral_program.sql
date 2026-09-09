-- Referral incentive program (direct request, 2026-09-09).
-- Terms confirmed directly: $25 credit for the referring customer,
-- earned once the referred customer's job is complete AND paid.
--
-- Capture happens in three places, since a referral doesn't only ever
-- come in through the public forms (a phone call or walk-in never
-- touches either form): both public forms (Book Instantly, the
-- homepage Request form) get an optional "Who referred you?" field,
-- AND the internal Job Tracker's own Add Job form gets the exact same
-- field -- so a referral mentioned on a phone call still gets
-- captured, by whoever actually takes that call. See
-- tools/job-tracker.html's first-time-customer nudge for how this
-- schema gets used automatically without relying on memory alone.

alter table public.th_leads add column if not exists referred_by text;
alter table public.th_bookings add column if not exists referred_by text;
alter table public.jobs add column if not exists referred_by text;

create table if not exists public.referrals (
  id bigint generated always as identity primary key,
  referrer_name text not null,
  referrer_phone text,
  referred_name text not null,
  referred_phone text,
  referred_job_id bigint references public.jobs(id) on delete set null,
  reward_amount numeric not null default 25,
  status text not null default 'pending' check (status in ('pending', 'earned', 'redeemed')),
  notes text,
  created_at timestamptz not null default now(),
  earned_at timestamptz,
  redeemed_at timestamptz
);

alter table public.referrals enable row level security;

-- Same "any account_roles row grants full access" pattern already used
-- on jobs/invoices/quotes/contracts -- this table is internal-only,
-- never written to directly by a public form (the two "referred_by"
-- text columns above are raw capture; a referrals row itself is only
-- ever created from inside the Job Tracker, by an authenticated
-- internal account).
create policy "internal accounts can manage referrals"
  on public.referrals
  for all
  to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));
