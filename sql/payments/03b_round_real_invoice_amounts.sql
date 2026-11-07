-- Fix plan Group 4, RP1.10 (2026-11-07): two paid-invoice amount oddities.
-- NOT APPLIED. This file EDITS EXISTING REAL INVOICE AMOUNTS, so it is
-- approved on its own, separately from 03_portal_balance_and_sent.sql.
--
-- Live on 2026-11-07 it changes exactly these rows:
--   INV-2026-1000  paid, paid_amount NULL, total 1.60125
--                  -> total 1.60, paid_amount 1.60 (invoices);
--                     total 1.60 (client_portal_invoices)
--   INV-2026-0905  paid, paid_amount 125, total 125.0025
--                  -> total 125.00 (invoices and client_portal_invoices)
-- Run the SELECT first; apply only if it still lists just these two.
--
--   select 'invoices' t, invoice_number, total, paid, paid_amount from public.invoices
--    where total <> round(total, 2) or (paid and paid_amount is null)
--   union all
--   select 'portal', invoice_number, total, paid, paid_amount from public.client_portal_invoices
--    where total <> round(total, 2);
--
-- The Workspace copy of each invoice (workspace_sync) is not changed; the
-- invoices mirror now writes whole cents (tools/sync.js centsOrNull), so the
-- next save of either invoice writes these same numbers.
--
-- UNDO (values as of 2026-11-07):
--   update public.invoices set total = 1.60125, paid_amount = null where invoice_number = 'INV-2026-1000';
--   update public.invoices set total = 125.0025 where invoice_number = 'INV-2026-0905';
--   update public.client_portal_invoices set total = 1.60125 where invoice_number = 'INV-2026-1000';
--   update public.client_portal_invoices set total = 125.0025 where invoice_number = 'INV-2026-0905';

update public.invoices set total = round(total, 2) where total <> round(total, 2);
update public.invoices set paid_amount = total where paid and paid_amount is null and total is not null;
update public.client_portal_invoices set total = round(total, 2) where total <> round(total, 2);
update public.client_portal_invoices cpi set paid_amount = round(i.paid_amount, 2)
  from public.invoices i
 where i.id = cpi.source_invoice_id and cpi.paid and cpi.paid_amount is distinct from round(i.paid_amount, 2);
