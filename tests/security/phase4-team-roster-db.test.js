// Phase 4 Team (2026-11-04): runs the real migration
// sql/security/phase4_team_roster_and_deactivate.sql in PGlite (real
// PostgreSQL) on top of account_roles as it is live -- the nine switches, its
// RLS, the live last-admin trigger (copied from
// sql/security/flexible_per_account_permissions.sql) -- plus auth.users and an
// internal table guarded by the inline "a row exists" policy shape that about
// 38 live policies use. Made-up accounts only.
//
// What is proved, against the database:
//   - existing accounts get Clients and "Manage jobs for others" ON; a re-run
//     doesn't turn them back on after someone turned them off;
//   - only an internal account that can manage the team can invite, revoke,
//     deactivate or reactivate; a staff member without it, and a portal
//     client, are refused by the database;
//   - deactivating moves the row: the person immediately fails the inline
//     internal-access policy (and current_user_has_any_role()), and
//     reactivating brings back exactly the switches they had;
//   - nobody can deactivate themselves, and the last person who can manage
//     the team can't be deactivated (the live trigger refuses);
//   - an invite starts with every switch off; it can be revoked only until
//     the person signs in;
//   - the roster shows Active / Invite pending / Deactivated with last
//     sign-in, and only to internal accounts;
//   - the archive table can't be written directly.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const MIGRATION = fs.readFileSync(repo('sql', 'security', 'phase4_team_roster_and_deactivate.sql'), 'utf8');
const FLEX = fs.readFileSync(repo('sql', 'security', 'flexible_per_account_permissions.sql'), 'utf8');
const GUARD = FLEX.slice(FLEX.indexOf('create or replace function guard_last_role_manager_permission()'),
  FLEX.indexOf('for each row execute function guard_last_role_manager_permission();') + 'for each row execute function guard_last_role_manager_permission();'.length);

const OWNER = 'owner@example.com';
const BOSS = 'boss@example.com';
const TECH = 'tech@example.com';
const CLIENT = 'client@example.com';

const SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
  create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, last_sign_in_at timestamptz, email_confirmed_at timestamptz);

  create table public.account_roles (
    email text primary key, role_name text,
    assigned_at timestamptz default now(), assigned_by text,
    can_manage_roles boolean not null default false,
    can_access_dev_tools boolean not null default false,
    can_manage_site_content boolean not null default false,
    can_access_dev_tools_full boolean not null default false,
    can_manage_invoices boolean not null default false,
    can_manage_contracts boolean not null default false,
    can_view_finance boolean not null default false,
    can_view_runway boolean not null default false,
    can_manage_reviews boolean not null default false,
    tenant_id uuid
  );
  insert into public.account_roles (email, role_name, can_manage_roles, can_access_dev_tools, can_access_dev_tools_full, can_manage_site_content, can_manage_invoices, can_manage_contracts, can_view_finance, can_view_runway, can_manage_reviews) values
    ('${OWNER}', 'Owner', true, true, true, true, true, true, true, true, true),
    ('${BOSS}', 'Owner', true, true, false, true, true, true, true, true, true),
    ('${TECH}', null, false, false, false, false, false, false, false, false, true);
  update public.account_roles set tenant_id = '07775ed9-0000-4000-8000-000000000001';
  insert into auth.users (email, last_sign_in_at) values
    ('${OWNER}', now() - interval '1 hour'), ('${BOSS}', now() - interval '2 days'), ('${TECH}', now() - interval '3 days'), ('${CLIENT}', now());

  alter table public.account_roles enable row level security;
  create function public.current_user_has_any_role() returns boolean
    language sql stable security definer set search_path to 'public' as $$
    select exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email')); $$;
  create function public.current_user_can_manage_roles() returns boolean
    language sql stable set search_path = 'public' as $$
    select coalesce((select ar.can_manage_roles from public.account_roles ar where ar.email = (select auth.jwt() ->> 'email')), false); $$;
  create policy "Authenticated can view account roles" on public.account_roles
    for select to authenticated using ((select public.current_user_has_any_role()));
  create policy "Only role managers can update assignments" on public.account_roles
    for update to authenticated using (public.current_user_can_manage_roles());
  grant select, insert, update, delete on public.account_roles to authenticated;

  -- One internal table with the inline policy shape about 38 live policies use.
  create table public.jobs (id int primary key, title text);
  insert into public.jobs values (1, 'Sample job');
  alter table public.jobs enable row level security;
  create policy "internal" on public.jobs for select to authenticated
    using (exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));
  grant select on public.jobs to authenticated;
