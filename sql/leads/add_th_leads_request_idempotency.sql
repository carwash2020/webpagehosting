-- Real gap found in a full-repo audit: th_leads' contact-form insert
-- (index.html) has no server-side uniqueness guard at all against a
-- duplicate submission of the same lead -- a slow/flaky connection
-- retrying the same POST, or a visitor reloading the page and
-- resubmitting before realizing their first attempt actually worked,
-- both produce a second th_leads row. Worse than a cosmetic duplicate:
-- a database trigger fires an Edge Function that emails Steve and
-- Connor on every single insert, so a duplicate submission means a
-- second, redundant "new lead" email and double follow-up work.
--
-- client_request_id is a client-generated idempotency key (persisted
-- in sessionStorage per browser tab, not regenerated until a
-- submission actually succeeds), not a hash of the lead's own fields
-- -- a real customer submitting two DIFFERENT leads with the same
-- phone/email on the same day must never be blocked by this.
--
-- Applied directly via the Supabase MCP migration tool; recorded here
-- after the fact so the schema is reproducible from this repo, same
-- convention as every other file in this directory.
alter table th_leads add column if not exists client_request_id uuid;

-- Partial unique index: only enforces uniqueness on rows that actually
-- provide a client_request_id, so every historical lead row (which has
-- no such value) is completely unaffected.
create unique index if not exists th_leads_client_request_id_key
  on th_leads (client_request_id)
  where client_request_id is not null;
