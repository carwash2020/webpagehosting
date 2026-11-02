// sql/security/grant_finance_access_connor_and_steve.sql (corrections pack,
// 2026-11-01): additive, NOT applied to the live project by this PR --
// shipped as a file for a human to run, same as add_trusted_devices.sql.
// Runs the real migration file in PGlite against a minimal account_roles
// table shaped like the live one, so the upsert's actual behavior is
// exercised, not just read.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', '..', 'sql', 'security', 'grant_finance_access_connor_and_steve.sql'),
  'utf8'
);

const dbs = [];
after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

// Same 9-boolean shape as the live table (flexible_per_account_permissions.sql
// + granular_permissions_expansion.sql), trimmed to what this migration can
// actually touch -- email, role_name, and the 9 permission booleans, all
// defaulting to false/null exactly as live.
async function buildDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  dbs.push(db);
  await db.exec(`
    create table public.account_roles (
      email text primary key,
      role_name text,
      assigned_at timestamptz not null default now(),
      assigned_by text,
      can_manage_roles boolean not null default false,
      can_access_dev_tools boolean not null default false,
      can_access_dev_tools_full boolean not null default false,
      can_manage_site_content boolean not null default false,
      can_manage_invoices boolean not null default false,
      can_manage_contracts boolean not null default false,
      can_view_finance boolean not null default false,
      can_view_runway boolean not null default false,
      can_manage_reviews boolean not null default false
    );
    -- The two *.biz accounts, seeded the same way create_account_roles_system.sql
    -- did, already fully privileged -- confirmed live before writing the
    -- migration (see its header comment).
    insert into public.account_roles (email, role_name, can_manage_roles, can_access_dev_tools, can_access_dev_tools_full,
      can_manage_site_content, can_manage_invoices, can_manage_contracts, can_view_finance, can_view_runway, can_manage_reviews)
    values
      ('connor@triplehenterprisesllc.biz', 'Developer', true, true, true, true, true, true, true, true, true),
      ('steve@triplehenterprisesllc.biz', 'Owner', false, true, false, true, true, true, true, true, true);
  `);
  return db;
}

test('gmail accounts get nothing -- only the real .biz sign-ins are granted', async () => {
  const db = await buildDb();
  await db.exec(MIGRATION);
  const r = await db.query(`select email from public.account_roles order by email`);
  assert.deepEqual(r.rows.map((x) => x.email), ['connor@triplehenterprisesllc.biz', 'steve@triplehenterprisesllc.biz']);
});

test('already-correct .biz rows are left exactly as they were', async () => {
  const db = await buildDb();
  const before = (await db.query(`select * from public.account_roles order by email`)).rows;
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  assert.deepEqual((await db.query(`select * from public.account_roles order by email`)).rows, before);
});

test('grants Steve finance + portal invoices (and an account_roles row for invites) when missing, nothing else', async () => {
  const db = await buildDb();
  await db.exec(`delete from public.account_roles where email = 'steve@triplehenterprisesllc.biz'`);
  await db.exec(MIGRATION);
  const r = await db.query(`select role_name, can_view_finance, can_manage_invoices, can_manage_roles
    from public.account_roles where email = 'steve@triplehenterprisesllc.biz'`);
  assert.deepEqual(r.rows[0], { role_name: null, can_view_finance: true, can_manage_invoices: true, can_manage_roles: false });
});
