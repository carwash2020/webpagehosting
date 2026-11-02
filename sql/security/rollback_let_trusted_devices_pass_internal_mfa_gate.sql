-- Undo let_trusted_devices_pass_internal_mfa_gate.sql (2026-11-01)
-- ---------------------------------------------------------------------------
-- Puts back the two function bodies exactly as enforce_internal_mfa_server_side.sql
-- wrote them. Trusted-device sessions on the Workspace are then treated like
-- any other password-only session (would_block in `log`, refused in
-- `enforce`); tools/login.html notices a refused session and asks for the
-- code instead, so nobody is locked out. The portal is unaffected.
-- Leaves the trusted_devices tables and functions in place.
-- ---------------------------------------------------------------------------

create or replace function public.internal_mfa_session_ok(p_user_id uuid, p_aal text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_aal, '') = 'aal2'
      or (
        p_user_id is not null
        and not exists (
          select 1 from auth.mfa_factors f
          where f.user_id = p_user_id and f.status = 'verified'
        )
      );
$$;

revoke all on function public.internal_mfa_session_ok(uuid, text) from public, anon, authenticated;

create or replace function public.check_internal_mfa_for_edge_function(
  p_user_id uuid, p_email text, p_session_id text, p_aal text, p_function text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_mode text := public.internal_mfa_mode();
  v_source text := 'edge:' || left(coalesce(p_function, '?'), 60);
begin
  if v_mode = 'off' then
    return true;
  end if;

  if public.internal_mfa_session_ok(p_user_id, p_aal) then
    if v_mode = 'log' then
      perform public.log_internal_mfa_gate(p_user_id, p_email, p_session_id, p_aal, v_source, 'allowed');
    end if;
    return true;
  end if;

  perform public.log_internal_mfa_gate(p_user_id, p_email, p_session_id, p_aal, v_source,
    case when v_mode = 'enforce' then 'blocked' else 'would_block' end);
  return v_mode <> 'enforce';
end;
$$;

revoke all on function public.check_internal_mfa_for_edge_function(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.check_internal_mfa_for_edge_function(uuid, text, text, text, text) to service_role;
