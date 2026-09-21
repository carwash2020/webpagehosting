-- Security advisor (2026-09-21, from an external audit list flagging
-- resync_cron_service_role_key as anon/authenticated-callable): applied
-- directly via the Supabase MCP migration tool, mirrored here after the
-- fact per this repo's convention.
--
-- resync_cron_service_role_key(text) was STILL callable by anon and
-- authenticated despite sql/infra/resync_cron_service_role_key.sql
-- already containing `revoke all on function ... from public`. Root
-- cause, confirmed live via pg_proc/has_function_privilege: Supabase
-- auto-grants EXECUTE to anon/authenticated as SEPARATE explicit grants
-- at function-creation time. Revoking from the `public` pseudo-role does
-- not remove a role's own previously-granted explicit privilege -- the
-- two are independent grants in Postgres. This is the real, exploitable
-- finding: anyone holding the public anon key (i.e. anyone who has ever
-- loaded any page on the site) could otherwise call this function
-- directly and overwrite the Vault secret every net.http_post cron
-- reminder job authenticates with, silently breaking every scheduled
-- reminder email.
revoke execute on function public.resync_cron_service_role_key(text) from anon, authenticated;
grant execute on function public.resync_cron_service_role_key(text) to service_role;

-- The same advisor run also flagged guard_last_role_manager_permission()
-- and 6 notify_* functions (notify_job_message_email,
-- notify_job_status_change, notify_new_job_application_email,
-- notify_new_work_order_email, notify_work_order_message_email,
-- notify_work_order_scheduled_email) as anon/authenticated-callable.
-- Re-verified directly against pg_proc: all 7 are `RETURNS trigger`.
-- Postgres itself refuses to invoke a trigger-return-type function
-- outside of an actual trigger fire ("ERROR: trigger functions can only
-- be called as triggers"), regardless of EXECUTE grants -- same
-- resolution already recorded for 3 of these 7 in
-- audit_round3_security_and_performance_fixes.sql back on 2026-09-10.
-- Not exploitable via /rest/v1/rpc/... by construction. Revoked anyway
-- (harmless defense-in-depth) so the advisor stops flagging them.
revoke execute on function public.guard_last_role_manager_permission() from anon, authenticated, public;
revoke execute on function public.notify_job_message_email() from anon, authenticated, public;
revoke execute on function public.notify_job_status_change() from anon, authenticated, public;
revoke execute on function public.notify_new_job_application_email() from anon, authenticated, public;
revoke execute on function public.notify_new_work_order_email() from anon, authenticated, public;
revoke execute on function public.notify_work_order_message_email() from anon, authenticated, public;
revoke execute on function public.notify_work_order_scheduled_email() from anon, authenticated, public;