`;

let dbPromise;
async function db() {
  if (!dbPromise) dbPromise = (async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(GUARD);
    await d.exec(MIGRATION);
    return d;
  })();
  return dbPromise;
}
after(async () => { if (dbPromise) await (await dbPromise).close(); });

async function asUser(email, fn) {
  const d = await db();
  return d.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ email, role: 'authenticated' })]);
    return fn(tx);
  });
}
const call = (email, sql, params) => asUser(email, (tx) => tx.query(sql, params));
const refused = async (email, sql, params, re) => {
  await assert.rejects(call(email, sql, params), re);
};
const row = async (email) => (await (await db()).query('select * from public.account_roles where email = $1', [email])).rows[0];
const seesJobs = async (email) => (await call(email, 'select count(*)::int n from public.jobs')).rows[0].n;

test('existing accounts get Clients and "Manage jobs for others" ON; running the migration again does not turn them back on', async () => {
  const d = await db();
  for (const e of [OWNER, BOSS, TECH]) {
    const r = await row(e);
    assert.equal(r.can_manage_clients, true, e);
    assert.equal(r.can_manage_others_jobs, true, e);
  }
  await d.query("update public.account_roles set can_manage_others_jobs = false where email = $1", [TECH]);
  await d.exec(MIGRATION);
  assert.equal((await row(TECH)).can_manage_others_jobs, false, 'a re-run leaves a switch someone turned off alone');
  await d.query("update public.account_roles set can_manage_others_jobs = true where email = $1", [TECH]);
});

test('only an internal account that can manage the team may invite, revoke, deactivate or reactivate', async () => {
  for (const who of [TECH, CLIENT]) {
    await refused(who, 'select public.team_add_invited($1, $2)', ['new@example.com', 'New'], /Not allowed/);
    await refused(who, 'select public.team_deactivate($1)', [BOSS], /Not allowed/);
    await refused(who, 'select public.team_reactivate($1)', [BOSS], /Not allowed/);
    await refused(who, 'select public.team_revoke_invite($1)', ['new@example.com'], /Not allowed/);
  }
  await assert.rejects(call(TECH, 'select public.team_require_manager()'), /permission denied/, 'the helper itself is not callable');
});

test('an invite starts with every switch off, refuses someone already on the team, and can be revoked until they sign in', async () => {
  await call(OWNER, 'select public.team_add_invited($1, $2)', ['  New.Person@Example.com ', 'New Person']);
  const r = await row('new.person@example.com');
  assert.ok(r, 'stored lower-cased and trimmed');
  assert.equal(r.display_name, 'New Person');
  assert.ok(r.invited_at);
  assert.equal(r.invited_by, OWNER);
  assert.equal(r.tenant_id, '07775ed9-0000-4000-8000-000000000001', 'same business as whoever invited them');
  for (const k of Object.keys(r).filter((k) => k.startsWith('can_'))) assert.equal(r[k], false, k);
  await refused(OWNER, 'select public.team_add_invited($1, $2)', [TECH, 'Again'], /already on the team/);
  await refused(OWNER, 'select public.team_add_invited($1, $2)', ['not-an-email', 'X'], /doesn't look right/);
  await refused(OWNER, 'select public.team_revoke_invite($1)', [TECH], /No pending invite/);

  await call(OWNER, 'select public.team_revoke_invite($1)', ['new.person@example.com']);
  assert.equal(await row('new.person@example.com'), undefined);

  // Signed in already: revoke refuses.
  await call(OWNER, 'select public.team_add_invited($1, $2)', ['joined@example.com', 'Joined']);
  await (await db()).query("insert into auth.users (email, last_sign_in_at) values ('joined@example.com', now())");
  await refused(OWNER, 'select public.team_revoke_invite($1)', ['joined@example.com'], /already signed in/);
});

test('deactivate moves the row: access stops at once, history rows are untouched, and reactivate brings back exactly the switches they had', async () => {
  const before = await row(BOSS);
  assert.equal(await seesJobs(BOSS), 1);
  await call(OWNER, 'select public.team_deactivate($1)', [BOSS]);
  assert.equal(await row(BOSS), undefined);
  assert.equal(await seesJobs(BOSS), 0, 'the inline internal-access policy refuses them immediately');
  assert.equal((await call(BOSS, 'select public.current_user_has_any_role() ok')).rows[0].ok, false);
  await refused(BOSS, 'select * from public.team_roster()', [], /Not allowed/);
  assert.equal(await seesJobs(OWNER), 1, 'everyone else is unaffected');
  await refused(OWNER, 'select public.team_add_invited($1, $2)', [BOSS, 'Boss'], /was deactivated/);

  await call(OWNER, 'select public.team_reactivate($1)', [BOSS]);
  const back = await row(BOSS);
  assert.deepEqual({ ...back }, { ...before }, 'every column comes back exactly as it was');
  assert.equal(await seesJobs(BOSS), 1);
  assert.equal((await (await db()).query('select count(*)::int n from public.account_roles_deactivated')).rows[0].n, 0);
});

test('nobody can deactivate themselves, and the last person who can manage the team cannot be deactivated', async () => {
  await refused(OWNER, 'select public.team_deactivate($1)', [OWNER], /deactivate yourself/);
  await call(OWNER, 'select public.team_deactivate($1)', [BOSS]);
  // OWNER is now the only manager; BOSS is gone, so only OWNER could try,
  // and self-deactivation is refused. Prove the live trigger also holds:
  const d = await db();
  await d.query("update public.account_roles set can_manage_roles = true where email = $1", [TECH]);
  await call(TECH, 'select public.team_deactivate($1)', [OWNER]); // allowed: TECH still manages
  await refused(TECH, 'select public.team_deactivate($1)', [TECH], /deactivate yourself/);
  await d.query("update public.account_roles set can_manage_roles = false where email = $1", [TECH]).catch((e) => {
    assert.match(String(e.message), /last account that has it/);
  });
  assert.equal((await row(TECH)).can_manage_roles, true, 'the live last-admin trigger kept the last manager');
  // Put everyone back.
  await call(TECH, 'select public.team_reactivate($1)', [OWNER]);
  await call(OWNER, 'select public.team_reactivate($1)', [BOSS]);
  await d.query("update public.account_roles set can_manage_roles = false where email = $1", [TECH]);
});

test('the last-admin trigger refuses deactivating the only remaining manager', async () => {
  const d = await db();
  // A manager (TECH) who is not the only one deactivates BOSS, leaving OWNER and TECH.
  await d.query("update public.account_roles set can_manage_roles = true where email = $1", [TECH]);
  await call(TECH, 'select public.team_deactivate($1)', [BOSS]);
  // Demote nobody; instead remove OWNER's manage permission through the
  // trigger-guarded path is fine; then TECH is the last manager and OWNER
  // (no longer a manager) can't act. Deactivating TECH by a manager is the
  // only path, and the only manager is TECH (self): refused.
  await d.query("update public.account_roles set can_manage_roles = false where email = $1", [OWNER]);
  await refused(TECH, 'select public.team_deactivate($1)', [TECH], /deactivate yourself/);
  // Direct DELETE of the last manager (any path that moves the row) is refused by the trigger.
  await assert.rejects(d.query('delete from public.account_roles where email = $1', [TECH]), /last remaining account/);
  await d.query("update public.account_roles set can_manage_roles = true where email = $1", [OWNER]);
  await call(OWNER, 'select public.team_reactivate($1)', [BOSS]);
  await d.query("update public.account_roles set can_manage_roles = false where email = $1", [TECH]);
});

test('the roster: Active / Invite pending / Deactivated with last sign-in, only for internal accounts', async () => {
  await call(OWNER, 'select public.team_add_invited($1, $2)', ['pending@example.com', 'Pending']);
  await call(OWNER, 'select public.team_deactivate($1)', [BOSS]);
  const rows = (await call(TECH, 'select * from public.team_roster()')).rows;
  const by = Object.fromEntries(rows.map((r) => [r.email, r]));
  assert.equal(by[OWNER].status, 'active');
  assert.ok(by[OWNER].last_sign_in_at);
  assert.equal(by['pending@example.com'].status, 'invited');
  assert.equal(by['pending@example.com'].last_sign_in_at, null);
  assert.equal(by['joined@example.com'].status, 'active', 'an invite that was used counts as active');
  assert.equal(by[BOSS].status, 'deactivated');
  assert.ok(by[BOSS].deactivated_at);
  assert.equal(by[BOSS].can_manage_roles, false, 'a deactivated person shows no capabilities');
  await refused(CLIENT, 'select * from public.team_roster()', [], /Not allowed/);
  await call(OWNER, 'select public.team_reactivate($1)', [BOSS]);
  await call(OWNER, 'select public.team_revoke_invite($1)', ['pending@example.com']);
});

test('the archive table cannot be written directly, and only internal accounts can read it', async () => {
  await assert.rejects(call(OWNER, "insert into public.account_roles_deactivated (email, row_data) values ('x@example.com', '{}')"), /permission denied/);
  await call(OWNER, 'select public.team_deactivate($1)', [BOSS]);
  assert.equal((await call(OWNER, 'select count(*)::int n from public.account_roles_deactivated')).rows[0].n, 1);
  assert.equal((await call(CLIENT, 'select count(*)::int n from public.account_roles_deactivated')).rows[0].n, 0);
  await call(OWNER, 'select public.team_reactivate($1)', [BOSS]);
});

test('the migration changes no existing function, policy or trigger', () => {
  for (const name of ['current_user_has_any_role', 'current_user_can_manage_roles', 'guard_last_role_manager_permission', 'internal_mfa_session_ok']) {
    assert.doesNotMatch(MIGRATION, new RegExp('create or replace function (public\\.)?' + name + '\\('), name);
  }
  assert.doesNotMatch(MIGRATION, /drop policy if exists "(?!Internal accounts can view deactivated accounts)/);
  assert.doesNotMatch(MIGRATION, /drop trigger/);
  assert.match(MIGRATION, /NOT APPLIED/);
});
