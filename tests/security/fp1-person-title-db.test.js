// Fix plan FP1.1 (2026-11-06): runs the real sql/security/fp1_person_title.sql
// in PGlite on top of the Phase 4 migration and the same account_roles shape
// the Phase 4 test builds (its SCHEMA block is reused, not copied). Made-up
// accounts only.
//
// What is proved, against the database:
//   - account_roles gains `title`; the migration runs twice cleanly;
//   - team_roster() returns each person's display_name and title, and a
//     deactivated person's title from the archived row;
//   - deactivate then reactivate keeps the name and title;
//   - only someone who can manage the team can change another person's
//     name or title (the existing update policy); a title over 60
//     characters or a name over 120 is refused;
//   - a title is only a label: setting one changes no switch.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const P4_TEST = fs.readFileSync(repo('tests', 'security', 'phase4-team-roster-db.test.js'), 'utf8');
const P4 = fs.readFileSync(repo('sql', 'security', 'phase4_team_roster_and_deactivate.sql'), 'utf8');
const FP1 = fs.readFileSync(repo('sql', 'security', 'fp1_person_title.sql'), 'utf8');
const FLEX = fs.readFileSync(repo('sql', 'security', 'flexible_per_account_permissions.sql'), 'utf8');
const GUARD = FLEX.slice(FLEX.indexOf('create or replace function guard_last_role_manager_permission()'),
  FLEX.indexOf('for each row execute function guard_last_role_manager_permission();') + 'for each row execute function guard_last_role_manager_permission();'.length);

const OWNER = 'owner@example.com';
const BOSS = 'boss@example.com';
const TECH = 'tech@example.com';
const CLIENT = 'client@example.com'; // used inside the reused SCHEMA
const SCHEMA = eval('`' + P4_TEST.slice(P4_TEST.indexOf('const SCHEMA = `') + 'const SCHEMA = `'.length, P4_TEST.indexOf('`;\n', P4_TEST.indexOf('const SCHEMA = `'))) + '`');

let dbPromise;
async function db() {
  if (!dbPromise) dbPromise = (async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(GUARD);
    await d.exec(P4);
    await d.exec(FP1);
    await d.exec(FP1); // re-runnable
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
const roster = async () => Object.fromEntries((await as(OWNER, 'select * from public.team_roster()')).rows.map((r) => [r.email, r]));

test('account_roles gains a title; the roster returns name and title for everyone', async () => {
  const d = await db();
  await d.query("update public.account_roles set display_name = 'Pat Owner', title = 'Developer' where email = $1", [OWNER]);
  await d.query("update public.account_roles set display_name = 'Sam Boss', title = 'Owner' where email = $1", [BOSS]);
  const r = await roster();
  assert.equal(r[OWNER].display_name, 'Pat Owner');
  assert.equal(r[OWNER].title, 'Developer');
  assert.equal(r[BOSS].title, 'Owner');
  assert.equal(r[TECH].title, null, 'no title yet');
});

test('only someone who can manage the team changes another person\'s name or title; long values are refused', async () => {
  await as(OWNER, "update public.account_roles set display_name = 'Tess Tech', title = 'Field tech' where email = $1", [TECH]);
  let r = await roster();
  assert.deepEqual([r[TECH].display_name, r[TECH].title], ['Tess Tech', 'Field tech']);

  // A field tech can't rename anyone, including the owner (policy filters the row out).
  await as(TECH, "update public.account_roles set title = 'Boss' where email = $1", [OWNER]);
  r = await roster();
  assert.equal(r[OWNER].title, 'Developer');

  await assert.rejects(as(OWNER, 'update public.account_roles set title = $1 where email = $2', ['x'.repeat(61), TECH]), /account_roles_title_len/);
  await assert.rejects(as(OWNER, 'update public.account_roles set display_name = $1 where email = $2', ['x'.repeat(121), TECH]), /account_roles_display_name_len/);
});

test('a title is only a label: setting one changes no switch', async () => {
  const d = await db();
  const before = (await d.query('select * from public.account_roles where email = $1', [TECH])).rows[0];
  await as(OWNER, "update public.account_roles set title = 'Owner' where email = $1", [TECH]);
  const after = (await d.query('select * from public.account_roles where email = $1', [TECH])).rows[0];
  for (const k of Object.keys(before).filter((k) => k.startsWith('can_'))) assert.equal(after[k], before[k], k);
  await as(OWNER, "update public.account_roles set title = 'Field tech' where email = $1", [TECH]);
});

test('deactivate then reactivate keeps the name and title; the roster shows a deactivated person\'s title', async () => {
  await as(OWNER, 'select public.team_deactivate($1)', [TECH]);
  let r = await roster();
  assert.equal(r[TECH].status, 'deactivated');
  assert.equal(r[TECH].title, 'Field tech');
  await as(OWNER, 'select public.team_reactivate($1)', [TECH]);
  r = await roster();
  assert.equal(r[TECH].status, 'active');
  assert.deepEqual([r[TECH].display_name, r[TECH].title], ['Tess Tech', 'Field tech']);
});
