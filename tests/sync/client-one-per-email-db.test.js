// sql/item1/04_one_client_per_email.sql (Item 1 Phase 1b, part 3): one
// client per email. Connor, 2026-09-30: "make sure we can't have duplicates
// in the future." The same email is blocked outright; the same phone and the
// same name stay review flags (tools/data-layer.js handles phone in the app).
//
// Runs the real batch 04 default-tenant function, 06, 07 and item1/01-04 in
// PGlite.

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
  '03_client_review_actions.sql', '04_one_client_per_email.sql'].map((f) => read('item1', f));
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

const CODE = 'tripleh-workspace-2026';

// The production case: the same person in the registry, the contacts and
// the portal, all with one email (in different capitals).
function blobSql({ registry = [], contacts = [], clientTombstones = [], contactTombstones = [] } = {}) {
  const data = {
    th_clients: JSON.stringify(registry),
    th_tracker_contacts: JSON.stringify(contacts),
    th_client_tombstones: JSON.stringify(clientTombstones),
    th_contact_tombstones: JSON.stringify(contactTombstones),
  };
  return `insert into public.workspace_sync (code, data) values ('${CODE}', '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)
          on conflict (code) do update set data = excluded.data;`;
}
const CONNOR_REGISTRY = { id: 'c_connor', name: 'Connor Dodart', email: 'Connor@triplehenterprisesllc.biz', phone: '(435)632-6901', address: '', createdAt: '2026-08-17T05:25:05.771Z' };
const CONNOR_CONTACT = { id: 1785362644345, name: 'Connor Dodart', role: 'Developer', email: 'Connor@triplehenterprisesllc.biz', notes: 'The Coolest guy around', phone: '(435)632-6901' };
const CONNOR_PORTAL = `insert into public.client_profiles (client_email, display_name, phone, tenant_id)
  values ('connor@triplehenterprisesllc.biz', 'Connor Dodart', '4356326901', '${TRIPLE_H}');`;

const dbs = [];
after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

async function buildDb({ blob = blobSql(), extra = '' } = {}) {
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
  await db.exec(blob);
  if (extra) await db.exec(extra);
  return db;
}

const seed = (db) => db.query('select public.item1_seed_clients($1, $2) as r', [TRIPLE_H, CODE]).then((x) => x.rows[0].r);
const live = (db) => db.query(`select * from public.clients where tenant_id = $1 and merged_into_id is null order by display_name`, [TRIPLE_H]).then((r) => r.rows);
const insertClient = (db, name, email, extra = {}) => db.query(
  `insert into public.clients (tenant_id, display_name, email, not_a_client, merged_into_id) values ($1, $2, $3, $4, $5) returning id`,
  [extra.tenant || TRIPLE_H, name, email, !!extra.notAClient, extra.mergedInto || null]).then((r) => r.rows[0].id);

test('the same person from the registry, the contacts and the portal seeds as ONE live client', async () => {
  const db = await buildDb({ blob: blobSql({ registry: [CONNOR_REGISTRY], contacts: [CONNOR_CONTACT] }), extra: CONNOR_PORTAL });
  const r = await seed(db);
  assert.equal(r.registry, 1);
  assert.equal(r.contact, 1);
  assert.equal(r.portal, 1);
  assert.equal(r.folded, 2, 'the contact and the portal account folded into the registry client');
  assert.equal(r.live_clients, 1);
  assert.equal(r.total_clients, 2, 'the contact row is kept, already merged, for its legacy id; the portal adds no row');

  const [connor] = await live(db);
  assert.equal(connor.seed_source, 'registry');
  assert.equal(connor.role, 'Developer', 'blanks filled from the contact');
  assert.equal(connor.notes, 'The Coolest guy around');

  const contactRow = (await db.query(`select * from public.clients where seed_source = 'contact'`)).rows[0];
  assert.equal(contactRow.merged_into_id, connor.id);
  assert.equal(String(contactRow.legacy_contact_id), '1785362644345');

  const profile = (await db.query(`select client_id from public.client_profiles`)).rows[0];
  assert.equal(profile.client_id, connor.id, 'the portal account links to the existing client');

  const folds = (await db.query(`select status, reasons, decided_by, merge_detail from public.client_duplicate_candidates`)).rows;
  assert.equal(folds.length, 1);
  assert.deepEqual([folds[0].status, folds[0].reasons, folds[0].decided_by], ['merged', ['email'], 'automatic: same email']);
  assert.deepEqual(folds[0].merge_detail.filled, ['role', 'notes']);

  assert.equal(await db.query(`select public.refresh_client_duplicate_candidates($1) as n`, [TRIPLE_H]).then((x) => x.rows[0].n), 0,
    'nothing left to review');
});

test('a re-run folds nothing new and adds nothing', async () => {
  const db = await buildDb({ blob: blobSql({ registry: [CONNOR_REGISTRY], contacts: [CONNOR_CONTACT] }), extra: CONNOR_PORTAL });
  await seed(db);
  const again = await seed(db);
  assert.deepEqual([again.registry, again.contact, again.portal, again.record_name, again.folded, again.live_clients],
    [0, 0, 0, 0, 0, 1]);
});

