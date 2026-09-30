-- Multi-tenant Tier 0 (batch 3/5): tenant_id + RLS extension across
-- every remaining business table, plus tenant-derivation triggers for
-- child/message tables. Additive only. Verified live against real
-- production data across every distinct policy shape (staff-only,
-- mixed client-or-staff, staff-or-own-row, message tables, and the
-- client_portal_* RPC pattern) before this file was committed.

do $$
declare
  t text;
  tid uuid := (select id from public.tenants where slug = 'triple-h');
begin
  foreach t in array array[
    'invoices','invoice_line_items','quotes','quote_line_items','contracts',
    'referrals','notification_recipients','stripe_customers','card_authorizations',
    'client_account_codes','th_bookings','th_leads','th_job_photos',
    'portal_bug_reports','portal_client_errors','quote_questions',
    'client_portal_jobs','client_portal_invoices','client_portal_quotes',
    'client_portal_work_orders','client_portal_contracts','client_portal_checkups',
    'client_portal_job_messages','client_portal_work_order_messages',
    'client_portal_thread_reads','push_subscriptions'
  ]
  loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id)', t);
    execute format('update public.%I set tenant_id = %L where tenant_id is null', t, tid);
    execute format('create index if not exists %I on public.%I(tenant_id)', t || '_tenant_id_idx', t);
  end loop;
end $$;

drop policy "internal accounts can manage quotes" on public.quotes;
create policy "internal accounts can manage quotes" on public.quotes for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "internal accounts can manage contracts" on public.contracts;
create policy "internal accounts can manage contracts" on public.contracts for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "internal accounts can manage referrals" on public.referrals;
create policy "internal accounts can manage referrals" on public.referrals for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "internal accounts can manage invoice line items" on public.invoice_line_items;
create policy "internal accounts can manage invoice line items" on public.invoice_line_items for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "internal accounts can manage quote line items" on public.quote_line_items;
create policy "internal accounts can manage quote line items" on public.quote_line_items for all to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "internal accounts manage notification recipients" on public.notification_recipients;
create policy "internal accounts manage notification recipients" on public.notification_recipients for all to authenticated
  using (public.current_user_has_any_role() and tenant_id = public.current_tenant_id())
  with check (public.current_user_has_any_role() and tenant_id = public.current_tenant_id());

drop policy "internal accounts can view stripe customer mappings" on public.stripe_customers;
create policy "internal accounts can view stripe customer mappings" on public.stripe_customers for select to authenticated
  using (public.current_user_has_any_role() and tenant_id = public.current_tenant_id());

drop policy "clients or internal accounts can view card authorizations" on public.card_authorizations;
create policy "clients or internal accounts can view card authorizations" on public.card_authorizations for select to authenticated
  using (client_email = (select auth.email()) or (public.current_user_has_any_role() and tenant_id = public.current_tenant_id()));

drop policy "internal accounts can insert client account codes" on public.client_account_codes;
create policy "internal accounts can insert client account codes" on public.client_account_codes for insert to authenticated
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "internal accounts can update client account codes" on public.client_account_codes;
create policy "internal accounts can update client account codes" on public.client_account_codes for update to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
  with check (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "internal accounts can delete client account codes" on public.client_account_codes;
create policy "internal accounts can delete client account codes" on public.client_account_codes for delete to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "staff or own row can view client account codes" on public.client_account_codes;
create policy "staff or own row can view client account codes" on public.client_account_codes for select to authenticated
  using ((exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
         or email = (select auth.email()));

drop policy "Only logged-in can view or manage bookings" on public.th_bookings;
create policy "Only logged-in can view or manage bookings" on public.th_bookings for select to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
drop policy "Only logged-in can update bookings" on public.th_bookings;
create policy "Only logged-in can update bookings" on public.th_bookings for update to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
drop policy "Only logged-in can delete bookings" on public.th_bookings;
create policy "Only logged-in can delete bookings" on public.th_bookings for delete to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
drop policy "Staff can add bookings directly" on public.th_bookings;
create policy "Staff can add bookings directly" on public.th_bookings for insert to authenticated
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "Only logged-in can view or manage leads" on public.th_leads;
create policy "Only logged-in can view or manage leads" on public.th_leads for select to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
drop policy "Only logged-in can update leads" on public.th_leads;
create policy "Only logged-in can update leads" on public.th_leads for update to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
drop policy "Only logged-in can delete leads" on public.th_leads;
create policy "Only logged-in can delete leads" on public.th_leads for delete to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
-- "Anyone can submit a lead" (anon+authenticated INSERT, with_check
-- true) is intentionally left untouched -- see 04's default-value fix
-- for how this is handled without an RLS change here.

drop policy "Require login" on public.th_job_photos;
create policy "Require login" on public.th_job_photos for all to public
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()))
  with check ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "Internal accounts can view bug reports" on public.portal_bug_reports;
