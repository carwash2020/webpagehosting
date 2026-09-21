-- Audit finding (2026-09-21, external Cursor list item #8): applied
-- directly via the Supabase MCP migration tool, mirrored here after the
-- fact per this repo's convention.
--
-- The visible FAQ accordion on index.html falls back to 4 categorized
-- groups (Pricing & Payment / Scheduling & Availability / Service Area &
-- Coverage / Policies, with <h3 class="faq-category"> headers) baked
-- into the static HTML, but the live site_faq fetch that replaces that
-- markup once Supabase responds always rendered a single flat list --
-- the categories only ever existed in the pre-fetch flash, then vanished
-- the moment the real data (which loads successfully almost always)
-- took over. Fixed on the frontend in index.html (group by category,
-- ordered by each category's first appearance in sort_order -- no
-- separate ordering column needed) and in tools/site-content.html's FAQ
-- editor (a Category field per item, saved and re-loaded like question/
-- answer already were).
alter table public.site_faq add column if not exists category text not null default 'General';

-- Backfilled to match the exact category each question already sits
-- under in index.html's static fallback markup, confirmed row-for-row
-- against the live table by question text (not guessed).
update public.site_faq set category = 'Pricing & Payment' where id in (1,5,7,13,15);
update public.site_faq set category = 'Scheduling & Availability' where id in (2,10,11,12);
update public.site_faq set category = 'Service Area & Coverage' where id in (3,8);
update public.site_faq set category = 'Policies' where id in (4,6,9,14);
