-- Item 1 Phase 0e: blob vs relational drift report (docs/ITEM-1-MIGRATION-PLAN.md).
-- READ-ONLY. Safe to run any time, as often as needed; it changes nothing.
-- Run it in the SQL editor (as postgres, so RLS doesn't hide rows with a
-- null tenant_id; those rows are themselves a finding, see `tenant_null`).
--
-- One row per discrepancy. An empty result means the relational tables
-- match the blob for every field compared here. Kinds:
--   only_in_blob        in th_* but missing from the table (mirror never landed)
--   only_in_relational  in the table but not the blob (deleted locally, delete mirror failed)
--   field_diff          same id, a compared field differs (edit mirror failed)
--   tenant_null         row exists but tenant_id is null (staff RLS hides it)
--   money_total         per-entity sum of totals differs, to the cent
--
-- Change the code below if the live sync code ever changes.
-- Written 2026-09-30, first run found: invoice INV-2026-1051 only_in_blob.

with ws as (
  select data from public.workspace_sync where code = 'tripleh-workspace-2026'
),
bj as (
  select (x->>'id')::bigint as id, x->>'title' as title, x->>'status' as status,
         nullif(x->>'date', '') as job_date, x->>'client' as client
  from ws, jsonb_array_elements(coalesce((ws.data->>'th_tracker_jobs')::jsonb, '[]')) x
),
bi as (
  select (x->>'id')::bigint as id, x->>'invoiceNumber' as invoice_number,
         round((x->>'total')::numeric, 2) as total,
         round(coalesce((x->>'paidAmount')::numeric, case when (x->>'paid')::boolean then (x->>'total')::numeric else 0 end), 2) as paid_amount,
         nullif(x->>'date', '') as invoice_date
  from ws, jsonb_array_elements(coalesce((ws.data->>'th_invoices')::jsonb, '[]')) x
),
bq as (
  select (x->>'id')::bigint as id, x->>'quoteNumber' as quote_number,
         round((x->>'total')::numeric, 2) as total, x->>'status' as status
  from ws, jsonb_array_elements(coalesce((ws.data->>'th_quotes')::jsonb, '[]')) x
),
bc as (
  select (x->>'id')::bigint as id, x->>'type' as contract_type
  from ws, jsonb_array_elements(coalesce((ws.data->>'th_contracts')::jsonb, '[]')) x
)

-- JOBS
select 'jobs' as entity, 'only_in_blob' as kind, b.id, b.title as detail from bj b
  where not exists (select 1 from public.jobs r where r.id = b.id)
union all
select 'jobs', 'only_in_relational', r.id, r.title from public.jobs r
  where not exists (select 1 from bj b where b.id = r.id)
union all
select 'jobs', 'field_diff', b.id,
  concat_ws('; ',
    case when b.title   is distinct from r.title    then 'title' end,
    case when b.status  is distinct from r.status   then 'status: ' || coalesce(r.status, 'null') || ' -> ' || coalesce(b.status, 'null') end,
    case when b.job_date is distinct from nullif(r.job_date, '') then 'job_date' end,
    case when b.client  is distinct from r.client   then 'client' end)
  from bj b join public.jobs r on r.id = b.id
  where (b.title, b.status, b.job_date, b.client) is distinct from (r.title, r.status, nullif(r.job_date, ''), r.client)

-- INVOICES
union all
select 'invoices', 'only_in_blob', b.id, b.invoice_number || ' (' || coalesce(b.invoice_date, 'no date') || ')' from bi b
  where not exists (select 1 from public.invoices r where r.id = b.id)
union all
select 'invoices', 'only_in_relational', r.id, r.invoice_number from public.invoices r
  where not exists (select 1 from bi b where b.id = r.id)
union all
select 'invoices', 'field_diff', b.id,
  b.invoice_number || ': ' || concat_ws('; ',
    case when b.total is distinct from round(r.total, 2) then 'total ' || coalesce(round(r.total, 2)::text, 'null') || ' -> ' || coalesce(b.total::text, 'null') end,
    case when b.paid_amount is distinct from round(coalesce(r.paid_amount, case when r.paid then r.total else 0 end), 2)
         then 'paid_amount ' || coalesce(round(r.paid_amount, 2)::text, 'null') || ' -> ' || coalesce(b.paid_amount::text, 'null') end,
    case when b.invoice_date is distinct from nullif(r.invoice_date, '') then 'invoice_date' end,
    case when b.invoice_number is distinct from r.invoice_number then 'invoice_number' end)
  from bi b join public.invoices r on r.id = b.id
  where (b.total, b.paid_amount, b.invoice_date, b.invoice_number)
        is distinct from (round(r.total, 2), round(coalesce(r.paid_amount, case when r.paid then r.total else 0 end), 2), nullif(r.invoice_date, ''), r.invoice_number)

-- QUOTES
union all
select 'quotes', 'only_in_blob', b.id, b.quote_number from bq b
  where not exists (select 1 from public.quotes r where r.id = b.id)
union all
select 'quotes', 'only_in_relational', r.id, r.quote_number from public.quotes r
  where not exists (select 1 from bq b where b.id = r.id)
union all
select 'quotes', 'field_diff', b.id, b.quote_number from bq b join public.quotes r on r.id = b.id
  where (b.total, b.status) is distinct from (round(r.total, 2), r.status)

-- CONTRACTS
union all
select 'contracts', 'only_in_blob', b.id, b.contract_type from bc b
  where not exists (select 1 from public.contracts r where r.id = b.id)
union all
select 'contracts', 'only_in_relational', r.id, r.contract_type from public.contracts r
  where not exists (select 1 from bc b where b.id = r.id)

-- TENANT
union all select 'jobs',      'tenant_null', id, null from public.jobs      where tenant_id is null
union all select 'invoices',  'tenant_null', id, null from public.invoices  where tenant_id is null
union all select 'quotes',    'tenant_null', id, null from public.quotes    where tenant_id is null
union all select 'contracts', 'tenant_null', id, null from public.contracts where tenant_id is null

-- MONEY, to the cent
union all
select 'invoices', 'money_total', null,
  'blob total ' || b.t || ' vs relational ' || r.t || '; blob paid ' || b.p || ' vs relational ' || r.p
from (select coalesce(sum(total), 0) t, coalesce(sum(paid_amount), 0) p from bi) b,
     (select coalesce(sum(round(total, 2)), 0) t,
             coalesce(sum(round(coalesce(paid_amount, case when paid then total else 0 end), 2)), 0) p
      from public.invoices) r
where b.t <> r.t or b.p <> r.p

order by 1, 2, 3;
