-- Advisor Health fix (2026-08-16): 12 "Public/Signed-In Can Execute
-- SECURITY DEFINER Function" WARN-level findings across 6 functions.
-- Already applied directly to the live project via the Supabase MCP
-- (apply_migration: advisor_fix_security_definer_grants) -- this file
-- documents that change in the repo's SQL history, matching the pattern
-- of the other fix_*.sql files here.

-- current_user_can_manage_roles(): confirmed both account_roles and
-- role_definitions already have `USING (true)` SELECT policies for
-- authenticated (see create_account_roles_system.sql) -- so SECURITY
-- DEFINER bought this function nothing; an invoker-mode call sees the
-- exact same rows. Switched to SECURITY INVOKER, which fully clears
-- both the anon and authenticated warnings for this function. EXECUTE
-- is still needed by `authenticated` (the RLS policies on account_roles/
-- role_definitions call it directly inside USING/WITH CHECK), so that
-- grant is kept; revoked from anon and PUBLIC since anon never has a
-- policy that evaluates it.
alter function public.current_user_can_manage_roles() security invoker;
revoke execute on function public.current_user_can_manage_roles() from public, anon;
grant execute on function public.current_user_can_manage_roles() to authenticated;

-- The other 5 flagged functions are all trigger functions (RETURNS
-- trigger): log_site_content_change, log_site_faq_change,
-- log_site_terms_change, prevent_removing_last_role_manager,
-- prevent_disabling_last_role_manager_capability.
--
-- Postgres fires a trigger via EXECUTE FUNCTION regardless of whether
-- the triggering role holds EXECUTE privilege on the function -- that
-- privilege check only applies to an explicit direct call (e.g. via
-- PostgREST's /rest/v1/rpc/<name>), which for a trigger function always
-- fails at runtime anyway ("trigger functions can only be called as
-- triggers"). So revoking EXECUTE here removes the exposed RPC surface
-- with zero effect on the triggers themselves continuing to fire.
--
-- Verified live, not assumed: ran a real UPDATE against site_content
-- after applying this revoke and confirmed site_content_history still
-- gained exactly one new row (0 -> 1), then cleaned up the test row.
revoke execute on function public.log_site_content_change() from public, anon, authenticated;
revoke execute on function public.log_site_faq_change() from public, anon, authenticated;
revoke execute on function public.log_site_terms_change() from public, anon, authenticated;
revoke execute on function public.prevent_removing_last_role_manager() from public, anon, authenticated;
revoke execute on function public.prevent_disabling_last_role_manager_capability() from public, anon, authenticated;

-- NOT fixed here: "Leaked Password Protection Disabled" -- this is an
-- Auth setting (Authentication -> Policies toggle in the dashboard),
-- not exposed through any SQL grant or API this migration can reach.
-- Still requires a manual toggle.
