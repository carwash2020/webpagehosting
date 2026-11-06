// Fix plan FP3.3 + FP3.4 (2026-11-06, D3: Clients ON): runs the real
// sql/security/fp3_invite_defaults_and_templates.sql in PGlite on top of the
// Phase 4 and FP1 migrations and the Phase 4 test's account_roles shape
// (its SCHEMA block is reused, not copied). Made-up accounts only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const P4_TEST = fs.readFileSync(repo('tests', 'security', 'phase4-team-roster-db.test.js'), 'utf8');
const P4 = fs.readFileSync(repo('sql', 'security', 'phase4_team_roster_and_deactivate.sql'), 'utf8');
const FP1 = fs.readFileSync(repo('sql', 'security', 'fp1_person_title.sql'), 'utf8');
const FP3 = fs.readFileSync(repo('sql', 'security', 'fp3_invite_defaults_and_templates.sql'), 'utf8');
const FLEX = fs.readFileSync(repo('sql', 'security', 'flexible_per_account_permissions.sql'), 'utf8');
const GUARD = FLEX.slice(FLEX.indexOf('create or replace function guard_last_role_manager_permission()'),
  FLEX.indexOf('for each row execute function guard_last_role_manager_permission();') + 'for each row execute function guard_last_role_manager_permission();'.length);

const OWNER = 'owner@example.com';
const BOSS = 'boss@example.com';
const TECH = 'tech@example.com';
const CLIENT = 'client@example.com'; // used inside the reused SCHEMA
const SCHEMA = eval('`' + P4_TEST.slice(P4_TEST.indexOf('const SCHEMA = `') + 'const SCHEMA = `'.length, P4_TEST.indexOf('`;\n', P4_TEST.indexOf('const SCHEMA = `'))) + '`');
// The templates table as it is live today (sql/infra/create_account_roles_system.sql
// plus the later per-switch columns), with the three live templates.
const TEMPLATES = `
  create table public.role_definitions (
    name text primary key, description text, created_at timestamptz default now(), created_by text,
    can_manage_roles boolean not null default false, can_access_dev_tools boolean not null default false,
    can_access_dev_tools_full boolean not null default false, can_manage_site_content boolean not null default false,
    can_manage_invoices boolean not null default false, can_manage_contracts boolean not null default false,
    can_view_finance boolean not null default false, can_view_runway boolean not null default false,
    can_manage_reviews boolean not null default false);
  insert into public.role_definitions (name, can_manage_roles, can_manage_invoices) values ('Developer', true, true), ('Owner', false, true), ('Employee', false, false);
`;

let dbPromise;
async function db() {
  if (!dbPromise) dbPromise = (async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(TEMPLATES);
    await d.exec(GUARD);
    await d.exec(P4);
    await d.exec(FP1);
    await d.exec(FP3);
    await d.exec(FP3); // re-runnable
    return d;
  })();
  return dbPromise;
}
after(async () => { if (dbPromise) await (await dbPromise).close(); });

async function as(email, sql, params) {
  const d = await db();
  return d.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ email, role: 'authenticated' })]);
    return tx.query(sql, params);
  });
}

test('FP3.4: the templates carry the two Phase 4 switches -- Developer and Owner both, Employee Clients only (D3)', async () => {
  const d = await db();
  const rows = (await d.query('select name, can_manage_clients, can_manage_others_jobs from public.role_definitions order by name')).rows;
  assert.deepEqual(rows.map((r) => [r.name, r.can_manage_clients, r.can_manage_others_jobs]), [
    ['Developer', true, true], ['Employee', true, false], ['Owner', true, true],
  ]);
});

test('FP3.3: a fresh invite starts with Clients on and Manage jobs for others off; nothing else is on', async () => {
  await as(OWNER, 'select public.team_add_invited($1, $2)', ['new.hire@example.com', 'New Hire']);
  const d = await db();
  const row = (await d.query('select * from public.account_roles where email = $1', ['new.hire@example.com'])).rows[0];
  assert.equal(row.can_manage_clients, true);
  assert.equal(row.can_manage_others_jobs, false);
  for (const k of Object.keys(row).filter((k) => k.startsWith('can_') && k !== 'can_manage_clients')) assert.equal(row[k], false, k);
  assert.equal(row.display_name, 'New Hire');
  assert.ok(row.invited_at);
});

test('FP3.3: the invite keeps its checks -- only a manager, never a duplicate', async () => {
  await assert.rejects(as(TECH, 'select public.team_add_invited($1, $2)', ['x@example.com', 'X']), /Not allowed/);
  await assert.rejects(as(OWNER, 'select public.team_add_invited($1, $2)', [TECH, 'Again']), /already on the team/);
});
