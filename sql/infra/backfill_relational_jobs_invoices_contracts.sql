-- One-time backfill run alongside create_relational_jobs_invoices_quotes_contracts.sql,
-- populating the new tables from the live workspace_sync blob's current
-- content at the time this ran (2026-09-08). Safe to re-run -- every
-- insert is `on conflict (id) do nothing`. th_quotes was an empty array
-- in the live data at the time, so no quotes/quote_line_items rows exist
-- yet; they'll arrive via the dual-write hook in tools/sync.js once a
-- real quote is created.

insert into public.jobs (id, title, client, client_id, phone, address, client_email, priority, job_date, status, notes, show_on_calendar, status_changed_at, created_by, last_edited_by)
select
  (j->>'id')::bigint,
  j->>'title',
  j->>'client',
  j->>'clientId',
  j->>'phone',
  j->>'address',
  j->>'clientEmail',
  j->>'priority',
  j->>'date',
  j->>'status',
  j->>'notes',
  coalesce((j->>'showOnCalendar')::boolean, false),
  nullif(j->>'statusChangedAt','')::timestamptz,
  j->>'createdBy',
  j->>'lastEditedBy'
from public.workspace_sync ws, jsonb_array_elements(coalesce((ws.data->>'th_tracker_jobs')::jsonb, '[]')) as j
on conflict (id) do nothing;

insert into public.invoices (id, invoice_number, client_name, client_id, client_email, invoice_date, terms, invoice_type, subtotal, tax, discount, total, paid, paid_amount, job_id, job_ref_title, generated_by)
select
  (i->>'id')::bigint,
  i->>'invoiceNumber',
  i->>'clientName',
  i->>'clientId',
  i->>'clientEmail',
  i->>'date',
  i->>'terms',
  i->>'invoiceType',
  (i->>'subtotal')::numeric,
  (i->>'tax')::numeric,
  (i->>'discount')::numeric,
  (i->>'total')::numeric,
  coalesce((i->>'paid')::boolean, false),
  (i->>'paidAmount')::numeric,
  nullif(i->>'jobRefId','')::bigint,
  nullif(i->>'jobRefTitle',''),
  i->>'generatedBy'
from public.workspace_sync ws, jsonb_array_elements(coalesce((ws.data->>'th_invoices')::jsonb, '[]')) as i
on conflict (id) do nothing;

insert into public.invoice_line_items (invoice_id, sort_order, description, part, qty, price, amount, taxable, item_type)
select
  (i->>'id')::bigint,
  ord - 1,
  li->>'desc',
  li->>'part',
  (li->>'qty')::numeric,
  (li->>'price')::numeric,
  (li->>'amount')::numeric,
  (li->>'taxable')::boolean,
  li->>'type'
from public.workspace_sync ws,
  jsonb_array_elements(coalesce((ws.data->>'th_invoices')::jsonb, '[]')) as i,
  jsonb_array_elements(coalesce(i->'line_items', '[]')) with ordinality as t(li, ord);

insert into public.contracts (id, contract_type, fields, date_generated, generated_by)
select
  (c->>'id')::bigint,
  c->>'type',
  c->'fields',
  c->>'dateGenerated',
  c->>'generatedBy'
from public.workspace_sync ws, jsonb_array_elements(coalesce((ws.data->>'th_contracts')::jsonb, '[]')) as c
on conflict (id) do nothing;
