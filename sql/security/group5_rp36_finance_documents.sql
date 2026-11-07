-- Fix plan RP3.6 (2026-11-07): receipts and secure documents (insurance, LLC
-- certificate) readable by any internal account. NOT APPLIED and NOT
-- DECIDED: which switch should guard them is Connor's call (the plan names
-- none). This file is the proposal: can_view_finance, the switch the
-- Finance page (receipts) already uses. Job photos stay staff-wide (the
-- field needs them). Apply only after the decision, and only after
-- group5_backend_hardening.sql; if he picks another switch, change
-- current_user_can_view_finance() below to read it.
--
-- Was: "Internal accounts can view|upload|delete receipts|secure-documents",
-- each `bucket_id = '<bucket>' and current_user_has_any_role()`.
--
--
-- SHIP WITH IT (front end, held back from Group 5 with this file): without
-- Finance access the Workspace's Secure Documents list would just look
-- empty, so renderSecureDocsList() in tools/workspace.html says why and
-- hides upload. Insert at the top of that function, after the container
-- check:
--       // Fix plan RP3.6 (2026-11-07): secure documents need Finance access
--       // (the database enforces it; without it the list would just look empty).
--       const uploadWrap = document.getElementById('secureDocsUploadWrap');
--       if (typeof canViewFinance === 'function' && typeof getCurrentUserRole === 'function' && getCurrentUserRole() && !canViewFinance()) {
--         if (uploadWrap) uploadWrap.hidden = true;
--         container.innerHTML = '<div class="empty-state-small"><svg class="th-icon" aria-hidden="true"><use href="#icon-shield" xlink:href="#icon-shield"></use></svg>Secure documents are for accounts with Finance access.</div>';
--         return;
--       }
--       if (uploadWrap) uploadWrap.hidden = false;
--
-- UNDO: drop the three "Finance accounts can ..." policies per bucket and
-- recreate the "Internal accounts can ..." ones above.

create or replace function public.current_user_can_view_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_has_any_role()
     and coalesce((select ar.can_view_finance from public.account_roles ar
                   where ar.email = (select auth.jwt() ->> 'email')), false);
$$;
revoke execute on function public.current_user_can_view_finance() from public, anon;
grant execute on function public.current_user_can_view_finance() to authenticated;

do $$
declare
  b text;
  verb text;
begin
  foreach b in array array['receipts', 'secure-documents'] loop
    foreach verb in array array['view', 'upload', 'delete'] loop
      execute format('drop policy if exists %I on storage.objects', 'Internal accounts can ' || verb || ' ' || b);
      execute format('drop policy if exists %I on storage.objects', 'Finance accounts can ' || verb || ' ' || b);
    end loop;
    execute format($p$create policy %I on storage.objects for select to authenticated
      using (bucket_id = %L and (select public.current_user_can_view_finance()))$p$, 'Finance accounts can view ' || b, b);
    execute format($p$create policy %I on storage.objects for insert to authenticated
      with check (bucket_id = %L and (select public.current_user_can_view_finance()))$p$, 'Finance accounts can upload ' || b, b);
    execute format($p$create policy %I on storage.objects for delete to authenticated
      using (bucket_id = %L and (select public.current_user_can_view_finance()))$p$, 'Finance accounts can delete ' || b, b);
  end loop;
end $$;

