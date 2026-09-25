-- Server-side two-factor enforcement for internal /tools/ accounts
-- (2026-09-25). Closes docs/ACTION-ITEMS.md #13: the 2026-09-23 audit's
-- round 3 finding #4 (HIGH), plus the recovery-code gap its follow-up found.
-- ---------------------------------------------------------------------------
-- The gap. Two-factor was only ever checked by tools/login.html. Postgres,
-- PostgREST, Storage and the edge functions never looked at the session's
-- authenticator assurance level (the JWT's `aal` claim), so anyone holding
-- an internal account's password could skip the login page, take the
-- password-only (aal1) token /auth/v1/token hands out, and read or change
-- every internal table, bucket and edge function. On that same aal1 session
-- they could also mint a fresh set of recovery codes for themselves.
--
-- The rule: an internal account (an account_roles row) that has a verified
-- authenticator must be using a session that passed it (aal2). An account
-- with NO authenticator enrolled keeps working exactly as before -- two-factor
-- here is opt-in, then enforced. That rule lives in one place,
-- internal_mfa_session_ok(), and reaches:
--
--   * every internal RLS policy, through current_user_has_any_role(). The
--     account_roles SELECT policy is that function, and every other internal
--     policy (the inline `exists (select 1 from account_roles ...)` ones, the
--     can_manage_site_content ones, current_user_can_manage_roles(), the CMS
--     publish functions) reads account_roles as the caller, so all of them
--     inherit it. Portal-client policies (`client_email = auth.email()`) are
--     not touched.
--   * the internal edge functions, through check_internal_mfa_for_edge_function(),
--     which each one calls after its own account_roles check.
--   * the /tools/ pages, through internal_mfa_session_status(), so a stale
--     password-only session is sent back to sign in with a code instead of
--     rendering empty pages.
--
-- The rollout switch. internal_mfa_enforcement.mode is 'log' after this
-- migration: nothing is blocked, and everything enforcement WOULD block is
-- recorded (internal_mfa_gate_log for edge functions, pages and recovery;
-- a `internal_mfa_gate would_block source=rls` WARNING in the Postgres log
-- for RLS reads, which run in read-only transactions and can't insert rows).
-- 'enforce' turns blocking on. 'off' skips the check entirely. The runbook
-- (docs/INTERNAL-MFA-ENFORCEMENT.md) has the review queries, the flip, and
-- the break-glass statement; rollback_enforce_internal_mfa_server_side.sql
-- restores the previous function bodies exactly.
--
-- Always on, whatever the mode (neither can lock anyone out of the tools;
-- see the comments on each):
--   * generate_internal_recovery_codes() needs an aal2 session on an account
--     that has an authenticator. Every real caller already has one.
--   * delete_internal_recovery_codes() refuses a password-only session while
--     the account still has its authenticator.
--
-- Recovery codes still get you in. With the server now refusing aal1
-- sessions on enrolled accounts, "sign in with a recovery code" can no longer
-- mean "password-only session plus a consumed code". Instead
-- redeem_internal_recovery_code() treats the code as the replacement for a
-- lost authenticator: it consumes the code and, in the same transaction,
-- removes the account's authenticator, its other unused codes, and every
-- other signed-in session (a lost phone may still hold a fully verified one).
-- The account is then in the "no authenticator" state, so the recovering
-- session works, and tools/login.html's existing mandatory-enrollment step
-- has the person set up a new authenticator straight away.
-- ---------------------------------------------------------------------------

-- 1. The switch --------------------------------------------------------------

create table if not exists public.internal_mfa_enforcement (
  id boolean primary key default true check (id),
  mode text not null check (mode in ('off', 'log', 'enforce')),
  changed_at timestamptz not null default now(),
  note text
);

insert into public.internal_mfa_enforcement (id, mode, note)
values (true, 'log', 'Dry run: record what two-factor enforcement would block, block nothing.')
on conflict (id) do nothing;

alter table public.internal_mfa_enforcement enable row level security;
-- No policies: read and changed from the dashboard SQL editor only.
revoke all on public.internal_mfa_enforcement from anon, authenticated;

-- 2. The log -----------------------------------------------------------------

create table if not exists public.internal_mfa_gate_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  email text,
  session_id uuid,
  aal text,
  source text not null,
  outcome text not null check (outcome in (
    'allowed', 'would_block', 'blocked', 'recovery_redeemed', 'recovery_rejected'
  )),
  mode text not null
);

create index if not exists internal_mfa_gate_log_created_at_idx
  on public.internal_mfa_gate_log (created_at desc);

alter table public.internal_mfa_gate_log enable row level security;
revoke all on public.internal_mfa_gate_log from anon, authenticated;
revoke all on sequence public.internal_mfa_gate_log_id_seq from anon, authenticated;

-- 3. Helpers (internal only: no EXECUTE for anon or authenticated) ------------

-- The current mode. A missing row reads as 'enforce': deleting the switch
-- must not quietly turn the protection off.
create or replace function public.internal_mfa_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select e.mode from public.internal_mfa_enforcement e where e.id), 'enforce');
$$;

