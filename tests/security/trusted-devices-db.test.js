// Trusted devices (2026-11-01): "trusted device skips 2FA for 30 days."
//
// Runs the real migration files in PGlite (real PostgreSQL in WASM, with
// pgcrypto installed in `extensions` the way Supabase does it) on top of the
// live pieces they touch: Supabase's roles and auth helpers, auth.users
// (with encrypted_password), auth.mfa_factors, the recovery-code objects and
// the Workspace's server-side 2FA gate (enforce_internal_mfa_server_side.sql),
// and an internal table carrying its live RLS policy shape.
//
// What is proved here, against the database itself rather than the UI:
//   - only the bcrypt hash of a device token is ever stored (the plaintext is
//     looked for in every column of every row the feature writes);
//   - trust can only be minted after the code (aal2), never by a password;
//   - a trusted device skips the code, an untrusted one doesn't, and a device
//     past 30 days doesn't;
//   - a password change, a 2FA reset, and a recovery-code redemption each
//     revoke every device, whichever page made the change;
//   - Remove revokes exactly one device; nobody can touch another account's;
//   - the migration is additive: it defines no function that already exists;
//   - without the (separate, held) gate change, the Workspace's 2FA gate
//     treats a trusted session as it always has: not blocked in `log` mode,
//     refused in `enforce` mode, where tools/login.html asks for the code.
//
// Teaching the gate about trusted sessions replaces existing function
// bodies, so that change was split out on 2026-11-01 into its own draft PR,
// held for separate review; its tests travel with it.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');

const TRUSTED = read('sql', 'security', 'add_trusted_devices.sql');
const ENFORCE = read('sql', 'security', 'enforce_internal_mfa_server_side.sql');

const CONNOR = { id: '22222222-2222-4222-8222-222222222222', email: 'connor@triplehenterprisesllc.biz' };
const CLIENT = { id: '33333333-3333-4333-8333-333333333333', email: 'client@example.com' };
const STEVE = { id: '11111111-1111-4111-8111-111111111111', email: 'steve@triplehenterprisesllc.biz' };
const CONNOR_FACTOR = 'aaaaaaaa-0000-4000-8000-000000000001';
const CLIENT_FACTOR = 'aaaaaaaa-0000-4000-8000-000000000003';

// Session ids: one per sign-in.
let sessionSeq = 0;
const newSession = () => `bbbbbbbb-0000-4000-8000-${String(++sessionSeq).padStart(12, '0')}`;

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
  create extension pgcrypto schema extensions;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;

  create table auth.users (id uuid primary key, email text, encrypted_password text);
  create type auth.factor_status as enum ('unverified', 'verified');
  create table auth.mfa_factors (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    factor_type text not null default 'totp',
    status auth.factor_status not null
  );
  create table auth.mfa_challenges (
    id uuid primary key default gen_random_uuid(),
    factor_id uuid not null references auth.mfa_factors(id) on delete cascade
  );
  create table auth.sessions (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    aal text,
    factor_id uuid
  );
  create table auth.refresh_tokens (
    id bigserial primary key,
    session_id uuid references auth.sessions(id) on delete cascade,
    token text
  );

  create table public.account_roles (email text primary key, role_name text, can_manage_roles boolean not null default false);
  alter table public.account_roles enable row level security;
  create function public.current_user_has_any_role() returns boolean
    language sql stable security definer set search_path to 'public' as $$
    select exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email'));
  $$;
  revoke execute on function public.current_user_has_any_role() from public, anon;
  grant execute on function public.current_user_has_any_role() to authenticated, service_role;
  create policy "Authenticated can view account roles" on public.account_roles
    for select to authenticated using ((select public.current_user_has_any_role()));

  -- An internal table with the bare current_user_has_any_role() policy shape.
  create table public.stripe_customers (email text primary key, customer_id text);
  alter table public.stripe_customers enable row level security;
  create policy "internal accounts can view stripe customer mappings" on public.stripe_customers
    for select to authenticated using (current_user_has_any_role());
  grant select on public.account_roles, public.stripe_customers to anon, authenticated, service_role;
`;

const SEED = `
  insert into auth.users (id, email, encrypted_password) values
    ('${CONNOR.id}', '${CONNOR.email}', extensions.crypt('connor-pw', extensions.gen_salt('bf', 4))),
    ('${CLIENT.id}', '${CLIENT.email}', extensions.crypt('client-pw', extensions.gen_salt('bf', 4))),
    ('${STEVE.id}', '${STEVE.email}', extensions.crypt('steve-pw', extensions.gen_salt('bf', 4)));
  insert into auth.mfa_factors (id, user_id, status) values
    ('${CONNOR_FACTOR}', '${CONNOR.id}', 'verified'),
    ('${CLIENT_FACTOR}', '${CLIENT.id}', 'verified');
  insert into public.account_roles (email, role_name, can_manage_roles) values
    ('${CONNOR.email}', 'Developer', true), ('${STEVE.email}', 'Owner', true);
  insert into public.stripe_customers values ('a@example.com', 'cus_1'), ('b@example.com', 'cus_2');
