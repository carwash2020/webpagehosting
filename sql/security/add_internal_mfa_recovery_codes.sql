-- Internal-tools MFA recovery codes (2026-09-22)
-- ---------------------------------------------------------------------------
-- Supabase Auth's TOTP MFA (already proven working for the client portal,
-- 2026-09-16) has no built-in "lost your phone" recovery path exposed on
-- this project's hosted GoTrue version -- the JS SDK's own
-- `client.auth.mfa.recoveryCodes` API exists in the library source but is
-- gated behind an `experimental` client flag
-- (`assertRecoveryCodesExperimentalEnabled`), and this repo has no live
-- Supabase MCP access to confirm the hosted project's GoTrue server even
-- has that endpoint deployed. Rather than ship a recovery flow that might
-- silently 404 in production, this builds a small, fully self-contained
-- recovery-code system: one table, plus SECURITY DEFINER functions that are
-- the ONLY way in or out of it (the table itself denies all direct access,
-- same "deny-all, functions only" pattern already documented for
-- cron_watchdog_state).
--
-- Scope: internal /tools/ accounts only (account_roles-backed). The client
-- portal is untouched -- it has its own, already-shipped MFA and is
-- explicitly out of scope for this change.
--
-- Every function below is keyed off auth.uid() (the CALLING user), never a
-- caller-supplied user id -- so even though EXECUTE is granted broadly to
-- `authenticated`, no account can generate, consume, or count another
-- account's recovery codes.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

create table if not exists internal_mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_internal_mfa_recovery_codes_user_id
  on internal_mfa_recovery_codes(user_id);

alter table internal_mfa_recovery_codes enable row level security;

-- Deliberately no policies -- default-deny for anon and authenticated alike.
-- Belt-and-suspenders on top of that default deny: explicitly revoke the
-- table-level grants Supabase auto-issues to anon/authenticated at table
-- creation (the same auto-grant behavior documented in this project's own
-- 2026-09-21 security log entry for resync_cron_service_role_key, where
-- relying on RLS alone without also revoking the table grant left a real
-- gap). Every legitimate access path goes through a function below.
revoke all on internal_mfa_recovery_codes from anon, authenticated;

-- Generates p_count fresh codes for the CALLING user, replacing any
-- existing set (regenerating invalidates old codes -- a forgotten old code
-- should not remain valid forever). Returns the codes in PLAINTEXT: this is
-- the only moment they are ever available anywhere, including to this
-- database itself -- only the bcrypt hash is stored.
create or replace function generate_internal_recovery_codes(p_count int default 10)
returns text[]
language plpgsql
security definer
set search_path = public
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

revoke all on function generate_internal_recovery_codes(int) from public;
grant execute on function generate_internal_recovery_codes(int) to authenticated;

-- Checks p_code against the CALLING user's unused codes; if it matches,
-- marks that one code used (one-time use, matching every mainstream
-- provider's recovery-code semantics) and returns true.
create or replace function verify_and_consume_internal_recovery_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
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

revoke all on function verify_and_consume_internal_recovery_code(text) from public;
grant execute on function verify_and_consume_internal_recovery_code(text) to authenticated;

-- How many unused codes the CALLING user has left -- shown in Settings so
-- someone burning through codes knows to regenerate before they run out.
create or replace function count_unused_internal_recovery_codes()
returns int
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::int from internal_mfa_recovery_codes
  where user_id = auth.uid() and used_at is null;
$$;

revoke all on function count_unused_internal_recovery_codes() from public;
grant execute on function count_unused_internal_recovery_codes() to authenticated;

-- Called when the CALLING user turns two-factor authentication off entirely
-- -- recovery codes for a factor that no longer exists should not remain
-- valid (they'd otherwise let someone back in with no real second factor at
-- all).
create or replace function delete_internal_recovery_codes()
returns void
language sql
security definer
set search_path = public
as $$
  delete from internal_mfa_recovery_codes where user_id = auth.uid();
$$;

revoke all on function delete_internal_recovery_codes() from public;
grant execute on function delete_internal_recovery_codes() to authenticated;
