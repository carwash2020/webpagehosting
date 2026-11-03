-- Scoped workspace sync (handoff 2026-11-03 §2, Phase 2.4).
--
-- WHAT THIS FIXES. RLS on workspace_sync already refuses anyone who is not
-- signed in to an account listed in account_roles, so the hardcoded row key
-- 'tripleh-workspace-2026' is a label, not a credential. The gap: every
-- staff account can read and write the WHOLE blob -- invoices, income,
-- expenses, Runway -- whatever its Money switch says, because those
-- switches were only enforced in page JavaScript. This splits the blob into
-- two rows, each scoped by the signed-in person's own switches:
--   scope:ops    jobs, clients, contacts, notes, contracts, shifts, ...
--                -> any account in account_roles
--   scope:money  invoices, quotes, income, expenses, tax and set-aside
--                rates, Runway (rd_*), the graveyard and sync-conflict log
--                (both can hold copies of money records)
--                -> accounts with can_view_finance or can_manage_invoices
-- The old row stays, readable and writable only with money access, so
-- devices still on the old build keep syncing (dual-write; tools/sync.js
-- writes it too while SYNC_LEGACY_DUAL_WRITE is on). Retiring it is a
-- separate, later step (sql/sync/02_retire_legacy_row.sql, not written yet).
--
-- ADDITIVE AND RE-RUNNABLE: adds a nullable column, two rows (seeded from the
-- old row, only if missing), a helper function, and replaces one policy with
-- two. No data is deleted or rewritten; the old row is not touched.
--
-- The money key list below must match SYNC_MONEY_KEYS in tools/sync.js
-- (tests/sync/scoped-workspace-sync-db.test.js checks they agree). Every
-- other key is ops.

begin;

alter table public.workspace_sync add column if not exists scope text;
alter table public.workspace_sync drop constraint if exists workspace_sync_scope_check;
alter table public.workspace_sync add constraint workspace_sync_scope_check
  check (scope is null or scope in ('ops', 'money'));
create unique index if not exists workspace_sync_one_row_per_scope
  on public.workspace_sync (scope) where scope is not null;

create or replace function public.workspace_sync_money_keys() returns text[]
  language sql immutable as $$
  select array[
    'th_expense_tombstones', 'th_expense_log',
    'th_income_tombstones', 'th_income_log',
    'th_invoice_tombstones', 'th_invoices',
    'th_quote_tombstones', 'th_quotes',
    'th_tax_rate', 'th_tax_labor', 'th_tax_parts', 'th_setaside_rate',
    'rd_personal-expenses', 'rd_personal-income', 'rd_budget-settings',
    'rd_business-months', 'rd_emergency-fund', 'rd_debts',
    'th_graveyard', 'th_sync_conflicts'
  ]::text[];
$$;

-- Money access, read from the caller's own account_roles row. security
-- definer so the check works whatever account_roles' own RLS allows.
create or replace function public.current_user_has_money_access() returns boolean
  language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.account_roles ar
    where ar.email = (select auth.email())
      and (ar.can_view_finance or ar.can_manage_invoices)
  );
$$;
revoke all on function public.current_user_has_money_access() from public;
grant execute on function public.current_user_has_money_access() to authenticated;

-- Seed both rows from the old one (only if they don't exist yet).
insert into public.workspace_sync (code, scope, data, updated_at)
select 'scope:ops', 'ops',
       coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(ws.data) e
                 where not (e.key = any (public.workspace_sync_money_keys()))), '{}'::jsonb),
       ws.updated_at
from public.workspace_sync ws where ws.code = 'tripleh-workspace-2026'
on conflict (code) do nothing;

insert into public.workspace_sync (code, scope, data, updated_at)
select 'scope:money', 'money',
       coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(ws.data) e
                 where e.key = any (public.workspace_sync_money_keys())), '{}'::jsonb),
       ws.updated_at
from public.workspace_sync ws where ws.code = 'tripleh-workspace-2026'
on conflict (code) do nothing;

-- RLS, evaluated per signed-in person. Replaces the single "Require login"
-- policy (any internal account, every row).
drop policy if exists "Require login" on public.workspace_sync;
drop policy if exists "Ops row: any internal account" on public.workspace_sync;
drop policy if exists "Money row and legacy blob: money access only" on public.workspace_sync;

create policy "Ops row: any internal account" on public.workspace_sync
  for all to authenticated
  using (scope = 'ops' and exists (select 1 from public.account_roles ar where ar.email = (select auth.email())))
  with check (scope = 'ops' and exists (select 1 from public.account_roles ar where ar.email = (select auth.email())));

create policy "Money row and legacy blob: money access only" on public.workspace_sync
  for all to authenticated
  using ((scope = 'money' or scope is null) and (select public.current_user_has_money_access()))
  with check ((scope = 'money' or scope is null) and (select public.current_user_has_money_access()));

commit;
