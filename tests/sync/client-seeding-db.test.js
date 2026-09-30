// sql/item1/02_client_seeding_and_duplicate_candidates.sql (Item 1 Phase 1b,
// part 1): seeding `clients` from the blob registry, blob contacts, portal
// accounts and free-text record names, and listing duplicate candidates.
//
// Runs the real batch 04 default-tenant function, 06, 07, item1/01 and
// item1/02 in PGlite. The fixture blob is shaped like production's
// (2026-09-30): the same person in the registry, the contacts and the portal;
// tombstoned clients whose names are still on jobs; and one registry id that
// a job still points to.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SQL = path.join(__dirname, '..', '..', 'sql');
const read = (...p) => fs.readFileSync(path.join(SQL, ...p), 'utf8');
const BATCH_04 = read('multi-tenant', '04_fixes_defaults_and_remaining_triggers.sql');
const BATCH_06 = read('multi-tenant', '06_tenant_id_from_session_top_level_tables.sql');
const BATCH_07 = read('multi-tenant', '07_tenant_id_fallback_for_sessionless_inserts.sql');
const ITEM1_01 = read('item1', '01_clients_table_and_legacy_client_id.sql');
const ITEM1_02 = read('item1', '02_client_seeding_and_duplicate_candidates.sql');
const DEFAULT_TENANT_FN = BATCH_04.match(
  /create or replace function public\.default_tenant_id_triple_h\(\)[\s\S]*?grant execute on function public\.default_tenant_id_triple_h\(\)[^;]*;/)[0];

const TRIPLE_H = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const CODE = 'tripleh-workspace-2026';
const STAFF = { email: 'staff@triplehenterprisesllc.biz', role: 'authenticated' };
const OTHER_STAFF = { email: 'staff@other.example', role: 'authenticated' };
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

  create table public.account_roles (email text primary key, tenant_id uuid references public.tenants(id));
  insert into public.account_roles values ('${STAFF.email}', '${TRIPLE_H}'), ('${OTHER_STAFF.email}', '${OTHER}');
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
  alter table public.workspace_sync enable row level security;
