-- Fix plan FP4.1 (2026-11-06): one sign-in page for everyone.
--
-- After the password, the combined sign-in (portal/login.html) has to know
-- whether this account is staff (go on to the Workspace's own two-factor
-- steps) or a client (the portal's steps) -- BEFORE the second step. The
-- usual staff check, current_user_has_any_role(), goes through the
-- Workspace's two-factor gate, so a staff account with an authenticator
-- reads as "not staff" until its code is in (by design: that's what keeps a
-- password-only session out of internal data). This function answers only
-- that one question, only about the caller's own email, and grants nothing:
-- no row, no permission, no data. Every internal table and function still
-- applies the two-factor gate exactly as before.
--
-- Returns 'staff' or 'client'. A deactivated staff account can't sign in
-- (its Auth user is banned), so it never reaches this. Re-runnable.

begin;

create or replace function public.signin_account_kind()
returns text
language sql
stable
security definer
set search_path = 'public'
as $$
  select case
    when exists (
      select 1 from public.account_roles
      where lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
    ) then 'staff'
    else 'client'
  end;
$$;

revoke execute on function public.signin_account_kind() from public, anon;
grant execute on function public.signin_account_kind() to authenticated;

commit;
