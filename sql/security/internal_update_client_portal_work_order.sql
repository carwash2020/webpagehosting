-- Staff status changes on portal work orders, after #469 (2026-09-29).
-- See docs/specialist-logs/bugfix.md, 2026-09-29 (second redesign pass).
--
-- #469 (scope_client_portal_rls_to_client_only_plus_internal_rpcs.sql)
-- made client_portal_work_orders' SELECT policy client-only and moved
-- staff reads to internal_read_client_portal_work_orders(). Staff writes
-- were left on the direct PATCH from tools/workspace.html
-- (confirmWorkOrderApproval / advanceWorkRequest), relying on the
-- "internal accounts update work orders" UPDATE policy. But Postgres
-- applies a table's SELECT policies to an UPDATE whose WHERE clause reads
-- the table (PostgREST's PATCH ...?id=eq.X is exactly that), so a staff
-- session can no longer see the row it is updating: the UPDATE matches 0
-- rows, raises nothing, and PostgREST answers 204. Scheduling a request
-- and every status move (Reviewing, Quoted, Completed, Close) said
-- "done" and changed nothing.
--
-- This function is the write-side twin of the internal_read_* functions:
-- SECURITY DEFINER (owned by postgres, which these tables' RLS doesn't
-- bind -- no FORCE ROW LEVEL SECURITY), re-checks the same staff+MFA gate
-- (current_user_has_any_role()) in its body, and returns the updated row
-- so the caller can tell a real update from none. The table's own CHECK
-- constraint still rejects an unknown status, and the on_work_order_scheduled
-- trigger (the client's "scheduled" email) fires on this UPDATE as before.
-- Client-side access is unchanged: SELECT stays client-only, and clients
-- still have no UPDATE path on this table.

create or replace function public.internal_update_client_portal_work_order(
  p_id bigint,
  p_status text,
  p_scheduled_at timestamptz default null
)
returns setof public.client_portal_work_orders
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.current_user_has_any_role() then
    raise exception 'Only internal accounts can update work orders.'
      using errcode = '42501';
  end if;

  return query
    update public.client_portal_work_orders
       set status = p_status,
           scheduled_at = coalesce(p_scheduled_at, scheduled_at),
           updated_at = now()
     where id = p_id
    returning *;
end;
$$;

-- Staff-only, like the internal_read_* functions: this project's default
-- privileges grant EXECUTE to anon on new functions, so revoke it.
revoke execute on function public.internal_update_client_portal_work_order(bigint, text, timestamptz) from public, anon;
grant execute on function public.internal_update_client_portal_work_order(bigint, text, timestamptz) to authenticated;
