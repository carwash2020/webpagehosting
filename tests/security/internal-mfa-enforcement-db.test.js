// Server-side two-factor enforcement for internal accounts (2026-09-25,
// docs/ACTION-ITEMS.md #13; audit 2026-09-23 round 3 finding #4).
//
// Runs the real migration files in PGlite (a real PostgreSQL build in WASM)
// on top of the pieces of the live schema they touch: Supabase's roles and
// auth helpers, auth.users / mfa_factors / sessions, the recovery-code table
// and functions as they were live before this change (the 2026-09-22
// migration plus its search_path fix), and a sample of internal tables
// carrying their live RLS policies, copied from pg_policies on 2026-09-25:
// the inline `exists (select 1 from account_roles ...)` shape (invoices,
// workspace_sync), the bare current_user_has_any_role() shape
// (stripe_customers), the client-or-internal shape (client_portal_jobs), and
// account_roles' own policies, which everything else reads through.
//
// The two accounts are shaped like the real ones on 2026-09-25: the Developer
// has a verified authenticator and 10 recovery codes; the Owner has no
// authenticator at all. A portal client with its own portal authenticator,
// and a stranger (open signup), are the two accounts that must never gain
// anything from this.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');

const MIGRATION = read('sql', 'security', 'enforce_internal_mfa_server_side.sql');
const ROLLBACK = read('sql', 'security', 'rollback_enforce_internal_mfa_server_side.sql');

const STEVE = { id: '11111111-1111-4111-8111-111111111111', email: 'steve@triplehenterprisesllc.biz' };
const CONNOR = { id: '22222222-2222-4222-8222-222222222222', email: 'connor@triplehenterprisesllc.biz' };
const CLIENT = { id: '33333333-3333-4333-8333-333333333333', email: 'client@example.com' };
const STRANGER = { id: '44444444-4444-4444-8444-444444444444', email: 'stranger@example.com' };

const CONNOR_FACTOR = 'aaaaaaaa-0000-4000-8000-000000000001';
const CLIENT_FACTOR = 'aaaaaaaa-0000-4000-8000-000000000003';
// Connor's sessions: the one signing in now, and two other devices.
const S_CONNOR_HERE = 'bbbbbbbb-0000-4000-8000-000000000001';
const S_CONNOR_LAPTOP = 'bbbbbbbb-0000-4000-8000-000000000002';
const S_CONNOR_LOST_PHONE = 'bbbbbbbb-0000-4000-8000-000000000003';
const S_STEVE = 'bbbbbbbb-0000-4000-8000-000000000004';
const S_CLIENT = 'bbbbbbbb-0000-4000-8000-000000000005';

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
  -- Supabase installs pgcrypto into extensions, not public (the reason for
  -- fix_internal_mfa_recovery_codes_search_path.sql).
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

  create table auth.users (id uuid primary key, email text);
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

  -- account_roles and its live policies.
  create table public.account_roles (
    email text primary key,
    role_name text,
    can_manage_roles boolean not null default false
  );
  alter table public.account_roles enable row level security;
  create function public.current_user_has_any_role() returns boolean
    language sql stable security definer set search_path to 'public' as $$
    select exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email'));
  $$;
  revoke execute on function public.current_user_has_any_role() from public, anon;
  grant execute on function public.current_user_has_any_role() to authenticated, service_role;
  create function public.current_user_can_manage_roles() returns boolean
    language sql stable set search_path to 'public' as $$
    select coalesce((select ar.can_manage_roles from public.account_roles ar
                     where ar.email = (select auth.jwt() ->> 'email')), false);
  $$;
  create policy "Authenticated can view account roles" on public.account_roles
    for select to authenticated using ((select public.current_user_has_any_role()));
  create policy "Only role managers can update assignments" on public.account_roles
    for update to authenticated using ((select public.current_user_can_manage_roles()));

  create table public.invoices (id bigserial primary key, total numeric);
  alter table public.invoices enable row level security;
  create policy "internal accounts can manage invoices" on public.invoices for all to authenticated
    using (exists (select 1 from account_roles where account_roles.email = (select auth.email())))
    with check (exists (select 1 from account_roles where account_roles.email = (select auth.email())));

  create table public.workspace_sync (id text primary key, data jsonb);
  alter table public.workspace_sync enable row level security;
  create policy "Require login" on public.workspace_sync for all to public
    using (((select auth.role()) = 'authenticated') and exists (select 1 from account_roles where account_roles.email = (select auth.email())))
    with check (((select auth.role()) = 'authenticated') and exists (select 1 from account_roles where account_roles.email = (select auth.email())));

  create table public.stripe_customers (email text primary key, customer_id text);
  alter table public.stripe_customers enable row level security;
  create policy "internal accounts can view stripe customer mappings" on public.stripe_customers
    for select to authenticated using (current_user_has_any_role());

  create table public.client_portal_jobs (id bigserial primary key, client_email text, title text);
  alter table public.client_portal_jobs enable row level security;
  create policy "clients or internal accounts can view jobs" on public.client_portal_jobs
    for select to authenticated using ((((select auth.email()) = client_email) or current_user_has_any_role()));

  create sequence invoice_number_seq;
  create function public.next_invoice_number() returns text language plpgsql security definer
    set search_path to 'public' as $$
  begin
    if not public.current_user_has_any_role() then
      raise exception 'Only internal accounts can generate invoice numbers';
    end if;
    return 'INV-' || to_char(now(), 'YYYY') || '-' || nextval('invoice_number_seq')::text;
  end; $$;

  grant select, insert, update, delete on public.account_roles, public.invoices, public.workspace_sync,
    public.stripe_customers, public.client_portal_jobs to anon, authenticated, service_role;
  grant usage, select on sequence public.invoices_id_seq to authenticated;