`;

// The live column shapes the seed reads.
const EXTRA_COLUMNS = {
  jobs: 'client text, client_id text, client_email text, phone text, address text, created_at timestamptz default now(),',
  invoices: 'client_name text, client_id text, client_email text, created_at timestamptz default now(),',
  quotes: 'client_name text, client_id text, client_email text, created_at timestamptz default now(),',
  contracts: 'fields jsonb, created_at timestamptz default now(),',
};
const TEN = ['jobs', 'invoices', 'quotes', 'contracts', 'referrals', 'th_job_photos', 'th_bookings',
  'push_subscriptions', 'notification_recipients', 'client_account_codes'];

function tableSql(t) {
  return `
    create table public.${t} (id bigint primary key, ${EXTRA_COLUMNS[t] || ''}
      tenant_id uuid references public.tenants(id));
    alter table public.${t} enable row level security;
    create policy staff_all on public.${t} for all to authenticated
      using (exists (select 1 from account_roles where email = (select auth.email()))
             and tenant_id = (select public.current_tenant_id()))
      with check (exists (select 1 from account_roles where email = (select auth.email()))
                  and tenant_id = (select public.current_tenant_id()));
  `;
}

// Shaped like production's blob on 2026-09-30.
const REGISTRY = [
  { id: 'c_bree', name: 'Bree Sullivan', email: '', phone: '4358628162', address: 'Little valley area', createdAt: '2026-08-17T05:25:05.771Z', source: 'backfill' },
  { id: 'c_connor', name: 'Connor Dodart', email: 'Connor@triplehenterprisesllc.biz', phone: '(435)632-6901', address: '', createdAt: '2026-08-17T05:25:05.771Z', source: 'backfill' },
  { id: 'c_richie', name: 'Richie', email: '', phone: '', address: '', createdAt: 'not a date', source: 'created' },
  { id: 'c_restored', name: 'Restored Rita', email: '', phone: '', address: '', createdAt: '2026-09-01T00:00:00Z', source: 'created' },
  { id: 'c_deleted_still_cached', name: 'Deleted Dan', email: '', phone: '', address: '', createdAt: '2026-09-01T00:00:00Z', source: 'created' },
  { id: '', name: 'No Id', email: '' },
  { id: 'c_blank', name: '   ', email: '' },
];
const CLIENT_TOMBSTONES = [
  { id: 'c_old_bree', normalizedName: 'bree sullivan', deletedAt: '2026-08-26T18:12:28Z' },
  { id: 'c_unknown', normalizedName: 'unknown', deletedAt: '2026-09-07T18:10:25Z' },
  { id: 'c_yelp', normalizedName: 'yelp customer', deletedAt: '2026-09-24T06:07:40Z' },
  { id: 'c_restored', normalizedName: 'restored rita', deletedAt: '2026-09-02T00:00:00Z', restoredAt: '2026-09-03T00:00:00Z' },
  { id: 'c_deleted_still_cached', normalizedName: 'deleted dan', deletedAt: '2026-09-05T00:00:00Z' },
];
const CONTACTS = [
  { id: 1785362644345, name: 'Connor Dodart', role: 'Developer', email: 'Connor@triplehenterprisesllc.biz', notes: 'The Coolest guy around', phone: '(435)632-6901' },
  { id: 1785362644999, name: 'Pat Supplier', role: 'Supplier', email: '', notes: '', phone: '' },
  { id: 1785362645000, name: 'Gone Gary', role: '', email: '', notes: '', phone: '' },
  { id: 'abc', name: 'Bad Id', role: '' },
];
const CONTACT_TOMBSTONES = [{ id: 1785362645000, deletedAt: '2026-09-10T00:00:00Z' }];

function blobSql({ registry = REGISTRY, contacts = CONTACTS, clientTombstones = CLIENT_TOMBSTONES,
  contactTombstones = CONTACT_TOMBSTONES } = {}) {
  // Each key is a JSON string, as tools/sync.js stores it.
  const data = {
    th_clients: JSON.stringify(registry),
    th_tracker_contacts: JSON.stringify(contacts),
    th_client_tombstones: JSON.stringify(clientTombstones),
    th_contact_tombstones: JSON.stringify(contactTombstones),
  };
  return `insert into public.workspace_sync (code, data) values ('${CODE}', '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)
          on conflict (code) do update set data = excluded.data;`;
}

const RECORDS = `
  insert into public.jobs (id, client, client_id, client_email, phone, address, tenant_id, created_at) values
    (1, 'Bree Sullivan', null, null, null, 'Little valley area', '${TRIPLE_H}', '2026-08-01T00:00:00Z'),
    (2, 'Unknown', 'c_unknown', null, '9098413546', '339 s 600 e', '${TRIPLE_H}', '2026-08-02T00:00:00Z'),
    (3, 'Yelp customer', 'c_yelp', null, null, null, '${TRIPLE_H}', '2026-08-03T00:00:00Z'),
    (4, 'Richie Renamed', 'c_richie', null, null, null, '${TRIPLE_H}', '2026-08-04T00:00:00Z'),
    (5, '  sherri   CARLSON ', null, null, null, null, '${TRIPLE_H}', '2026-08-05T00:00:00Z'),
    (6, 'Sherri Carlson', null, null, '435-555-0100', '5429 w copper cliffs', '${TRIPLE_H}', '2026-08-06T00:00:00Z'),
    (7, 'Other Tenant Olga', null, null, null, null, '${OTHER}', '2026-08-07T00:00:00Z'),
    (8, 'Deleted Dan', null, null, null, null, '${TRIPLE_H}', '2026-08-08T00:00:00Z'),
    (9, '', null, null, null, null, '${TRIPLE_H}', '2026-08-09T00:00:00Z');
  insert into public.invoices (id, client_name, client_id, client_email, tenant_id) values
    (10, 'Cody Grover', 'c_cody_not_in_registry', 'Cody@smartlivingbuilders.com', '${TRIPLE_H}');
  insert into public.contracts (id, fields, tenant_id) values
    (1, '{"clientName":"Connor Dodart","email":"x@y.z"}', '${TRIPLE_H}'),
    (2, '{"clientName":"Contract Carl","email":"carl@example.com","phone":"(435) 555-0199","serviceAddress":"1 Main St"}', '${TRIPLE_H}');
  insert into public.client_profiles (client_email, display_name, phone, tenant_id, updated_at) values
    ('connor@triplehenterprisesllc.biz', 'Connor Dodart', '4356326901', '${TRIPLE_H}', '2026-09-04T06:42:46Z'),
    ('portal-only@example.com', null, null, '${TRIPLE_H}', null),
    ('other@example.com', 'Other Portal', null, '${OTHER}', null);
`;

const dbs = [];
after(async () => { await Promise.all(dbs.map((db) => db.close().catch(() => {}))); });

async function buildDb({ blob = blobSql(), records = RECORDS } = {}) {
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
  await db.exec(ITEM1_01);
  await db.exec(ITEM1_02);
  if (blob) await db.exec(blob);
  if (records) await db.exec(records);
  return db;
}

const seed = (db, tenant = TRIPLE_H) =>
  db.query('select public.item1_seed_clients($1, $2) as r', [tenant, CODE]).then((x) => x.rows[0].r);
const refresh = (db, tenant = TRIPLE_H) =>
  db.query('select public.refresh_client_duplicate_candidates($1) as n', [tenant]).then((x) => x.rows[0].n);
const clients = (db, tenant = TRIPLE_H) => db.query(
  `select display_name, email, phone, address, role, notes, legacy_id, legacy_contact_id::text, seed_source,
          tenant_id, created_at
     from public.clients where tenant_id = $1 order by seed_source, display_name`, [tenant]).then((x) => x.rows);

test('seeds each source once, with the counts reported', async () => {
  const db = await buildDb();
  const r = await seed(db);
  // registry: Bree, Connor, Richie, Restored Rita (Deleted Dan tombstoned; no-id and blank skipped)
  // contact: Connor, Pat Supplier (Gone Gary tombstoned; 'abc' id skipped)
  // portal: connor@…, portal-only@… (other tenant's profile untouched)
  // record_name: Sherri Carlson, Cody Grover, Contract Carl
  assert.deepEqual(r, { registry: 4, contact: 2, portal: 2, record_name: 3, total_clients: 11 });
  const rows = await clients(db);
  assert.ok(rows.every((c) => c.tenant_id === TRIPLE_H));
  assert.deepEqual(rows.map((c) => `${c.seed_source}:${c.display_name}`), [
    'contact:Connor Dodart', 'contact:Pat Supplier',
    'portal:Connor Dodart', 'portal:portal-only@example.com',
    'record_name:Cody Grover', 'record_name:Contract Carl', 'record_name:Sherri Carlson',
    'registry:Bree Sullivan', 'registry:Connor Dodart', 'registry:Restored Rita', 'registry:Richie',
  ]);
});

test('registry rows keep the old id as legacy_id, blanks become null, and createdAt carries over', async () => {
  const db = await buildDb();
  await seed(db);
  const rows = await clients(db);
  const bree = rows.find((c) => c.legacy_id === 'c_bree');
  assert.equal(bree.email, null);
  assert.equal(bree.phone, '4358628162');
  assert.equal(bree.address, 'Little valley area');
  assert.equal(new Date(bree.created_at).toISOString(), '2026-08-17T05:25:05.771Z');
  // A createdAt that doesn't parse falls back to now() instead of failing the seed.
  const richie = rows.find((c) => c.legacy_id === 'c_richie');
  assert.ok(Date.now() - new Date(richie.created_at).getTime() < 60_000);
});

test('contacts keep role and notes and get created_at from their Date.now() id', async () => {
  const db = await buildDb();
  await seed(db);
  const connor = (await clients(db)).find((c) => c.seed_source === 'contact' && c.display_name === 'Connor Dodart');
  assert.equal(connor.legacy_contact_id, '1785362644345');
  assert.equal(connor.role, 'Developer');
  assert.equal(connor.notes, 'The Coolest guy around');
  assert.equal(new Date(connor.created_at).getTime(), 1785362644345);
});

test('deleted clients are not re-seeded, by id or by name; a restored one is', async () => {
  const db = await buildDb();
  await seed(db);
  const names = (await clients(db)).map((c) => c.display_name);
  for (const gone of ['Deleted Dan', 'Unknown', 'Yelp customer', 'Gone Gary']) {
    assert.ok(!names.includes(gone), `${gone} should not be seeded`);
  }
  assert.ok(names.includes('Restored Rita'));
});

test('portal accounts become clients and are linked back through client_profiles.client_id', async () => {
  const db = await buildDb();
  await seed(db);
  const { rows } = await db.query(`
    select p.client_email, c.display_name, c.email, c.phone, c.seed_source
      from public.client_profiles p left join public.clients c on c.id = p.client_id
     order by p.client_email`);
  assert.deepEqual(rows, [
    { client_email: 'connor@triplehenterprisesllc.biz', display_name: 'Connor Dodart',
      email: 'connor@triplehenterprisesllc.biz', phone: '4356326901', seed_source: 'portal' },
    // Another tenant's portal account is not touched by Triple H's seed.
    { client_email: 'other@example.com', display_name: null, email: null, phone: null, seed_source: null },
    // No display name: the email stands in, so the row passes the not-blank check.
    { client_email: 'portal-only@example.com', display_name: 'portal-only@example.com',
      email: 'portal-only@example.com', phone: null, seed_source: 'portal' },
  ]);
});

test('record names: grouped by normalized name, the latest spelling and details win, and contract field keys are read', async () => {
  const db = await buildDb();
  await seed(db);
  const rows = await clients(db);
  const sherri = rows.filter((c) => c.seed_source === 'record_name' && c.display_name.toLowerCase().includes('sherri'));
  assert.equal(sherri.length, 1, 'two spellings of the same name are one client');
  assert.equal(sherri[0].display_name, 'Sherri Carlson', 'the latest record names it');
  assert.equal(new Date(sherri[0].created_at).toISOString(), '2026-08-05T00:00:00.000Z', 'created at the first record');
  assert.equal(sherri[0].phone, '435-555-0100');
  assert.equal(sherri[0].address, '5429 w copper cliffs');
  const carl = rows.find((c) => c.display_name === 'Contract Carl');
  assert.deepEqual([carl.email, carl.phone, carl.address], ['carl@example.com', '(435) 555-0199', '1 Main St']);
});

test('record names already covered are not seeded again', async () => {
  const db = await buildDb();
  await seed(db);
  const names = (await clients(db)).filter((c) => c.seed_source === 'record_name').map((c) => c.display_name);
  // Bree matches the registry by name; "Richie Renamed" points at registry id c_richie;
  // the contract's "Connor Dodart" matches by name; the blank name is skipped.
  assert.deepEqual(names.sort(), ['Cody Grover', 'Contract Carl', 'Sherri Carlson']);
});

test('a re-run adds nothing, and a new registry entry added later is picked up', async () => {
  const db = await buildDb();
  await seed(db);
  assert.deepEqual(await seed(db), { registry: 0, contact: 0, portal: 0, record_name: 0, total_clients: 11 });
  await db.exec(blobSql({ registry: [...REGISTRY, { id: 'c_new', name: 'New Nina', createdAt: '2026-09-30T00:00:00Z' }] }));
  const r = await seed(db);
  assert.equal(r.registry, 1);
  assert.equal(r.total_clients, 12);
});

test("seeding one tenant leaves another tenant's records alone", async () => {
  const db = await buildDb();
  await seed(db);
  assert.equal((await clients(db, OTHER)).length, 0);
});

test('an unknown tenant or sync code fails loudly instead of seeding nothing', async () => {
  const db = await buildDb();
  await assert.rejects(seed(db, 'aaaaaaaa-0000-4000-8000-00000000dead'), /unknown tenant/);
  await assert.rejects(db.query('select public.item1_seed_clients($1, $2)', [TRIPLE_H, 'nope']), /no workspace_sync row/);
});

test('a blob with a key missing or not an array still seeds the rest', async () => {
  const db = await buildDb({
    blob: `insert into public.workspace_sync (code, data) values ('${CODE}',
      '${JSON.stringify({ th_clients: JSON.stringify({ not: 'an array' }) })}'::jsonb);`,
  });
  const r = await seed(db);
  assert.equal(r.registry, 0);
  assert.equal(r.contact, 0);
  assert.equal(r.portal, 2);
});

test('candidates: the same person from three sources gives three pairs, with every reason', async () => {
  const db = await buildDb();
  await seed(db);
  assert.equal(await refresh(db), 3);
  const { rows } = await db.query(`
    select a.seed_source as a_src, b.seed_source as b_src, d.reasons, d.status, d.tenant_id
      from public.client_duplicate_candidates d
      join public.clients a on a.id = d.client_a join public.clients b on b.id = d.client_b`);
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.equal(r.status, 'open');
    assert.equal(r.tenant_id, TRIPLE_H);
    assert.ok([r.a_src, r.b_src].every((s) => ['registry', 'contact', 'portal'].includes(s)));
  }
  // The contract row used a different email, so the portal and contact
  // pairs match on all three; every pair here has email, name and phone
  // ('(435)632-6901' and '4356326901' are the same digits).
  assert.ok(rows.every((r) => r.reasons.join() === 'email,name,phone'), JSON.stringify(rows));
});

test('candidates: phone matches on the last 10 digits; short numbers and blanks never match', async () => {
  const db = await buildDb({ blob: blobSql({ registry: [], contacts: [], clientTombstones: [], contactTombstones: [] }), records: '' });
  await db.exec(`insert into public.clients (tenant_id, display_name, phone, email) values
    ('${TRIPLE_H}', 'A', '+1 (435) 555-0142', ''), ('${TRIPLE_H}', 'B', '435.555.0142', null),
    ('${TRIPLE_H}', 'C', '12345', null), ('${TRIPLE_H}', 'D', '12345', null),
    ('${TRIPLE_H}', 'E', '', ''), ('${TRIPLE_H}', 'F', null, null)`);
  assert.equal(await refresh(db), 1);
  const { rows } = await db.query(`select a.display_name || b.display_name as pair, d.reasons
    from public.client_duplicate_candidates d join public.clients a on a.id = d.client_a join public.clients b on b.id = d.client_b`);
  assert.deepEqual(rows.map((r) => [[...r.pair].sort().join(''), r.reasons]), [['AB', ['phone']]]);
});

test('candidates: a decided pair keeps its decision on refresh; merged clients are left out', async () => {
  const db = await buildDb();
  await seed(db);
  await refresh(db);
  await db.exec(`update public.client_duplicate_candidates set status = 'kept_separate' where id = (select min(id) from public.client_duplicate_candidates)`);
  assert.equal(await refresh(db), 0, 'nothing new, nothing changed');
  const { rows } = await db.query(`select status, count(*)::int n from public.client_duplicate_candidates group by status order by status`);
  assert.deepEqual(rows, [{ status: 'kept_separate', n: 1 }, { status: 'open', n: 2 }]);

  // A new duplicate of a merged-away row doesn't produce a pair with it.
  await db.exec(`update public.clients set merged_into_id = (select id from public.clients where legacy_id = 'c_connor')
                  where seed_source = 'contact' and display_name = 'Connor Dodart'`);
  await db.exec(`insert into public.clients (tenant_id, display_name) values ('${TRIPLE_H}', 'Pat Supplier')`);
  assert.equal(await refresh(db), 1, 'only the new Pat Supplier pair');
});

test("candidates: one tenant's refresh never pairs with another tenant's clients", async () => {
  const db = await buildDb({ blob: blobSql({ registry: [], contacts: [], clientTombstones: [], contactTombstones: [] }), records: '' });
  await db.exec(`insert into public.clients (tenant_id, display_name, email) values
    ('${TRIPLE_H}', 'Same Name', 'same@example.com'), ('${OTHER}', 'Same Name', 'same@example.com')`);
  assert.equal(await refresh(db, TRIPLE_H), 0);
});

test('RLS on candidates: staff see their tenant only; anon sees nothing', async () => {
  const db = await buildDb();
  await seed(db);
  await refresh(db);
  const count = async (claims) => {
    await db.exec('begin');
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await db.exec(`set local role ${claims.role}`);
      return (await db.query('select count(*)::int n from public.client_duplicate_candidates')).rows[0].n;
    } catch (e) {
      return e;
    } finally {
      await db.exec('rollback');
    }
  };
  assert.equal(await count(STAFF), 3);
  assert.equal(await count(OTHER_STAFF), 0);
  const anon = await count(ANON);
  assert.ok(anon instanceof Error && /permission denied/.test(anon.message));
});

test('the seed and refresh functions are not callable by anon or staff over RPC', async () => {
  const db = await buildDb();
  const { rows } = await db.query(`
    select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can
      from pg_proc p cross join (values ('anon'), ('authenticated')) r(rolname)
     where p.proname in ('item1_seed_clients', 'refresh_client_duplicate_candidates', 'item1_try_timestamptz')
     order by 1, 2`);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.can === false), JSON.stringify(rows));
});

test('the file can be re-run safely', async () => {
  const db = await buildDb();
  await seed(db);
  await refresh(db);
  await db.exec(ITEM1_02);
  assert.equal((await db.query('select count(*)::int n from public.client_duplicate_candidates')).rows[0].n, 3);
});