create policy "Internal accounts can view bug reports" on public.portal_bug_reports for select to authenticated
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
drop policy "Internal accounts can resolve bug reports" on public.portal_bug_reports;
create policy "Internal accounts can resolve bug reports" on public.portal_bug_reports for update to authenticated
  using ((select auth.role()) = 'authenticated' and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "Internal accounts can view portal client errors" on public.portal_client_errors;
create policy "Internal accounts can view portal client errors" on public.portal_client_errors for select to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "internal accounts can view quote questions" on public.quote_questions;
create policy "internal accounts can view quote questions" on public.quote_questions for select to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));
drop policy "internal accounts can resolve quote questions" on public.quote_questions;
create policy "internal accounts can resolve quote questions" on public.quote_questions for update to authenticated
  using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())) and tenant_id = (select public.current_tenant_id()));

drop policy "internal accounts or the owning user can manage push subscripti" on public.push_subscriptions;
create policy "internal accounts or the owning user can manage push subscripti" on public.push_subscriptions for all to authenticated
  using ((public.current_user_has_any_role() and tenant_id = public.current_tenant_id()) or user_id = (select auth.uid()))
  with check ((public.current_user_has_any_role() and tenant_id = public.current_tenant_id()) or user_id = (select auth.uid()));

drop policy "clients or internal accounts send job messages" on public.client_portal_job_messages;
create policy "clients or internal accounts send job messages" on public.client_portal_job_messages for insert to authenticated
  with check (
    (sender_type = 'client' and sender_email = (select auth.email())
     and exists (select 1 from public.client_portal_jobs j where j.id = client_portal_job_messages.job_id and j.client_email = (select auth.email())))
    or
    (sender_type = 'internal' and sender_email = (select auth.email())
     and public.current_user_has_any_role() and tenant_id = public.current_tenant_id())
  );

drop policy "clients or internal accounts send work order messages" on public.client_portal_work_order_messages;
create policy "clients or internal accounts send work order messages" on public.client_portal_work_order_messages for insert to authenticated
  with check (
    (sender_type = 'client' and sender_email = (select auth.email())
     and exists (select 1 from public.client_portal_work_orders wo where wo.id = client_portal_work_order_messages.work_order_id and wo.client_email = (select auth.email())))
    or
    (sender_type = 'internal' and sender_email = (select auth.email())
     and public.current_user_has_any_role() and tenant_id = public.current_tenant_id())
  );

drop policy "clients or internal accounts view thread reads" on public.client_portal_thread_reads;
create policy "clients or internal accounts view thread reads" on public.client_portal_thread_reads for select to authenticated
  using (client_email = (select auth.email()) or (public.current_user_has_any_role() and tenant_id = public.current_tenant_id()));

create or replace function public.internal_read_client_portal_invoices()
returns setof public.client_portal_invoices language sql security definer set search_path = public stable as $$
  select * from public.client_portal_invoices where public.current_user_has_any_role() and tenant_id = public.current_tenant_id();
$$;
create or replace function public.internal_read_client_portal_quotes()
returns setof public.client_portal_quotes language sql security definer set search_path = public stable as $$
  select * from public.client_portal_quotes where public.current_user_has_any_role() and tenant_id = public.current_tenant_id();
