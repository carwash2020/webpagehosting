-- Item 1 Phase 1a step 2: jobs/invoices/quotes' client_id moves from the
-- old free-text `'c_…'` registry id to the real uuid FK into `clients`.
--
-- Step 1 (01_clients_table_and_legacy_client_id.sql) left client_id as text
-- and added legacy_client_id as its permanent copy, specifically so a tab
-- running old cached sync.js (which used to write client_id directly)
-- wouldn't fail its save with a type error. The copy_client_id_to_legacy
-- trigger logged every such write into legacy_client_id_writes so this step
-- would know when it was safe to run.
--
-- Confirmed live before this file was written: legacy_client_id_writes has
-- zero rows -- no old tab has written client_id directly in the 12 days
-- since step 1 shipped (2026-09-30 -> 2026-10-12). The current sync.js
-- (tools/sync.js) only ever sends legacy_client_id for these three tables,
-- never client_id, so nothing live writes the column this step removes.
--
-- DEPLOY NOTE (2026-10-12): applying this file hit a tool-level issue where
-- every DROP statement (DROP COLUMN, DROP TRIGGER, DROP FUNCTION, DROP
-- TABLE) hung until timeout against the live project, while ADD COLUMN,
-- UPDATE, RENAME COLUMN, CREATE INDEX and CREATE OR REPLACE FUNCTION all
-- ran instantly -- not a lock or data issue (checked pg_locks/pg_stat_activity,
-- found nothing blocking). Deployed with the same end *behavior* via a
-- workaround instead of literally running this file statement-for-statement:
--   * the old text client_id was renamed to client_id_old_text (not dropped)
--     on all three tables, then client_id_uuid renamed into the client_id
--     slot -- same resulting column, same data, same type.
--   * the copy_client_id_to_legacy trigger was DISABLED (not dropped) on
--     all three tables, and its function body replaced (CREATE OR REPLACE,
--     not a drop) with a no-op, so it's inert even if ever re-enabled by
--     mistake.
--   * legacy_client_id_writes and the original trigger function definition
--     were left in place (inert, unused) rather than dropped.
-- Real cleanup (actually DROP client_id_old_text, the disabled trigger, its
-- function, and legacy_client_id_writes) is still owed as a follow-up, once
-- DROP works again against this project -- nothing reads any of these
-- leftover objects today, so there's no urgency, but this file's literal
-- statements don't match the live schema until that follow-up runs.

-- ---------------------------------------------------------------------------
-- 1. Add the real FK column, backfill it from legacy_client_id, drop the
--    old text column, and give the new one the old column's name.
--
-- Resolution: legacy_client_id holds the old registry's 'c_…' id, which
-- matches exactly one clients.legacy_id (Phase 1b seeded one client row per
-- legacy_id, never more). If that client has since been merged into another
-- (clients.merged_into_id), merges never chain (03_client_review_actions.sql
-- repoints every merged_into_id to the final survivor when a merge-of-a-merge
-- happens), so a single coalesce reaches the live row.
--
-- A legacy_client_id with no matching clients.legacy_id (a client deleted
-- before Phase 1b's seed ran) leaves client_id null, same as today -- it's
-- the same known, already-documented unmatched remainder from Phase 1b, not
-- a new gap this step creates.
do $$
declare
  t text;
begin
  foreach t in array array['jobs', 'invoices', 'quotes'] loop
    execute format('alter table public.%I add column if not exists client_id_uuid uuid references public.clients(id)', t);
    execute format(
      'update public.%I j set client_id_uuid = coalesce(c.merged_into_id, c.id) '
      'from public.clients c where c.legacy_id = j.legacy_client_id and j.client_id_uuid is null', t);
    execute format('alter table public.%I drop column client_id', t);
    execute format('alter table public.%I rename column client_id_uuid to client_id', t);
    execute format('create index if not exists %I_client_id_idx on public.%I (client_id) where client_id is not null', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Remove the step-1 transition machinery. Its job (log any old-tab write
--    of the now-gone text client_id) is finished -- there's no text column
--    left to write to, so the trigger would just error on NEW.client_id being
--    the wrong type if left in place.
do $$
declare
  t text;
begin
  foreach t in array array['jobs', 'invoices', 'quotes'] loop
    execute format('drop trigger if exists copy_client_id_to_legacy on public.%I', t);
  end loop;
end;
$$;
drop function if exists public.copy_client_id_to_legacy();
drop table if exists public.legacy_client_id_writes;

comment on column public.jobs.client_id is
  'Real FK into clients(id). legacy_client_id is kept alongside it (not this step''s to remove) -- it''s still read as a display fallback by tools/sync.js''s relational-read functions until Phase 2 replaces that with a real clients join.';
comment on column public.invoices.client_id is
  'Real FK into clients(id). legacy_client_id is kept alongside it (not this step''s to remove) -- it''s still read as a display fallback by tools/sync.js''s relational-read functions until Phase 2 replaces that with a real clients join.';
comment on column public.quotes.client_id is
  'Real FK into clients(id). legacy_client_id is kept alongside it (not this step''s to remove) -- it''s still read as a display fallback by tools/sync.js''s relational-read functions until Phase 2 replaces that with a real clients join.';
