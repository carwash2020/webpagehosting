-- Fix plan A5 (2026-11-07): the portal shows each unpaid invoice's due date.
-- client_portal_invoices has no due date; the pay page works it out from
-- the Workspace invoice's terms (guest-pay dueDateFor, data-layer.js
-- TH_TERM_DAYS: Due Upon Receipt 0, Net 15 15, Net 30 30, anything else 15).
-- This function does the same for the signed-in client's own invoices
-- only, at read time, so nothing is stored and nothing can go stale.
-- Read-only; no data changes. The match is by the invoice's own id, for
-- the caller's own emails; a portal row with no tenant (4 of 7 live on
-- 2026-11-07, INV-2026-1174 among them: sync-invoice-to-portal doesn't set
-- one) still matches its invoice. A row with a DIFFERENT tenant never does.
--
-- UNDO: drop function public.client_portal_my_invoice_due_dates();

create or replace function public.client_portal_my_invoice_due_dates()
returns table (id bigint, due_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select ci.id,
         (ci.invoice_date + case i.terms
                              when 'Due Upon Receipt' then 0
                              when 'Net 15' then 15
                              when 'Net 30' then 30
                              else 15
                            end)::date
    from public.client_portal_invoices ci
    join public.invoices i
      on i.id = ci.source_invoice_id
     and (ci.tenant_id is null or i.tenant_id is not distinct from ci.tenant_id)
   where lower(ci.client_email) = any (public.client_portal_my_emails());
$$;

revoke all on function public.client_portal_my_invoice_due_dates() from public, anon;
grant execute on function public.client_portal_my_invoice_due_dates() to authenticated;
