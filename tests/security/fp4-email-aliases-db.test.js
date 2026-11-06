// Fix plan FP4.2 (2026-11-06; D11): verified email aliases, in PGlite.
// Runs sql/security/fp4_email_aliases.sql (twice: re-runnable) on a small
// copy of the client-portal tables with the live policy names, then checks
// who sees what. Made-up accounts only.
//
// Pinned: an alias counts only once confirmed; it shows the person their own
// records sent to that address and nothing of anyone else's; the sign-in
// email is still the sender of a message and the owner of a read mark; a
// confirmed alias has one owner; clients can't read the alias table at all.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const SQL = fs.readFileSync(path.join(__dirname, '..', '..', 'sql', 'security', 'fp4_email_aliases.sql'), 'utf8');
const SAM = { id: '11111111-1111-4111-8111-111111111111', email: 'sam@example.com' };
const KIM = { id: '22222222-2222-4222-8222-222222222222', email: 'kim@example.com' };
const STAFF = { id: '33333333-3333-4333-8333-333333333333', email: 'owner@example.com' };
const ALIAS = 'sam.work@example.com';
const CLIENT_TABLES = ['card_authorizations', 'client_portal_checkups', 'client_portal_contracts', 'client_portal_invoices', 'client_portal_jobs', 'client_portal_quotes', 'client_portal_work_orders'];

const SCHEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.email() returns text language sql stable as $$ select auth.jwt() ->> 'email' $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create table auth.users (id uuid primary key, email text);
  insert into auth.users values ('${SAM.id}', '${SAM.email}'), ('${KIM.id}', '${KIM.email}'), ('${STAFF.id}', '${STAFF.email}');
  grant usage on schema auth to anon, authenticated;
  create table public.account_roles (email text primary key);
  insert into public.account_roles values ('${STAFF.email}');
  create function public.current_user_has_any_role() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.account_roles where email = auth.email()) $$;
  create function public.current_tenant_id() returns uuid language sql stable as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
  ${CLIENT_TABLES.map((t) => `
  create table public.${t} (id bigint primary key, client_email text not null, tenant_id uuid default public.current_tenant_id());
  alter table public.${t} enable row level security;
  grant select on public.${t} to authenticated;`).join('')}
  create table public.client_portal_job_messages (id bigserial primary key, job_id bigint, sender_type text, sender_email text, body text, created_at timestamptz default now(), tenant_id uuid default public.current_tenant_id());
  create table public.client_portal_work_order_messages (id bigserial primary key, work_order_id bigint, sender_type text, sender_email text, body text, created_at timestamptz default now(), tenant_id uuid default public.current_tenant_id());
  create table public.client_portal_thread_reads (client_email text, thread_type text, thread_id bigint, last_read_at timestamptz, tenant_id uuid default public.current_tenant_id(), primary key (client_email, thread_type, thread_id));
  create table public.quote_questions (id bigserial primary key, quote_id bigint, client_email text, message text, tenant_id uuid default public.current_tenant_id());
  alter table public.client_portal_job_messages enable row level security;
  alter table public.client_portal_work_order_messages enable row level security;
  alter table public.client_portal_thread_reads enable row level security;
  alter table public.quote_questions enable row level security;
  grant select, insert on public.client_portal_job_messages, public.client_portal_work_order_messages, public.quote_questions to authenticated;
  grant select, insert, update on public.client_portal_thread_reads to authenticated;
  grant usage on all sequences in schema public to authenticated;
  create policy "clients advance their own thread reads" on public.client_portal_thread_reads for update to authenticated
    using (client_email = (select auth.email())) with check (client_email = (select auth.email()));
  create policy "clients or internal accounts view thread reads" on public.client_portal_thread_reads for select to authenticated
    using (client_email = (select auth.email()));
  create function public.mark_portal_thread_read(p_thread_type text, p_thread_id bigint) returns void language sql as $$
    insert into public.client_portal_thread_reads as r (client_email, thread_type, thread_id, last_read_at)
    values (auth.email(), p_thread_type, p_thread_id, now())
    on conflict (client_email, thread_type, thread_id) do update set last_read_at = greatest(r.last_read_at, excluded.last_read_at); $$;
  grant execute on function public.mark_portal_thread_read(text, bigint) to authenticated;
`;
const SEED = `
  ${CLIENT_TABLES.map((t) => `insert into public.${t} (id, client_email) values (1, '${SAM.email}'), (2, 'Sam.Work@Example.com'), (3, '${KIM.email}');`).join('\n')}
  insert into public.client_portal_job_messages (job_id, sender_type, sender_email, body, created_at) values (2, 'internal', '${STAFF.email}', 'On our way', now() - interval '1 hour');
  insert into public.client_portal_work_order_messages (work_order_id, sender_type, sender_email, body, created_at) values (2, 'internal', '${STAFF.email}', 'Got it', now() - interval '1 hour');
