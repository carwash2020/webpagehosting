-- UTM campaign-attribution tracking on leads and bookings, closing a
-- real gap: GA4 already attributes traffic sources for pageviews, but
-- that data lives only in GA4 -- there was no way to see "which
-- campaign's leads actually turned into paid jobs" without
-- cross-referencing two separate systems by hand. This stores the SAME
-- UTM values directly on the row a lead or booking actually creates.
--
-- Applied directly via the Supabase MCP migration tool; recorded here
-- after the fact so the schema is reproducible from this repo, same
-- convention as every other file in this directory.
--
-- Plain nullable text columns, matching the existing `source`/
-- `referred_by` columns' own convention -- a URL query parameter is
-- inherently free text with no fixed set of values (campaign names and
-- ad-platform source/medium values are entirely up to whoever built
-- the ad, not something this app controls), so an enum would only ever
-- reject a real, legitimate value.
--
-- Deliberately separate from the existing `source` column: that one is
-- a manual, customer-self-reported dropdown ("How did you hear about
-- us?") for channels with no URL at all. These utm_* columns are the
-- automatic, URL-driven counterpart captured by utm-tracking.js for
-- real UTM-tagged campaign traffic -- complementary data, not a
-- replacement for the existing field.
alter table th_leads add column if not exists utm_source text;
alter table th_leads add column if not exists utm_medium text;
alter table th_leads add column if not exists utm_campaign text;
alter table th_leads add column if not exists utm_term text;
alter table th_leads add column if not exists utm_content text;

alter table th_bookings add column if not exists utm_source text;
alter table th_bookings add column if not exists utm_medium text;
alter table th_bookings add column if not exists utm_campaign text;
alter table th_bookings add column if not exists utm_term text;
alter table th_bookings add column if not exists utm_content text;
