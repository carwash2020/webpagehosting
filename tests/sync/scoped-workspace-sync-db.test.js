// sql/sync/01_scoped_workspace_sync.sql run for real in PGlite (2026-11-03,
// handoff §2 / Phase 2.4). The blob is split into an ops row and a money
// row, and RLS decides per signed-in person which rows they can read or
// write: the Money switch is enforced by the database now, not only by
// page JavaScript.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PGlite } = require('@electric-sql/pglite');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'sql', 'sync', '01_scoped_workspace_sync.sql'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'tools', 'sync.js'), 'utf8');

const OWNER = 'steve@triplehenterprisesllc.biz';
const HELPER = 'helper@example.com'; // staff, Money off
const BOOKKEEPER = 'books@example.com'; // invoices on, Runway off
const CLIENT = 'client@example.com'; // portal client: not in account_roles

const LEGACY = {
  th_tracker_jobs: '[{"id":1,"title":"Fix washer"}]',
  th_clients: '[{"id":"c_1","name":"Tony"}]',
  th_invoices: '[{"id":7,"total":300}]',
  th_income_log: '[{"id":8,"amount":300}]',
  'rd_personal-expenses': '[{"id":9,"label":"Mortgage"}]',
  th_graveyard: '[{"type":"invoice","record":{"id":6}}]',
  th_contracts: '[{"id":5}]',
  th_shift_log: '[]',
};

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

  create table public.account_roles (
    email text primary key, role_name text,
    can_view_finance boolean not null default false,
    can_manage_invoices boolean not null default false,
    can_view_runway boolean not null default false
  );
  insert into public.account_roles values
    ('${OWNER}', 'Owner', true, true, true),
    ('${HELPER}', 'Helper', false, false, false),
    ('${BOOKKEEPER}', 'Books', false, true, false);
  -- account_roles' own RLS, as live: staff can read it, nobody else.
  alter table public.account_roles enable row level security;
  create function public.current_user_has_any_role() returns boolean
    language sql stable security definer set search_path to 'public' as $$
    select exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email')); $$;
  create policy "Authenticated can view account roles" on public.account_roles
    for select to authenticated using ((select public.current_user_has_any_role()));
  grant select on public.account_roles to authenticated;

  -- workspace_sync exactly as live (2026-11-03): code PK, data jsonb, the
  -- one "Require login" policy.
  create table public.workspace_sync (code text primary key, data jsonb, updated_at timestamptz);
  alter table public.workspace_sync enable row level security;
  create policy "Require login" on public.workspace_sync for all to public
    using (((select auth.role()) = 'authenticated') and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())))
    with check (((select auth.role()) = 'authenticated') and exists (select 1 from public.account_roles where account_roles.email = (select auth.email())));
  grant select, insert, update, delete on public.workspace_sync to anon, authenticated, service_role;
  insert into public.workspace_sync values ('tripleh-workspace-2026', '${JSON.stringify(LEGACY).replace(/'/g, "''")}'::jsonb, '2026-11-03T21:35:45Z');
