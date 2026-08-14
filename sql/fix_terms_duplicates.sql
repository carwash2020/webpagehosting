-- Run in Supabase SQL Editor.
--
-- Root cause: the Terms seed SQL used "ON CONFLICT DO NOTHING", but
-- site_terms has no actual unique constraint for Postgres to check
-- against (only the auto-generated id, which is different every time).
-- That made "safe to re-run" false for this file specifically -- it ran
-- twice, so every section got inserted twice.

-- Step 1: see exactly what will be deleted, before deleting anything.
-- This is read-only -- run it first and look at the result.
SELECT id, heading, sort_order
FROM public.site_terms
WHERE id NOT IN (SELECT MIN(id) FROM public.site_terms GROUP BY heading, body)
ORDER BY heading;
-- Expect: exactly 16 rows -- one duplicate per section, all the
-- higher-numbered id in each pair (the second copy that got inserted).

-- Step 2: the actual fix. Keeps the FIRST copy of each (heading, body)
-- pair (lowest id), removes the duplicate.
DELETE FROM public.site_terms
WHERE id NOT IN (SELECT MIN(id) FROM public.site_terms GROUP BY heading, body);

-- Step 3: confirm it worked.
SELECT count(*) FROM public.site_terms;
-- Expect: 16 now, not 32.

-- Step 4: add a REAL unique constraint, so this specific failure mode
-- can never happen again for this table -- re-running the seed file
-- (or the site_terms half of any future SQL) will now correctly no-op
-- via ON CONFLICT instead of silently duplicating everything again.
ALTER TABLE public.site_terms ADD CONSTRAINT site_terms_heading_unique UNIQUE (heading);