revoke all on function public.internal_mfa_mode() from public, anon, authenticated;

-- The rule itself. True when the session passed two-factor (aal2), or when
-- the account has no verified authenticator at all.
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

-- Writes one log row. Repeats of the same session/source/outcome within 10
-- minutes are skipped so a busy page doesn't write a row per request; every
-- recovery attempt is kept. Never raises: logging must not be the reason a
-- request fails.
create or replace function public.log_internal_mfa_gate(
  p_user_id uuid, p_email text, p_session_id text, p_aal text, p_source text, p_outcome text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if p_session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_session_id := p_session_id::uuid;
  end if;

  if p_outcome in ('allowed', 'would_block', 'blocked') and exists (
    select 1 from public.internal_mfa_gate_log l
    where l.created_at > now() - interval '10 minutes'
      and l.user_id is not distinct from p_user_id
      and l.session_id is not distinct from v_session_id
      and l.source = p_source
      and l.outcome = p_outcome
  ) then
    return;
  end if;

  insert into public.internal_mfa_gate_log (user_id, email, session_id, aal, source, outcome, mode)
  values (p_user_id, left(p_email, 320), v_session_id, left(p_aal, 16), left(p_source, 80), p_outcome,
          public.internal_mfa_mode());
exception when others then
  return;
end;
$$;

revoke all on function public.log_internal_mfa_gate(uuid, text, text, text, text, text) from public, anon, authenticated;

-- 4. Every internal RLS policy -------------------------------------------------

-- Same role test as before (exact match on the JWT's email), then the
-- two-factor rule. Still STABLE and still returns false for anyone without
-- an account_roles row. PL/pgSQL now, so the dry run can RAISE WARNING:
-- this runs inside read-only transactions (every PostgREST GET), where
-- nothing can be inserted.
create or replace function public.current_user_has_any_role()
returns boolean
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_mode text;
begin
  if not exists (
    select 1 from public.account_roles
    where email = (select auth.jwt() ->> 'email')
  ) then
    return false;
  end if;

  v_mode := public.internal_mfa_mode();
  if v_mode = 'off' then
    return true;
  end if;

  if public.internal_mfa_session_ok(auth.uid(), auth.jwt() ->> 'aal') then
    return true;
  end if;

  if v_mode = 'log' then
    raise warning 'internal_mfa_gate would_block source=rls user=% session=% aal=%',
      coalesce(auth.uid()::text, '-'),
      coalesce(auth.jwt() ->> 'session_id', '-'),
      coalesce(auth.jwt() ->> 'aal', '-');
    return true;
  end if;

  return false;
end;
$$;

-- Grants carry over on replace (authenticated + service_role, per
-- tighten_current_user_has_any_role_grant.sql); restated so this file stands
-- on its own.
revoke execute on function public.current_user_has_any_role() from public, anon;
grant execute on function public.current_user_has_any_role() to authenticated;

-- 5. Edge functions ---------------------------------------------------------------

-- Called by each internal edge function with the service role, passing the
-- caller's claims from its already gateway-verified JWT (every one of these
-- functions runs with verify_jwt on). Returns true to let the call through.
-- In 'log' mode it always returns true and records the decision -- allowed
-- ones too, so the dry run shows the check really ran on real traffic.
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

-- 6. /tools/ pages ------------------------------------------------------------------

-- Lets tools/auth.js tell a signed-in page "this session no longer gets
-- internal access; sign in again with your code" instead of the page just
-- coming back empty. Only ever describes the caller's own session. Returns
-- {"internal": false} for anyone without an account_roles row, and never
-- reveals the mode itself: `blocked` is only true when this session is
-- actually being refused.
create or replace function public.internal_mfa_session_status()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_aal text := auth.jwt() ->> 'aal';
  v_mode text;
  v_ok boolean;
begin
  if v_user_id is null or not exists (
    select 1 from public.account_roles ar where ar.email = v_email
  ) then
    return jsonb_build_object('internal', false);
  end if;

  v_mode := public.internal_mfa_mode();
  v_ok := public.internal_mfa_session_ok(v_user_id, v_aal);

  if not v_ok and v_mode <> 'off' then
    perform public.log_internal_mfa_gate(v_user_id, v_email, auth.jwt() ->> 'session_id', v_aal, 'page:tools',
      case when v_mode = 'enforce' then 'blocked' else 'would_block' end);
  end if;

  return jsonb_build_object(
    'internal', true,
    'meets', v_ok,
    'blocked', (not v_ok and v_mode = 'enforce')
  );
end;
$$;

revoke all on function public.internal_mfa_session_status() from public, anon;
grant execute on function public.internal_mfa_session_status() to authenticated;

-- 7. Recovery codes ---------------------------------------------------------------

-- Minting codes. A code is a second way past two-factor, so only a session
-- that already passed two-factor, on an account that has an authenticator,
-- may mint them; otherwise a stolen password could mint a set and then redeem
-- one below to strip the real authenticator. This is enforced in every mode,
-- not dry-run first, because it can't lock anyone out: sign-in, the
-- authenticator and existing codes are untouched. Every real caller already
-- qualifies -- login.html generates with the fresh aal2 session its verify
-- returns, settings.html stores its verify's aal2 session before generating,
-- and "Generate new codes" only shows once an authenticator exists.
-- Codes are otherwise generated exactly as before (same format, bcrypt).
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

  if not exists (
    select 1 from public.account_roles where email = (select auth.jwt() ->> 'email')
  ) then
    raise exception 'Recovery codes are only for Triple H Workspace accounts.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from auth.mfa_factors f where f.user_id = v_user_id and f.status = 'verified'
  ) then
    raise exception 'Turn on two-factor authentication before generating recovery codes.'
      using errcode = '42501';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    -- A WARNING reaches the Postgres log even though the exception below
    -- rolls the transaction back.
    raise warning 'internal_mfa_gate blocked source=rpc:generate_internal_recovery_codes user=% session=% aal=%',
      v_user_id, coalesce(auth.jwt() ->> 'session_id', '-'), coalesce(auth.jwt() ->> 'aal', '-');
    raise exception 'Sign out, then sign back in with your authenticator code before generating new recovery codes.'
      using errcode = '42501';
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