$$;
create or replace function public.internal_read_client_portal_jobs()
returns setof public.client_portal_jobs language sql security definer set search_path = public stable as $$
  select * from public.client_portal_jobs where public.current_user_has_any_role() and tenant_id = public.current_tenant_id();
$$;
create or replace function public.internal_read_client_portal_work_orders()
returns setof public.client_portal_work_orders language sql security definer set search_path = public stable as $$
  select * from public.client_portal_work_orders where public.current_user_has_any_role() and tenant_id = public.current_tenant_id();
$$;
create or replace function public.internal_read_client_portal_contracts()
returns setof public.client_portal_contracts language sql security definer set search_path = public stable as $$
  select * from public.client_portal_contracts where public.current_user_has_any_role() and tenant_id = public.current_tenant_id();
$$;
create or replace function public.internal_read_client_portal_checkups()
returns setof public.client_portal_checkups language sql security definer set search_path = public stable as $$
  select * from public.client_portal_checkups where public.current_user_has_any_role() and tenant_id = public.current_tenant_id();
$$;

revoke execute on function
  public.internal_read_client_portal_invoices(), public.internal_read_client_portal_quotes(),
  public.internal_read_client_portal_jobs(), public.internal_read_client_portal_work_orders(),
  public.internal_read_client_portal_contracts(), public.internal_read_client_portal_checkups()
  from public, anon;
grant execute on function
  public.internal_read_client_portal_invoices(), public.internal_read_client_portal_quotes(),
  public.internal_read_client_portal_jobs(), public.internal_read_client_portal_work_orders(),
  public.internal_read_client_portal_contracts(), public.internal_read_client_portal_checkups()
  to authenticated;

-- Child/denormalized tables: tenant_id via trigger, not the app. FOUND
-- BY LOCAL TESTING before this went live: a bare "tenant_id =
-- current_tenant_id()" check on a table the app never sends tenant_id
-- for is broken -- the column comes in null on insert, and null never
-- equals current_tenant_id(), so the insert is silently rejected even
-- for the row's own rightful tenant. Same class of bug as the #469
-- regression (an RLS change silently breaking a write path) -- caught
-- here specifically because this was tested end to end, not just
-- reasoned about. Fix: a BEFORE INSERT trigger derives tenant_id from
-- the parent row. MUST be SECURITY DEFINER -- the trigger's own SELECT
-- against the parent table is otherwise itself subject to that
-- parent's RLS, and staff generally can't read client_portal_* tables
-- directly (they go through the internal_read_* RPCs instead), so an
-- ordinary trigger would see zero rows and leave tenant_id null anyway.

create or replace function public.set_tenant_id_from_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select tenant_id into new.tenant_id from public.invoices where id = new.invoice_id;
  return new;
end;
$$;
drop trigger if exists set_tenant_id on public.invoice_line_items;
create trigger set_tenant_id before insert on public.invoice_line_items
  for each row execute function public.set_tenant_id_from_invoice();

create or replace function public.set_tenant_id_from_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select tenant_id into new.tenant_id from public.quotes where id = new.quote_id;
  return new;
end;
$$;
drop trigger if exists set_tenant_id on public.quote_line_items;
create trigger set_tenant_id before insert on public.quote_line_items
  for each row execute function public.set_tenant_id_from_quote();

create or replace function public.set_tenant_id_from_portal_job()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select tenant_id into new.tenant_id from public.client_portal_jobs where id = new.job_id;
  return new;
end;
$$;
drop trigger if exists set_tenant_id on public.client_portal_job_messages;
create trigger set_tenant_id before insert on public.client_portal_job_messages
  for each row execute function public.set_tenant_id_from_portal_job();

create or replace function public.set_tenant_id_from_portal_work_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select tenant_id into new.tenant_id from public.client_portal_work_orders where id = new.work_order_id;
  return new;
end;
$$;
drop trigger if exists set_tenant_id on public.client_portal_work_order_messages;
create trigger set_tenant_id before insert on public.client_portal_work_order_messages
  for each row execute function public.set_tenant_id_from_portal_work_order();
