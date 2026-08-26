-- Run in Supabase SQL Editor.
CREATE TABLE IF NOT EXISTS public.site_terms (
  id bigserial PRIMARY KEY,
  heading text NOT NULL,
  body text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.site_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read terms" ON public.site_terms;
CREATE POLICY "Anyone can read terms"
ON public.site_terms FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Only logged-in can edit terms" ON public.site_terms;
CREATE POLICY "Only logged-in can edit terms"
ON public.site_terms FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.site_terms_history (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  term_id bigint,
  heading text,
  old_body text,
  new_body text,
  changed_by text,
  changed_at timestamptz DEFAULT now()
);

ALTER TABLE public.site_terms_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only logged-in can read terms history" ON public.site_terms_history;
CREATE POLICY "Only logged-in can read terms history"
ON public.site_terms_history FOR SELECT
TO authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.log_site_terms_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO public.site_terms_history (action, term_id, heading, old_body, changed_by)
    VALUES ('delete', OLD.id, OLD.heading, OLD.body, auth.jwt() ->> 'email');
  ELSIF (TG_OP = 'INSERT') THEN
    INSERT INTO public.site_terms_history (action, term_id, heading, new_body, changed_by)
    VALUES ('insert', NEW.id, NEW.heading, NEW.body, auth.jwt() ->> 'email');
  ELSIF (TG_OP = 'UPDATE' AND OLD.body IS DISTINCT FROM NEW.body) THEN
    INSERT INTO public.site_terms_history (action, term_id, heading, old_body, new_body, changed_by)
    VALUES ('update', NEW.id, NEW.heading, OLD.body, NEW.body, auth.jwt() ->> 'email');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS site_terms_change_trigger ON public.site_terms;
CREATE TRIGGER site_terms_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.site_terms
FOR EACH ROW
EXECUTE FUNCTION public.log_site_terms_change();

-- Seed with all 16 sections currently on the live site (the intro
-- "Business Information" paragraph plus all 15 numbered sections),
-- exactly as they read today.
INSERT INTO public.site_terms (heading, body, sort_order) VALUES
('Business Information', 'Triple H Enterprises LLC is a domestic limited liability company registered with the Utah Department of Commerce, Division of Corporations and Commercial Code (Entity Number 14711750-0160).', 1),
('1. Scope of Work', 'Work performed is limited to what is discussed and agreed upon at the time of scheduling or in a written estimate. Any additional work requested during a visit will be discussed and approved before it begins.', 2),
('2. Estimates and Pricing', 'Estimates are based on the information provided at the time of booking. Final pricing may vary if the actual scope of work differs once the job is inspected in person. Any change in price will be communicated before additional work proceeds.', 3),
('3. Payment Terms', 'Payment is due upon completion of the work unless otherwise agreed in advance. Cash, check, Venmo, Cash App, and credit or debit cards (via a secure Stripe invoice) are accepted.', 4),
('4. Scheduling and Cancellations', 'Appointments are scheduled based on availability. If you need to cancel or reschedule, please provide as much notice as possible so the time slot can be offered to another customer. A $50 cancellation fee may apply if an appointment is cancelled the same day as the scheduled service.', 5),
('5. Access to Property', 'Customers are responsible for providing safe and reasonable access to the work area, including any necessary parking, entry, or utility access needed to complete the job.', 6),
('6. Materials and Permits', 'Unless otherwise agreed, materials required for a job are the customer''s responsibility to provide or purchase, or will be quoted separately. Some projects may require permits or licensed trade professionals (such as electrical or plumbing work beyond basic repairs); customers will be informed if a job falls outside the scope of general handyman work.', 7),
('7. Workmanship', 'Work is guaranteed. Parts used are covered under whatever warranty the manufacturer sets, which can vary by part. Any concerns about completed work should be raised as soon as possible so they can be addressed.', 8),
('8. Limitation of Liability', 'While every effort is made to complete work safely and correctly, liability for pre-existing conditions, hidden damage not visible at the time of inspection, or issues arising from normal wear and tear is limited. Customers are encouraged to disclose any known issues with the property before work begins.', 9),
('9. Delays', 'Delays caused by weather, parts availability, or circumstances outside of reasonable control will be communicated as soon as they are known.', 10),
('10. Photos and Media', 'Before-and-after photos of completed work may be taken and used for marketing purposes, including the website, social media, and advertising. Customer names and specific addresses are never shared. Let us know before work begins if you''d prefer photos not be taken.', 11),
('11. Third-Party Services', 'Online booking, invoicing/payment processing, and website contact forms are handled through third-party platforms, including Cal.com, Stripe, and Formspree. Information submitted through these tools is subject to those providers'' own privacy practices, and Triple H Enterprises is not responsible for outages or issues originating from these third-party services.', 12),
('12. Cookies and Analytics', 'This website uses Google Analytics to understand general site traffic, such as which pages are visited and how visitors arrive at the site. This may involve cookies or similar technologies. No personal information submitted through the contact or scheduling forms is shared with Google Analytics. Visitors who prefer to opt out of analytics tracking can do so using their browser''s privacy settings or a browser extension such as Google''s Analytics Opt-out add-on.', 13),
('13. Missed Appointments', 'If no one is available at the scheduled time and access cannot be arranged, the visit may be treated as a same-day cancellation, and the $50 fee outlined above may apply.', 14),
('14. Changes to These Terms', 'These terms may be updated from time to time. The most current version will always be available on this website.', 15),
('15. Contact', 'Questions about these terms can be directed to <a class="js-email-link" href="mailto:steve@triplehenterprisesllc.biz" style="color:var(--blue-light);"><span class="js-email-text">steve@triplehenterprisesllc.biz</span></a> or <a class="js-phone-link" href="tel:+14354141667" style="color:var(--blue-light);"><span class="js-phone-text">(435) 414-1667</span></a>.', 16)
ON CONFLICT DO NOTHING;
