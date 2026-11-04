-- Card payment wording (2026-11-04, Phase 3.4 decision 9). APPLIED
-- 2026-11-04 18:00 UTC with Connor's approval ("apply the faq sql"); both
-- rows read back with the new text. The public pages' static copies were
-- updated in the repo; the live FAQ and Terms are read from these two rows
-- (index.html fetches site_faq and site_terms).
--
-- Each UPDATE only touches the row while it still holds the old text, so
-- running it twice, or after someone edited the row, changes nothing.

begin;

update public.site_faq
   set answer = 'Cash, check, Venmo, and Cash App are all accepted, along with credit and debit cards: in person when the job is done, or online through the secure pay link on your invoice. Card payments are processed by Stripe.',
       updated_at = now()
 where id = 5
   and answer = 'Cash, check, Venmo, and Cash App are all accepted, along with credit and debit cards via a secure Stripe invoice.';

update public.site_terms
   set body = 'Payment is due upon completion of the work unless otherwise agreed in advance. Cash, check, Venmo, Cash App, and credit or debit cards (in person, or online through the secure pay link on your invoice; card payments are processed by Stripe) are accepted.',
       updated_at = now()
 where id = 4
   and body = 'Payment is due upon completion of the work unless otherwise agreed in advance. Cash, check, Venmo, Cash App, and credit or debit cards (via a secure Stripe invoice) are accepted.';

-- Check: both should return the new text.
select id, answer from public.site_faq where id = 5;
select id, body from public.site_terms where id = 4;

commit;
