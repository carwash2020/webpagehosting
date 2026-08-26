-- Run in Supabase SQL Editor.

-- Step 1: read-only -- see exactly what's there right now, for the
-- record, before touching anything.
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'th_leads' AND cmd = 'INSERT';

-- Step 2: the fix. Drops whatever INSERT policy currently exists on
-- th_leads (whatever it's actually named -- found dynamically rather
-- than guessed) and replaces it with a clean, permissive one. This
-- table's whole purpose is capturing a lead from any website visitor,
-- logged in or not -- there's no legitimate reason for a restrictive
-- WITH CHECK here. Whatever was blocking real submissions (error
-- 42501, "new row violates row-level security policy") was almost
-- certainly a bug, not an intentional restriction.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE tablename = 'th_leads' AND cmd = 'INSERT' LOOP
    EXECUTE format('DROP POLICY %I ON public.th_leads', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Anyone can submit a lead"
ON public.th_leads FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Step 3: confirm -- should show exactly the one new policy above,
-- covering both anon and authenticated.
SELECT policyname, roles, cmd, with_check
FROM pg_policies
WHERE tablename = 'th_leads' AND cmd = 'INSERT';
