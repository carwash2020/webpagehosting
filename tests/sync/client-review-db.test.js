// sql/item1/03_client_review_actions.sql (Item 1 Phase 1b, part 2): the
// review actions behind the "Possible duplicates" queue in tools/clients.html.
//
// Runs the real batch 04 default-tenant function, 06, 07 and item1/01-03 in
// PGlite, and calls each action as the signed-in staff account, the way the
// page does over PostgREST RPC.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SQL = path.join(__dirname, '..', '..', 'sql');
const read = (...p) => fs.readFileSync(path.join(SQL, ...p), 'utf8');
const BATCH_04 = read('multi-tenant', '04_fixes_defaults_and_remaining_triggers.sql');
const BATCH_06 = read('multi-tenant', '06_tenant_id_from_session_top_level_tables.sql');
const BATCH_07 = read('multi-tenant', '07_tenant_id_fallback_for_sessionless_inserts.sql');
const ITEM1 = ['01_clients_table_and_legacy_client_id.sql', '02_client_seeding_and_duplicate_candidates.sql',
  '03_client_review_actions.sql'].map((f) => read('item1', f));
const DEFAULT_TENANT_FN = BATCH_04.match(
  /create or replace function public\.default_tenant_id_triple_h\(\)[\s\S]*?grant execute on function public\.default_tenant_id_triple_h\(\)[^;]*;/)[0];

const TRIPLE_H = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const STEVE = { email: 'steve@triplehenterprisesllc.biz', role: 'authenticated' };
const HELPER = { email: 'helper@triplehenterprisesllc.biz', role: 'authenticated' }; // staff, no invoices permission
const OTHER_STAFF = { email: 'staff@other.example', role: 'authenticated' };
const PORTAL_CLIENT = { email: 'client@example.com', role: 'authenticated' };
const ANON = { role: 'anon' };

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;

  create table public.tenants (id uuid primary key, slug text unique);
  insert into public.tenants values ('${TRIPLE_H}', 'triple-h'), ('${OTHER}', 'other');

  create table public.account_roles (email text primary key, tenant_id uuid references public.tenants(id),
    can_manage_invoices boolean not null default false);
  insert into public.account_roles values
    ('${STEVE.email}', '${TRIPLE_H}', true), ('${HELPER.email}', '${TRIPLE_H}', false),
    ('${OTHER_STAFF.email}', '${OTHER}', true);
  alter table public.account_roles enable row level security;
  grant select on public.account_roles to authenticated;
  create policy own_role on public.account_roles for select to authenticated
    using (email = (select auth.email()));

  create function public.current_tenant_id() returns uuid language sql security definer
    set search_path = public stable as $$
    select ar.tenant_id from public.account_roles ar where ar.email = (select auth.jwt() ->> 'email') limit 1;
  $$;
  revoke execute on function public.current_tenant_id() from public, anon;
  grant execute on function public.current_tenant_id() to authenticated;

  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

  create table public.workspace_sync (code text primary key, data jsonb, updated_at timestamptz default now());
