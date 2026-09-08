-- Security review finding (independent second-pass, 2026-09-08): current_user_has_any_role()
-- was executable by PUBLIC and anon, but every one of the 9 RLS policies that
-- actually reference it (account_roles, storage.objects work-order-photos,
-- notification_recipients, client_portal_work_order_messages x2,
-- stripe_customers, card_authorizations, client_profiles,
-- client_notification_preferences) is scoped to {authenticated} only -- anon
-- never legitimately needs to call this. Confirmed calling it as anon was
-- already harmless (auth.jwt()->>'email' is null for anon, so it always
-- returned false -- no data leak either way), but tightening the grant to
-- match actual real usage removes an unnecessary public attack surface with
-- zero effect on any real caller.
revoke execute on function public.current_user_has_any_role() from public;
revoke execute on function public.current_user_has_any_role() from anon;
