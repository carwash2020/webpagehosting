-- Applied live 2026-09-15. Recorded here after the fact so the schema is
-- reproducible from this repo rather than living only in the live database.
--
-- referrals.referred_job_id had no uniqueness guard: if a job's referral
-- got recorded twice (double form submit, a Job Tracker double-click,
-- retry after a network hiccup) the auto-earn-on-invoice-paid flow could
-- credit the same referrer twice for the same job. A job can only be
-- referred once, so enforce that at the DB level. Partial (only when
-- not null) since most jobs have no referral at all.
create unique index if not exists referrals_referred_job_id_unique
  on public.referrals (referred_job_id)
  where referred_job_id is not null;

-- client_portal_invoices' SELECT policy had no explicit "to authenticated",
-- so it applied to the PUBLIC role (anon included). auth.email() is null
-- for an anon session so the row-level check never matched in practice,
-- but scoping the policy to authenticated only removes the anon role from
-- consideration entirely rather than relying on that null-comparison
-- behavior, matching the explicit "to authenticated" already used on
-- referrals and every other internal-access policy in this project.
drop policy if exists "clients can only view their own invoices" on public.client_portal_invoices;
create policy "clients can only view their own invoices"
  on public.client_portal_invoices for select
  to authenticated
  using ((select auth.email()) = client_email);
