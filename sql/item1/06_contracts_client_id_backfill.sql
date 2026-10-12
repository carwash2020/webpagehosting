-- Item 1 Phase 1a cleanup: backfill contracts.client_id.
--
-- 01_clients_table_and_legacy_client_id.sql added contracts.client_id (uuid
-- FK into clients) and contracts.legacy_client_id (the old 'c_...' registry
-- id, written by tools/sync.js's mirrorContractToRelational()) at the same
-- time. But unlike jobs/invoices/quotes -- which got their matching backfill
-- in 05_client_id_uuid_fk.sql's step 2 -- nothing ever backfilled
-- contracts.client_id from contracts.legacy_client_id. Caught while
-- double-checking Phase 1a step 2 was fully closed out: live data shows only
-- 1 contract today and it has no legacy_client_id set yet, so this has been
-- silently harmless so far, but the next contract that links a client would
-- get a legacy_client_id with no matching client_id, same gap jobs/invoices/
-- quotes had before 05.
--
-- Same resolution as 05: legacy_client_id matches exactly one
-- clients.legacy_id (Phase 1b seeded one client row per legacy_id), and
-- merges never chain (03_client_review_actions.sql repoints every
-- merged_into_id to the final survivor), so a single coalesce reaches the
-- live row. A legacy_client_id with no matching clients.legacy_id leaves
-- client_id null, same as the known Phase 1b unmatched remainder.
update public.contracts c
set client_id = coalesce(cl.merged_into_id, cl.id)
from public.clients cl
where cl.legacy_id = c.legacy_client_id
  and c.client_id is null
  and c.legacy_client_id is not null;
