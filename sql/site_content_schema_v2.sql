-- Run this in the Supabase SQL Editor. Safe to run even if the original
-- (v1) site_content table already exists -- everything here uses
-- IF NOT EXISTS / ON CONFLICT DO NOTHING so it won't error or duplicate.

CREATE TABLE IF NOT EXISTS public.site_content (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read site content" ON public.site_content;
CREATE POLICY "Anyone can read site content"
ON public.site_content FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Only logged-in can edit site content" ON public.site_content;
CREATE POLICY "Only logged-in can edit site content"
ON public.site_content FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Every field this build covers. Blank/null means "use whatever's
-- already hardcoded in the page" for phone/email/hours, or "don't show
-- it" for the banners.
INSERT INTO public.site_content (key, value) VALUES
  ('phone', null),
  ('email', null),
  ('hoursLine1', null),
  ('hoursLine2', null),
  ('banner1', null),
  ('banner2', null)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- Audit history -- a permanent record of every change, who made it,
-- and what it was before. Built as a database trigger rather than
-- something the editing UI writes by hand, specifically so it catches
-- ANY edit to this table regardless of what made it (this UI, a future
-- UI, or someone running SQL directly) -- an audit log that only the
-- one "correct" code path writes to isn't a real audit log.

CREATE TABLE IF NOT EXISTS public.site_content_history (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  old_value text,
  new_value text,
  changed_by text,
  changed_at timestamptz DEFAULT now()
);

ALTER TABLE public.site_content_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only logged-in can read history" ON public.site_content_history;
CREATE POLICY "Only logged-in can read history"
ON public.site_content_history FOR SELECT
TO authenticated
USING (true);
-- No INSERT/UPDATE/DELETE policy for any role -- this table is only
-- ever written to by the trigger function below (which runs as
-- SECURITY DEFINER, so it doesn't need its own grant), not directly by
-- any client. That's deliberate: an audit log a client can edit isn't
-- trustworthy as an audit log.

CREATE OR REPLACE FUNCTION public.log_site_content_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.value IS DISTINCT FROM NEW.value) THEN
    INSERT INTO public.site_content_history (key, old_value, new_value, changed_by)
    VALUES (NEW.key, OLD.value, NEW.value, auth.jwt() ->> 'email');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_content_change_trigger ON public.site_content;
CREATE TRIGGER site_content_change_trigger
AFTER UPDATE ON public.site_content
FOR EACH ROW
EXECUTE FUNCTION public.log_site_content_change();

-- This is a genuine trigger function (RETURNS trigger), so per Postgres
-- itself it can't be called directly via SQL/RPC regardless of grants --
-- same reasoning already confirmed for notify_new_lead earlier in this
-- project. No REVOKE needed here for that reason.
