-- Declining a quote in the client portal used to be a one-way dead end
-- (direct request, 2026-09-19, from a portal audit finding): no text
-- field for why, so Steve never learned what changed the client's mind
-- and had no lead to reconsider or follow up on beyond a cold call.
-- This column captures an optional reason, set by respond-to-quote
-- (edge function) when action = 'decline'.

alter table public.client_portal_quotes add column if not exists decline_reason text;
