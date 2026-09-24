// Real-Postgres harness for the site_content CMS (2026-09-23).
//
// Runs the actual migration files (sql/site-content/cms_safe_publish_and_undo.sql,
// then sql/site-content/cms_site_banners.sql) inside PGlite -- a real PostgreSQL build compiled to WASM, running
// in-process -- on top of a copy of the live schema it applies to:
// site_content + site_content_history as sql/site-content/site_content_schema_v2.sql
// created them, the live RLS policies (read back from pg_policies on
// 2026-09-23, matching sql/security/restrict_site_content_and_private_buckets_to_internal_accounts.sql),
// and the Supabase roles/auth helpers those policies call.
//
// Why not a hand-written fake: the whole point of the CMS undo is that it
// is enforced by triggers, a CHECK constraint, RLS, and plpgsql
// compare-and-swap. A JavaScript imitation of those would test the
// imitation. This tests the SQL that actually ships.
//
// Not a test file itself (no .test.js suffix), just shared setup.

const fs = require('fs');
const path = require('path');

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'sql', 'site-content', 'cms_safe_publish_and_undo.sql');
// Applied right after it, the way it was applied live: banner modes and links.
const BANNER_MIGRATION_PATH = path.join(__dirname, '..', '..', 'sql', 'site-content', 'cms_site_banners.sql');

const OWNER_EMAIL = 'steve@triplehenterprisesllc.biz';
const DEV_EMAIL = 'connor@triplehenterprisesllc.biz';
const PORTAL_EMAIL = 'client@example.com';
const STAFF_NO_CMS_EMAIL = 'helper@triplehenterprisesllc.biz';

const BASE_SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  -- Supabase's auth helpers, reading the same request.jwt.claims setting
  -- PostgREST sets per request.
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.email() returns text language sql stable as $$
    select auth.jwt() ->> 'email'
  $$;

  create table public.account_roles (
    email text primary key,
    role_name text,
    can_manage_site_content boolean not null default false
  );
  alter table public.account_roles enable row level security;
  create function public.current_user_has_any_role() returns boolean
    language sql stable security definer set search_path to 'public' as $$
    select exists (select 1 from public.account_roles where email = (select auth.jwt() ->> 'email'));
  $$;
  create policy "Authenticated can view account roles" on public.account_roles
    for select to authenticated using ((select public.current_user_has_any_role()));
  grant select on public.account_roles to authenticated;

  -- site_content_schema_v2.sql, as live
  create table public.site_content (
    key text primary key,
    value text,
    updated_at timestamptz default now()
  );
  alter table public.site_content enable row level security;
  create table public.site_content_history (
    id bigserial primary key,
    key text not null,
    old_value text,
    new_value text,
    changed_by text,
    changed_at timestamptz default now()
  );
  alter table public.site_content_history enable row level security;
  create function public.log_site_content_change() returns trigger
    language plpgsql security definer set search_path = public as $$
  begin
    if (OLD.value is distinct from NEW.value) then
      insert into public.site_content_history (key, old_value, new_value, changed_by)
      values (NEW.key, OLD.value, NEW.value, auth.jwt() ->> 'email');
    end if;
    return NEW;
  end;
  $$;
  create trigger site_content_change_trigger after update on public.site_content
    for each row execute function public.log_site_content_change();

  -- Live policies (pg_policies, 2026-09-23)
  create policy "Anyone can read site content" on public.site_content
    for select to anon, authenticated using (true);
  create policy "Site content managers can insert site content" on public.site_content
    for insert to authenticated with check (exists (select 1 from public.account_roles ar
      where ar.email = (select auth.email()) and ar.can_manage_site_content));
  create policy "Site content managers can update site content" on public.site_content
    for update to authenticated
    using (exists (select 1 from public.account_roles ar
      where ar.email = (select auth.email()) and ar.can_manage_site_content))
    with check (exists (select 1 from public.account_roles ar
      where ar.email = (select auth.email()) and ar.can_manage_site_content));
  create policy "Site content managers can delete site content" on public.site_content
    for delete to authenticated using (exists (select 1 from public.account_roles ar
      where ar.email = (select auth.email()) and ar.can_manage_site_content));
  create policy "Internal accounts can read site content history" on public.site_content_history
    for select to authenticated using ((select public.current_user_has_any_role()));

  -- Supabase's default table grants; RLS above is what actually scopes them.
  grant select, insert, update, delete on public.site_content to anon, authenticated, service_role;
  grant select, insert, update, delete on public.site_content_history to anon, authenticated, service_role;
  grant usage, select on sequence public.site_content_history_id_seq to authenticated, service_role;

  -- Live rows (backups/site_content.json, 2026-09-23)
  insert into public.site_content (key, value) values
    ('phone', null), ('email', null), ('hoursLine1', null), ('hoursLine2', null),
    ('hoursMonday', null), ('hoursTuesday', null), ('hoursWednesday', null),
    ('hoursThursday', null), ('hoursFriday', null), ('hoursSaturday', null),
    ('hoursSunday', '2:00 pm - 8:00 pm'), ('banner1', null), ('banner2', null);

  insert into public.account_roles (email, role_name, can_manage_site_content) values
    ('${OWNER_EMAIL}', 'Owner', true),
    ('${DEV_EMAIL}', 'Developer', true),
    ('${STAFF_NO_CMS_EMAIL}', 'Employee', false);
