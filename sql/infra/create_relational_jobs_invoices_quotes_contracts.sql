-- Code-health pass (2026-09-08): real relational tables for jobs,
-- invoices, quotes, and contracts, with real foreign keys -- the
-- architecture this replaces (all of it living inside th_tracker_jobs/
-- th_invoices/th_quotes/th_contracts, JSON arrays inside ONE ROW's
-- `data jsonb` column in workspace_sync) has no referential integrity at
-- all: an invoice's jobRefId is just a string that happens to match a
-- job's id, never enforced, and a deleted job silently leaves every
-- invoice that referenced it pointing at nothing.
--
-- Deliberately ADDITIVE, not a cutover: every tool page's actual reads/
-- writes still go through localStorage + the existing blob-sync
-- mechanism (tools/sync.js) exactly as before. This is Phase 1 --
-- standing up the real schema and populating it (see the backfill and
-- the dual-write hook added to sync.js in the same change) so the data
-- has a real relational home, without touching the read path any tool
-- page depends on today. A future phase can move reads over once this
-- has run in parallel long enough to trust it.

create table public.jobs (
  id bigint primary key,
  title text not null,
  client text,
  client_id text,
  phone text,
  address text,
  client_email text,
  priority text,
  job_date text, -- kept as free text, not a real date column: real data includes '' for "no date set", not always a parseable date
  status text,
  notes text,
  show_on_calendar boolean not null default false,
  status_changed_at timestamptz,
  created_by text,
  last_edited_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id bigint primary key,
  invoice_number text,
  client_name text,
  client_id text,
  client_email text,
  invoice_date text,
  terms text,
  invoice_type text,
  subtotal numeric,
  tax numeric,
  discount numeric,
  total numeric,
  paid boolean not null default false,
  paid_amount numeric,
  job_id bigint references public.jobs(id) on delete set null,
  job_ref_title text,
  source_quote_id bigint,
  generated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_invoices_job_id on public.invoices(job_id);

create table public.invoice_line_items (
  id bigserial primary key,
  invoice_id bigint not null references public.invoices(id) on delete cascade,
  sort_order int not null default 0,
  description text,
  part text,
  qty numeric,
  price numeric,
  amount numeric,
  taxable boolean,
  item_type text
);
create index idx_invoice_line_items_invoice_id on public.invoice_line_items(invoice_id);

create table public.quotes (
  id bigint primary key,
  quote_number text,
  client_name text,
  client_id text,
  client_email text,
  quote_date text,
  subtotal numeric,
  tax numeric,
  discount numeric,
  total numeric,
  status text,
  job_id bigint references public.jobs(id) on delete set null,
  job_ref_title text,
  generated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_quotes_job_id on public.quotes(job_id);

-- Added after invoices exists, and as a separate ALTER (not inline in
-- CREATE TABLE invoices above) specifically to avoid a circular
-- forward-reference between invoices and quotes (an invoice can cite the
-- quote it was converted from; a quote can cite the invoice it became).
alter table public.invoices add constraint invoices_source_quote_id_fkey
  foreign key (source_quote_id) references public.quotes(id) on delete set null;
alter table public.quotes add column converted_to_invoice_id bigint
  references public.invoices(id) on delete set null;
create index idx_invoices_source_quote_id on public.invoices(source_quote_id);
create index idx_quotes_converted_to_invoice_id on public.quotes(converted_to_invoice_id);

create table public.quote_line_items (
  id bigserial primary key,
  quote_id bigint not null references public.quotes(id) on delete cascade,
  sort_order int not null default 0,
  description text,
  part text,
  qty numeric,
  price numeric,
  amount numeric,
  taxable boolean,
  item_type text
);
create index idx_quote_line_items_quote_id on public.quote_line_items(quote_id);

create table public.contracts (
  id bigint primary key,
  contract_type text,
  job_id bigint references public.jobs(id) on delete set null,
  fields jsonb,
  date_generated text,
  generated_by text,
  created_at timestamptz not null default now()
);
create index idx_contracts_job_id on public.contracts(job_id);

-- RLS: internal-only data (no public/anon path needed at all -- unlike
-- th_leads/th_bookings, nothing on the public site ever writes to these),
-- gated the same way every other internal-accounts-only table already is.
alter table public.jobs enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_line_items enable row level security;
alter table public.contracts enable row level security;

create policy "internal accounts can manage jobs" on public.jobs for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

create policy "internal accounts can manage invoices" on public.invoices for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

create policy "internal accounts can manage invoice line items" on public.invoice_line_items for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

create policy "internal accounts can manage quotes" on public.quotes for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

create policy "internal accounts can manage quote line items" on public.quote_line_items for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));

create policy "internal accounts can manage contracts" on public.contracts for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));
