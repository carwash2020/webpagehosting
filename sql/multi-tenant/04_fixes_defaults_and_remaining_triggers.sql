-- Multi-tenant Tier 0 (batch 4/5): default tenant_id for the anonymous,
-- pre-session capture tables (leads, bug reports, client errors) so
-- nothing lands null, plus the two remaining child-table triggers.
--
-- Verified live before this file was committed: the actual public
-- lead-capture and bug/error-report call sites (index.html,
-- portal-app.js, and every portal_bug_reports call site) never
-- request RETURNING (either explicitly via `Prefer: return=minimal`,
-- or implicitly by never chaining .select()) -- Postgres only
-- evaluates a table's SELECT policy when a statement includes
-- RETURNING, so none of these real call sites are affected by
-- current_tenant_id() being unreachable for anon. Confirmed directly:
-- a bare INSERT with no RETURNING succeeds for anon; the same INSERT
-- WITH RETURNING fails with `permission denied for function
-- current_tenant_id`. If a future edit ever adds `.select()` to one of
-- these three anonymous insert paths, it will hit that same error --
-- worth knowing if this file is ever revisited.

-- A subquery can't appear directly in a DEFAULT expression, hence the
-- wrapper function (STABLE, so the planner can treat it sensibly).
-- SECURITY DEFINER: anon (submitting a public lead form, correctly has
-- no read access to public.tenants at all) still needs this default to
-- resolve when its INSERT fires.
create or replace function public.default_tenant_id_triple_h()
returns uuid language sql security definer set search_path = public stable as $$
  select id from public.tenants where slug = 'triple-h';
$$;
grant execute on function public.default_tenant_id_triple_h() to anon, authenticated;

alter table public.th_leads
  alter column tenant_id set default public.default_tenant_id_triple_h();
alter table public.portal_bug_reports
  alter column tenant_id set default public.default_tenant_id_triple_h();
alter table public.portal_client_errors
  alter column tenant_id set default public.default_tenant_id_triple_h();

comment on column public.th_leads.tenant_id is
  'Defaults to Triple H (the only real tenant as of this migration). Remove the default and make the capture form send tenant_id explicitly once a second tenant''s public site exists.';
comment on column public.portal_bug_reports.tenant_id is
  'Defaults to Triple H (the only real tenant as of this migration). Remove the default and make the capture form send tenant_id explicitly once a second tenant''s portal exists.';
comment on column public.portal_client_errors.tenant_id is
  'Defaults to Triple H (the only real tenant as of this migration). Remove the default and make the capture form send tenant_id explicitly once a second tenant''s portal exists.';

-- Client-side email identity (client_profiles, client_portal_*,
-- client_account_codes' own-row branch, card_authorizations' client
-- branch): reassessed, not a real gap. A client's session resolves
-- from a single Supabase Auth account (auth.users.email is globally
-- unique across this whole project), and every client-side policy
-- (client_email = auth.email()) only ever returns THAT person's own
-- rows, tagged with whatever tenant they actually belong to per row. A
-- client who happens to be a customer of two tenants using this
-- product would correctly see both -- exactly like using one email
-- across two unrelated SaaS accounts. That's expected behavior, not
-- cross-tenant leakage. No RLS change needed here.

create or replace function public.set_tenant_id_from_portal_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select tenant_id into new.tenant_id from public.client_portal_quotes where id = new.quote_id;
  return new;
end;
$$;
drop trigger if exists set_tenant_id on public.quote_questions;
create trigger set_tenant_id before insert on public.quote_questions
  for each row execute function public.set_tenant_id_from_portal_quote();

-- client_portal_thread_reads' tenant comes from whichever thread type
-- the row is about (a work order or a job) -- branch on thread_type.
create or replace function public.set_tenant_id_from_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.thread_type = 'work_order' then
    select tenant_id into new.tenant_id from public.client_portal_work_orders where id = new.thread_id;
  elsif new.thread_type = 'job' then
    select tenant_id into new.tenant_id from public.client_portal_jobs where id = new.thread_id;
  end if;
  return new;
end;
$$;
drop trigger if exists set_tenant_id on public.client_portal_thread_reads;
create trigger set_tenant_id before insert on public.client_portal_thread_reads
  for each row execute function public.set_tenant_id_from_thread();