`;

// Booting PGlite and running both scripts takes several seconds, and so
// does a clone() -- too slow to repeat for every test. So each test file
// boots ONE migrated instance, snapshots the two tables right after the
// migration, and createCmsDb() puts them back before handing it out:
// every test starts from exactly the just-migrated state. The restore
// runs with triggers off (session_replication_role = replica) so putting
// rows back doesn't itself write history. node:test runs a file's tests
// one at a time, so they never share the instance concurrently.
const RESET_SQL = `
  set session_replication_role = replica;
  delete from public.site_content;
  insert into public.site_content select * from test_snapshot_content;
  delete from public.site_content_history;
  insert into public.site_content_history select * from test_snapshot_history;
  select setval('public.site_content_history_id_seq', coalesce((select max(id) from public.site_content_history), 0) + 1, false);
  set session_replication_role = origin;
`;

const openDbs = [];
let sharedPromise = null;

async function buildDb(applyMigration) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  openDbs.push(db);
  await db.exec(BASE_SCHEMA);
  if (applyMigration) {
    await db.exec(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    await db.exec(fs.readFileSync(BANNER_MIGRATION_PATH, 'utf8'));
    await db.exec(`
      create table test_snapshot_content as select * from public.site_content;
      create table test_snapshot_history as select * from public.site_content_history;
    `);
  }
  return db;
}

async function createCmsDb({ applyMigration = true } = {}) {
  if (!applyMigration) return buildDb(false);
  if (!sharedPromise) sharedPromise = buildDb(true);
  const db = await sharedPromise;
  await db.exec(RESET_SQL);
  return db;
}

// Open PGlite instances keep the process alive; call from an after() hook.
async function closeAllCmsDbs() {
  const dbs = openDbs.splice(0);
  sharedPromise = null;
  await Promise.all(dbs.map(db => db.close().catch(() => {})));
}

// Runs fn(tx) as a signed-in `authenticated` user with this email, the way
// PostgREST runs a request: one transaction, role switched, JWT claims set.
// A thrown error rolls the whole thing back, exactly like a failed request.
async function asUser(db, email, fn) {
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ email, role: 'authenticated' })]);
    return fn(tx);
  });
}

async function asAnon(db, fn) {
  return db.transaction(async (tx) => {
    await tx.query('set local role anon');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'anon' })]);
    return fn(tx);
  });
}

// PostgREST's own SQLSTATE -> HTTP mapping for the codes these functions
// raise: PTxyz -> xyz, 42501 -> 403 for a signed-in caller, 23514/22023/P0001 -> 400.
function httpStatusForError(err) {
  const code = err && err.code;
  if (code && /^PT\d{3}$/.test(code)) return Number(code.slice(2));
  if (code === '42501') return 403;
  return 400;
}

// Calls an RPC as PostgREST would and returns { status, body } -- the
// shape the editor's fetch() sees. Used as the backend for the jsdom
// tests of tools/site-content.html.
async function rpc(db, email, fnName, args) {
  const argNames = Object.keys(args);
  const placeholders = argNames.map((name, i) => `${name} => $${i + 1}`).join(', ');
  const values = argNames.map(name => {
    const v = args[name];
    if (fnName === 'cms_publish_content' && name === 'p_changes') return JSON.stringify(v);
    return v;
  });
  try {
    const rows = await asUser(db, email, tx => tx.query(`select * from public.${fnName}(${placeholders})`, values));
    return { status: 200, body: rows.rows };
  } catch (err) {
    return {
      status: httpStatusForError(err),
      body: { code: err.code, message: err.message, details: err.detail || null, hint: err.hint || null },
    };
  }
}

async function readValue(db, key) {
  const r = await db.query('select value from public.site_content where key = $1', [key]);
  return r.rows.length ? r.rows[0].value : undefined;
}

module.exports = {
  createCmsDb, closeAllCmsDbs, asUser, asAnon, rpc, readValue, httpStatusForError,
  OWNER_EMAIL, DEV_EMAIL, PORTAL_EMAIL, STAFF_NO_CMS_EMAIL, MIGRATION_PATH, BANNER_MIGRATION_PATH,
};