`;

const SEED = `
  insert into auth.users (id, email) values
    ('${STEVE.id}', '${STEVE.email}'), ('${CONNOR.id}', '${CONNOR.email}'),
    ('${CLIENT.id}', '${CLIENT.email}'), ('${STRANGER.id}', '${STRANGER.email}');
  insert into auth.mfa_factors (id, user_id, status) values
    ('${CONNOR_FACTOR}', '${CONNOR.id}', 'verified'),
    ('${CLIENT_FACTOR}', '${CLIENT.id}', 'verified');
  insert into auth.mfa_challenges (factor_id) values ('${CONNOR_FACTOR}');
  insert into auth.sessions (id, user_id, aal) values
    ('${S_CONNOR_HERE}', '${CONNOR.id}', 'aal1'),
    ('${S_CONNOR_LAPTOP}', '${CONNOR.id}', 'aal2'),
    ('${S_CONNOR_LOST_PHONE}', '${CONNOR.id}', 'aal2'),
    ('${S_STEVE}', '${STEVE.id}', 'aal1'),
    ('${S_CLIENT}', '${CLIENT.id}', 'aal2');
  insert into auth.refresh_tokens (session_id, token) values
    ('${S_CONNOR_HERE}', 'r1'), ('${S_CONNOR_LOST_PHONE}', 'r3'), ('${S_STEVE}', 'r4');
  insert into public.account_roles (email, role_name, can_manage_roles) values
    ('${STEVE.email}', 'Owner', true), ('${CONNOR.email}', 'Developer', true);
  insert into public.invoices (total) values (120), (340), (95);
  insert into public.workspace_sync (id, data) values ('main', '{"jobs": []}');
  insert into public.stripe_customers values ('${CLIENT.email}', 'cus_1'), ('other@example.com', 'cus_2');
  insert into public.client_portal_jobs (client_email, title) values
    ('${CLIENT.email}', 'Dryer'), ('other@example.com', 'Fridge');
