-- Trusted devices: skip the 2FA code for 30 days on a known device (2026-11-01)
-- ---------------------------------------------------------------------------
-- Approved by Connor: "trusted device skips 2FA for 30 days." One system for
-- BOTH sign-in pages (portal/login.html, supabase-js; tools/login.html, raw
-- fetch). Both call the same functions below; neither keeps its own copy.
--
-- What it does
--   * After a correct 6-digit code (an aal2 session) with "Trust this device
--     for 30 days" on, the page calls trust_this_device(). It mints a random
--     256-bit token, stores ONLY its bcrypt hash, and returns the plaintext
--     once. The browser keeps it in localStorage.
--   * Next time, after a correct PASSWORD, the page calls
--     use_trusted_device(id, token). If the token matches an unexpired,
--     unrevoked row for this same account, the session that just proved the
--     password is recorded as trusted (trusted_device_sessions) and the code
--     step is skipped. The password is never skipped: this function can only
--     be reached with a session the password already produced.
--   * Any other device still gets the code, exactly as before.
--
-- Hashing: the same approach as internal_mfa_recovery_codes
-- (add_internal_mfa_recovery_codes.sql): pgcrypto bcrypt,
-- crypt(token, gen_salt('bf')), compared with crypt(input, stored_hash)
-- inside the database. Same "deny-all table, SECURITY DEFINER functions are
-- the only way in" shape, and every function is keyed to auth.uid(), never a
-- caller-supplied user id. search_path includes `extensions`, where Supabase
-- installs pgcrypto (fix_internal_mfa_recovery_codes_search_path.sql).
--
-- Why no edge function: the comparison already happens server-side, in
-- Postgres, against a table no client can read. The browser only ever sends
-- the plaintext token and gets back true/false. That is the property an edge
-- function would buy, with one less thing to deploy.
--
-- Revocation is checked on every use, not only by deleting rows, so it holds
-- whichever path made the change (the portal, the Workspace, a reset email,
-- or the Supabase dashboard):
--   * Password change: each row stores password_marker, the SHA-256 of the
--     account's bcrypt password hash at trust time. A changed password
--     changes the hash, so every older row stops matching. (The marker is a
--     hash of a salted hash; it can't be used to test password guesses.)
--   * 2FA turned off, reset or re-enrolled, or a Workspace recovery code
--     redeemed (which removes the authenticator): each row stores the
--     factor_id it was granted under, and only counts while that exact factor
--     still exists and is verified. A new authenticator is a new factor id.
--   * Expiry: expires_at = created + 30 days. A session trusted on day 29
--     stops counting on day 30 too.
--   * Remove (Settings) and revoke_all_trusted_devices() delete rows outright.
--
-- Additive only: two new tables and new functions. Nothing existing is
-- changed. This file does NOT touch the Workspace's server-side 2FA gate:
-- in `log` mode (live today) a trusted Workspace session is let through as
-- it always has been; in `enforce` mode it is refused and tools/login.html
-- asks for the code. Teaching the gate about trusted sessions replaces
-- existing function bodies, so it is a separate change held for its own
-- review (see docs/SIGNIN.md).
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

create table if not exists public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null,
  factor_id uuid not null,
  password_marker text not null,
  label text,
  surface text not null check (surface in ('portal', 'tools')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz
);

create index if not exists idx_trusted_devices_user_id on public.trusted_devices(user_id);

alter table public.trusted_devices enable row level security;
-- No policies: deny-all. Same belt-and-braces revoke as the recovery codes.
revoke all on public.trusted_devices from anon, authenticated;

-- Which signed-in sessions got past the code by a trusted device. Keyed by
-- the JWT's session_id, which stays the same across token refreshes.
create table if not exists public.trusted_device_sessions (
  session_id uuid primary key,
  device_id uuid not null references public.trusted_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_trusted_device_sessions_device_id on public.trusted_device_sessions(device_id);

alter table public.trusted_device_sessions enable row level security;
revoke all on public.trusted_device_sessions from anon, authenticated;

-- ---- Internal helpers (no EXECUTE for anon or authenticated) --------------

-- The account's current password marker. NULL when there is no password.
create or replace function public.trusted_device_password_marker(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(u.encrypted_password, 'sha256'), 'hex')
  from auth.users u
  where u.id = p_user_id and coalesce(u.encrypted_password, '') <> '';
$$;

revoke all on function public.trusted_device_password_marker(uuid) from public, anon, authenticated;

-- One rule for "does this row still count": not expired, granted under an
-- authenticator that still exists and is verified, and the password hasn't
-- changed since.
create or replace function public.trusted_device_row_valid(
  p_user_id uuid, p_factor_id uuid, p_password_marker text, p_expires_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_expires_at > now()
     and exists (
       select 1 from auth.mfa_factors f
       where f.id = p_factor_id and f.user_id = p_user_id and f.status = 'verified'
     )
     and p_password_marker is not distinct from public.trusted_device_password_marker(p_user_id)
     and p_password_marker is not null;
$$;

revoke all on function public.trusted_device_row_valid(uuid, uuid, text, timestamptz) from public, anon, authenticated;

-- True when this session (by its JWT session_id) passed sign-in on a trusted
-- device that still counts. Used by current_session_is_trusted() below and by
-- the Workspace 2FA gate (separate migration). Never raises.
create or replace function public.trusted_device_session_valid(p_user_id uuid, p_session_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_session_id is null
     or p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1
    from public.trusted_device_sessions s
    join public.trusted_devices d on d.id = s.device_id
    where s.session_id = p_session_id::uuid
      and s.user_id = p_user_id
      and d.user_id = p_user_id
      and public.trusted_device_row_valid(d.user_id, d.factor_id, d.password_marker, d.expires_at)
  );
exception when others then
  return false;
end;
$$;

revoke all on function public.trusted_device_session_valid(uuid, text) from public, anon, authenticated;

-- ---- Called by the sign-in pages and Settings ------------------------------

-- Right after a correct code. Only an aal2 session on an account with a
-- verified authenticator may mint trust: a password alone must never be able
-- to make a device trusted. Returns the plaintext token exactly once; only
-- its bcrypt hash is stored. Keeps at most 10 live devices per account (the
-- oldest goes) and clears this account's dead rows while it is here.
create or replace function public.trust_this_device(p_label text default null, p_surface text default 'portal')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_factor_id uuid;
  v_marker text;
  v_token text;
  v_id uuid;
  v_expires timestamptz := now() + interval '30 days';
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Enter your authenticator code before trusting this device.' using errcode = '42501';
  end if;
  if p_surface is null or p_surface not in ('portal', 'tools') then
    raise exception 'Unknown sign-in page.' using errcode = '22023';
  end if;

  select f.id into v_factor_id
  from auth.mfa_factors f
  where f.user_id = v_user_id and f.status = 'verified'
  limit 1;
  if v_factor_id is null then
    raise exception 'Two-factor authentication is not on for this account.' using errcode = '42501';
  end if;

  v_marker := public.trusted_device_password_marker(v_user_id);
  if v_marker is null then
    raise exception 'This account has no password to pair a trusted device with.' using errcode = '42501';
  end if;

  delete from public.trusted_devices d
  where d.user_id = v_user_id
    and not public.trusted_device_row_valid(d.user_id, d.factor_id, d.password_marker, d.expires_at);

  delete from public.trusted_devices d
  where d.id in (
    select x.id from public.trusted_devices x
    where x.user_id = v_user_id
    order by x.created_at desc
    offset 9
  );

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.trusted_devices (user_id, token_hash, factor_id, password_marker, label, surface, expires_at)
  values (v_user_id, crypt(v_token, gen_salt('bf')), v_factor_id, v_marker,
          nullif(left(btrim(coalesce(p_label, '')), 80), ''), p_surface, v_expires)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires);
end;
$$;

revoke all on function public.trust_this_device(text, text) from public, anon;
grant execute on function public.trust_this_device(text, text) to authenticated;

-- After a correct password, on a device holding a token. True (and this
-- session is recorded as trusted) only when the token matches a row of the
-- CALLING account that still counts. False otherwise, changing nothing; the
-- page then shows the code step as usual. The token is 256 random bits, so
-- guessing is not a concern; bcrypt keeps a leaked table from being replayed.
create or replace function public.use_trusted_device(p_device_id uuid, p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_text text := auth.jwt() ->> 'session_id';
  v_id uuid;
begin
  if v_user_id is null or p_device_id is null or p_token is null or length(p_token) = 0
     or v_session_text is null
     or v_session_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  select d.id into v_id
  from public.trusted_devices d
  where d.id = p_device_id
    and d.user_id = v_user_id
    and public.trusted_device_row_valid(d.user_id, d.factor_id, d.password_marker, d.expires_at)
    and d.token_hash = crypt(p_token, d.token_hash)
  for update;

  if v_id is null then
    return false;
  end if;

  insert into public.trusted_device_sessions (session_id, device_id, user_id)
  values (v_session_text::uuid, v_id, v_user_id)
  on conflict (session_id) do update set device_id = excluded.device_id
    where public.trusted_device_sessions.user_id = excluded.user_id;

  update public.trusted_devices set last_used_at = now() where id = v_id;
  return true;
end;
$$;

revoke all on function public.use_trusted_device(uuid, text) from public, anon;
grant execute on function public.use_trusted_device(uuid, text) to authenticated;

-- For the portal's per-page "second step owed?" check (portal-app.js): true
-- when THIS session got in on a trusted device that still counts.
create or replace function public.current_session_is_trusted()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.trusted_device_session_valid(auth.uid(), auth.jwt() ->> 'session_id');
$$;

revoke all on function public.current_session_is_trusted() from public, anon;
grant execute on function public.current_session_is_trusted() to authenticated;

-- Settings → Trusted devices. The CALLING account's devices that still
-- count. Never returns the hash, the factor id or the password marker.
create or replace function public.list_my_trusted_devices()
returns table (id uuid, label text, surface text, created_at timestamptz, expires_at timestamptz, last_used_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.label, d.surface, d.created_at, d.expires_at, d.last_used_at
  from public.trusted_devices d
  where d.user_id = auth.uid()
    and public.trusted_device_row_valid(d.user_id, d.factor_id, d.password_marker, d.expires_at)
  order by d.created_at desc;
$$;

revoke all on function public.list_my_trusted_devices() from public, anon;
grant execute on function public.list_my_trusted_devices() to authenticated;

-- Settings → Remove. Revokes one device of the CALLING account, and with it
-- any session that got in on it. Any signed-in session may remove trust;
-- taking trust away never needs the code.
create or replace function public.revoke_trusted_device(p_device_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if auth.uid() is null or p_device_id is null then
    return false;
  end if;
  delete from public.trusted_devices where id = p_device_id and user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.revoke_trusted_device(uuid) from public, anon;
grant execute on function public.revoke_trusted_device(uuid) to authenticated;

-- Revokes every trusted device of the CALLING account. Called after a
-- password change and when 2FA is turned off or set up again. (The checks in
-- trusted_device_row_valid() already make those rows dead; this clears them
-- so Settings shows the truth straight away.) Returns how many were removed.
create or replace function public.revoke_all_trusted_devices()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    return 0;
  end if;
  delete from public.trusted_devices where user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.revoke_all_trusted_devices() from public, anon;
grant execute on function public.revoke_all_trusted_devices() to authenticated;
