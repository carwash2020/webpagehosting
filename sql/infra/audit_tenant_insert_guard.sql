-- READ-ONLY. Live counterpart to tests/sync/tenant-insert-guard.test.js.
--
-- Lists every public table whose INSERT/ALL RLS policy checks
-- current_tenant_id() but which has neither a tenant_id default nor a
-- set_tenant_id trigger. Those tables reject every app insert and upsert with
-- 42501 (the Tier 0 bug fixed by sql/multi-tenant/06, 2026-09-30).
--
-- The repo test only sees committed SQL. Run this after any change made by
-- hand in the SQL editor. It must return zero rows.

with guarded as (
  select p.tablename, string_agg(p.policyname, ', ') as policies
  from pg_policies p
  where p.schemaname = 'public'
    and p.cmd in ('INSERT', 'ALL')
    and coalesce(p.with_check, p.qual) ilike '%current_tenant_id%'
  group by p.tablename
)
select g.tablename, g.policies
from guarded g
where not exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = g.tablename
          and c.column_name = 'tenant_id' and c.column_default is not null)
  and not exists (
        select 1 from pg_trigger t
        join pg_class k on k.oid = t.tgrelid
        where k.relnamespace = 'public'::regnamespace and k.relname = g.tablename
          and t.tgname = 'set_tenant_id' and not t.tgisinternal)
order by 1;
