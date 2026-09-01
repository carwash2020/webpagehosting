-- Phase 2 of the client-portal roadmap (docs/CLIENT-PORTAL.md):
-- client_portal_quotes and quote_questions. Applied directly via the
-- Supabase MCP migration tool; recorded here after the fact so the
-- schema is reproducible from this repo, same convention as
-- sql/portal/create_client_portal_tables.sql.

-- ---------------------------------------------------------------
-- client_portal_quotes
-- ---------------------------------------------------------------
-- Mirrors client_portal_invoices' shape and boundaries exactly. A
-- SEPARATE table from the internal th_quotes (which lives in the
-- workspace_sync JSON blob) -- deliberately NOT two-way synced back
-- into that blob. Writing into a live JSONB blob from a server-side
-- edge function, outside the established sync-merge logic in
-- sync.js, would risk exactly the kind of clobbered-write bug this
-- project's own DISASTER_RECOVERY.md already documents once.
-- Internal visibility into approval status instead comes from a
-- direct, real-time query against this table, surfaced inline in the
-- Quote Log in tools/invoice-generator.html -- not a separate Dev
-- Tools panel, since Dev Tools is Developer-only for almost every
-- panel and Steve (Owner role) needs to see this too.
create table client_portal_quotes (
  id bigint generated always as identity primary key,
  source_quote_id bigint not null,
  client_email text not null,
  client_name text not null,
  quote_number text not null,
  quote_date date not null,
  description text,
  total numeric not null,
  line_items jsonb,
  status text not null default 'pending',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_portal_quotes_status_check check (status in ('pending', 'approved', 'declined'))
);

-- Lets sync-quote-to-portal upsert -- syncing the same quote twice
-- (e.g. Steve edits and re-sends) updates rather than duplicates.
alter table client_portal_quotes
  add constraint client_portal_quotes_source_quote_id_key
  unique (source_quote_id);

alter table client_portal_quotes enable row level security;

-- Clients see only their own quote -- (select ...) wraps auth.email()
-- for the same per-query-not-per-row performance reason already
-- applied to five other tables in this project.
create policy "clients can only view their own quotes"
  on client_portal_quotes for select
  to authenticated
  using ((select auth.email()) = client_email);

-- Internal accounts can see every quote -- the write-back visibility
-- Steve needs, via a real-time query rather than a blob sync. Two
-- permissive SELECT policies on the same table OR together, so this
-- adds internal visibility without narrowing what a client can see.
create policy "internal accounts can view all quotes"
  on client_portal_quotes for select
  to authenticated
  using (exists (select 1 from account_roles where email = (select auth.email())));

-- No insert/update/delete policy for the authenticated role at all --
-- every write goes through an edge function with the service role
-- key, never from the browser, matching client_portal_invoices.


-- ---------------------------------------------------------------
-- quote_questions
-- ---------------------------------------------------------------
-- Deliberately narrower than an open-ended messaging thread (that
-- idea is explicitly declined in docs/CLIENT-PORTAL.md's own "worth
-- considering but has real tradeoffs" section) -- a client can ask
-- one question tied to one specific quote; Steve follows up by
-- phone/text/email as usual, the same way bug reports already work.
create table quote_questions (
  id bigint generated always as identity primary key,
  quote_id bigint not null references client_portal_quotes(id) on delete cascade,
  client_email text not null,
  message text not null,
  created_at timestamptz not null default now(),
  resolved boolean not null default false,
  resolved_at timestamptz
);

alter table quote_questions enable row level security;

-- Unlike portal_bug_reports (which must allow a question before any
-- session exists, since a login problem has to be reportable pre-
-- login), asking about a specific quote already requires being signed
-- in to have viewed that quote at all -- so this is authenticated-only,
-- and the with-check ties the inserted client_email to the caller's
-- own verified session AND confirms that quote genuinely belongs to
-- them, so one client can never submit a question tagged to another
-- client's quote_id.
create policy "clients can ask a question about their own quote"
  on quote_questions for insert
  to authenticated
  with check (
    (select auth.email()) = client_email
    and length(message) > 0 and length(message) <= 2000
    and exists (
      select 1 from client_portal_quotes q
      where q.id = quote_id and q.client_email = (select auth.email())
    )
  );

-- Read and resolve are internal-only, same shape as portal_bug_reports.
create policy "internal accounts can view quote questions"
  on quote_questions for select
  to authenticated
  using (exists (select 1 from account_roles where email = (select auth.email())));

create policy "internal accounts can resolve quote questions"
  on quote_questions for update
  to authenticated
  using (exists (select 1 from account_roles where email = (select auth.email())));
