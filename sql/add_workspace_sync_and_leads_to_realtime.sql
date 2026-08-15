-- sync.js has always subscribed to postgres_changes on workspace_sync
-- and th_leads, expecting live cross-device updates -- neither table
-- was ever added to the supabase_realtime publication, so this was
-- silently non-functional. Run 2026-08-15.

alter publication supabase_realtime add table public.workspace_sync;
alter publication supabase_realtime add table public.th_leads;

-- Also cleaned up in the same session: a stale, long-abandoned
-- workspace_sync row under an old sync code, untouched for 16 days and
-- referenced nowhere in the current app code.
-- delete from public.workspace_sync where code = 'TripleH2026';
