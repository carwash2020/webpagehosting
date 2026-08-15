-- site_content, site_faq, site_terms each had an "Anyone can read ..."
-- SELECT policy PLUS an "Only logged-in can edit ..." ALL policy, so
-- every authenticated SELECT evaluated both. Narrows the edit policies
-- to INSERT/UPDATE/DELETE, removing the overlap without changing what
-- anyone can actually do. Run 2026-08-14.

drop policy "Only logged-in can edit site content" on public.site_content;
create policy "Only logged-in can edit site content" on public.site_content
  as permissive for insert to authenticated with check (true);
create policy "Only logged-in can update site content" on public.site_content
  as permissive for update to authenticated using (true) with check (true);
create policy "Only logged-in can delete site content" on public.site_content
  as permissive for delete to authenticated using (true);

drop policy "Only logged-in can edit FAQ" on public.site_faq;
create policy "Only logged-in can edit FAQ" on public.site_faq
  as permissive for insert to authenticated with check (true);
create policy "Only logged-in can update FAQ" on public.site_faq
  as permissive for update to authenticated using (true) with check (true);
create policy "Only logged-in can delete FAQ" on public.site_faq
  as permissive for delete to authenticated using (true);

drop policy "Only logged-in can edit terms" on public.site_terms;
create policy "Only logged-in can edit terms" on public.site_terms
  as permissive for insert to authenticated with check (true);
create policy "Only logged-in can update terms" on public.site_terms
  as permissive for update to authenticated using (true) with check (true);
create policy "Only logged-in can delete terms" on public.site_terms
  as permissive for delete to authenticated using (true);
