-- Phase 3 of the client-portal roadmap (docs/CLIENT-PORTAL.md):
-- scheduling the job from an approved quote. Applied directly via the
-- Supabase MCP migration tool; recorded here after the fact, same
-- convention as the other files in sql/portal/.

-- client_address: the Quote form (tools/invoice-generator.html) always
-- had this field (quoteClientAddress) -- it just never got synced to
-- the portal since nothing needed it until now. A real handyman visit
-- needs an address; without this the client would have to re-type it
-- during scheduling for no reason.
alter table client_portal_quotes add column client_address text;

-- scheduled_at: set only by schedule-quote-job (service role), never
-- by the client's own session -- lets the portal know not to show the
-- scheduling flow again on a later visit for the same quote.
alter table client_portal_quotes add column scheduled_at timestamptz;

-- th_bookings.quote_id: a REAL foreign key, unlike th_bookings'
-- existing job_id (a deliberately loose, unenforced reference,
-- documented as such, since th_jobs lives only in the workspace_sync
-- JSON blob and can't be a real FK target). quote_id can be a real FK
-- because client_portal_quotes is a real table.
alter table th_bookings add column quote_id bigint references client_portal_quotes(id);