`;

const PRIOR_RECOVERY_SQL = [
  read('sql', 'security', 'add_internal_mfa_recovery_codes.sql'),
  read('sql', 'security', 'fix_internal_mfa_recovery_codes_search_path.sql'),
];

const dbs = [];
after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

async function buildDb({ trusted = true } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  dbs.push(db);
  await db.exec(BASE_SCHEMA);
  for (const sql of PRIOR_RECOVERY_SQL) await db.exec(sql);
  await db.exec(SEED);
  await db.exec(ENFORCE);
  if (trusted) await db.exec(TRUSTED);
  return db;
}
let sharedDb = null;
const db0 = () => (sharedDb = sharedDb || buildDb());

const claims = (user, aal, sessionId) => ({ sub: user.id, email: user.email, role: 'authenticated', aal, session_id: sessionId });

// One test = one transaction, rolled back at the end. as() runs a statement
// the way PostgREST would (role switched, JWT claims set) in a savepoint.
async function scenario(fn, dbPromise) {
  const db = await (dbPromise || db0());
  await db.exec('begin');
  const run = async (role, c, sql, params = []) => {
    await db.exec('savepoint step');
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(c || {})]);
    await db.exec(`set local role ${role}`);
    try {
      const r = await db.query(sql, params);
      await db.exec('reset role');
      await db.exec('release savepoint step');
      return { rows: r.rows };
    } catch (error) {
      await db.exec('rollback to savepoint step');
      return { error };
    }
  };
  const ctx = {
    db,
    as: (c, sql, params) => run('authenticated', c, sql, params),
    asAnon: (sql, params) => run('anon', { role: 'anon' }, sql, params),
    asService: (sql, params) => run('service_role', { role: 'service_role' }, sql, params),
    admin: async (sql, params = []) => (await db.query(sql, params)).rows,
    // Code just verified on this device, with "Trust this device" on.
    trust: async (user, label = 'Safari on iPhone', surface = 'portal') => {
      const r = await run('authenticated', claims(user, 'aal2', newSession()),
        'select public.trust_this_device($1, $2) as t', [label, surface]);
      if (r.error) throw r.error;
      return r.rows[0].t;
    },
    // A later password sign-in on the device holding `device`. Returns the
    // new (aal1) session's claims and whether the code was skipped.
    signInWithPassword: async (user, device) => {
      const c = claims(user, 'aal1', newSession());
      if (!device) return { claims: c, skipped: false };
      const r = await run('authenticated', c, 'select public.use_trusted_device($1, $2) as ok', [device.id, device.token]);
      if (r.error) throw r.error;
      return { claims: c, skipped: r.rows[0].ok === true };
    },
    isTrusted: async (c) => (await run('authenticated', c, 'select public.current_session_is_trusted() as t')).rows[0].t,
    listFor: async (user) => (await run('authenticated', claims(user, 'aal1', newSession()), 'select * from public.list_my_trusted_devices()')).rows,
  };
  try {
    await fn(ctx);
  } finally {
    await db.exec('rollback');
  }
}

// ---- storage: hash only -----------------------------------------------------

test('trusting a device stores only a bcrypt hash of the token, never the token itself, anywhere', async () => {
  await scenario(async (ctx) => {
    const device = await ctx.trust(CONNOR, 'Chrome on Mac', 'tools');
    assert.match(device.token, /^[0-9a-f]{64}$/, '256 random bits, hex');
    assert.match(device.id, /^[0-9a-f-]{36}$/);
    const expiresInDays = (new Date(device.expires_at) - Date.now()) / 86400000;
    assert.ok(expiresInDays > 29.9 && expiresInDays <= 30, `expires in 30 days (got ${expiresInDays})`);

    // What was actually persisted.
    const rows = await ctx.admin('select * from public.trusted_devices');
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.match(row.token_hash, /^\$2[abxy]\$\d\d\$/, 'a bcrypt hash');
    assert.notEqual(row.token_hash, device.token);
    for (const [col, value] of Object.entries(row)) {
      assert.ok(!String(value).includes(device.token), `column ${col} must not contain the plaintext token`);
    }
    // The hash really is of this token (so it can be checked), and is salted.
    const [{ same }] = await ctx.admin('select extensions.crypt($1, $2) = $2 as same', [device.token, row.token_hash]);
    assert.equal(same, true);
    const [{ again }] = await ctx.admin("select extensions.crypt($1, extensions.gen_salt('bf')) as again", [device.token]);
    assert.notEqual(again, row.token_hash, 'salted: hashing the same token again gives a different string');
    assert.equal(row.factor_id, CONNOR_FACTOR);
    assert.equal(row.surface, 'tools');
    assert.equal(row.label, 'Chrome on Mac');

    // The password marker is not the password hash (nor the password).
    const [u] = await ctx.admin('select encrypted_password from auth.users where id = $1', [CONNOR.id]);
    assert.notEqual(row.password_marker, u.encrypted_password);
    assert.match(row.password_marker, /^[0-9a-f]{64}$/);

    // Nothing in the sessions table holds the token either, after a use.
    const used = await ctx.signInWithPassword(CONNOR, device);
    assert.equal(used.skipped, true);
    for (const r of await ctx.admin('select * from public.trusted_device_sessions')) {
      for (const value of Object.values(r)) assert.ok(!String(value).includes(device.token));
    }
  });
});

test('no browser role can read either table directly, or call the internal helpers', async () => {
  await scenario(async (ctx) => {
    await ctx.trust(CONNOR);
    for (const table of ['trusted_devices', 'trusted_device_sessions']) {
      const asUser = await ctx.as(claims(CONNOR, 'aal2', newSession()), `select * from public.${table}`);
      assert.match(String(asUser.error && asUser.error.message), /permission denied/, `${table} as its own user`);
      const asAnon = await ctx.asAnon(`select * from public.${table}`);
      assert.match(String(asAnon.error && asAnon.error.message), /permission denied/, `${table} as anon`);
    }
    for (const fn of [
      `public.trusted_device_session_valid('${CONNOR.id}', '${newSession()}')`,
      `public.trusted_device_password_marker('${CONNOR.id}')`,
    ]) {
      const r = await ctx.as(claims(CONNOR, 'aal2', newSession()), `select ${fn}`);
      assert.match(String(r.error && r.error.message), /permission denied/, fn);
    }
    const anon = await ctx.asAnon("select public.trust_this_device('x', 'portal')");
    assert.match(String(anon.error && anon.error.message), /permission denied/);
    const listed = await ctx.listFor(CONNOR);
    assert.deepEqual(Object.keys(listed[0]).sort(), ['created_at', 'expires_at', 'id', 'label', 'last_used_at', 'surface'],
      'the list never returns the hash, the factor id or the password marker');
  });
});

// ---- minting trust ---------------------------------------------------------------

test('a password alone (aal1) can never make a device trusted', async () => {
  await scenario(async (ctx) => {
    const r = await ctx.as(claims(CONNOR, 'aal1', newSession()), "select public.trust_this_device('x', 'portal')");
    assert.match(String(r.error && r.error.message), /Enter your authenticator code/);
    assert.equal((await ctx.admin('select count(*)::int n from public.trusted_devices'))[0].n, 0);
  });
});

test('an account with no authenticator has no code to skip, so it cannot trust a device', async () => {
  await scenario(async (ctx) => {
    const r = await ctx.as(claims(STEVE, 'aal2', newSession()), "select public.trust_this_device('x', 'tools')");
    assert.match(String(r.error && r.error.message), /not on for this account/);
  });
});

test('an unknown surface is refused; a long label is trimmed to 80 characters', async () => {
  await scenario(async (ctx) => {
    const r = await ctx.as(claims(CONNOR, 'aal2', newSession()), "select public.trust_this_device('x', 'admin')");
    assert.ok(r.error);
    await ctx.trust(CONNOR, 'x'.repeat(300));
    assert.equal((await ctx.admin('select length(label) n from public.trusted_devices'))[0].n, 80);
  });
});

// ---- using trust -------------------------------------------------------------------

test('a trusted device skips the code within 30 days; the session is recorded as trusted', async () => {
  await scenario(async (ctx) => {
    const device = await ctx.trust(CLIENT);
    const s = await ctx.signInWithPassword(CLIENT, device);
    assert.equal(s.skipped, true);
    assert.equal(await ctx.isTrusted(s.claims), true);
    const [row] = await ctx.admin('select last_used_at from public.trusted_devices');
    assert.ok(row.last_used_at, 'last used is recorded');
  });
});

test('an untrusted device still needs the code: no token, a wrong token, or another device id all fail', async () => {
  await scenario(async (ctx) => {
    const device = await ctx.trust(CLIENT);
    const none = await ctx.signInWithPassword(CLIENT, null);
    assert.equal(none.skipped, false);
    assert.equal(await ctx.isTrusted(none.claims), false);
    const wrong = await ctx.signInWithPassword(CLIENT, { id: device.id, token: 'f'.repeat(64) });
    assert.equal(wrong.skipped, false);
    assert.equal(await ctx.isTrusted(wrong.claims), false);
    const otherId = await ctx.signInWithPassword(CLIENT, { id: 'cccccccc-0000-4000-8000-000000000000', token: device.token });
    assert.equal(otherId.skipped, false);
  });
});

test("another account can't use a stolen device id + token: trust is per account", async () => {
  await scenario(async (ctx) => {
    const device = await ctx.trust(CLIENT);
    const thief = await ctx.signInWithPassword(CONNOR, device);
    assert.equal(thief.skipped, false);
    assert.equal(await ctx.isTrusted(thief.claims), false);
  });
});

test('a device past its 30 days needs the code again, and drops off the list', async () => {
  await scenario(async (ctx) => {
    const device = await ctx.trust(CLIENT);
    const during = await ctx.signInWithPassword(CLIENT, device);
    assert.equal(during.skipped, true);
    await ctx.admin("update public.trusted_devices set expires_at = now() - interval '1 second'");
    const afterExpiry = await ctx.signInWithPassword(CLIENT, device);
    assert.equal(afterExpiry.skipped, false);
    assert.equal(await ctx.isTrusted(during.claims), false, 'a session trusted before expiry stops counting too');
    assert.deepEqual(await ctx.listFor(CLIENT), []);
  });
});

// ---- revocation ---------------------------------------------------------------------

test('changing the password revokes every trusted device, whatever page (or the dashboard) changed it', async () => {
  await scenario(async (ctx) => {
    const phone = await ctx.trust(CONNOR, 'Safari on iPhone', 'tools');
    const laptop = await ctx.trust(CONNOR, 'Chrome on Mac', 'portal');
    const live = await ctx.signInWithPassword(CONNOR, phone);
    assert.equal(live.skipped, true);
    assert.equal((await ctx.listFor(CONNOR)).length, 2);

    // GoTrue writes a new bcrypt hash; nothing in the app is involved.
    await ctx.admin("update auth.users set encrypted_password = extensions.crypt('new-pw', extensions.gen_salt('bf', 4)) where id = $1", [CONNOR.id]);

    assert.equal((await ctx.signInWithPassword(CONNOR, phone)).skipped, false);
    assert.equal((await ctx.signInWithPassword(CONNOR, laptop)).skipped, false);
    assert.equal(await ctx.isTrusted(live.claims), false, 'an already trusted session loses it too');
    assert.deepEqual(await ctx.listFor(CONNOR), []);
  });
});

test('the in-app revoke-all after a password change deletes the rows outright', async () => {
  await scenario(async (ctx) => {
    await ctx.trust(CONNOR);
    await ctx.trust(CONNOR);
    await ctx.trust(CLIENT);
    const r = await ctx.as(claims(CONNOR, 'aal1', newSession()), 'select public.revoke_all_trusted_devices() as n');
    assert.equal(r.rows[0].n, 2);
    assert.equal((await ctx.admin('select count(*)::int n from public.trusted_devices where user_id = $1', [CONNOR.id]))[0].n, 0);
    assert.equal((await ctx.admin('select count(*)::int n from public.trusted_devices where user_id = $1', [CLIENT.id]))[0].n, 1, "another account's devices are untouched");
  });
});

test('turning 2FA off revokes every trusted device, and turning it back on does not bring them back', async () => {
  await scenario(async (ctx) => {
    const device = await ctx.trust(CLIENT);
    assert.equal((await ctx.signInWithPassword(CLIENT, device)).skipped, true);
    await ctx.admin('delete from auth.mfa_factors where id = $1', [CLIENT_FACTOR]);
    assert.equal((await ctx.signInWithPassword(CLIENT, device)).skipped, false);
    // Re-enabled: a brand-new authenticator.
    await ctx.admin("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [CLIENT.id]);
    assert.equal((await ctx.signInWithPassword(CLIENT, device)).skipped, false);
    assert.deepEqual(await ctx.listFor(CLIENT), []);
  });
});

test('a Workspace recovery-code sign-in (lost phone) revokes every trusted device', async () => {
  await scenario(async (ctx) => {
    const device = await ctx.trust(CONNOR, 'Chrome on Mac', 'tools');
    const codes = (await ctx.as(claims(CONNOR, 'aal2', newSession()), 'select public.generate_internal_recovery_codes(2) as c')).rows[0].c;
    const redeem = await ctx.as(claims(CONNOR, 'aal1', newSession()), 'select public.redeem_internal_recovery_code($1) as ok', [codes[0]]);
    assert.equal(redeem.rows[0].ok, true);
    assert.equal((await ctx.signInWithPassword(CONNOR, device)).skipped, false);
  });
});

test('Remove revokes just that one device; another account cannot remove it', async () => {
  await scenario(async (ctx) => {
    const phone = await ctx.trust(CLIENT, 'Safari on iPhone');
    const laptop = await ctx.trust(CLIENT, 'Chrome on Windows');
    const phoneSession = await ctx.signInWithPassword(CLIENT, phone);

    const stranger = await ctx.as(claims(CONNOR, 'aal2', newSession()), 'select public.revoke_trusted_device($1) as ok', [phone.id]);
    assert.equal(stranger.rows[0].ok, false);
    assert.equal((await ctx.listFor(CLIENT)).length, 2);

    const own = await ctx.as(claims(CLIENT, 'aal1', newSession()), 'select public.revoke_trusted_device($1) as ok', [phone.id]);
    assert.equal(own.rows[0].ok, true, 'removing trust never needs the code');
    assert.equal((await ctx.signInWithPassword(CLIENT, phone)).skipped, false);
    assert.equal(await ctx.isTrusted(phoneSession.claims), false, 'the session it let in loses trust too');
    assert.equal((await ctx.signInWithPassword(CLIENT, laptop)).skipped, true, 'the other device still works');
    assert.deepEqual((await ctx.listFor(CLIENT)).map((d) => d.label), ['Chrome on Windows']);
  });
});

test('at most 10 trusted devices per account: the oldest goes', async () => {
  await scenario(async (ctx) => {
    const first = await ctx.trust(CLIENT, 'device 1');
    await ctx.admin("update public.trusted_devices set created_at = now() - interval '1 day'");
    for (let i = 2; i <= 11; i++) await ctx.trust(CLIENT, `device ${i}`);
    assert.equal((await ctx.listFor(CLIENT)).length, 10);
    assert.equal((await ctx.signInWithPassword(CLIENT, first)).skipped, false);
  });
});

test('the migration is safe to run twice', async () => {
  const db = await buildDb();
  await db.exec(TRUSTED);
  await scenario(async (ctx) => {
    const d = await ctx.trust(CLIENT);
    assert.equal((await ctx.signInWithPassword(CLIENT, d)).skipped, true);
  }, Promise.resolve(db));
});

// ---- the Workspace's server-side 2FA gate, untouched by this migration --------------

const setMode = (ctx, mode) => ctx.admin('update public.internal_mfa_enforcement set mode = $1 where id', [mode]);

test("log mode (live today): a trusted Workspace session is not blocked, so trusted sign-in works without the gate change", async () => {
  await scenario(async (ctx) => {
    await setMode(ctx, 'log');
    const device = await ctx.trust(CONNOR, 'Chrome on Mac', 'tools');
    const s = await ctx.signInWithPassword(CONNOR, device);
    assert.equal(s.skipped, true);
    const status = await ctx.as(s.claims, 'select public.internal_mfa_session_status() s');
    assert.deepEqual(status.rows[0].s, { internal: true, meets: false, blocked: false });
  });
});

test('without the gate migration the Workspace refuses trusted sessions in enforce mode (tools/login.html falls back to the code)', async () => {
  await scenario(async (ctx) => {
    await setMode(ctx, 'enforce');
    const device = await ctx.trust(CONNOR, 'Chrome on Mac', 'tools');
    const s = await ctx.signInWithPassword(CONNOR, device);
    assert.equal(s.skipped, true);
    const status = await ctx.as(s.claims, 'select public.internal_mfa_session_status() s');
    assert.equal(status.rows[0].s.blocked, true);
  });
});

test('additive only: the migration leaves every existing function body exactly as it was', async () => {
  const fnDefs = async (db) => (await db.query(`
    select p.oid::regprocedure::text as sig, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'auth') order by 1`)).rows;
  const before = await fnDefs(await buildDb({ trusted: false }));
  const after = await fnDefs(await db0());
  const afterBySig = new Map(after.map((r) => [r.sig, r.h]));
  for (const r of before) assert.equal(afterBySig.get(r.sig), r.h, `${r.sig} was changed`);
  assert.ok(after.length > before.length);
  // And in the text: no gate function is redefined here.
  assert.doesNotMatch(TRUSTED, /function public\.(internal_mfa_session_ok|check_internal_mfa_for_edge_function|internal_mfa_session_status)\b/);
});