`;

let dbPromise = null;
async function db() {
  if (!dbPromise) dbPromise = (async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
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
const codes = async (email) => (await asUser(email, (tx) => tx.query('select code from public.workspace_sync order by code'))).rows.map((r) => r.code);

test('the money and Runway key lists in the SQL match SYNC_MONEY_KEYS / SYNC_RUNWAY_KEYS in tools/sync.js, and every one is a real synced key', async () => {
  const d = await db();
  const sqlList = async (fn) => (await d.query(`select unnest(public.${fn}()) k`)).rows.map((r) => r.k).sort();
  const money = await sqlList('workspace_sync_money_keys');
  const runway = await sqlList('workspace_sync_runway_keys');
  const ctx = {};
  vm.createContext(ctx);
  const grab = (name) => { const i = SYNC.indexOf('const ' + name + ' = ['); return SYNC.slice(i, SYNC.indexOf('];', i) + 2).replace('const ' + name, 'this.' + name); };
  vm.runInContext(grab('SYNC_DATA_KEYS') + '\n' + grab('SYNC_MONEY_KEYS') + '\n' + grab('SYNC_RUNWAY_KEYS'), ctx);
  assert.deepEqual([...ctx.SYNC_MONEY_KEYS].sort(), money);
  assert.deepEqual([...ctx.SYNC_RUNWAY_KEYS].sort(), runway);
  assert.ok(runway.every((k) => k.startsWith('rd_')) && runway.length === 6, 'all six Runway keys');
  assert.ok(!money.some((k) => runway.includes(k)), 'no key is in both');
  for (const k of money.concat(runway)) assert.ok(ctx.SYNC_DATA_KEYS.includes(k), k + ' is synced');
});

test('the seeded rows split the old blob exactly: money, Runway and everything else each in its own row, nothing lost', async () => {
  const d = await db();
  const rows = Object.fromEntries((await d.query("select code, data from public.workspace_sync")).rows.map((r) => [r.code, r.data]));
  assert.deepEqual(Object.keys(rows['scope:money']).sort(), ['th_graveyard', 'th_income_log', 'th_invoices']);
  assert.deepEqual(Object.keys(rows['scope:runway']).sort(), ['rd_personal-expenses']);
  assert.deepEqual(Object.keys(rows['scope:ops']).sort(), ['th_clients', 'th_contracts', 'th_shift_log', 'th_tracker_jobs']);
  assert.deepEqual({ ...rows['scope:ops'], ...rows['scope:money'], ...rows['scope:runway'] }, rows['tripleh-workspace-2026'], 'the three rows add back up to the old blob');
  assert.deepEqual(rows['tripleh-workspace-2026'], LEGACY, 'the old row is untouched');
});

test('everything on sees every row; Money off sees only ops; Invoices on but Runway off sees money but not Runway or the old blob', async () => {
  assert.deepEqual(await codes(OWNER), ['scope:money', 'scope:ops', 'scope:runway', 'tripleh-workspace-2026']);
  assert.deepEqual(await codes(HELPER), ['scope:ops']);
  assert.deepEqual(await codes(BOOKKEEPER), ['scope:money', 'scope:ops']);
});

test('Runway off cannot read or write the Runway row or the old blob (which also holds Runway), even with money access', async () => {
  const upd = await asUser(BOOKKEEPER, (tx) => tx.query("update public.workspace_sync set data = '{}'::jsonb where code in ('scope:runway', 'tripleh-workspace-2026')"));
  assert.equal(upd.affectedRows, 0);
  await assert.rejects(asUser(BOOKKEEPER, (tx) => tx.query("update public.workspace_sync set scope = 'runway' where code = 'scope:money'")), /row-level security/);
  const d = await db();
  const runway = (await d.query("select data from public.workspace_sync where code = 'scope:runway'")).rows[0].data;
  assert.ok(runway['rd_personal-expenses'], 'the Runway row is intact');
});

test('a portal client or a signed-out visitor sees no rows at all', async () => {
  assert.deepEqual(await codes(CLIENT), []);
  const d = await db();
  const rows = await d.transaction(async (tx) => {
    await tx.query('set local role anon');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
    return (await tx.query('select code from public.workspace_sync')).rows;
  });
  assert.deepEqual(rows, []);
});

test('Money off cannot write the money row or the old blob, cannot move a row into money, and cannot create one', async () => {
  const upd = await asUser(HELPER, (tx) => tx.query("update public.workspace_sync set data = '{}'::jsonb where code in ('scope:money', 'tripleh-workspace-2026')"));
  assert.equal(upd.affectedRows, 0, 'no money/legacy row is visible to update');
  await assert.rejects(asUser(HELPER, (tx) => tx.query("update public.workspace_sync set scope = 'money' where code = 'scope:ops'")), /row-level security/);
  await assert.rejects(asUser(HELPER, (tx) => tx.query("insert into public.workspace_sync (code, scope, data) values ('x', 'money', '{}')")), /row-level security|duplicate/);
  await assert.rejects(asUser(HELPER, (tx) => tx.query("insert into public.workspace_sync (code, data) values ('y', '{}')")), /row-level security/);
  const d = await db();
  const money = (await d.query("select data from public.workspace_sync where code = 'scope:money'")).rows[0].data;
  assert.ok(money.th_invoices, 'the money row is intact');
});

test('Money off can still read and write the ops row (jobs, clients) -- the field loop keeps working', async () => {
  const res = await asUser(HELPER, async (tx) => {
    await tx.query(`update public.workspace_sync set data = data || '{"th_shift_log":"[{\\"id\\":1}]"}'::jsonb where code = 'scope:ops'`);
    return tx.query("select data->>'th_shift_log' s from public.workspace_sync where code = 'scope:ops'");
  });
  assert.equal(res.rows[0].s, '[{"id":1}]');
});

test('the upsert the client sends (insert ... on conflict (code) do update) works for each person on the rows they may write', async () => {
  const up = (code, scope) => `insert into public.workspace_sync (code, scope, data, updated_at) values ('${code}', ${scope ? `'${scope}'` : 'null'}, '{"k":"v"}', now()) on conflict (code) do update set data = excluded.data, updated_at = excluded.updated_at`;
  await asUser(OWNER, (tx) => tx.query(up('scope:money', 'money')));
  await asUser(OWNER, (tx) => tx.query(up('tripleh-workspace-2026', null)));
  await asUser(HELPER, (tx) => tx.query(up('scope:ops', 'ops')));
  await assert.rejects(asUser(HELPER, (tx) => tx.query(up('scope:money', 'money'))), /row-level security/);
  // put the seeded data back for any later test
  const d = await db();
  await d.exec(`update public.workspace_sync set data = '${JSON.stringify(LEGACY).replace(/'/g, "''")}'::jsonb where code = 'tripleh-workspace-2026'`);
});

test('re-running the migration is safe: it changes nothing that already exists', async () => {
  const d = await db();
  const before = (await d.query('select code, scope, data from public.workspace_sync order by code')).rows;
  await d.exec(MIGRATION);
  const afterRows = (await d.query('select code, scope, data from public.workspace_sync order by code')).rows;
  assert.deepEqual(afterRows, before);
  const policies = (await d.query("select policyname from pg_policies where tablename = 'workspace_sync' order by 1")).rows.map((r) => r.policyname);
  assert.deepEqual(policies, ['Money row: money access only', 'Old whole blob: money and Runway access', 'Ops row: any internal account', 'Runway row: Runway access only']);
});