`;

const EXTRA_COLUMNS = {
  jobs: 'client text, client_id text, client_email text, phone text, address text, created_at timestamptz default now(),',
  invoices: 'client_name text, client_id text, client_email text, created_at timestamptz default now(),',
  quotes: 'client_name text, client_id text, client_email text, created_at timestamptz default now(),',
  contracts: 'fields jsonb, created_at timestamptz default now(),',
};
const TEN = ['jobs', 'invoices', 'quotes', 'contracts', 'referrals', 'th_job_photos', 'th_bookings',
  'push_subscriptions', 'notification_recipients', 'client_account_codes'];
const tableSql = (t) => `
  create table public.${t} (id bigint primary key, ${EXTRA_COLUMNS[t] || ''} tenant_id uuid references public.tenants(id));
  alter table public.${t} enable row level security;
  create policy staff_all on public.${t} for all to authenticated
    using (exists (select 1 from account_roles where email = (select auth.email()))
           and tenant_id = (select public.current_tenant_id()))
    with check (exists (select 1 from account_roles where email = (select auth.email()))
                and tenant_id = (select public.current_tenant_id()));`;

// Production's shape after the seed: Connor three times (registry, contact,
// portal), plus a supplier, plus another tenant's client.
const IDS = {
  registry: '11111111-0000-4000-8000-000000000001',
  contact: '11111111-0000-4000-8000-000000000002',
  portal: '11111111-0000-4000-8000-000000000003',
  supplier: '11111111-0000-4000-8000-000000000004',
  supplierTwin: '11111111-0000-4000-8000-000000000005',
  other: '11111111-0000-4000-8000-000000000009',
};
const FIXTURE = `
  insert into public.clients (id, tenant_id, display_name, email, phone, address, role, notes, legacy_id, legacy_contact_id, seed_source) values
    ('${IDS.registry}', '${TRIPLE_H}', 'Connor Dodart', 'Connor@triplehenterprisesllc.biz', '(435)632-6901', null, null, null, 'c_connor', null, 'registry'),
    ('${IDS.contact}', '${TRIPLE_H}', 'Connor Dodart', 'Connor@triplehenterprisesllc.biz', '(435)632-6901', null, 'Developer', 'The Coolest guy around', null, 1785362644345, 'contact'),
    ('${IDS.portal}', '${TRIPLE_H}', 'Connor Dodart', 'connor@triplehenterprisesllc.biz', '4356326901', '3080 S Bloomington E', null, null, null, null, 'portal'),
    ('${IDS.supplier}', '${TRIPLE_H}', 'San Diego building supply', 'crisandk05@gmail.com', null, null, null, null, 'c_sd', null, 'registry'),
    ('${IDS.supplierTwin}', '${TRIPLE_H}', 'San Diego Building Supply', null, null, null, 'Supplier', null, null, 42, 'contact'),
    ('${IDS.other}', '${OTHER}', 'Connor Dodart', 'connor@triplehenterprisesllc.biz', null, null, null, null, null, null, 'registry');
  insert into public.client_profiles (client_email, display_name, tenant_id, client_id) values
    ('connor@triplehenterprisesllc.biz', 'Connor Dodart', '${TRIPLE_H}', '${IDS.portal}');
  insert into public.contracts (id, fields, tenant_id, client_id) values
    (1, '{"clientName":"Connor Dodart"}', '${TRIPLE_H}', '${IDS.contact}');
  select public.refresh_client_duplicate_candidates('${TRIPLE_H}');
  select public.refresh_client_duplicate_candidates('${OTHER}');