`;

// The recovery-code objects exactly as they stood before this change.
const PRIOR_RECOVERY_SQL = [
  read('sql', 'security', 'add_internal_mfa_recovery_codes.sql'),
  read('sql', 'security', 'fix_internal_mfa_recovery_codes_search_path.sql'),
  `revoke execute on function public.generate_internal_recovery_codes(integer) from anon;
   revoke execute on function public.verify_and_consume_internal_recovery_code(text) from anon;
   revoke execute on function public.count_unused_internal_recovery_codes() from anon;
   revoke execute on function public.delete_internal_recovery_codes() from anon;`,
];

// Connor's 10 existing codes, generated the way login.html generated them
// (right after verifying the authenticator, so on an aal2 session). The
// plaintext is kept here only so the tests can redeem them.
const CONNOR_CODES = Array.from({ length: 10 }, (_, i) => `C0D${i}-${String(1000 + i)}`);
const SEED_CODES = CONNOR_CODES.map((c) =>
  `insert into public.internal_mfa_recovery_codes (user_id, code_hash)
   values ('${CONNOR.id}', extensions.crypt('${c}', extensions.gen_salt('bf', 4)));`).join('\n');

const dbs = [];
async function buildDb({ migrate = true } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  dbs.push(db);
  await db.exec(BASE_SCHEMA);
  for (const sql of PRIOR_RECOVERY_SQL) await db.exec(sql);
  await db.exec(SEED);
  await db.exec(SEED_CODES);
  if (migrate) await db.exec(MIGRATION);
  return db;
}
let shared = null;
const migratedDb = () => (shared = shared || buildDb());

after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

function jwt(user, aal, sessionId) {
  const claims = { sub: user.id, email: user.email, role: 'authenticated' };
  if (aal) claims.aal = aal;
  if (sessionId) claims.session_id = sessionId;
  return claims;
}

// One test = one transaction, always rolled back, so tests can't leak state
// into each other. Inside it, as()/asService() run a statement the way
// PostgREST would (role switched, JWT claims set) inside a savepoint, so an
// expected error doesn't abort the rest of the test.
async function scenario(fn, { db: dbPromise } = {}) {
  const db = await (dbPromise || migratedDb());
  await db.exec('begin');
  const notices = [];
  const run = async (role, claims, sql, params = []) => {
    await db.exec('savepoint step');
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || {})]);
    await db.exec(`set local role ${role}`);
    try {
      const r = await db.query(sql, params, { onNotice: (n) => notices.push(n.message) });
      await db.exec('reset role');
      await db.exec('release savepoint step');
      return { rows: r.rows, affected: r.affectedRows };
    } catch (error) {
      await db.exec('rollback to savepoint step');
      return { error };
    }
  };
  const ctx = {
    db,
    notices,
    as: (claims, sql, params) => run('authenticated', claims, sql, params),
    asAnon: (sql, params) => run('anon', { role: 'anon' }, sql, params),
    asService: (sql, params) => run('service_role', { role: 'service_role' }, sql, params),
    admin: async (sql, params = []) => (await db.query(sql, params)).rows,
    setMode: (mode) => db.query('update public.internal_mfa_enforcement set mode = $1 where id', [mode]),
    count: async (claims, table) => {
      const r = await run('authenticated', claims, `select count(*)::int as n from public.${table}`);
      if (r.error) throw r.error;
      return r.rows[0].n;
    },
  };
  try {
    await fn(ctx);
  } finally {
    await db.exec('rollback');
  }
}

const INTERNAL_TABLES = { invoices: 3, workspace_sync: 1, account_roles: 2, stripe_customers: 2, client_portal_jobs: 2 };

async function assertSeesEverything(ctx, claims, label) {
  for (const [table, n] of Object.entries(INTERNAL_TABLES)) {
    assert.equal(await ctx.count(claims, table), n, `${label}: ${table}`);
  }
}
async function assertSeesNothingInternal(ctx, claims, label) {
  for (const table of Object.keys(INTERNAL_TABLES)) {
    assert.equal(await ctx.count(claims, table), 0, `${label}: ${table}`);
  }
}

// ---- the gap this closes ----------------------------------------------------

test('before this migration, a password-only session on the enrolled Developer account read every internal table', async () => {
  await scenario(async (ctx) => {
    await assertSeesEverything(ctx, jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'aal1, pre-migration');
    const codes = await ctx.as(jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'select public.generate_internal_recovery_codes(10) as c');
    assert.equal(codes.rows[0].c.length, 10, 'and could mint recovery codes on that same password-only session');
  }, { db: buildDb({ migrate: false }) });
});

// ---- the switch ---------------------------------------------------------------

test("the migration lands in 'log' (dry run), and re-running it never resets a mode someone already chose", async () => {
  await scenario(async (ctx) => {
    assert.deepEqual((await ctx.admin('select mode from public.internal_mfa_enforcement')).map((r) => r.mode), ['log']);
    await ctx.setMode('enforce');
    await ctx.db.exec(MIGRATION);
    assert.equal((await ctx.admin('select mode from public.internal_mfa_enforcement'))[0].mode, 'enforce');
  });
});

test("a deleted switch row reads as 'enforce', not as off", async () => {
  await scenario(async (ctx) => {
    await ctx.admin('delete from public.internal_mfa_enforcement');
    await assertSeesNothingInternal(ctx, jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'no switch row');
    await assertSeesEverything(ctx, jwt(CONNOR, 'aal2', S_CONNOR_LAPTOP), 'aal2 still fine');
  });
});

// ---- dry run: blocks nothing, records what it would block ------------------------------

test('log mode: every account keeps exactly the access it had, and only the would-be-blocked session raises a warning', async () => {
  await scenario(async (ctx) => {
    await assertSeesEverything(ctx, jwt(CONNOR, 'aal2', S_CONNOR_LAPTOP), 'Developer, verified session');
    assert.equal(ctx.notices.length, 0);
    await assertSeesEverything(ctx, jwt(STEVE, 'aal1', S_STEVE), 'Owner, no authenticator');
    assert.equal(ctx.notices.length, 0);
    await assertSeesEverything(ctx, jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'Developer, password-only');
    assert.ok(ctx.notices.length > 0, 'the password-only session on an enrolled account is reported');
    assert.ok(ctx.notices.every((m) => m.startsWith('internal_mfa_gate would_block source=rls')), ctx.notices.join('\n'));
    assert.ok(ctx.notices.some((m) => m.includes(`user=${CONNOR.id}`) && m.includes(`session=${S_CONNOR_HERE}`) && m.includes('aal=aal1')));
  });
});

test('log mode works inside a read-only transaction, the way PostgREST runs every GET', async () => {
  const db = await migratedDb();
  await db.exec('begin read only');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(jwt(CONNOR, 'aal1', S_CONNOR_HERE))]);
    await db.exec('set local role authenticated');
    const r = await db.query('select count(*)::int as n from public.invoices');
    assert.equal(r.rows[0].n, 3);
  } finally {
    await db.exec('rollback');
  }
});

// ---- enforce -------------------------------------------------------------------------

test('enforce: a password-only session on an account with an authenticator gets nothing internal, reads or writes', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('enforce');
    const stolen = jwt(CONNOR, 'aal1', S_CONNOR_HERE);
    await assertSeesNothingInternal(ctx, stolen, 'Developer, password-only');
    const upd = await ctx.as(stolen, "update public.account_roles set role_name = 'x'");
    assert.equal(upd.affected, 0, 'cannot change permissions');
    const ins = await ctx.as(stolen, 'insert into public.invoices (total) values (1)');
    assert.match(String(ins.error && ins.error.message), /row-level security/);
    const mr = await ctx.as(stolen, 'select public.current_user_can_manage_roles() as v');
    assert.equal(mr.rows[0].v, false);
    const num = await ctx.as(stolen, 'select public.next_invoice_number()');
    assert.match(String(num.error && num.error.message), /Only internal accounts/);
    // A token with no aal claim at all is treated the same as aal1.
    await assertSeesNothingInternal(ctx, jwt(CONNOR, null, S_CONNOR_HERE), 'no aal claim');
  });
});

test('enforce: the same account signed in with its authenticator (aal2) keeps full access', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('enforce');
    const ok = jwt(CONNOR, 'aal2', S_CONNOR_LAPTOP);
    await assertSeesEverything(ctx, ok, 'Developer, verified');
    const upd = await ctx.as(ok, "update public.account_roles set role_name = role_name");
    assert.equal(upd.affected, 2);
    assert.match((await ctx.as(ok, 'select public.next_invoice_number() as n')).rows[0].n, /^INV-/);
  });
});

test('enforce: an account with no authenticator enrolled (the Owner today) works exactly as before -- opt-in, then enforced', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('enforce');
    await assertSeesEverything(ctx, jwt(STEVE, 'aal1', S_STEVE), 'Owner, no authenticator');
  });
});

test('enforce: strangers still get nothing, and a portal client keeps seeing only their own rows (portal policies untouched)', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('enforce');
    await assertSeesNothingInternal(ctx, jwt(STRANGER, 'aal1'), 'stranger');
    // The client has its own portal authenticator but signs in password-only
    // here: portal access is out of scope and must not change.
    const client = jwt(CLIENT, 'aal1', S_CLIENT);
    const jobs = await ctx.as(client, 'select title from public.client_portal_jobs');
    assert.deepEqual(jobs.rows.map((r) => r.title), ['Dryer']);
    assert.equal(await ctx.count(client, 'invoices'), 0);
  });
});

test("off: the check is skipped entirely, even for a password-only session on an enrolled account, with nothing logged", async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('off');
    await assertSeesEverything(ctx, jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'off');
    assert.equal(ctx.notices.length, 0);
  });
});

// ---- recovery codes: minting ------------------------------------------------------------

test('generating recovery codes needs a verified (aal2) session on an enrolled account, in every mode', async () => {
  for (const mode of ['off', 'log', 'enforce']) {
    await scenario(async (ctx) => {
      await ctx.setMode(mode);
      const r = await ctx.as(jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'select public.generate_internal_recovery_codes(10) as c');
      assert.equal(r.error && r.error.code, '42501', `${mode}: password-only session refused`);
      assert.match(r.error.message, /sign back in with your authenticator code/);
      const left = await ctx.admin(`select count(*)::int as n from public.internal_mfa_recovery_codes where user_id = '${CONNOR.id}' and used_at is null`);
      assert.equal(left[0].n, 10, `${mode}: the existing codes are untouched`);

      const ok = await ctx.as(jwt(CONNOR, 'aal2', S_CONNOR_LAPTOP), 'select public.generate_internal_recovery_codes(10) as c');
      assert.equal(ok.rows[0].c.length, 10, `${mode}: verified session gets 10 codes`);
      assert.ok(ok.rows[0].c.every((c) => /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(c)));
      const stored = await ctx.admin(`select code_hash from public.internal_mfa_recovery_codes where user_id = '${CONNOR.id}'`);
      assert.equal(stored.length, 10, 'the new set replaced the old one');
      assert.ok(stored.every((s) => s.code_hash.startsWith('$2')), 'stored as bcrypt hashes only');
    });
  }
});

test('generating codes is refused for an account with no authenticator, and for anyone without an internal account', async () => {
  await scenario(async (ctx) => {
    const steve = await ctx.as(jwt(STEVE, 'aal1', S_STEVE), 'select public.generate_internal_recovery_codes(10)');
    assert.match(steve.error.message, /Turn on two-factor authentication before generating recovery codes/);
    const client = await ctx.as(jwt(CLIENT, 'aal2', S_CLIENT), 'select public.generate_internal_recovery_codes(10)');
    assert.match(client.error.message, /only for Triple H Workspace accounts/);
    const anon = await ctx.asAnon('select public.generate_internal_recovery_codes(10)');
    assert.match(anon.error.message, /permission denied/);
  });
});

test("deleting recovery codes: refused for a password-only session while the authenticator exists; Settings' turn-off path still works", async () => {
  await scenario(async (ctx) => {
    const codes = () => ctx.admin(`select count(*)::int as n from public.internal_mfa_recovery_codes where user_id = '${CONNOR.id}'`);
    const r = await ctx.as(jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'select public.delete_internal_recovery_codes()');
    assert.equal(r.error && r.error.code, '42501');
    assert.equal((await codes())[0].n, 10);
    // settings.html: unenroll (GoTrue, needs aal2) first, then delete codes.
    await ctx.admin(`delete from auth.mfa_factors where user_id = '${CONNOR.id}'`);
    const after = await ctx.as(jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'select public.delete_internal_recovery_codes()');
    assert.equal(after.error, undefined);
    assert.equal((await codes())[0].n, 0);
  });
  await scenario(async (ctx) => {
    const r = await ctx.as(jwt(CONNOR, 'aal2', S_CONNOR_LAPTOP), 'select public.delete_internal_recovery_codes()');
    assert.equal(r.error, undefined, 'a verified session may delete them');
  });
});

// ---- recovery codes: signing in with one -------------------------------------------------

test('a valid recovery code gets a lost-phone owner back in even with enforcement on: authenticator removed, other devices signed out', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('enforce');
    const here = jwt(CONNOR, 'aal1', S_CONNOR_HERE);
    await assertSeesNothingInternal(ctx, here, 'before redeeming');

    const r = await ctx.as(here, 'select public.redeem_internal_recovery_code($1) as ok', [CONNOR_CODES[3]]);
    assert.equal(r.rows[0].ok, true);

    assert.equal((await ctx.admin(`select count(*)::int as n from auth.mfa_factors where user_id = '${CONNOR.id}'`))[0].n, 0, 'lost authenticator removed');
    assert.equal((await ctx.admin('select count(*)::int as n from auth.mfa_challenges'))[0].n, 0, 'its challenges went with it');
    const codes = await ctx.admin(`select used_at is not null as used from public.internal_mfa_recovery_codes where user_id = '${CONNOR.id}'`);
    assert.deepEqual(codes.map((c) => c.used), [true], 'the spent code stays as a record; the other 9 are gone');
    const sessions = await ctx.admin(`select id from auth.sessions where user_id = '${CONNOR.id}'`);
    assert.deepEqual(sessions.map((s) => s.id), [S_CONNOR_HERE], 'every other device, including the lost phone, is signed out');
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.refresh_tokens where session_id = '${S_CONNOR_LOST_PHONE}'`))[0].n, 0);
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.sessions where id = '${S_STEVE}'`))[0].n, 1, "nobody else's sessions touched");
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.mfa_factors where user_id = '${CLIENT.id}'`))[0].n, 1);

    // The recovering session now works -- the account has no authenticator
    // until login.html's re-enrollment adds a new one.
    await assertSeesEverything(ctx, here, 'after redeeming, same session, enforce on');

    const log = await ctx.admin("select outcome, session_id from public.internal_mfa_gate_log where source = 'rpc:redeem_internal_recovery_code'");
    assert.deepEqual(log.map((l) => [l.outcome, l.session_id]), [['recovery_redeemed', S_CONNOR_HERE]]);
  });
});

