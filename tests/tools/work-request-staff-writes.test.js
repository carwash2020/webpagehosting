// Staff writes to portal work orders after #469 (2026-09-29 bugfix pass).
// #469 made client_portal_work_orders' SELECT policy client-only. Postgres
// applies SELECT policies to an UPDATE whose WHERE reads the table, so the
// Workspace's direct PATCH ...?id=eq.X (Schedule, and every status move)
// matched 0 rows from a staff session and PostgREST still answered 204:
// the page said "Scheduled -- the client has been emailed." and nothing
// was saved. Reproduced in real Postgres (PGlite) against the repo's
// policies and read back from the live project's pg_policies.
//
// The writes now go through internal_update_client_portal_work_order(), a
// staff-gated SECURITY DEFINER function that returns the updated row, and
// an empty result is reported as a failure. The last test keeps any staff
// page from writing to one of #469's client-only tables directly again.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const MIGRATION = fs.readFileSync(repo('sql', 'security', 'internal_update_client_portal_work_order.sql'), 'utf8');

function extractFn(src, name) {
  const start = src.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, 'expected function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

function helper(reply) {
  const calls = [];
  const ctx = vm.createContext({
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', getAuthToken: () => 'staff-jwt',
    fetch: async (url, init) => { calls.push({ url, init }); return reply; },
  });
  vm.runInContext(extractFn(WORKSPACE, 'updateWorkRequest') + ';this.updateWorkRequest = updateWorkRequest;', ctx);
  return { run: (...a) => ctx.updateWorkRequest(...a), calls };
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test('updateWorkRequest() posts to the staff RPC with the id, status and time', async () => {
  const h = helper(json(200, [{ id: 31, status: 'scheduled' }]));
  const row = await h.run('31', 'scheduled', '2026-10-02T15:00:00.000Z');
  assert.equal(row.status, 'scheduled');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://x.supabase.co/rest/v1/rpc/internal_update_client_portal_work_order');
  assert.equal(h.calls[0].init.method, 'POST');
  assert.equal(h.calls[0].init.headers.Authorization, 'Bearer staff-jwt');
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { p_id: 31, p_status: 'scheduled', p_scheduled_at: '2026-10-02T15:00:00.000Z' });
});

test('a status move without a time sends p_scheduled_at: null (the function keeps the old value)', async () => {
  const h = helper(json(200, [{ id: 32, status: 'reviewing' }]));
  await h.run(32, 'reviewing');
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { p_id: 32, p_status: 'reviewing', p_scheduled_at: null });
});

test('an update that matched no row is an error, not a success toast (the #469 bug)', async () => {
  await assert.rejects(helper(json(200, [])).run(31, 'scheduled', null), /wasn't updated/);
  await assert.rejects(helper({ ok: true, status: 204, json: async () => { throw new SyntaxError('no body'); }, text: async () => '' }).run(31, 'declined'), /wasn't updated/);
});

test('a refused call surfaces the HTTP status and body', async () => {
  await assert.rejects(helper(json(403, { code: '42501', message: 'Only internal accounts can update work orders.' })).run(31, 'declined'), /HTTP 403: .*Only internal accounts/);
});

test('Schedule and every status move use updateWorkRequest(), and neither PATCHes the table any more', () => {
  const schedule = extractFn(WORKSPACE, 'confirmWorkOrderApproval');
  const advance = extractFn(WORKSPACE, 'advanceWorkRequest');
  assert.match(schedule, /await updateWorkRequest\(id, 'scheduled', scheduledAtUtc\.toISOString\(\)\)/);
  assert.match(advance, /await updateWorkRequest\(id, newStatus\)/);
  for (const fn of [schedule, advance]) assert.doesNotMatch(fn, /PATCH|client_portal_work_orders\?id=eq/);
});

test('the migration is staff-gated, SECURITY DEFINER, returns the row, and is closed to anon', () => {
  assert.match(MIGRATION, /create or replace function public\.internal_update_client_portal_work_order\(\s*p_id bigint,\s*p_status text,\s*p_scheduled_at timestamptz default null\s*\)/);
  assert.match(MIGRATION, /returns setof public\.client_portal_work_orders/);
  assert.match(MIGRATION, /security definer\s+set search_path = public/);
  assert.match(MIGRATION, /if not public\.current_user_has_any_role\(\) then\s+raise exception/);
  assert.match(MIGRATION, /update public\.client_portal_work_orders[\s\S]*where id = p_id\s+returning \*/);
  assert.match(MIGRATION, /revoke execute on function public\.internal_update_client_portal_work_order\(bigint, text, timestamptz\) from public, anon;/);
  assert.match(MIGRATION, /grant execute on function public\.internal_update_client_portal_work_order\(bigint, text, timestamptz\) to authenticated;/);
});

// #469's client-only tables. A staff page reads them through
// /rest/v1/rpc/internal_read_<table>; writing to them directly with an
// UPDATE/DELETE filtered by a column silently matches nothing for staff.
const CLIENT_ONLY = ['client_portal_invoices', 'client_portal_jobs', 'client_portal_quotes', 'client_portal_contracts', 'client_portal_work_orders', 'client_portal_job_messages', 'client_portal_work_order_messages', 'client_profiles', 'client_notification_preferences'];

test('no Workspace page PATCHes, PUTs or DELETEs one of the client-only tables directly', () => {
  const files = fs.readdirSync(repo('tools')).filter((f) => /\.(html|js)$/.test(f));
  const bad = [];
  const re = new RegExp('rest/v1/(' + CLIENT_ONLY.join('|') + ')\\b', 'g');
  for (const f of files) {
    const src = fs.readFileSync(repo('tools', f), 'utf8');
    for (const m of src.matchAll(re)) {
      const window = src.slice(m.index, m.index + 400);
      const method = window.match(/method:\s*'([A-Z]+)'/);
      if (method && /^(PATCH|PUT|DELETE)$/.test(method[1])) bad.push(`tools/${f}: ${method[1]} ${m[0]} (line ${src.slice(0, m.index).split('\n').length})`);
    }
  }
  assert.deepEqual(bad, []);
});