`;

const dbs = [];
after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

async function buildDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  dbs.push(db);
  await db.exec(BASE_SCHEMA);
  await db.exec(DEFAULT_TENANT_FN);
  for (const t of TEN) await db.exec(tableSql(t));
  await db.exec(`create table public.client_profiles (client_email text primary key, display_name text,
    phone text, updated_at timestamptz, tenant_id uuid references public.tenants(id));`);
  await db.exec(BATCH_06);
  await db.exec(BATCH_07);
  for (const f of ITEM1) await db.exec(f);
  await db.exec(FIXTURE);
  return db;
}

// Runs one statement as `claims`, committed (so later reads see it), or
// returns the error.
async function as(db, claims, sql, params = []) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || {})]);
    if (claims) await db.exec(`set local role ${claims.role}`);
    const r = await db.query(sql, params);
    await db.exec('commit');
    return r.rows;
  } catch (error) {
    await db.exec('rollback');
    return { error };
  }
}

const pairOf = (db, a, b) => db.query(
  `select * from public.client_duplicate_candidates
    where client_a = least($1::uuid, $2::uuid) and client_b = greatest($1::uuid, $2::uuid)`, [a, b]).then((r) => r.rows[0]);
const client = (db, id) => db.query('select * from public.clients where id = $1', [id]).then((r) => r.rows[0]);
const openPairs = (db) => db.query(
  `select client_a, client_b from public.client_duplicate_candidates where status = 'open' and tenant_id = $1`, [TRIPLE_H])
  .then((r) => r.rows);

test('the fixture starts with Connor x3 (three pairs) and the supplier pair open', async () => {
  const db = await buildDb();
  assert.equal((await openPairs(db)).length, 4);
});

test('merge: keeps one, fills its blanks, repoints contracts and portal accounts, records what it did', async () => {
  const db = await buildDb();
  const pair = await pairOf(db, IDS.registry, IDS.contact);
  const r = await as(db, STEVE, 'select public.merge_client_candidate($1, $2) as d', [pair.id, IDS.registry]);
  assert.ifError(r.error);
  const d = r[0].d;
  assert.deepEqual(d.filled, ['role', 'notes']);
  assert.deepEqual(d.contracts, [1]);
  assert.equal(d.kept, IDS.registry);
  assert.equal(d.merged, IDS.contact);

  const kept = await client(db, IDS.registry);
  assert.equal(kept.role, 'Developer');
  assert.equal(kept.notes, 'The Coolest guy around');
  assert.equal(kept.email, 'Connor@triplehenterprisesllc.biz', 'an existing value is never overwritten');
  assert.equal(kept.merged_into_id, null);
  const gone = await client(db, IDS.contact);
  assert.equal(gone.merged_into_id, IDS.registry);
  assert.equal(String(gone.legacy_contact_id), '1785362644345', 'the merged row keeps its legacy ids for the step 2 backfill');

  const contract = (await db.query('select client_id from public.contracts where id = 1')).rows[0];
  assert.equal(contract.client_id, IDS.registry);

  const decided = await pairOf(db, IDS.registry, IDS.contact);
  assert.equal(decided.status, 'merged');
  assert.equal(decided.decided_by, STEVE.email);
  assert.ok(decided.decided_at);
  assert.deepEqual(decided.merge_detail, d);
});

test("merge: the merged client's other pairs go, and the kept client keeps its own", async () => {
  const db = await buildDb();
  const pair = await pairOf(db, IDS.registry, IDS.contact);
  await as(db, STEVE, 'select public.merge_client_candidate($1, $2)', [pair.id, IDS.registry]);
  const open = await openPairs(db);
  assert.ok(!open.some((p) => [p.client_a, p.client_b].includes(IDS.contact)), 'no open pair with the merged client');
  assert.ok(open.some((p) => [p.client_a, p.client_b].sort().join() === [IDS.registry, IDS.portal].sort().join()),
    'registry and portal are still a pair');
});

test('merge all three into one: the portal account follows, and earlier merges re-point to the survivor', async () => {
  const db = await buildDb();
  // contact -> portal first, then portal -> registry.
  const p1 = await pairOf(db, IDS.contact, IDS.portal);
  assert.ifError((await as(db, STEVE, 'select public.merge_client_candidate($1, $2)', [p1.id, IDS.portal])).error);
  const p2 = await pairOf(db, IDS.registry, IDS.portal);
  const r = await as(db, STEVE, 'select public.merge_client_candidate($1, $2) as d', [p2.id, IDS.registry]);
  assert.ifError(r.error);
  assert.deepEqual(r[0].d.client_profiles, ['connor@triplehenterprisesllc.biz']);
  assert.deepEqual(r[0].d.already_merged_into_it, [IDS.contact]);
  assert.deepEqual(r[0].d.contracts, [1], 'the contract moved to portal in the first merge, then to registry');

  assert.equal((await client(db, IDS.contact)).merged_into_id, IDS.registry, 'no chains: everything points at the survivor');
  assert.equal((await client(db, IDS.portal)).merged_into_id, IDS.registry);
  const kept = await client(db, IDS.registry);
  assert.equal(kept.address, '3080 S Bloomington E', 'filled from the portal row');
  assert.equal(kept.role, 'Developer', 'carried through the first merge');
  const profile = (await db.query('select client_id from public.client_profiles')).rows[0];
  assert.equal(profile.client_id, IDS.registry);
  const connorOpen = (await openPairs(db)).filter((p) => [p.client_a, p.client_b].includes(IDS.registry));
  assert.equal(connorOpen.length, 0, 'nothing left to review for Connor');
});

test('merge: refuses a decided pair, a client outside the pair, and a second merge of the same pair', async () => {
  const db = await buildDb();
  const pair = await pairOf(db, IDS.registry, IDS.contact);
  const wrongKeep = await as(db, STEVE, 'select public.merge_client_candidate($1, $2)', [pair.id, IDS.portal]);
  assert.match(wrongKeep.error.message, /must be one of the pair/);
  assert.ifError((await as(db, STEVE, 'select public.merge_client_candidate($1, $2)', [pair.id, IDS.registry])).error);
  const again = await as(db, STEVE, 'select public.merge_client_candidate($1, $2)', [pair.id, IDS.contact]);
  assert.match(again.error.message, /already reviewed/);
  assert.equal((await client(db, IDS.registry)).merged_into_id, null, 'the refused call changed nothing');
});

test('keep separate: the pair stays decided through a refresh', async () => {
  const db = await buildDb();
  const pair = await pairOf(db, IDS.supplier, IDS.supplierTwin);
  assert.ifError((await as(db, STEVE, 'select public.keep_client_candidate_separate($1)', [pair.id])).error);
  const r = await as(db, STEVE, 'select public.refresh_my_client_candidates() as n');
  assert.ifError(r.error);
  const after = await pairOf(db, IDS.supplier, IDS.supplierTwin);
  assert.equal(after.status, 'kept_separate');
  assert.equal(after.decided_by, STEVE.email);
  const again = await as(db, STEVE, 'select public.keep_client_candidate_separate($1)', [pair.id]);
  assert.match(again.error.message, /no open candidate/);
});

test('not a client: flagged, its open pairs dismissed, and it never pairs again', async () => {
  const db = await buildDb();
  const r = await as(db, STEVE, 'select public.mark_client_not_a_client($1) as n', [IDS.supplierTwin]);
  assert.ifError(r.error);
  assert.equal(r[0].n, 1);
  assert.equal((await client(db, IDS.supplierTwin)).not_a_client, true);
  assert.equal((await pairOf(db, IDS.supplier, IDS.supplierTwin)).status, 'dismissed');
  // A new look-alike doesn't pair with it.
  await db.exec(`insert into public.clients (tenant_id, display_name) values ('${TRIPLE_H}', 'San Diego building SUPPLY')`);
  await as(db, STEVE, 'select public.refresh_my_client_candidates()');
  const pairsWithIt = (await openPairs(db)).filter((p) => [p.client_a, p.client_b].includes(IDS.supplierTwin));
  assert.equal(pairsWithIt.length, 0);
});

test('edit: staff can correct a client directly, and the refresh sees it', async () => {
  const db = await buildDb();
  const r = await as(db, STEVE, `update public.clients set email = 'orders@sdbs.example' where id = $1 returning email_norm`, [IDS.supplierTwin]);
  assert.ifError(r.error);
  assert.equal(r[0].email_norm, 'orders@sdbs.example');
  await as(db, STEVE, 'select public.refresh_my_client_candidates()');
  assert.deepEqual((await pairOf(db, IDS.supplier, IDS.supplierTwin)).reasons, ['name'], 'reasons refreshed');
});

test('permissions: only staff who can manage invoices, in their own tenant, can review', async () => {
  const db = await buildDb();
  const pair = await pairOf(db, IDS.registry, IDS.contact);
  const calls = [
    ['select public.merge_client_candidate($1, $2)', [pair.id, IDS.registry]],
    ['select public.keep_client_candidate_separate($1)', [pair.id]],
    ['select public.mark_client_not_a_client($1)', [IDS.contact]],
    ['select public.refresh_my_client_candidates()', []],
  ];
  for (const who of [HELPER, OTHER_STAFF, PORTAL_CLIENT, ANON]) {
    for (const [sql, params] of calls) {
      // Another tenant's reviewer may refresh their own tenant's pairs; the
      // cross-tenant check is below.
      if (who === OTHER_STAFF && params.length === 0) continue;
      const r = await as(db, who, sql, params);
      assert.ok(r.error, `${who.email || 'anon'} should be refused: ${sql}`);
      assert.match(r.error.message, /not allowed to review clients|permission denied|no such|no open/, r.error.message);
    }
  }
  // Another tenant's reviewer can't touch Triple H's pair even with the id.
  const cross = await as(db, OTHER_STAFF, 'select public.merge_client_candidate($1, $2)', [pair.id, IDS.registry]);
  assert.match(cross.error.message, /no such candidate/);
  const otherRefresh = await as(db, OTHER_STAFF, 'select public.refresh_my_client_candidates() as n');
  assert.ifError(otherRefresh.error);
  assert.equal((await pairOf(db, IDS.registry, IDS.contact)).status, 'open', 'nothing was decided');
  assert.equal((await client(db, IDS.contact)).not_a_client, false);
});

test("permissions: the internal helpers aren't callable over RPC", async () => {
  const db = await buildDb();
  const { rows } = await db.query(`
    select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can
      from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
     where p.proname in ('client_review_tenant', 'refresh_client_duplicate_candidates', 'item1_seed_clients')
     order by 1, 2`);
  assert.ok(rows.length === 6 && rows.every((r) => r.can === false), JSON.stringify(rows));
  const { rows: granted } = await db.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p where p.proname in ('merge_client_candidate', 'keep_client_candidate_separate',
        'mark_client_not_a_client', 'refresh_my_client_candidates') order by 1`);
  assert.deepEqual(granted.map((g) => [g.proname, g.anon, g.auth]), [
    ['keep_client_candidate_separate', false, true],
    ['mark_client_not_a_client', false, true],
    ['merge_client_candidate', false, true],
    ['refresh_my_client_candidates', false, true],
  ]);
});

test('the file can be re-run safely, and existing decisions survive it', async () => {
  const db = await buildDb();
  const pair = await pairOf(db, IDS.supplier, IDS.supplierTwin);
  await as(db, STEVE, 'select public.keep_client_candidate_separate($1)', [pair.id]);
  await db.exec(ITEM1[2]);
  assert.equal((await pairOf(db, IDS.supplier, IDS.supplierTwin)).status, 'kept_separate');
});
