-- Fix plan RP3.12 (2026-11-07): the clients table is not a dead mirror -- it
-- is the client registry behind the Clients page's duplicate review, and the
-- client_id on payments, invoices and card authorizations. It was seeded
-- once (sql/item1/02) and never again, so clients added in the Workspace
-- since 2026-09-26 are missing (live 2026-11-07: 11 rows; 8 Workspace
-- clients absent, 2 of them TEST).
--
-- WRITES REAL CLIENT DATA: approved on its own. It only ADDS rows for
-- clients not already there (the seed skips anything it already has, by
-- legacy id, contact id, portal email or name), then refreshes the
-- duplicate-review list. Nothing is changed or deleted. The 2 TEST clients
-- come in too and leave with the other TEST records (D9, Group 6).
--
-- Run the preview first; apply only if it lists the expected new names.
--
--   select c ->> 'id' as legacy_id, c ->> 'name' as name
--     from public.workspace_sync w,
--          jsonb_array_elements(coalesce((w.data ->> 'th_clients')::jsonb, '[]'::jsonb)) c
--    where w.code = 'tripleh-workspace-2026'
--      and not exists (select 1 from public.clients x where x.legacy_id = c ->> 'id');
--
-- UNDO: delete from public.clients where created_by_seed_run = ... is not
-- possible (the seed records no run id); the new rows can be found by
-- seed_source and created_at > the apply time, and removed by hand if needed.

select public.item1_seed_clients((select id from public.tenants where slug = 'triple-h'), 'tripleh-workspace-2026');
select public.refresh_client_duplicate_candidates((select id from public.tenants where slug = 'triple-h'));