test('recovery codes are forgiving about case and spacing, and each one works once', async () => {
  await scenario(async (ctx) => {
    const here = jwt(CONNOR, 'aal1', S_CONNOR_HERE);
    const r = await ctx.as(here, 'select public.redeem_internal_recovery_code($1) as ok', [`  ${CONNOR_CODES[0].toLowerCase()} `]);
    assert.equal(r.rows[0].ok, true);
  });
  await scenario(async (ctx) => {
    const here = jwt(CONNOR, 'aal1', S_CONNOR_HERE);
    await ctx.admin(`update public.internal_mfa_recovery_codes set used_at = now()
                     where user_id = '${CONNOR.id}' and extensions.crypt('${CONNOR_CODES[1]}', code_hash) = code_hash`);
    const r = await ctx.as(here, 'select public.redeem_internal_recovery_code($1) as ok', [CONNOR_CODES[1]]);
    assert.equal(r.rows[0].ok, false, 'an already-used code is refused');
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.mfa_factors where user_id = '${CONNOR.id}'`))[0].n, 1);
  });
});

test('a wrong recovery code changes nothing and is logged', async () => {
  await scenario(async (ctx) => {
    const r = await ctx.as(jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'select public.redeem_internal_recovery_code($1) as ok', ['ZZZZ-9999']);
    assert.equal(r.rows[0].ok, false);
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.mfa_factors where user_id = '${CONNOR.id}'`))[0].n, 1);
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.sessions where user_id = '${CONNOR.id}'`))[0].n, 3);
    assert.equal((await ctx.admin(`select count(*)::int as n from public.internal_mfa_recovery_codes where used_at is null`))[0].n, 10);
    const log = await ctx.admin("select outcome from public.internal_mfa_gate_log");
    assert.deepEqual(log.map((l) => l.outcome), ['recovery_rejected']);
  });
});

test("redeeming can never strip a portal client's authenticator, and does nothing for an account with none", async () => {
  await scenario(async (ctx) => {
    await ctx.admin(`insert into public.internal_mfa_recovery_codes (user_id, code_hash)
                     values ('${CLIENT.id}', extensions.crypt('CLNT-0001', extensions.gen_salt('bf', 4)))`);
    const r = await ctx.as(jwt(CLIENT, 'aal1', S_CLIENT), 'select public.redeem_internal_recovery_code($1) as ok', ['CLNT-0001']);
    assert.equal(r.rows[0].ok, false);
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.mfa_factors where user_id = '${CLIENT.id}'`))[0].n, 1);
    const s = await ctx.as(jwt(STEVE, 'aal1', S_STEVE), 'select public.redeem_internal_recovery_code($1) as ok', ['ANYT-HING']);
    assert.equal(s.rows[0].ok, false);
    const anon = await ctx.asAnon("select public.redeem_internal_recovery_code('x')");
    assert.match(anon.error.message, /permission denied/);
  });
});

