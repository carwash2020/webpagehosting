-- Unread-message tracking for the client portal (2026-09-22).
--
-- Found during a portal audit: neither message table
-- (client_portal_work_order_messages, client_portal_job_messages)
-- records whether a client has seen a reply. So a client had no way to
-- tell Triple H had answered without opening every thread, the
-- "Messages" buttons carried no count, and Home's action inbox showed a
-- "Reply" item for EVERY open work request with the guess "We may have
-- a question, or an update waiting" -- whether or not anything new
-- existed.
--
-- Design, and what was rejected:
--   * read_at columns on the message rows themselves: would need a
--     client UPDATE policy on tables that deliberately have none, and
--     RLS can't restrict an UPDATE to one column -- a client could then
--     edit Triple H's message text. It would also change the rows the
--     notify_*_email() triggers serialize with row_to_json(NEW).
--   * localStorage only: per-device (phone and laptop disagree, a
--     reinstall resets it) and staff could never see "seen" later.
--   * one reads table PER message table with real FKs (the
--     job-messages precedent): read rows are per-client UI state, not a
--     business record. An orphan (parent deleted) is harmless -- ids are
--     identity-generated and never reused, so it can never match a
--     future thread -- and one table means one ON CONFLICT target and
--     one set of policies. Ownership is enforced by RLS instead.
--
-- A thread's "last read" is a watermark, not a flag: every Triple H
-- ('internal') message created after last_read_at is unread. The
-- client's own messages never count.
--
-- Applied directly via the Supabase MCP migration tool; recorded here
-- after the fact, same convention as every other file in sql/portal/.

create table public.client_portal_thread_reads (
  client_email text not null default auth.email(),
  thread_type text not null,
  thread_id bigint not null,
  last_read_at timestamptz not null default now(),
  constraint client_portal_thread_reads_pkey primary key (client_email, thread_type, thread_id),
  constraint thread_read_type_valid check (thread_type in ('work_order', 'job'))
);
-- The primary key doubles as the lookup index: get_portal_unread_counts()
-- joins on exactly these three columns.

alter table public.client_portal_thread_reads enable row level security;

-- Merged SELECT, same "clients or internal accounts" shape as
-- client_profiles/client_notification_preferences -- staff read access
-- leaves room for a "seen" indicator in tools/clients.html later
-- without another migration.
create policy "clients or internal accounts view thread reads"
  on public.client_portal_thread_reads for select
  to authenticated
  using (client_email = (select auth.email()) or public.current_user_has_any_role());

-- A client may only mark THEIR OWN thread read -- the parent row must
-- belong to them -- and never with a watermark in the future (which
-- would pre-mark replies that don't exist yet as read).
create policy "clients mark their own threads read"
  on public.client_portal_thread_reads for insert
  to authenticated
  with check (
    client_email = (select auth.email())
    and last_read_at <= now()
    and (
      (thread_type = 'work_order' and exists (
        select 1 from public.client_portal_work_orders wo
        where wo.id = client_portal_thread_reads.thread_id
          and wo.client_email = (select auth.email())))
      or (thread_type = 'job' and exists (
        select 1 from public.client_portal_jobs j
        where j.id = client_portal_thread_reads.thread_id
          and j.client_email = (select auth.email())))
    )
  );

create policy "clients advance their own thread reads"
  on public.client_portal_thread_reads for update
  to authenticated
  using (client_email = (select auth.email()))
  with check (client_email = (select auth.email()) and last_read_at <= now());
-- No DELETE policy: nothing needs to un-read a thread.

revoke all on table public.client_portal_thread_reads from public, anon, authenticated;
grant select, insert on table public.client_portal_thread_reads to authenticated;
-- Column-level: an existing row can only ever have its watermark moved,
-- never be repointed at a different thread or client.
grant update (last_read_at) on table public.client_portal_thread_reads to authenticated;

-- Unread counts per thread for the CALLER, in one round trip.
--
-- SECURITY INVOKER on purpose: the caller can already read every row
-- involved, so RLS stays in force. The explicit client_email =
-- (select auth.email()) join filters are REQUIRED, not decoration: the
-- message tables' SELECT policies let internal accounts see every
-- client's threads, so relying on RLS alone would make a staff login
-- that opens the portal count every client's unread messages as its own.
create or replace function public.get_portal_unread_counts()
returns table (thread_type text, thread_id bigint, unread_count integer, latest_unread_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select 'work_order'::text, m.work_order_id, count(*)::int, max(m.created_at)
  from public.client_portal_work_order_messages m
  join public.client_portal_work_orders w
    on w.id = m.work_order_id and w.client_email = (select auth.email())
  left join public.client_portal_thread_reads r
    on r.client_email = w.client_email and r.thread_type = 'work_order' and r.thread_id = m.work_order_id
  where m.sender_type = 'internal'
    and (r.last_read_at is null or m.created_at > r.last_read_at)
  group by m.work_order_id
  union all
  select 'job'::text, m.job_id, count(*)::int, max(m.created_at)
  from public.client_portal_job_messages m
  join public.client_portal_jobs j
    on j.id = m.job_id and j.client_email = (select auth.email())
  left join public.client_portal_thread_reads r
    on r.client_email = j.client_email and r.thread_type = 'job' and r.thread_id = m.job_id
  where m.sender_type = 'internal'
    and (r.last_read_at is null or m.created_at > r.last_read_at)
  group by m.job_id;
$$;

-- "I've read this thread up to here." p_seen_through is the raw
-- created_at of the newest message the client actually rendered (so a
-- reply that lands between loading the thread and this call keeps a
-- later timestamp and stays unread), capped at the server's now() and
-- defaulting to it -- the client's own clock is never used. greatest()
-- means an older device can never move the watermark backwards.
create or replace function public.mark_portal_thread_read(
  p_thread_type text, p_thread_id bigint, p_seen_through timestamptz default null)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  insert into public.client_portal_thread_reads as r (client_email, thread_type, thread_id, last_read_at)
  values (auth.email(), p_thread_type, p_thread_id, least(coalesce(p_seen_through, now()), now()))
  on conflict (client_email, thread_type, thread_id)
  do update set last_read_at = greatest(r.last_read_at, excluded.last_read_at);
$$;

-- Supabase grants EXECUTE to anon separately at create time, so revoking
-- from public alone is not enough (see
-- sql/security/revoke_public_execute_on_internal_only_functions.sql).
revoke execute on function public.get_portal_unread_counts() from public, anon;
grant execute on function public.get_portal_unread_counts() to authenticated;
revoke execute on function public.mark_portal_thread_read(text, bigint, timestamptz) from public, anon;
grant execute on function public.mark_portal_thread_read(text, bigint, timestamptz) to authenticated;

-- Backfill: a client's own latest message in a thread proves they saw
-- everything before it. Triple H replies AFTER that stay unread -- which
-- is exactly the state worth surfacing on launch.
insert into public.client_portal_thread_reads (client_email, thread_type, thread_id, last_read_at)
select w.client_email, 'work_order', m.work_order_id, max(m.created_at)
  from public.client_portal_work_order_messages m
  join public.client_portal_work_orders w on w.id = m.work_order_id
 where m.sender_type = 'client'
 group by w.client_email, m.work_order_id
union all
select j.client_email, 'job', m.job_id, max(m.created_at)
  from public.client_portal_job_messages m
  join public.client_portal_jobs j on j.id = m.job_id
 where m.sender_type = 'client'
 group by j.client_email, m.job_id
on conflict do nothing;
