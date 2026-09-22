-- Fix a real bug in add_internal_mfa_recovery_codes.sql, found and applied
-- live 2026-09-22 (same day as the original migration) after a real report:
-- clicking "Generate new codes" in Settings failed with "Could not generate
-- recovery codes. Please try again." every single time, for every account,
-- since the feature shipped -- not the token-refresh bug fixed the same day
-- in tools/auth.js/settings.html (see docs/specialist-logs/security.md),
-- a completely separate, deeper problem underneath it.
--
-- Root cause, confirmed directly by simulating an authenticated call
-- (`set local role authenticated; set local request.jwt.claims = ...`):
--   ERROR: function gen_random_bytes(integer) does not exist
-- generate_internal_recovery_codes()/verify_and_consume_internal_recovery_code()
-- both declared `set search_path = public` -- but on this Supabase project,
-- `create extension if not exists pgcrypto;` (line 27 of the original
-- migration) installs pgcrypto into the `extensions` schema, not `public`,
-- which is Supabase's own standard convention for every extension. A
-- SECURITY DEFINER function's explicit `search_path` completely replaces
-- the calling role's own search_path (that's the whole point of setting one
-- at all, to avoid a search-path-hijack attack) -- so `extensions` was never
-- in scope, and every call to `gen_random_bytes`/`crypt`/`gen_salt` failed
-- at the database level, regardless of which account called it or whether
-- its access token was fresh. The token-refresh bug fixed the same day was
-- real and worth fixing, but it was never the actual reason generation
-- failed -- the RPC would have failed with "not authenticated" once the
-- token issue was fixed, still never reaching pgcrypto at all, until this.
--
-- Fix: add `extensions` to both functions' search_path
-- (`set search_path = public, extensions`). `count_unused_internal_recovery_codes()`
-- and `delete_internal_recovery_codes()` don't call any pgcrypto function,
-- so they were never affected and are left untouched.
--
-- Verified live before AND after this fix, via the same authenticated-call
-- simulation: reproduced the exact "gen_random_bytes does not exist" error
-- pre-fix, confirmed real codes generate correctly post-fix, confirmed
-- verify_and_consume_internal_recovery_code() correctly accepts a
-- just-generated code, then deleted the test codes generated during
-- verification so no stray live rows were left behind.

create or replace function generate_internal_recovery_codes(p_count int default 10)
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

revoke all on function generate_internal_recovery_codes(int) from public;
grant execute on function generate_internal_recovery_codes(int) to authenticated;

create or replace function verify_and_consume_internal_recovery_code(p_code text)
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

revoke all on function verify_and_consume_internal_recovery_code(text) from public;
grant execute on function verify_and_consume_internal_recovery_code(text) to authenticated;
