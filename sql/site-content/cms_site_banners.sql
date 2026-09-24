-- Site banners: the new-customer offer and hiring notice become editable
-- (2026-09-23).
--
-- The two bars above the header (#siteBanner1, #siteBanner2) used to be
-- two things fighting over the same slots: promo-banner.js and
-- hiring-banner.js wrote fixed wording into them, and a banner1/banner2
-- value from Tools > Site Content silently replaced that wording (close
-- button and all) whenever it was set. js/site-banners.js now owns both
-- slots, and each one has three settings here:
--   banner1Mode / banner2Mode  'builtin' (the wording in js/site-banners.js),
--                              'custom' (the message below), or 'off'
--   banner1 / banner2          the custom message (unchanged: one line, 200 max)
--   banner1Link / banner2Link  optional link at the end of a custom message,
--                              one of a fixed list of pages on this site
--
-- Additive: the validator gains branches for the four new keys (every
-- existing value still passes), and the four rows are seeded so the
-- editor can write them (cms_publish_content only writes existing keys).
-- The modes start as 'builtin', which is what the site shows today.
--
-- Depends on sql/site-content/cms_safe_publish_and_undo.sql.

-- Same rules as before, plus:
--   banner*Mode: builtin, custom, or off
--   banner*Link: one of the pages in BANNER_LINKS (tools/site-content.html)
--                and LINKS (js/site-banners.js). A fixed list, so a banner
--                can never link anywhere off the site.
create or replace function public.site_content_value_is_valid(p_key text, p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then true
    when p_value = '' or p_value <> btrim(p_value) then false
    when char_length(p_value) > 500 then false
    when p_key = 'googleRating' then
      case when p_value ~ '^[1-5]\.[0-9]$' then p_value::numeric <= 5.0 else false end
    when p_key = 'googleReviewCount' then p_value ~ '^[1-9][0-9]{0,4}$'
    when p_key = 'phone' then p_value ~ '^\([2-9][0-9]{2}\) [2-9][0-9]{2}-[0-9]{4}$'
    when p_key = 'email' then
      char_length(p_value) <= 254 and p_value ~* '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
    when p_key like 'hours%' then char_length(p_value) <= 60 and p_value !~ '[\r\n]'
    when p_key in ('banner1', 'banner2') then char_length(p_value) <= 200 and p_value !~ '[\r\n]'
    when p_key in ('banner1Mode', 'banner2Mode') then p_value in ('builtin', 'custom', 'off')
    when p_key in ('banner1Link', 'banner2Link') then p_value in ('/booking.html', '/careers.html', '/our-work.html')
    else true
  end
$$;

insert into public.site_content (key, value) values
  ('banner1Mode', 'builtin'),
  ('banner1Link', null),
  ('banner2Mode', 'builtin'),
  ('banner2Link', null)
on conflict (key) do nothing;
