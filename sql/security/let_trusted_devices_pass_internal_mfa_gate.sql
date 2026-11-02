-- Let a trusted-device session through the Workspace's server-side 2FA gate (2026-11-01)
-- ---------------------------------------------------------------------------
-- Needs add_trusted_devices.sql applied first.
--
-- READ BEFORE APPLYING: unlike add_trusted_devices.sql, this file REPLACES the
-- bodies of two existing functions from enforce_internal_mfa_server_side.sql.
-- Each new body is the old one, copied exactly, with one extra OR. Undo with
-- rollback_let_trusted_devices_pass_internal_mfa_gate.sql.
--
-- Why it's needed: a trusted device skips the code, so its session stays at
-- Supabase's aal1 (Supabase has no way to mint aal2 without the code). The
-- Workspace gate (internal_mfa_session_ok) only accepts aal2 on an account
-- with an authenticator. In `log` mode that would write a would_block row for
-- every trusted sign-in, muddying the review window; in `enforce` mode the
-- Workspace would refuse the session and send it back to sign in.
--
-- The extra OR accepts an aal1 session ONLY when
-- trusted_device_session_valid() says this exact session (JWT session_id)
-- passed sign-in on a trusted device that still counts: unexpired, same
-- authenticator still verified, password unchanged. A password-only token
-- minted straight from /auth/v1/token (the attack the gate exists for) has no
-- such row, so it is refused exactly as before. Getting one needs the
-- password AND the device's 256-bit token.
--
-- Unchanged: the mode switch, logging, recovery-code rules
-- (generate_internal_recovery_codes() and delete_internal_recovery_codes()
-- still demand aal2 -- a trusted device can't mint codes), and every caller.
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
      )
      or public.trusted_device_session_valid(p_user_id, auth.jwt() ->> 'session_id');
$$;

revoke all on function public.internal_mfa_session_ok(uuid, text) from public, anon, authenticated;

-- Edge functions call this with the service role, so auth.jwt() above is the
-- service role's token, not the caller's. The caller's session_id arrives as
-- p_session_id (every one of the 15 functions already sends it), so the
-- trusted-session check is made with that here.
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

  if public.internal_mfa_session_ok(p_user_id, p_aal)
     or public.trusted_device_session_valid(p_user_id, p_session_id) then
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