test('the old RPC name (verify_and_consume_internal_recovery_code) now redeems the same way, so a cached old login page still recovers', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('enforce');
    const here = jwt(CONNOR, 'aal1', S_CONNOR_HERE);
    const r = await ctx.as(here, 'select public.verify_and_consume_internal_recovery_code($1) as ok', [CONNOR_CODES[5]]);
    assert.equal(r.rows[0].ok, true);
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.mfa_factors where user_id = '${CONNOR.id}'`))[0].n, 0);
    await assertSeesEverything(ctx, here, 'old page, enforce on');
  });
});

test('a password thief cannot combine the two: minting is refused, so there is no code to redeem', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('log');
    const stolen = jwt(CONNOR, 'aal1', S_CONNOR_HERE);
    const mint = await ctx.as(stolen, 'select public.generate_internal_recovery_codes(10) as c');
    assert.ok(mint.error, 'even during the dry run');
    const guess = await ctx.as(stolen, 'select public.redeem_internal_recovery_code($1) as ok', ['0000-0000']);
    assert.equal(guess.rows[0].ok, false);
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.mfa_factors where user_id = '${CONNOR.id}'`))[0].n, 1);
  });
});

// ---- the edge-function check -------------------------------------------------------------

const EDGE = 'select public.check_internal_mfa_for_edge_function($1, $2, $3, $4, $5) as ok';
const edgeArgs = (user, aal, sid, fn = 'set-invoice-paid') => [user && user.id, user && user.email, sid, aal, fn];

