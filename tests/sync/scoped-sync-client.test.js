// tools/sync.js against a server shaped like sql/sync/01_scoped_workspace_sync.sql
// (2026-11-03, handoff §2 / Phase 2.4). The fake server below applies the
// same visibility rule as the real RLS (tests/sync/scoped-workspace-sync-db.test.js
// proves the SQL itself): money access sees the old row and both scoped
// rows; Money off sees only the ops row.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const SYNC = fs.readFileSync(path.join(TOOLS, 'sync.js'), 'utf8');
const DATA = fs.readFileSync(path.join(TOOLS, 'data-layer.js'), 'utf8');
const LEGACY = 'tripleh-workspace-2026';

// server: { migrated, money, runway (this account's switches), rows: { code: {code, scope, data, updated_at} } }
function load(server) {
  const posts = [];
  const gets = [];
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'dangerously', url: 'https://www.triplehenterprisesllc.biz/tools/job-tracker.html',
    beforeParse(w) {
      w.SUPABASE_URL = 'https://x.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon';
      w.getAuthToken = () => 'token';
      w.showToast = () => {};
      const can = (scope) => (scope === 'ops' ? true : scope === 'money' ? !!server.money : scope === 'runway' ? !!server.runway : !!(server.money && server.runway));
      const visible = () => Object.values(server.rows).filter((r) => can(r.scope));
      w.fetch = async (url, opts = {}) => {
        const method = opts.method || 'GET';
        if (method === 'GET' && /workspace_sync\?select=code,scope,data,updated_at/.test(url)) {
          gets.push('all');
          if (!server.migrated) return { ok: false, status: 400, json: async () => ({ message: 'column workspace_sync.scope does not exist' }) };
          return { ok: true, status: 200, json: async () => visible().map((r) => ({ ...r })) };
        }
        if (method === 'GET' && /workspace_sync\?code=eq\./.test(url)) {
          gets.push('legacy');
          const r = server.rows[LEGACY];
          return { ok: true, status: 200, json: async () => (r && (!server.migrated || can(null)) ? [{ data: r.data, updated_at: r.updated_at }] : []) };
        }
        if (method === 'POST' && /workspace_sync\?on_conflict=code/.test(url)) {
          const body = JSON.parse(opts.body);
          posts.push(body);
          for (const row of body) {
            const allowed = server.migrated ? can(row.scope === undefined ? null : row.scope) : true;
            if (!allowed) return { ok: false, status: 403, json: async () => ({ message: 'new row violates row-level security policy' }) };
          }
          for (const row of body) server.rows[row.code] = { code: row.code, scope: row.scope === undefined ? null : row.scope, data: row.data, updated_at: row.updated_at };
          return { ok: true, status: 201, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => [] };
      };
    },
  });
  const w = dom.window;
  for (const src of [DATA, SYNC]) {
    const s = w.document.createElement('script');
    s.textContent = src;
    w.document.head.appendChild(s);
  }
  return { w, posts, gets };
}
const get = (w, k) => JSON.parse(w.localStorage.getItem(k) || 'null');
const put = (w, k, v) => w.localStorage.setItem(k, JSON.stringify(v));
const blob = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, JSON.stringify(v)]));

test('before the SQL is applied (no scope column) it works exactly as before: reads and writes the old row only', async () => {
  const server = { migrated: false, money: true, rows: { [LEGACY]: { code: LEGACY, scope: null, data: blob({ th_tracker_jobs: [{ id: 1, title: 'Fix washer' }] }), updated_at: '2026-11-03T00:00:00Z' } } };
  const { w, posts } = load(server);
  assert.equal((await w.pullSync()).ok, true);
  assert.deepEqual(get(w, 'th_tracker_jobs'), [{ id: 1, title: 'Fix washer' }]);
  put(w, 'th_invoices', [{ id: 7, total: 300 }]);
  assert.equal((await w.pushSync()).ok, true);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].map((r) => r.code), [LEGACY]);
  assert.ok(!('scope' in posts[0][0]), 'no scope field is sent to a server without the column');
});

const ALL_ROWS = () => ({
  [LEGACY]: { code: LEGACY, scope: null, data: {}, updated_at: '2026-11-03T00:00:00Z' },
  'scope:ops': { code: 'scope:ops', scope: 'ops', data: {}, updated_at: '2026-11-03T00:00:00Z' },
  'scope:money': { code: 'scope:money', scope: 'money', data: {}, updated_at: '2026-11-03T00:00:00Z' },
  'scope:runway': { code: 'scope:runway', scope: 'runway', data: {}, updated_at: '2026-11-03T00:00:00Z' },
});

test('with every switch on: each scope row gets only its own keys, and the old row still gets the whole blob (dual-write)', async () => {
  const server = { migrated: true, money: true, runway: true, rows: ALL_ROWS() };
  const { w, posts } = load(server);
  put(w, 'th_tracker_jobs', [{ id: 1 }]);
  put(w, 'th_invoices', [{ id: 7, total: 300 }]);
  put(w, 'rd_personal-expenses', [{ id: 9, label: 'Mortgage' }]);
  assert.equal((await w.pushSync()).ok, true);
  const byCode = Object.fromEntries(posts[0].map((r) => [r.code, r]));
  assert.deepEqual(Object.keys(byCode).sort(), ['scope:money', 'scope:ops', 'scope:runway', LEGACY].sort());
  assert.ok(byCode['scope:ops'].data.th_tracker_jobs);
  assert.ok(!byCode['scope:ops'].data.th_invoices && !byCode['scope:ops'].data['rd_personal-expenses'], 'no money or Runway key in the ops row');
  assert.ok(byCode['scope:money'].data.th_invoices && !byCode['scope:money'].data['rd_personal-expenses'], 'invoices in money, Runway not');
  assert.ok(byCode['scope:runway'].data['rd_personal-expenses'] && !byCode['scope:runway'].data.th_invoices, 'Runway in its own row');
  assert.ok(!byCode['scope:money'].data.th_tracker_jobs, 'no ops key in the money row');
  assert.ok(byCode[LEGACY].data.th_tracker_jobs && byCode[LEGACY].data.th_invoices, 'the old row keeps the whole blob for older devices');
  assert.equal(byCode[LEGACY].scope, null);
});