revoke all on function public.generate_internal_recovery_codes(int) from public, anon;
grant execute on function public.generate_internal_recovery_codes(int) to authenticated;

-- Deleting codes. settings.html calls this right after turning two-factor
-- off, when no authenticator is left, so that path is unchanged. What's
-- refused is a password-only session wiping the codes of an account that
-- still has its authenticator (taking away the owner's way back in).
create or replace function public.delete_internal_recovery_codes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'
  ) and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise warning 'internal_mfa_gate blocked source=rpc:delete_internal_recovery_codes user=% session=% aal=%',
      coalesce(auth.uid()::text, '-'), coalesce(auth.jwt() ->> 'session_id', '-'), coalesce(auth.jwt() ->> 'aal', '-');
    raise exception 'Sign out, then sign back in with your authenticator code first.'
      using errcode = '42501';
  end if;

  delete from internal_mfa_recovery_codes where user_id = auth.uid();
end;
$$;

revoke all on function public.delete_internal_recovery_codes() from public, anon;
grant execute on function public.delete_internal_recovery_codes() to authenticated;

-- Signing in with a recovery code. Called by tools/login.html with the
-- password-verified (aal1) session, in place of a 6-digit code. On a valid,
-- unused code, all in one transaction (so a code is never spent without the
-- account being let back in, or the other way round):
--   * the code is marked used;
--   * the account's authenticator(s) are removed -- the code stands in for a
--     phone that's lost or unavailable, and while a verified authenticator
--     exists the server keeps refusing this aal1 session;
--   * the account's other unused codes go too (they backed up that
--     authenticator; login.html's re-enrollment issues a fresh set);
--   * every other signed-in session for the account is signed out, since a
--     lost phone may still hold a fully verified one. The recovering
--     session (the JWT's session_id) is kept.
-- Returns false, changing nothing, for an invalid or used code, a
-- non-internal account, or an account with no authenticator to recover.
create or replace function public.redeem_internal_recovery_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_session_text text := auth.jwt() ->> 'session_id';
  v_code_id uuid;
begin
  if v_user_id is null or p_code is null or length(trim(p_code)) = 0 then
    return false;
  end if;

  if not exists (select 1 from public.account_roles where email = v_email) then
    return false;
  end if;

  if not exists (
    select 1 from auth.mfa_factors f where f.user_id = v_user_id and f.status = 'verified'
  ) then
    return false;
  end if;

  -- Codes are stored uppercase (XXXX-XXXX); accept them typed in lowercase
  -- or pasted with surrounding spaces. FOR UPDATE: two tabs racing the same
  -- code can't both succeed.
  select c.id into v_code_id
  from internal_mfa_recovery_codes c
  where c.user_id = v_user_id
    and c.used_at is null
    and c.code_hash = crypt(upper(trim(p_code)), c.code_hash)
  limit 1
  for update;

  if v_code_id is null then
    perform public.log_internal_mfa_gate(v_user_id, v_email, v_session_text, auth.jwt() ->> 'aal',
      'rpc:redeem_internal_recovery_code', 'recovery_rejected');
    return false;
  end if;

  update internal_mfa_recovery_codes set used_at = now() where id = v_code_id;

  delete from auth.mfa_factors where user_id = v_user_id;

  delete from internal_mfa_recovery_codes where user_id = v_user_id and used_at is null;

  if v_session_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    delete from auth.sessions where user_id = v_user_id and id <> v_session_text::uuid;
  end if;

  perform public.log_internal_mfa_gate(v_user_id, v_email, v_session_text, auth.jwt() ->> 'aal',
    'rpc:redeem_internal_recovery_code', 'recovery_redeemed');
  return true;
end;
$$;

revoke all on function public.redeem_internal_recovery_code(text) from public, anon;
grant execute on function public.redeem_internal_recovery_code(text) to authenticated;

-- The old name, which login.html called before this change. Kept, and now
-- does exactly what redeem does, so a cached copy of the old page can't
-- consume a code and leave behind a session the server then refuses.
create or replace function public.verify_and_consume_internal_recovery_code(p_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.redeem_internal_recovery_code(p_code);
$$;

revoke all on function public.verify_and_consume_internal_recovery_code(text) from public, anon;
grant execute on function public.verify_and_consume_internal_recovery_code(text) to authenticated;