test('edge check: only the service role can call it', async () => {
  await scenario(async (ctx) => {
    const a = await ctx.as(jwt(CONNOR, 'aal2'), EDGE, edgeArgs(CONNOR, 'aal2', S_CONNOR_LAPTOP));
    assert.match(a.error.message, /permission denied/);
    const b = await ctx.asAnon(EDGE, edgeArgs(CONNOR, 'aal2', S_CONNOR_LAPTOP));
    assert.match(b.error.message, /permission denied/);
  });
});

test('edge check, log mode: always lets the call through, recording both passes and would-be blocks', async () => {
  await scenario(async (ctx) => {
    const r1 = await ctx.asService(EDGE, edgeArgs(CONNOR, 'aal1', S_CONNOR_HERE));
    const r2 = await ctx.asService(EDGE, edgeArgs(CONNOR, 'aal2', S_CONNOR_LAPTOP));
    const r3 = await ctx.asService(EDGE, edgeArgs(STEVE, 'aal1', S_STEVE));
    assert.deepEqual([r1, r2, r3].map((r) => r.rows[0].ok), [true, true, true]);
    const log = await ctx.admin('select email, outcome, source, mode, aal from public.internal_mfa_gate_log order by id');
    assert.deepEqual(log.map((l) => [l.email, l.outcome, l.source, l.mode, l.aal]), [
      [CONNOR.email, 'would_block', 'edge:set-invoice-paid', 'log', 'aal1'],
      [CONNOR.email, 'allowed', 'edge:set-invoice-paid', 'log', 'aal2'],
      [STEVE.email, 'allowed', 'edge:set-invoice-paid', 'log', 'aal1'],
    ]);
  });
});

