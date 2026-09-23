-- Security audit (2026-09-23, LOW, hygiene): applied directly via the
-- Supabase MCP migration tool, mirrored here per this repo's convention.
--
-- Public signup is on (see
-- restrict_site_content_and_private_buckets_to_internal_accounts.sql), so
-- `authenticated` includes strangers and invited portal clients, not just
-- staff. Three leftovers still treated `authenticated` as staff:
--
--   - public.role_definitions: SELECT with `true` ("Authenticated can view
--     roles"). The permission presets (Owner/Developer/Employee and every
--     can_* flag). Low sensitivity, but it maps the internal permission
--     model for anyone who signs up. Its only reader is
--     tools/dev-tools.html (an internal page); edge functions use the
--     service role, which bypasses RLS.
--   - public.th_uptime_checks: SELECT with `true`, even though the policy
--     is named "Staff can read uptime history". Readers: tools/dev-tools.html
--     and Send-Push's weekly digest (service role).
--   - The four internal MFA recovery-code RPCs: add_internal_mfa_recovery_codes.sql
--     meant them for `authenticated` only (`revoke all ... from public`),
--     but Supabase's auto-grant gives anon its own explicit EXECUTE, which a
--     revoke from public doesn't remove (the same root cause
--     revoke_public_execute_on_internal_only_functions.sql fixed for other
--     functions). Not exploitable as anon -- every one keys off auth.uid(),
--     which is null for anon, so they return false / 0 / nothing or raise
--     -- but anon has no reason to reach them.
--
-- Write policies on role_definitions are untouched (already gated on
-- current_user_can_manage_roles()). Dry-run in a rolled-back transaction
-- before applying: a simulated stranger saw 0 role_definitions and 0
-- uptime rows (3 and 227 before); both internal accounts still saw all of
-- them; anon got "permission denied" on all four RPCs while an
-- authenticated caller still reached count_unused_internal_recovery_codes().

drop policy if exists "Authenticated can view roles" on public.role_definitions;
create policy "Internal accounts can view roles"
  on public.role_definitions for select to authenticated
  using ((select public.current_user_has_any_role()));

drop policy if exists "Staff can read uptime history" on public.th_uptime_checks;
create policy "Staff can read uptime history"
  on public.th_uptime_checks for select to authenticated
  using ((select public.current_user_has_any_role()));

revoke execute on function public.generate_internal_recovery_codes(integer) from anon;
revoke execute on function public.verify_and_consume_internal_recovery_code(text) from anon;
revoke execute on function public.count_unused_internal_recovery_codes() from anon;
revoke execute on function public.delete_internal_recovery_codes() from anon;