test('two registry entries with one email: the first stays, the second folds into it', async () => {
  const db = await buildDb({ blob: blobSql({ registry: [
    { id: 'c_a', name: 'Sarah Miller', email: 'sarah@example.com', phone: '', address: '1 Main St', createdAt: '2026-08-01T00:00:00Z' },
    { id: 'c_b', name: 'Sarah M.', email: ' SARAH@example.com ', phone: '435-555-0101', address: '', createdAt: '2026-08-02T00:00:00Z' },
  ] }) });
  const r = await seed(db);
  assert.equal(r.folded, 1);
  const rows = await live(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].legacy_id, 'c_a');
  assert.equal(rows[0].phone, '435-555-0101', 'the blank phone was filled from the second');
  const b = (await db.query(`select merged_into_id from public.clients where legacy_id = 'c_b'`)).rows[0];
  assert.equal(b.merged_into_id, rows[0].id, 'the second keeps its legacy id, merged, for the backfill');
});

test('the same phone or the same name alone never folds: those stay review pairs', async () => {
  const db = await buildDb({ blob: blobSql({ registry: [
    { id: 'c_1', name: 'Sarah Miller', email: 'sarah@example.com', phone: '435-555-0101' },
    { id: 'c_2', name: 'Bill Miller', email: 'bill@example.com', phone: '(435) 555-0101' },
    { id: 'c_3', name: 'Mike', email: '', phone: '' },
    { id: 'c_4', name: 'mike', email: 'mike2@example.com', phone: '' },
  ] }) });
  const r = await seed(db);
  assert.equal(r.folded, 0);
  assert.equal(r.live_clients, 4);
  assert.equal(await db.query(`select public.refresh_client_duplicate_candidates($1) as n`, [TRIPLE_H]).then((x) => x.rows[0].n), 2,
    'one phone pair, one name pair, for review');
});

test('the database refuses a second live client with the same email, in any capitals', async () => {
  const db = await buildDb();
  await insertClient(db, 'Sarah Miller', 'sarah@example.com');
  await assert.rejects(insertClient(db, 'Sarah M', ' Sarah@Example.com '), /clients_tenant_email_live_key|duplicate key/);
  const r = await as(db, STEVE, `update public.clients set email = 'sarah@example.com' where id = $1`,
    [await insertClient(db, 'Someone Else', null)]);
  assert.match(r.error.message, /duplicate key|clients_tenant_email_live_key/, 'an edit to a taken email is refused too');
});

test('the rule leaves out merged clients, not-a-client rows, blank emails and other tenants', async () => {
  const db = await buildDb();
  const kept = await insertClient(db, 'Sarah Miller', 'sarah@example.com');
  await insertClient(db, 'Sarah (merged)', 'sarah@example.com', { mergedInto: kept });
  await insertClient(db, 'Sarah Supplies', 'sarah@example.com', { notAClient: true });
  await insertClient(db, 'Sarah elsewhere', 'sarah@example.com', { tenant: OTHER });
  await insertClient(db, 'No Email 1', null);
  await insertClient(db, 'No Email 2', '');
  assert.equal((await db.query(`select count(*)::int n from public.clients`)).rows[0].n, 6);
});

test('a merge where only the merged client has the email moves it to the kept client', async () => {
  const db = await buildDb();
  const a = await insertClient(db, 'Sarah Miller', null);
  const b = await insertClient(db, 'Sarah Miller', 'sarah@example.com');
  await db.query(`select public.refresh_client_duplicate_candidates($1)`, [TRIPLE_H]);
  const pair = (await db.query(`select id from public.client_duplicate_candidates`)).rows[0];
  const r = await as(db, STEVE, 'select public.merge_client_candidate($1, $2) as d', [pair.id, a]);
  assert.ifError(r.error);
  assert.deepEqual(r[0].d.filled, ['email']);
  assert.equal((await db.query('select email from public.clients where id = $1', [a])).rows[0].email, 'sarah@example.com');
  assert.equal((await db.query('select merged_into_id from public.clients where id = $1', [b])).rows[0].merged_into_id, a);
});

test('a portal account whose email is new still becomes its own client', async () => {
  const db = await buildDb({ extra: `insert into public.client_profiles (client_email, display_name, tenant_id)
    values ('new@example.com', 'New Person', '${TRIPLE_H}');` });
  const r = await seed(db);
  assert.equal(r.portal, 1);
  assert.equal(r.folded, 0);
  const [c] = await live(db);
  assert.equal(c.seed_source, 'portal');
  assert.equal((await db.query('select client_id from public.client_profiles')).rows[0].client_id, c.id);
});

test('the new helpers are not callable over RPC', async () => {
  const db = await buildDb();
  const { rows } = await db.query(`
    select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can
      from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
     where p.proname in ('item1_fill_client_blanks', 'item1_seed_one_client', 'item1_seed_clients')
     order by 1, 2`);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.can === false), JSON.stringify(rows));
});

test('the file can be re-run safely', async () => {
  const db = await buildDb({ blob: blobSql({ registry: [CONNOR_REGISTRY], contacts: [CONNOR_CONTACT] }) });
  await seed(db);
  await db.exec(ITEM1[3]);
  assert.equal((await live(db)).length, 1);
});