test('edge check, enforce: refuses a password-only session on an enrolled account; verified and never-enrolled accounts pass', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('enforce');
    const ok = async (...a) => (await ctx.asService(EDGE, edgeArgs(...a))).rows[0].ok;
    assert.equal(await ok(CONNOR, 'aal1', S_CONNOR_HERE), false);
    assert.equal(await ok(CONNOR, null, S_CONNOR_LOST_PHONE), false, 'missing aal claim');
    assert.equal(await ok(CONNOR, 'aal2', S_CONNOR_LAPTOP), true);
    assert.equal(await ok(STEVE, 'aal1', S_STEVE), true);
    assert.equal(await ok(null, 'aal1', null), false, 'no user id: fail closed');
    const log = await ctx.admin('select outcome from public.internal_mfa_gate_log order by id');
    assert.deepEqual(log.map((l) => l.outcome), ['blocked', 'blocked', 'blocked'], 'only refusals are logged once enforcing');
  });
});

test('edge check, off: lets everything through and logs nothing', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('off');
    assert.equal((await ctx.asService(EDGE, edgeArgs(CONNOR, 'aal1', S_CONNOR_HERE))).rows[0].ok, true);
    assert.equal((await ctx.admin('select count(*)::int as n from public.internal_mfa_gate_log'))[0].n, 0);
  });
});

test('the log keeps one row per session, source and outcome per 10 minutes, so busy pages do not flood it', async () => {
  await scenario(async (ctx) => {
    for (let i = 0; i < 5; i++) await ctx.asService(EDGE, edgeArgs(CONNOR, 'aal1', S_CONNOR_HERE));
    await ctx.asService(EDGE, edgeArgs(CONNOR, 'aal1', S_CONNOR_HERE, 'sync-job-to-portal'));
    const log = await ctx.admin('select source from public.internal_mfa_gate_log order by id');
    assert.deepEqual(log.map((l) => l.source), ['edge:set-invoice-paid', 'edge:sync-job-to-portal']);
  });
});

