-- Run in Supabase SQL Editor.
--
-- Root cause: when I extracted the original Terms content to seed this
-- table, the "15. Contact" section's paragraph in the live HTML had
-- actual <a> link tags embedded in it (for the phone/email
-- auto-update feature) -- my extraction pulled that raw markup in as
-- literal text instead of stripping it to plain text first. The public
-- site then correctly escaped it for safety (so it couldn't execute as
-- real HTML), which is exactly why it's showing up as visible tag
-- text instead of a rendered link.

-- Step 1: see the current (broken) value first.
SELECT id, heading, body FROM public.site_terms WHERE heading = '15. Contact';

-- Step 2: fix it -- plain, readable text, matching the same approach
-- already used for the 2 FAQ answers that mention the phone number
-- (a known, accepted tradeoff: this section won't auto-update if the
-- phone/email fields change later; edit it directly if either one
-- does, same note already sitting in the Terms editor's own panel).
UPDATE public.site_terms
SET body = 'Questions about these terms can be directed to steve@triplehenterprisesllc.biz or (435) 414-1667.'
WHERE heading = '15. Contact';

-- Step 3: confirm.
SELECT id, heading, body FROM public.site_terms WHERE heading = '15. Contact';
