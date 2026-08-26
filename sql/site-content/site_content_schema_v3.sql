-- Run in Supabase SQL Editor. Safe to re-run (idempotent).
-- Adds the 7 independent per-day hours fields, replacing the old
-- 2-line hoursLine1/hoursLine2 pair. Those 2 old rows are left in
-- place (unused, harmless) rather than deleted, in case anything
-- still references them.

INSERT INTO public.site_content (key, value) VALUES
  ('hoursMonday', null),
  ('hoursTuesday', null),
  ('hoursWednesday', null),
  ('hoursThursday', null),
  ('hoursFriday', null),
  ('hoursSaturday', null),
  ('hoursSunday', null)
ON CONFLICT (key) DO NOTHING;