// ---- the page-level status check ----------------------------------------------------------

test("session status: tells a signed-in tools page whether its own session is refused, without revealing the mode", async () => {
  await scenario(async (ctx) => {
    const status = async (claims) => (await ctx.as(claims, 'select public.internal_mfa_session_status() as s')).rows[0].s;
    assert.deepEqual(await status(jwt(STRANGER, 'aal1')), { internal: false });
    assert.deepEqual(await status(jwt(CLIENT, 'aal1', S_CLIENT)), { internal: false });

    assert.deepEqual(await status(jwt(CONNOR, 'aal1', S_CONNOR_HERE)), { internal: true, meets: false, blocked: false }, 'log');
    assert.deepEqual(await status(jwt(CONNOR, 'aal2', S_CONNOR_LAPTOP)), { internal: true, meets: true, blocked: false });
    assert.deepEqual(await status(jwt(STEVE, 'aal1', S_STEVE)), { internal: true, meets: true, blocked: false });

    await ctx.setMode('enforce');
    assert.deepEqual(await status(jwt(CONNOR, 'aal1', S_CONNOR_HERE)), { internal: true, meets: false, blocked: true }, 'enforce');
    assert.deepEqual(await status(jwt(CONNOR, 'aal2', S_CONNOR_LAPTOP)), { internal: true, meets: true, blocked: false });

    const log = await ctx.admin("select outcome, mode from public.internal_mfa_gate_log where source = 'page:tools' order by id");
    assert.deepEqual(log.map((l) => [l.outcome, l.mode]), [['would_block', 'log'], ['blocked', 'enforce']]);
  });
});

// ---- nothing new is readable or callable from the browser ---------------------------------

test('the switch and the log are not readable, and the internal helpers not callable, by anon or signed-in users', async () => {
  await scenario(async (ctx) => {
    const who = jwt(CONNOR, 'aal2', S_CONNOR_LAPTOP);
    for (const table of ['internal_mfa_enforcement', 'internal_mfa_gate_log']) {
      assert.match((await ctx.as(who, `select * from public.${table}`)).error.message, /permission denied/, table);
      assert.match((await ctx.asAnon(`select * from public.${table}`)).error.message, /permission denied/, table);
    }
    for (const call of [
      'select public.internal_mfa_mode()',
      `select public.internal_mfa_session_ok('${CONNOR.id}', 'aal2')`,
      `select public.log_internal_mfa_gate(null, null, null, null, 'x', 'allowed')`,
    ]) {
      assert.match((await ctx.as(who, call)).error.message, /permission denied/, call);
    }
    assert.match((await ctx.asAnon('select public.internal_mfa_session_status()')).error.message, /permission denied/);
  });
});

// ---- the way back ---------------------------------------------------------------------------

test('the rollback file restores the old behavior completely, and leaves the edge/page checks answering "allowed"', async () => {
  await scenario(async (ctx) => {
    await ctx.setMode('enforce');
    await ctx.db.exec(ROLLBACK);
    assert.equal((await ctx.admin('select mode from public.internal_mfa_enforcement'))[0].mode, 'off');
    // Even with the switch forced back to enforce, RLS no longer reads it.
    await ctx.setMode('enforce');
    await assertSeesEverything(ctx, jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'after rollback');
    await ctx.setMode('off');
    assert.equal((await ctx.asService(EDGE, edgeArgs(CONNOR, 'aal1', S_CONNOR_HERE))).rows[0].ok, true);
    const gone = await ctx.as(jwt(CONNOR, 'aal1'), "select public.redeem_internal_recovery_code('x')");
    assert.match(gone.error.message, /does not exist/, 'login.html falls back to the old RPC on this 404');
    const old = await ctx.as(jwt(CONNOR, 'aal1', S_CONNOR_HERE), 'select public.verify_and_consume_internal_recovery_code($1) as ok', [CONNOR_CODES[2]]);
    assert.equal(old.rows[0].ok, true);
    assert.equal((await ctx.admin(`select count(*)::int as n from auth.mfa_factors where user_id = '${CONNOR.id}'`))[0].n, 1,
      'old consume-only behavior: the authenticator is kept');
  });
});
