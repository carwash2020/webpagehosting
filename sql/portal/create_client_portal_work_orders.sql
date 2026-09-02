-- Guest work-order requests (2026-09-02). Applied directly via the
-- Supabase MCP migration tool; recorded here after the fact, same
-- convention as every other file in sql/portal/.
--
-- Requested directly: "add a workflow on the portal for the guest to
-- create work orders or request a job be done."
--
-- This is the FIRST portal table a client writes to directly. Every
-- other one (invoices, quotes, jobs, checkups) is a one-way mirror
-- that only edge functions write, with clients holding SELECT only.
-- A client genuinely needs to create rows here, so its column set and
-- its policies are both written defensively.
--
-- Deliberate design decisions:
--
-- 1. client_email defaults to the caller's own verified JWT email
--    (auth.email() called DIRECTLY -- a subquery is not permitted in a
--    DEFAULT expression, confirmed by Postgres rejecting the first
--    attempt at this migration). The INSERT policy additionally
--    requires the inserted value to equal auth.email(). Without both,
--    a signed-in client could file a request attributed to someone
--    else's address -- which would surface in Steve's queue under the
--    wrong name and, worse, appear in that other client's own portal.
--
-- 2. Status is internal-controlled, never client-settable past the
--    initial 'submitted'. A client must not be able to mark their own
--    request 'scheduled' or 'declined'. Enforced by the CHECK
--    constraint plus the INSERT policy plus the absence of any client
--    UPDATE policy.
--
-- 3. No client UPDATE or DELETE policy whatsoever. Once submitted, a
--    request is a record of what was asked for -- letting a client
--    silently edit or delete it after Steve has started acting on it
--    invites real confusion about what was actually agreed. If
--    "cancel my request" is wanted later, that should be an explicit
--    status transition through an edge function, not a raw delete.
--
-- 4. internal_notes is for Connor/Steve only. Postgres RLS is
--    row-level, not column-level, so a client reading their own row
--    would technically be able to read this column too -- which is
--    why portal/work-orders.html deliberately selects an explicit
--    column list and never '*' (there's a test asserting exactly
--    that). Worth knowing: this is a convention enforced in the
--    query, not by the database. Anything genuinely sensitive must
--    not live here.
create table client_portal_work_orders (
  id bigint generated always as identity primary key,
  client_email text not null default auth.email(),
  client_name text,
  title text not null,
  description text not null,
  urgency text not null default 'normal',
  preferred_timing text,
  address text,
  phone text,
  photo_storage_paths jsonb,
  status text not null default 'submitted',
  internal_notes text,
  linked_quote_id bigint references client_portal_quotes(id),
  linked_job_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_urgency_valid
    check (urgency in ('normal', 'soon', 'urgent')),
  constraint work_order_status_valid
    check (status in ('submitted', 'reviewing', 'quoted', 'scheduled', 'completed', 'declined')),
  -- Guards against an empty or whitespace-only submission landing in
  -- the queue as an unactionable blank row.
  constraint work_order_title_not_blank check (length(trim(title)) > 0),
  constraint work_order_description_not_blank check (length(trim(description)) > 0)
);

alter table client_portal_work_orders enable row level security;

-- Clients see only their own requests.
create policy "clients view their own work orders"
  on client_portal_work_orders for select
  to authenticated
  using ((select auth.email()) = client_email);

-- Clients may create a request, but ONLY attributed to themselves,
-- only as 'submitted', and never pre-filling internal-only fields.
create policy "clients create their own work orders"
  on client_portal_work_orders for insert
  to authenticated
  with check (
    (select auth.email()) = client_email
    and status = 'submitted'
    and internal_notes is null
    and linked_quote_id is null
    and linked_job_id is null
  );

-- Internal accounts (anyone with an account_roles row) get full read
-- and update access, so the queue can actually be worked: status
-- moved along, internal notes added, a quote or job linked.
--
-- Deliberately keyed on "has an account_roles row at all" rather than
-- a specific granular permission: job-tracker.html and the rest of
-- the internal tooling have no permission gate of their own, and
-- triaging an incoming work request is core day-to-day work, not a
-- restricted finance-domain action.
create policy "internal accounts view all work orders"
  on client_portal_work_orders for select
  to authenticated
  using (
    exists (select 1 from account_roles where email = (select auth.email()))
  );

create policy "internal accounts update work orders"
  on client_portal_work_orders for update
  to authenticated
  using (
    exists (select 1 from account_roles where email = (select auth.email()))
  );

-- Newest-first queue reads, and per-client portal reads.
create index client_portal_work_orders_status_created_idx
  on client_portal_work_orders (status, created_at desc);
create index client_portal_work_orders_client_email_idx
  on client_portal_work_orders (client_email);