test('Money on, Runway off: writes ops and money only -- never the Runway row, the old blob, or a Runway key', async () => {
  const server = { migrated: true, money: true, runway: false, rows: ALL_ROWS() };
  server.rows['scope:runway'].data = blob({ 'rd_debts': [{ id: 1, label: 'Truck loan' }] });
  const { w, posts } = load(server);
  assert.equal((await w.pullSync()).ok, true);
  assert.equal(get(w, 'rd_debts'), null, 'Runway data never reaches this device');
  put(w, 'th_invoices', [{ id: 7 }]);
  assert.equal((await w.pushSync()).ok, true);
  assert.deepEqual(posts[0].map((r) => r.code).sort(), ['scope:money', 'scope:ops']);
  const runwayKeys = w.eval('SYNC_RUNWAY_KEYS');
  assert.ok(posts[0].every((r) => Object.keys(r.data).every((k) => !runwayKeys.includes(k))));
  assert.deepEqual(JSON.parse(server.rows['scope:runway'].data.rd_debts), [{ id: 1, label: 'Truck loan' }], 'the Runway row is untouched');
});

test('Money off: reads and writes only the ops row -- never the old blob, never a money key', async () => {
  const server = { migrated: true, money: false, rows: {
    [LEGACY]: { code: LEGACY, scope: null, data: blob({ th_invoices: [{ id: 7, total: 300 }] }), updated_at: '2026-11-03T00:00:00Z' },
    'scope:ops': { code: 'scope:ops', scope: 'ops', data: blob({ th_tracker_jobs: [{ id: 1, title: 'Fix washer' }] }), updated_at: '2026-11-03T00:00:00Z' },
    'scope:money': { code: 'scope:money', scope: 'money', data: blob({ th_invoices: [{ id: 7, total: 300 }] }), updated_at: '2026-11-03T00:00:00Z' },
  } };
  const { w, posts } = load(server);
  assert.equal((await w.pullSync()).ok, true);
  assert.deepEqual(get(w, 'th_tracker_jobs'), [{ id: 1, title: 'Fix washer' }]);
  assert.equal(get(w, 'th_invoices'), null, 'no invoice ever reaches this device');
  put(w, 'th_shift_log', [{ id: 3 }]);
  assert.equal((await w.pushSync()).ok, true);
  assert.deepEqual(posts[0].map((r) => r.code), ['scope:ops']);
  const moneyKeys = w.eval('SYNC_MONEY_KEYS');
  assert.ok(moneyKeys.length > 10 && Object.keys(posts[0][0].data).every((k) => !moneyKeys.includes(k)));
  assert.deepEqual(JSON.parse(server.rows[LEGACY].data.th_invoices), [{ id: 7, total: 300 }], 'the old row is untouched');
});

test('an older device still writing only the old row is never lost: reads merge the old row first, then the scoped rows', async () => {
  const server = { migrated: true, money: true, runway: true, rows: {
    // An old build added invoice 8 to the old row after the split.
    [LEGACY]: { code: LEGACY, scope: null, data: blob({ th_invoices: [{ id: 7, total: 300 }, { id: 8, total: 95 }] }), updated_at: '2026-11-03T12:00:00Z' },
    'scope:ops': { code: 'scope:ops', scope: 'ops', data: blob({ th_tracker_jobs: [{ id: 1 }] }), updated_at: '2026-11-03T10:00:00Z' },
    'scope:money': { code: 'scope:money', scope: 'money', data: blob({ th_invoices: [{ id: 7, total: 300 }] }), updated_at: '2026-11-03T10:00:00Z' },
  } };
  const { w, posts } = load(server);
  assert.equal((await w.pullSync()).ok, true);
  assert.deepEqual(get(w, 'th_invoices').map((i) => i.id).sort(), [7, 8]);
  assert.equal(w.localStorage.getItem('th_sync_known_at'), '2026-11-03T12:00:00Z', 'known-at is the newest row');
  await w.pushSync();
  const money = posts[0].find((r) => r.code === 'scope:money');
  assert.deepEqual(JSON.parse(money.data.th_invoices).map((i) => i.id).sort(), [7, 8], 'invoice 8 now lives in the money row too');
});

test('an account that can see no rows at all is told so, not handed an empty workspace', async () => {
  const server = { migrated: true, money: false, rows: {} };
  const { w, posts, gets } = load(server);
  const r = await w.pullSync();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no-data-yet');
  assert.deepEqual(gets, ['all', 'legacy'], 'it asks for the old row by code before concluding there is nothing');
  put(w, 'th_tracker_jobs', [{ id: 1 }]);
  await w.pushSync();
  assert.deepEqual(posts[0].map((x) => x.code), [LEGACY], 'with nothing scoped visible it falls back to the old row (which RLS refuses for a non-staff account)');
});

test('Realtime listens to every row this account may see, not one hard-coded code', () => {
  const fn = SYNC.slice(SYNC.indexOf('function startRealtimeSync('));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  assert.match(body, /\{ event: '\*', schema: 'public', table: 'workspace_sync' \}/);
  assert.doesNotMatch(body, /filter: `code=eq\./);
});
