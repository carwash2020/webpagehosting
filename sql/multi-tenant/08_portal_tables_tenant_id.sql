-- Multi-tenant follow-up (batch 8, fix plan A3, 2026-11-07): the client
-- portal mirror tables get the same tenant_id trigger as everything else.
--
-- THE BUG (found verifying A3 live): INV-2026-1174 kept "Never sent to
-- portal" after a reload though its client_portal_invoices row exists. The
-- Workspace reads portal rows through internal_read_client_portal_*(),
-- which return only tenant_id = current_tenant_id(). Batch 06 gave the
-- trigger to the top-level tables only; the portal mirrors are written by
-- edge functions as service_role, so every row since the September
-- backfill landed with tenant_id null and is invisible to staff. Live on
-- 2026-11-07: 4 of 7 portal invoices (13, 15, 17, 18 -- real clients'
-- invoices among them), the 1 portal quote and the 1 portal contract.
--
-- THE FIX:
--   1. set_tenant_id (batch 06/07's set_tenant_id_from_session: the staff
--      session's tenant, else Triple H) on the six portal mirror tables.
--   2. Backfill the null rows: an invoice from its own Workspace invoice's
--      tenant; a quote or contract from its source row's tenant; anything
--      left (no source row) from the Triple H default. Only null tenants
--      are filled; a set tenant_id is never changed. One tenant exists.
--
-- Changes no client-visible data: tenant_id only decides which business's
-- staff can see the row. Clients read their rows by email, unchanged.
--
-- UNDO: drop trigger set_tenant_id on each table below. (The backfill is
-- not undone: putting tenant_id back to null re-hides the rows.)

do $$
declare
  t text;
begin
  foreach t in array array[
    'client_portal_invoices', 'client_portal_quotes', 'client_portal_contracts',
    'client_portal_jobs', 'client_portal_checkups', 'client_portal_work_orders'
  ] loop
    execute format('drop trigger if exists set_tenant_id on public.%I', t);
    execute format(
      'create trigger set_tenant_id before insert on public.%I '
      'for each row execute function public.set_tenant_id_from_session()', t);
  end loop;
end;
$$;

update public.client_portal_invoices ci
   set tenant_id = i.tenant_id
  from public.invoices i
 where ci.tenant_id is null and i.id = ci.source_invoice_id and i.tenant_id is not null;

update public.client_portal_quotes cq
   set tenant_id = q.tenant_id
  from public.quotes q
 where cq.tenant_id is null and q.id = cq.source_quote_id and q.tenant_id is not null;

update public.client_portal_contracts cc
   set tenant_id = c.tenant_id
  from public.contracts c
 where cc.tenant_id is null and c.id = cc.source_contract_id and c.tenant_id is not null;

update public.client_portal_invoices    set tenant_id = public.default_tenant_id_triple_h() where tenant_id is null;
update public.client_portal_quotes      set tenant_id = public.default_tenant_id_triple_h() where tenant_id is null;
update public.client_portal_contracts   set tenant_id = public.default_tenant_id_triple_h() where tenant_id is null;
update public.client_portal_jobs        set tenant_id = public.default_tenant_id_triple_h() where tenant_id is null;
update public.client_portal_checkups    set tenant_id = public.default_tenant_id_triple_h() where tenant_id is null;
update public.client_portal_work_orders set tenant_id = public.default_tenant_id_triple_h() where tenant_id is null;
