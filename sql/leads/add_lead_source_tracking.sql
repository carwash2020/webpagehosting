-- Marketing-source-of-lead tracking, closing a real audit gap: the
-- referral program (referred_by) already tracks ONE specific source
-- (a friend/family referral, tied to the $25 reward ledger), but
-- there was no way to see how a customer found the business more
-- generally -- Google, Yelp, drove by, repeat customer, etc. Applied
-- directly via the Supabase MCP migration tool; recorded here after
-- the fact so the schema is reproducible from this repo, same
-- convention as every other file in this directory.
--
-- Both are plain nullable text columns, not an enum -- the same
-- reasoning as th_leads' existing `service` column (a fixed set of
-- options presented in the form's own <select>, but stored as free
-- text so a future new option never needs a schema migration to add).
alter table th_leads add column if not exists source text;
alter table th_bookings add column if not exists source text;
