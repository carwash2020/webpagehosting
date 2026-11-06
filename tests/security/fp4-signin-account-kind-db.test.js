// Fix plan FP4.1 (2026-11-06): signin_account_kind() runs in PGlite on top
// of the Phase 4 account_roles shape (the Phase 4 test's SCHEMA, reused).
// It says only whether the caller is staff or a client -- about their own
// email, at any assurance level -- and anon can't call it. Made-up accounts.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const P4_TEST = fs.readFileSync(repo('tests', 'security', 'phase4-team-roster-db.test.js'), 'utf8');
const SQL = fs.readFileSync(repo('sql', 'security', 'fp4_signin_account_kind.sql'), 'utf8');
const OWNER = 'owner@example.com';
const BOSS = 'boss@example.com';
const TECH = 'tech@example.com';
const CLIENT = 'client@example.com';
const SCHEMA = eval('`' + P4_TEST.slice(P4_TEST.indexOf('const SCHEMA = `') + 'const SCHEMA = `'.length, P4_TEST.indexOf('`;\n', P4_TEST.indexOf('const SCHEMA = `'))) + '`');

let dbPromise;
async function db() {
  if (!dbPromise) dbPromise = (async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(SQL);
    await d.exec(SQL); // re-runnable
    return d;
  })();
  return dbPromise;
}
after(async () => { if (dbPromise) await (await dbPromise).close(); });

async function kind(claims, role = 'authenticated') {
  const d = await db();
  return d.transaction(async (tx) => {
    await tx.query('set local role ' + role);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return (await tx.query('select public.signin_account_kind() as k')).rows[0].k;
  });
}

test('staff at aal1 (password only) reads as staff, so the sign-in can send them to the Workspace two-factor step', async () => {
  assert.equal(await kind({ email: OWNER, role: 'authenticated', aal: 'aal1' }), 'staff');
  assert.equal(await kind({ email: 'Tech@Example.com', role: 'authenticated', aal: 'aal1' }), 'staff', 'email case does not matter');
});

test('a client, or an email on no team, reads as client', async () => {
  assert.equal(await kind({ email: CLIENT, role: 'authenticated', aal: 'aal1' }), 'client');
  assert.equal(await kind({ email: 'stranger@example.com', role: 'authenticated' }), 'client');
  assert.equal(await kind({ role: 'authenticated' }), 'client', 'no email in the token');
});

test('anon cannot call it, and it grants nothing: the caller still cannot read account_roles through it', async () => {
  await assert.rejects(kind({ email: OWNER }, 'anon'), /permission denied/);
  const d = await db();
  const src = (await d.query("select prosrc from pg_proc where proname = 'signin_account_kind'")).rows[0].prosrc;
  assert.doesNotMatch(src, /insert|update|delete|grant/i);
});