`;

let dbPromise;
async function db() {
  if (!dbPromise) dbPromise = (async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(SQL);
    await d.exec(SQL);
    await d.exec(SEED);
    return d;
  })();
  return dbPromise;
}
after(async () => { if (dbPromise) await (await dbPromise).close(); });

// Admin-side changes to the alias table (what the edge function does with the service role).
async function admin(sql, params = []) { return (await db()).query(sql, params); }
async function as(user, fn, role = 'authenticated') {
  const d = await db();
  return d.transaction(async (tx) => {
    await tx.query('set local role ' + role);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(user ? { sub: user.id, email: user.email, role } : { role })]);
    return fn(tx);
  });
}
const ids = (rows) => rows.map((r) => Number(r.id)).sort();
const seen = (user, table) => as(user, async (tx) => ids((await tx.query(`select id from public.${table}`)).rows));

test('no alias: everyone sees only records sent to their own sign-in email', async () => {
  for (const t of CLIENT_TABLES) {
    assert.deepEqual(await seen(SAM, t), [1], t);
    assert.deepEqual(await seen(KIM, t), [3], t);
  }
});

test('a pending alias (code not entered yet) shows nothing new', async () => {
  await admin("insert into public.client_email_aliases (user_id, email, status, code_hash) values ($1, $2, 'pending', 'x')", [SAM.id, ALIAS]);
  for (const t of CLIENT_TABLES) assert.deepEqual(await seen(SAM, t), [1], t);
});

test('a confirmed alias shows that person their records sent to it (any letter case) -- and nobody else gains anything', async () => {
  await admin("update public.client_email_aliases set status = 'confirmed', code_hash = null, confirmed_at = now() where user_id = $1 and email = $2", [SAM.id, ALIAS]);
  for (const t of CLIENT_TABLES) {
    assert.deepEqual(await seen(SAM, t), [1, 2], t);
    assert.deepEqual(await seen(KIM, t), [3], t + ': another client sees nothing new');
  }
  assert.deepEqual(await as(SAM, async (tx) => (await tx.query('select public.client_portal_my_emails() as e')).rows[0].e), [ALIAS, SAM.email]);
});

test('messages on an alias job: readable, and replies go out under the sign-in email only', async () => {
  const msgs = await as(SAM, async (tx) => (await tx.query('select body from public.client_portal_job_messages')).rows.map((r) => r.body));
  assert.deepEqual(msgs, ['On our way']);
  await as(SAM, (tx) => tx.query("insert into public.client_portal_job_messages (job_id, sender_type, sender_email, body) values (2, 'client', $1, 'Thanks')", [SAM.email]));
  await assert.rejects(as(SAM, (tx) => tx.query("insert into public.client_portal_job_messages (job_id, sender_type, sender_email, body) values (2, 'client', $1, 'spoof')", [ALIAS])), /row-level security/, 'never as the alias');
  await assert.rejects(as(KIM, (tx) => tx.query("insert into public.client_portal_job_messages (job_id, sender_type, sender_email, body) values (2, 'client', $1, 'not mine')", [KIM.email])), /row-level security/);
  await as(SAM, (tx) => tx.query("insert into public.client_portal_work_order_messages (work_order_id, sender_type, sender_email, body) values (2, 'client', $1, 'Thanks')", [SAM.email]));
});

test('unread counts include alias threads, and the read mark is the reader\'s own', async () => {
  const unread = () => as(SAM, async (tx) => (await tx.query('select thread_type, thread_id, unread_count from public.get_portal_unread_counts() order by 1')).rows.map((r) => `${r.thread_type}:${r.thread_id}:${r.unread_count}`));
  assert.deepEqual(await unread(), ['job:2:1', 'work_order:2:1']);
  await as(SAM, (tx) => tx.query("select public.mark_portal_thread_read('job', 2)"));
  assert.deepEqual(await unread(), ['work_order:2:1']);
  const mark = (await admin("select client_email from public.client_portal_thread_reads where thread_type = 'job' and thread_id = 2")).rows[0];
  assert.equal(mark.client_email, SAM.email);
  await assert.rejects(as(KIM, (tx) => tx.query("select public.mark_portal_thread_read('job', 2)")), /row-level security/, 'no read marks on someone else\'s thread');
});

test('a question on an alias quote is asked under the sign-in email', async () => {
  await as(SAM, (tx) => tx.query("insert into public.quote_questions (quote_id, client_email, message) values (2, $1, 'When?')", [SAM.email]));
  await assert.rejects(as(SAM, (tx) => tx.query("insert into public.quote_questions (quote_id, client_email, message) values (2, $1, 'When?')", [ALIAS])), /row-level security/);
  await assert.rejects(as(KIM, (tx) => tx.query("insert into public.quote_questions (quote_id, client_email, message) values (2, $1, 'When?')", [KIM.email])), /row-level security/);
});

test('one owner per confirmed alias; clients cannot read or write the alias table; anon cannot ask', async () => {
  await assert.rejects(admin("insert into public.client_email_aliases (user_id, email, status) values ($1, $2, 'confirmed')", [KIM.id, ALIAS]), /client_email_aliases_one_owner|unique/);
  await admin("insert into public.client_email_aliases (user_id, email, status) values ($1, $2, 'pending')", [KIM.id, ALIAS]);
  for (const t of CLIENT_TABLES) assert.deepEqual(await seen(KIM, t), [3], 'a pending claim on someone else\'s alias shows nothing');
  await assert.rejects(as(SAM, (tx) => tx.query('select * from public.client_email_aliases')), /permission denied/);
  await assert.rejects(as(SAM, (tx) => tx.query("insert into public.client_email_aliases (user_id, email, status) values ($1, 'x@example.com', 'confirmed')", [SAM.id])), /permission denied/);
  await assert.rejects(as(null, (tx) => tx.query('select public.client_portal_my_emails()'), 'anon'), /permission denied/);
  await assert.rejects(admin("insert into public.client_email_aliases (user_id, email) values ($1, 'Upper@Example.com')", [SAM.id]), /check/, 'stored lower-case only');
});

test('removing an alias hides its records again', async () => {
  await admin('delete from public.client_email_aliases where user_id = $1 and email = $2', [SAM.id, ALIAS]);
  for (const t of CLIENT_TABLES) assert.deepEqual(await seen(SAM, t), [1], t);
});
