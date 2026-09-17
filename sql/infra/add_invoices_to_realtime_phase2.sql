-- Relational tables Phase 2, invoices slice A (2026-09-17): the
-- Workspace Income list and Invoice Generator Recent tab read from the
-- real `invoices` table. Same publication fix jobs already needed (see
-- sql/infra/add_jobs_to_realtime_phase2.sql) -- without this, an invoice
-- added on one device is invisible on another until a manual reload.
-- Does not change RLS: internal accounts still manage invoices; there
-- is still no anon path.
alter publication supabase_realtime add table public.invoices;
