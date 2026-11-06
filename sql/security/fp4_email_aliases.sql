-- Fix plan FP4.2 (2026-11-06; D11; approved design EmailAliases): verified
-- email aliases. A portal account can add other email addresses it has
-- used with Triple H. Each one is proved with a 6-digit code sent to it
-- (edge-functions/portal-email-alias-index.ts), and from then on records
-- Triple H sent to that address show up in the portal too.
--
-- Rules (D11):
--   * proof of ownership only: an alias counts once the code sent to it is
--     right (or, when staff start it, once the client opens the link sent to
--     it while signed in). Never matched on name or phone.
--   * one owner: a confirmed alias belongs to exactly one portal account
--     (unique index below).
--   * an email that has its own portal account is never folded in here; that
--     is a staff-assisted merge (same edge function, staff only).
--
-- This file:
--   1. client_email_aliases: no client access at all (RLS on, no policies,
--      grants revoked); only the edge function (service role) reads/writes it.
--   2. client_portal_my_emails(): the caller's sign-in email plus their
--      confirmed aliases, lower-cased. SECURITY DEFINER so it can read the
--      table above; it only ever answers about the caller (auth.uid()).
--   3. The client-side RLS policies that matched `auth.email() = client_email`
--      now match "any of my emails". Each policy keeps its name, command and
--      every other condition; the "Confirmed email only" restrictive
--      policies are untouched. Rows that belong to the person themselves
--      (profile, notification preferences, thread reads, signup codes) stay
--      keyed to the sign-in email, as do the sender of a message and the
--      asker of a quote question.
--   4. get_portal_unread_counts(): threads on any of my emails; read marks
--      are the reader's own (they were joined on the record's email, which
--      would miss reads on an alias's threads).
--
-- Matching is case-insensitive (lower(client_email)), as email addresses are.
-- Re-runnable.

begin;

-- 1. The aliases ---------------------------------------------------------------
create table if not exists public.client_email_aliases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 254),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  -- pending only: an HMAC of the code (client-started) or of the link token
  -- (staff-started); never the code itself.
  code_hash text,
  expires_at timestamptz,
  attempts integer not null default 0,
  sends integer not null default 1,
  window_started_at timestamptz not null default now(),
  added_by text not null default 'client' check (added_by in ('client', 'staff', 'merge')),
  added_by_email text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (user_id, email)
);
create unique index if not exists client_email_aliases_one_owner
  on public.client_email_aliases (email) where status = 'confirmed';
create index if not exists client_email_aliases_user on public.client_email_aliases (user_id);
alter table public.client_email_aliases enable row level security;
revoke all on public.client_email_aliases from public, anon, authenticated;

-- 2. "Any of my emails" --------------------------------------------------------
create or replace function public.client_portal_my_emails()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array(
    select lower(auth.email()) where auth.email() is not null
    union
    select a.email from public.client_email_aliases a
    where a.user_id = auth.uid() and a.status = 'confirmed'
  ), '{}'::text[]);
$$;
revoke execute on function public.client_portal_my_emails() from public, anon;
grant execute on function public.client_portal_my_emails() to authenticated;

-- 3. Client policies -----------------------------------------------------------
drop policy if exists "clients or internal accounts can view card authorizations" on public.card_authorizations;
create policy "clients or internal accounts can view card authorizations" on public.card_authorizations
  for select to authenticated
  using ((lower(client_email) = any ((select public.client_portal_my_emails())::text[]))
         or (public.current_user_has_any_role() and tenant_id = public.current_tenant_id()));

drop policy if exists "clients can only view their own checkup reminders" on public.client_portal_checkups;
create policy "clients can only view their own checkup reminders" on public.client_portal_checkups
  for select to authenticated
  using (lower(client_email) = any ((select public.client_portal_my_emails())::text[]));

drop policy if exists "clients or internal accounts can view contracts" on public.client_portal_contracts;
create policy "clients or internal accounts can view contracts" on public.client_portal_contracts
  for select to authenticated
  using (lower(client_email) = any ((select public.client_portal_my_emails())::text[]));

drop policy if exists "clients or internal accounts can view invoices" on public.client_portal_invoices;
create policy "clients or internal accounts can view invoices" on public.client_portal_invoices
  for select to authenticated
  using (lower(client_email) = any ((select public.client_portal_my_emails())::text[]));

drop policy if exists "clients or internal accounts can view jobs" on public.client_portal_jobs;
create policy "clients or internal accounts can view jobs" on public.client_portal_jobs
  for select to authenticated
  using (lower(client_email) = any ((select public.client_portal_my_emails())::text[]));

drop policy if exists "clients or internal accounts can view quotes" on public.client_portal_quotes;
create policy "clients or internal accounts can view quotes" on public.client_portal_quotes
  for select to authenticated
  using (lower(client_email) = any ((select public.client_portal_my_emails())::text[]));

