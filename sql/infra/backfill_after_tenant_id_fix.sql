-- Item 1 Phase 0 backfill: rows the relational mirror dropped while Tier 0's
-- tenant check rejected every staff insert/upsert (fixed by
-- sql/multi-tenant/06_tenant_id_from_session_top_level_tables.sql).
--
-- ALREADY RUN on 2026-09-30, after owner approval (as postgres). The
-- reconciliation returned zero rows afterwards. Kept as the record; re-running
-- is harmless (the upsert is idempotent), but there's nothing left to do.
--
-- Scope is exactly what sql/infra/reconcile_blob_vs_relational.sql reported
-- on 2026-09-30 after 06 was live:
--   invoices  only_in_blob  1790448758936  INV-2026-1051 (2026-09-26)
--   invoices  money_total   (the same invoice: 607.49 - 394.83 = 212.66)
-- No field_diff, no only_in_relational, no tenant_null, nothing for jobs,
-- quotes or contracts. So this touches one invoice and its line items. If a
-- re-run of the reconciliation reports more ids, add them to target_ids
-- (and a jobs/quotes section if needed) before running.
--
-- Source of truth: the workspace_sync blob, code 'tripleh-workspace-2026'.
-- Field mapping copies tools/sync.js exactly, not the older
-- backfill_relational_jobs_invoices_contracts.sql (which used DO NOTHING and
-- never set tenant_id):
--   - mirrorInvoiceToRelational(): `x || null` -> nullif(text, ''),
--     `x ?? null` -> plain cast (json null stays null), jobRefId/sourceQuoteId
--     are "truthy ? Number(x) : null".
--   - paid = deriveInvoicePaid(): whole cents, paidAmount vs total, and a
--     legacy invoice with no paidAmount but paid=true counts as paid in full.
--   - mirrorReplaceLineItems(): delete then insert, sort_order = array index,
--     taxable = !!it.taxable.
--   - referred_by is a jobs-only column (mirrorJobsToRelational); no jobs are
--     in scope.
--
-- tenant_id is set explicitly. This script runs as postgres with no JWT, so
-- the 06 trigger would resolve null and staff RLS would hide the row.
-- invoice_line_items gets its tenant from the parent invoice via its own
-- set_tenant_id trigger (batch 03), so the parent must be written first.
--
-- ON CONFLICT DO UPDATE, not DO NOTHING: if the row turns up in the table
-- before this runs, the blob still wins (e.g. paid status).

begin;

create temp table backfill_target_invoices on commit drop as
select x as inv
from public.workspace_sync ws,
     jsonb_array_elements(coalesce((ws.data->>'th_invoices')::jsonb, '[]')) x
where ws.code = 'tripleh-workspace-2026'
  and (x->>'id')::bigint = any (array[1790448758936]::bigint[]);  -- target_ids

do $$
declare
  n int;
begin
  if (select id from public.tenants where slug = 'triple-h') is null then
    raise exception 'tenant triple-h not found';
  end if;
  select count(*) into n from backfill_target_invoices;
  if n <> 1 then  -- = cardinality(target_ids)
    raise exception 'expected 1 target invoice in the blob, found %', n;
  end if;
end $$;

insert into public.invoices (
  id, invoice_number, client_name, client_id, client_email, invoice_date,
  terms, invoice_type, subtotal, tax, discount, total, paid, paid_amount,
  job_id, job_ref_title, source_quote_id, generated_by, tenant_id
)
select
  (inv->>'id')::bigint,
  nullif(inv->>'invoiceNumber', ''),
  nullif(inv->>'clientName', ''),
  nullif(inv->>'clientId', ''),
  nullif(inv->>'clientEmail', ''),
  nullif(inv->>'date', ''),
  nullif(inv->>'terms', ''),
  nullif(inv->>'invoiceType', ''),
  (inv->>'subtotal')::numeric,
  (inv->>'tax')::numeric,
  (inv->>'discount')::numeric,
  (inv->>'total')::numeric,
  -- deriveInvoicePaid()
  round(coalesce((inv->>'total')::numeric, 0) * 100) > 0
    and round(
          case when inv->'paidAmount' is not null and jsonb_typeof(inv->'paidAmount') <> 'null'
               then coalesce((inv->>'paidAmount')::numeric, 0)
               when inv->'paid' = 'true'::jsonb
               then coalesce((inv->>'total')::numeric, 0)
               else 0 end * 100)
        >= round(coalesce((inv->>'total')::numeric, 0) * 100),
  (inv->>'paidAmount')::numeric,
  nullif(nullif(inv->>'jobRefId', ''), '0')::bigint,
  nullif(inv->>'jobRefTitle', ''),
  nullif(nullif(inv->>'sourceQuoteId', ''), '0')::bigint,
  nullif(inv->>'generatedBy', ''),
  (select id from public.tenants where slug = 'triple-h')
from backfill_target_invoices
on conflict (id) do update set
  invoice_number  = excluded.invoice_number,
  client_name     = excluded.client_name,
  client_id       = excluded.client_id,
  client_email    = excluded.client_email,
  invoice_date    = excluded.invoice_date,
  terms           = excluded.terms,
  invoice_type    = excluded.invoice_type,
  subtotal        = excluded.subtotal,
  tax             = excluded.tax,
  discount        = excluded.discount,
  total           = excluded.total,
  paid            = excluded.paid,
  paid_amount     = excluded.paid_amount,
  job_id          = excluded.job_id,
  job_ref_title   = excluded.job_ref_title,
  source_quote_id = excluded.source_quote_id,
  generated_by    = excluded.generated_by,
  tenant_id       = excluded.tenant_id;

delete from public.invoice_line_items
where invoice_id in (select (inv->>'id')::bigint from backfill_target_invoices);

insert into public.invoice_line_items (
  invoice_id, sort_order, description, part, qty, price, amount, taxable, item_type
)
select
  (t.inv->>'id')::bigint,
  (li.ord - 1)::int,
  nullif(li.item->>'desc', ''),
  nullif(li.item->>'part', ''),
  (li.item->>'qty')::numeric,
  (li.item->>'price')::numeric,
  (li.item->>'amount')::numeric,
  case jsonb_typeof(li.item->'taxable')
    when 'boolean' then (li.item->>'taxable')::boolean
    when 'number'  then (li.item->>'taxable')::numeric <> 0
    when 'string'  then li.item->>'taxable' <> ''
    else false end,
  nullif(li.item->>'type', '')
from backfill_target_invoices t,
     jsonb_array_elements(coalesce(t.inv->'line_items', '[]')) with ordinality as li(item, ord);

-- What was written (shown before commit).
select i.id, i.invoice_number, i.total, i.paid, i.paid_amount, i.job_id, i.tenant_id,
       (select count(*) from public.invoice_line_items l
         where l.invoice_id = i.id and l.tenant_id = i.tenant_id) as line_items_with_tenant
from public.invoices i
where i.id in (select (inv->>'id')::bigint from backfill_target_invoices);

commit;
