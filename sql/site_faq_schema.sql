-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.site_faq (
  id bigserial PRIMARY KEY,
  question text NOT NULL,
  answer text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.site_faq ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read FAQ" ON public.site_faq;
CREATE POLICY "Anyone can read FAQ"
ON public.site_faq FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Only logged-in can edit FAQ" ON public.site_faq;
CREATE POLICY "Only logged-in can edit FAQ"
ON public.site_faq FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Same audit-trail approach as site_content -- a trigger, not something
-- the editing UI writes by hand, so it catches every real change.
CREATE TABLE IF NOT EXISTS public.site_faq_history (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  faq_id bigint,
  question text,
  old_answer text,
  new_answer text,
  changed_by text,
  changed_at timestamptz DEFAULT now()
);

ALTER TABLE public.site_faq_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only logged-in can read FAQ history" ON public.site_faq_history;
CREATE POLICY "Only logged-in can read FAQ history"
ON public.site_faq_history FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.log_site_faq_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO public.site_faq_history (action, faq_id, question, old_answer, changed_by)
    VALUES ('delete', OLD.id, OLD.question, OLD.answer, auth.jwt() ->> 'email');
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO public.site_faq_history (action, faq_id, question, new_answer, changed_by)
    VALUES ('insert', NEW.id, NEW.question, NEW.answer, auth.jwt() ->> 'email');
  ELSIF (TG_OP = 'UPDATE' AND OLD.answer IS DISTINCT FROM NEW.answer) THEN
    INSERT INTO public.site_faq_history (action, faq_id, question, old_answer, new_answer, changed_by)
    VALUES ('update', NEW.id, NEW.question, OLD.answer, NEW.answer, auth.jwt() ->> 'email');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS site_faq_change_trigger ON public.site_faq;
CREATE TRIGGER site_faq_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.site_faq
FOR EACH ROW
EXECUTE FUNCTION public.log_site_faq_change();

-- Seed with ALL 12 FAQ items currently hardcoded on the live site --
-- every one of them, so nothing visitors currently see disappears the
-- moment this table gets its first row. Once seeded, index.html reads
-- from here instead of its own static markup; the static markup stays
-- as the fallback if this table is ever empty or unreachable.
INSERT INTO public.site_faq (question, answer, sort_order) VALUES
('Do you offer estimates before starting work?', 'Pricing is set once the problem has been diagnosed. Some jobs can be estimated over the phone, but many issues need an in-person look before a firm price can be given. Either way, you''ll know the cost before any work begins.', 1),
('How far in advance do I need to book?', 'Availability can vary, so booking at least 7 days out is preferred when possible. If something can''t wait, call or text (435) 414-1667 directly instead of using the online scheduling options.', 2),
('What areas do you serve?', 'St. George, Hurricane, Washington, Santa Clara, and the surrounding Southern Utah area. We can also take on larger jobs in Cedar City or Mesquite, NV by request, just contact us to check availability and scheduling.', 3),
('Do you guarantee your work?', 'Yes, work is guaranteed. Parts used are covered under whatever warranty the manufacturer sets, which can vary by part.', 4),
('What payment methods do you accept?', 'Cash, check, Venmo, and Cash App are all accepted, along with credit and debit cards via a secure Stripe invoice.', 5),
('What''s your cancellation policy?', 'Plans change, and that''s okay, just try to give as much notice as possible. A $50 cancellation fee may apply if a scheduled visit is cancelled the same day as the appointment.', 6),
('Is there a trip fee?', 'Jobs within 15 miles have no trip fee. Beyond 15 miles, a $25 trip fee is added to the total.', 7),
('What if the job I need isn''t listed in your services?', 'Reach out anyway. There''s a good chance it can still be handled, and if not, you''ll get an honest answer and pointed in the right direction.', 8),
('Do I need to be home while the work is being done?', 'For most jobs, yes, especially anything involving appliance diagnostics or work inside the home. For simple exterior or pre-arranged jobs, other arrangements can sometimes be made. Just ask when scheduling.', 9),
('Can I text instead of call?', 'Yes, texting (435) 414-1667 works great for quick questions, photos of the issue, or scheduling. Use the "Text Us" bubble on the site from a phone, or just text the number directly.', 10),
('Do you offer emergency or same-day service?', 'Yes, for things that can''t wait, like an active leak or a fridge that''s failed. Call or text directly rather than booking online so it gets seen right away.', 11),
('What''s the best way to schedule a job?', 'Whichever is easiest for you. Use "Book Instantly" to pick an open time slot, fill out the request form for something more detailed, or just call or text (435) 414-1667 directly.', 12)
ON CONFLICT DO NOTHING;
