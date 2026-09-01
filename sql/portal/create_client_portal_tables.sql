-- The client portal's two tables, as actually deployed.
-- client_portal_invoices created 2026-08-31, portal_bug_reports
-- created 2026-09-01. Recorded here after the fact so the schema is
-- reproducible from this repo rather than living only in the live
-- database.

-- ---------------------------------------------------------------
-- client_portal_invoices
-- ---------------------------------------------------------------
-- A SEPARATE table from workspace_sync, not a view onto it. The
-- workspace blob is internal-only and must never be reachable by a
-- client session; this table holds only the specific invoice fields a
-- client is allowed to see, written to by an edge function using the
-- service role key.
create table client_portal_invoices (
  id bigint generated always as identity primary key,
  source_invoice_id bigint not null,
  client_email text not null,
  client_name text not null,
  invoice_number text not null,
  invoice_date date not null,
  description text,
  total numeric not null,
  paid boolean not null default false,
  paid_at timestamptz,
  stripe_payment_intent_id text,
  line_items jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lets sync-invoice-to-portal upsert -- syncing the same invoice
-- twice updates the existing row rather than creating a duplicate.
alter table client_portal_invoices
  add constraint client_portal_invoices_source_invoice_id_key
  unique (source_invoice_id);

alter table client_portal_invoices enable row level security;

-- SELECT only, and only your own. No insert/update/delete policy for
-- the authenticated role at all: every write goes through an edge
-- function with the service role key, never from the browser.
--
-- auth.email() is wrapped in (select ...) deliberately -- the same
-- performance pattern already applied to five other tables in this
-- project. Without it Postgres re-evaluates the function per row.
create policy "clients can only view their own invoices"
  on client_portal_invoices for select
  using ((select auth.email()) = client_email);


-- ---------------------------------------------------------------
-- portal_bug_reports
-- ---------------------------------------------------------------
-- Feeds the "Report a problem" link on all three portal pages, read
-- in Dev Tools -> Health -> Portal bug reports.
create table portal_bug_reports (
  id bigint generated always as identity primary key,
  client_email text,
  message text not null,
  page_url text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  resolved boolean not null default false,
  resolved_at timestamptz
);

alter table portal_bug_reports enable row level security;

-- client_email is nullable ON PURPOSE. A login problem has to be
-- reportable before any session exists at all -- requiring a session
-- here would make exactly the most useful report impossible to file.
create policy "Anyone can submit a bug report"
  on portal_bug_reports for insert
  to anon, authenticated
  with check (length(message) > 0 and length(message) <= 2000);

-- Read and resolve are internal-only. A client can submit but can
-- never read anything back, including their own past reports.
create policy "Internal accounts can view bug reports"
  on portal_bug_reports for select
  to authenticated
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));

create policy "Internal accounts can resolve bug reports"
  on portal_bug_reports for update
  to authenticated
  using ((select auth.role()) = 'authenticated' and exists (select 1 from account_roles where email = auth.email()));
