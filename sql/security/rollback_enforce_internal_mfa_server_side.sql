-- Full rollback of enforce_internal_mfa_server_side.sql (2026-09-25).
-- ---------------------------------------------------------------------------
-- Use this only if the one-line switch isn't enough. If Steve or Connor is
-- being refused and you just need them back in, run this from the Supabase
-- dashboard's SQL editor instead (it takes effect on the next request):
--
--   update public.internal_mfa_enforcement set mode = 'log', changed_at = now(),
--     note = 'why' where id;
--
-- This file goes further: it switches enforcement off and puts the four
-- functions the migration replaced back exactly as they were live before it
-- (definitions from pg_get_functiondef on 2026-09-25), so RLS no longer
-- depends on any new code at all.
--
-- It deliberately KEEPS internal_mfa_enforcement, internal_mfa_gate_log,
-- internal_mfa_mode(), internal_mfa_session_ok(), log_internal_mfa_gate(),
-- check_internal_mfa_for_edge_function() and internal_mfa_session_status().
-- The deployed edge functions and tools/auth.js call the last two, and with
-- the mode 'off' both simply answer "allowed". Dropping them first would make
-- every internal edge function fail closed. Drop them only after the edge
-- functions are redeployed without the check.
--
-- redeem_internal_recovery_code() is dropped, so tools/login.html falls back
-- to verify_and_consume_internal_recovery_code(), restored below to its old
-- consume-only behavior (the account keeps its authenticator).
-- ---------------------------------------------------------------------------

insert into public.internal_mfa_enforcement (id, mode, note)
values (true, 'off', 'Rolled back with rollback_enforce_internal_mfa_server_side.sql')
on conflict (id) do update set mode = excluded.mode, changed_at = now(), note = excluded.note;

create or replace function public.current_user_has_any_role()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1 from public.account_roles
    where email = (select auth.jwt() ->> 'email')
  );
$$;

create or replace function public.generate_internal_recovery_codes(p_count int default 10)
returns text[]
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_codes text[] := '{}';
  v_code text;
  i int;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_count is null or p_count < 1 or p_count > 20 then
    p_count := 10;
  end if;

  delete from internal_mfa_recovery_codes where user_id = v_user_id;

  for i in 1..p_count loop
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4)) || '-' ||
              upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4));
    v_codes := array_append(v_codes, v_code);
    insert into internal_mfa_recovery_codes (user_id, code_hash)
    values (v_user_id, crypt(v_code, gen_salt('bf')));
  end loop;

  return v_codes;
end;
$$;

create or replace function public.verify_and_consume_internal_recovery_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
begin
  if v_user_id is null or p_code is null or length(trim(p_code)) = 0 then
    return false;
  end if;

  select id into v_id
  from internal_mfa_recovery_codes
  where user_id = v_user_id
    and used_at is null
    and code_hash = crypt(p_code, code_hash)
  limit 1;

  if v_id is null then
    return false;
  end if;

  update internal_mfa_recovery_codes set used_at = now() where id = v_id;
  return true;
end;
$$;

create or replace function public.delete_internal_recovery_codes()
returns void
language sql
security definer
set search_path = public
as $$
  delete from internal_mfa_recovery_codes where user_id = auth.uid();
$$;

drop function if exists public.redeem_internal_recovery_code(text);

-- Grants as they were before the migration.
revoke execute on function public.current_user_has_any_role() from public, anon;
grant execute on function public.current_user_has_any_role() to authenticated;
revoke all on function public.generate_internal_recovery_codes(int) from public, anon;
grant execute on function public.generate_internal_recovery_codes(int) to authenticated;
revoke all on function public.verify_and_consume_internal_recovery_code(text) from public, anon;
grant execute on function public.verify_and_consume_internal_recovery_code(text) to authenticated;
revoke all on function public.delete_internal_recovery_codes() from public, anon;
grant execute on function public.delete_internal_recovery_codes() to authenticated;