drop policy if exists "clients or internal accounts view work orders" on public.client_portal_work_orders;
create policy "clients or internal accounts view work orders" on public.client_portal_work_orders
  for select to authenticated
  using (lower(client_email) = any ((select public.client_portal_my_emails())::text[]));

drop policy if exists "clients or internal accounts view job messages" on public.client_portal_job_messages;
create policy "clients or internal accounts view job messages" on public.client_portal_job_messages
  for select to authenticated
  using (exists (select 1 from public.client_portal_jobs j
                 where j.id = client_portal_job_messages.job_id
                   and lower(j.client_email) = any ((select public.client_portal_my_emails())::text[])));

drop policy if exists "clients or internal accounts send job messages" on public.client_portal_job_messages;
create policy "clients or internal accounts send job messages" on public.client_portal_job_messages
  for insert to authenticated
  with check (
    (sender_type = 'client' and sender_email = (select auth.email())
      and exists (select 1 from public.client_portal_jobs j
                  where j.id = client_portal_job_messages.job_id
                    and lower(j.client_email) = any ((select public.client_portal_my_emails())::text[])))
    or (sender_type = 'internal' and sender_email = (select auth.email())
      and public.current_user_has_any_role() and tenant_id = public.current_tenant_id()));

drop policy if exists "clients or internal accounts view work order messages" on public.client_portal_work_order_messages;
create policy "clients or internal accounts view work order messages" on public.client_portal_work_order_messages
  for select to authenticated
  using (exists (select 1 from public.client_portal_work_orders wo
                 where wo.id = client_portal_work_order_messages.work_order_id
                   and lower(wo.client_email) = any ((select public.client_portal_my_emails())::text[])));

drop policy if exists "clients or internal accounts send work order messages" on public.client_portal_work_order_messages;
create policy "clients or internal accounts send work order messages" on public.client_portal_work_order_messages
  for insert to authenticated
  with check (
    (sender_type = 'client' and sender_email = (select auth.email())
      and exists (select 1 from public.client_portal_work_orders wo
                  where wo.id = client_portal_work_order_messages.work_order_id
                    and lower(wo.client_email) = any ((select public.client_portal_my_emails())::text[])))
    or (sender_type = 'internal' and sender_email = (select auth.email())
      and public.current_user_has_any_role() and tenant_id = public.current_tenant_id()));

drop policy if exists "clients mark their own threads read" on public.client_portal_thread_reads;
create policy "clients mark their own threads read" on public.client_portal_thread_reads
  for insert to authenticated
  with check (
    client_email = (select auth.email()) and last_read_at <= now()
    and ((thread_type = 'work_order' and exists (select 1 from public.client_portal_work_orders wo
            where wo.id = client_portal_thread_reads.thread_id
              and lower(wo.client_email) = any ((select public.client_portal_my_emails())::text[])))
      or (thread_type = 'job' and exists (select 1 from public.client_portal_jobs j
            where j.id = client_portal_thread_reads.thread_id
              and lower(j.client_email) = any ((select public.client_portal_my_emails())::text[])))));

drop policy if exists "clients can ask a question about their own quote" on public.quote_questions;
create policy "clients can ask a question about their own quote" on public.quote_questions
  for insert to authenticated
  with check (
    (select auth.email()) = client_email and length(message) > 0 and length(message) <= 2000
    and exists (select 1 from public.client_portal_quotes q
                where q.id = quote_questions.quote_id
                  and lower(q.client_email) = any ((select public.client_portal_my_emails())::text[])));

-- 4. Unread counts ---------------------------------------------------------------
create or replace function public.get_portal_unread_counts()
returns table(thread_type text, thread_id bigint, unread_count integer, latest_unread_at timestamptz)
language sql
stable
set search_path = 'public'
as $$
  select 'work_order'::text, m.work_order_id, count(*)::int, max(m.created_at)
  from public.client_portal_work_order_messages m
  join public.client_portal_work_orders w
    on w.id = m.work_order_id and lower(w.client_email) = any ((select public.client_portal_my_emails())::text[])
  left join public.client_portal_thread_reads r
    on r.client_email = (select auth.email()) and r.thread_type = 'work_order' and r.thread_id = m.work_order_id
  where m.sender_type = 'internal'
    and (r.last_read_at is null or m.created_at > r.last_read_at)
  group by m.work_order_id
  union all
  select 'job'::text, m.job_id, count(*)::int, max(m.created_at)
  from public.client_portal_job_messages m
  join public.client_portal_jobs j
    on j.id = m.job_id and lower(j.client_email) = any ((select public.client_portal_my_emails())::text[])
  left join public.client_portal_thread_reads r
    on r.client_email = (select auth.email()) and r.thread_type = 'job' and r.thread_id = m.job_id
  where m.sender_type = 'internal'
    and (r.last_read_at is null or m.created_at > r.last_read_at)
  group by m.job_id;
$$;

commit;

notify pgrst, 'reload schema';
