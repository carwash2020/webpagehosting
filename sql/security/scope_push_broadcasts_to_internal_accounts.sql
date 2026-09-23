-- Push notification privacy fix (2026-09-22, booking-flow pass).
--
-- Two service-role-only lookups for the edge functions, replacing two
-- latent privacy bugs. Neither had fired yet (at the time of this fix
-- push_subscriptions held 6 rows, all belonging to the 2 internal
-- accounts), but both would have the moment any client turned on push in
-- the portal (portal/push-notifications.js writes to the same table).
--
-- 1. get_internal_push_subscriptions() -- Send-Push's "broadcast to the
--    team" helper used to read EVERY push_subscriptions row, so a client
--    who enabled portal push would have started receiving every internal
--    alert: new-lead and new-booking names, overdue invoices by client
--    name, the weekly revenue digest. This returns only subscriptions
--    whose account email is in account_roles. Send-Push fails CLOSED if
--    this call errors (no broadcast at all rather than a broadcast to
--    everyone).
--
-- 2. get_auth_user_id_by_email(p_email) -- six notification functions
--    looked up a client's user id with GET /auth/v1/admin/users?email=...
--    GoTrue's admin list endpoint has no `email` filter; it ignored the
--    parameter and returned the first page of all users, newest first, so
--    users[0] was whichever account was created most recently -- a
--    client's invoice/quote/message push would have gone to someone else.
--    This is an exact, case-insensitive match that returns null when
--    there's no such account.
--
-- Both are SECURITY DEFINER (they read auth.users) and executable by
-- service_role ONLY -- revoked from public/anon/authenticated explicitly,
-- since Postgres grants EXECUTE on new functions to PUBLIC by default and
-- Supabase's default privileges add anon/authenticated too.

create or replace function public.get_internal_push_subscriptions()
returns table (id uuid, subscription jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select ps.id, ps.subscription
  from public.push_subscriptions ps
  join auth.users u on u.id = ps.user_id
  where u.email is not null
    and exists (
      select 1 from public.account_roles ar
      where lower(ar.email) = lower(u.email)
    );
$$;

revoke all on function public.get_internal_push_subscriptions() from public, anon, authenticated;
grant execute on function public.get_internal_push_subscriptions() to service_role;

create or replace function public.get_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from auth.users u
  where p_email is not null
    and length(trim(p_email)) > 0
    and lower(u.email) = lower(trim(p_email))
  order by u.created_at asc
  limit 1;
$$;

revoke all on function public.get_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.get_auth_user_id_by_email(text) to service_role;
