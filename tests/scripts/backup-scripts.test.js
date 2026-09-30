// scripts/backup-tables.py and scripts/backup-storage-bucket.py, run for
// real against a fake Supabase (2026-09-30). The daily private backup
// had fallen 16 tables behind the live schema, read each table in one
// request (PostgREST stops at 1000 rows), listed each Storage folder in
// one call (also 1000), and named its 5 buckets by hand.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const CONFIG = JSON.parse(fs.readFileSync(repo('scripts', 'backup-tables.json'), 'utf8'));
const WORKFLOW = fs.readFileSync(repo('.github', 'workflows', 'backup-sensitive-data.yml'), 'utf8');
const ALL_NAMED = [...Object.keys(CONFIG.tables), ...Object.keys(CONFIG.public_elsewhere), ...Object.keys(CONFIG.excluded)];

function run(script, args, url) {
  return new Promise((resolve) => {
    const child = spawn('python3', [repo('scripts', script), ...args], {
      env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

// A PostgREST that serves `rows[table]` in pages, honouring limit/offset
// and Prefer: count=exact. `claimTotal` lets a test report more rows than
// it serves.
function fakeRest({ live, rows, claimTotal = {} }) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    assert.equal(req.headers.authorization, 'Bearer test-service-key');
    if (u.pathname === '/rest/v1/') {
      const paths = { '/': {}, '/rpc/some_fn': {} };
      for (const t of live) paths['/' + t] = {};
      res.setHeader('Content-Type', 'application/openapi+json');
      return res.end(JSON.stringify({ swagger: '2.0', paths }));
    }
    const table = u.pathname.replace('/rest/v1/', '');
    const all = rows[table] || [];
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset'));
    calls.push({ table, limit, offset, order: u.searchParams.get('order'), select: u.searchParams.get('select'), count: req.headers.prefer || '' });
    const page = all.slice(offset, offset + limit);
    const total = claimTotal[table] ?? all.length;
    if (/count=exact/.test(req.headers.prefer || '')) {
      res.setHeader('Content-Range', page.length ? `${offset}-${offset + page.length - 1}/${total}` : `*/${total}`);
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(page));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'th-backup-')); }

test('the config names every table in the live schema once, and every table sql/ creates', () => {
  assert.equal(new Set(ALL_NAMED).size, ALL_NAMED.length, 'no table in two groups');
  for (const [t, order] of Object.entries(CONFIG.tables)) assert.match(order, /^[a-z_]+(,[a-z_]+)*$/, t);
  for (const [t, why] of Object.entries(CONFIG.excluded)) assert.ok(why.length > 20, `${t} says why it's excluded`);
  // The two that sat unbacked-up since 2026-09-17, and the rest found 2026-09-30.
  for (const t of ['client_portal_contracts', 'client_portal_job_messages', 'client_portal_thread_reads', 'client_account_codes',
    'referrals', 'th_job_applications', 'jobs', 'invoices', 'invoice_line_items', 'quotes', 'quote_line_items', 'contracts',
    'tenants', 'stripe_pos_charges_logged', 'internal_mfa_enforcement']) {
    assert.ok(CONFIG.tables[t], `${t} is backed up`);
  }
  // Tenants first: since multi-tenant Tier 0 every row references one.
  assert.equal(Object.keys(CONFIG.tables)[0], 'tenants');
  const created = new Set();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (f.endsWith('.sql')) for (const m of fs.readFileSync(f, 'utf8').matchAll(/create table(?: if not exists)?\s+(?:public\.)?"?([a-z_]+)/gi)) created.add(m[1].toLowerCase());
  } };
  walk(repo('sql'));
  const missing = [...created].filter((t) => !ALL_NAMED.includes(t));
  assert.deepEqual(missing, [], 'a table created in sql/ must be backed up or excluded in scripts/backup-tables.json');
});

test('the workflow runs both scripts and keeps no hand-typed table or bucket list', () => {
  assert.match(WORKFLOW, /run: python3 scripts\/backup-tables\.py private-backups\/database/);
  assert.match(WORKFLOW, /run: python3 scripts\/backup-storage-bucket\.py --all private-backups\/storage/);
  assert.doesNotMatch(WORKFLOW, /declare -A QUERY/);
  assert.doesNotMatch(WORKFLOW, /for bucket in secure-documents/);
});

test('backup-tables.py pages past 1000 rows by primary key and writes json.tool-style files', async () => {
  const live = ALL_NAMED;
  const rows = {};
  for (const t of Object.keys(CONFIG.tables)) rows[t] = [{ id: 1, note: `row of ${t}` }];
  rows.notification_log = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, body: 'café' }));
  const fake = await fakeRest({ live, rows });
  const dest = tmpdir();
  try {
    const r = await run('backup-tables.py', [dest], fake.url);
    assert.equal(r.code, 0, r.out);
    const log = fake.calls.filter((c) => c.table === 'notification_log');
    assert.deepEqual(log.map((c) => c.offset), [0, 1000, 2000]);
    assert.ok(log.every((c) => c.limit === 1000 && c.order === 'id' && c.select === '*'));
    assert.match(log[0].count, /count=exact/);
    const tr = fake.calls.find((c) => c.table === 'client_portal_thread_reads');
    assert.equal(tr.order, 'client_email,thread_type,thread_id');
    const written = JSON.parse(fs.readFileSync(path.join(dest, 'notification_log.json'), 'utf8'));
    assert.equal(written.length, 2500);
    assert.equal(written[2499].id, 2500);
    // Same bytes `python3 -m json.tool` used to write.
    const text = fs.readFileSync(path.join(dest, 'notification_log.json'), 'utf8');
    assert.ok(text.startsWith('[\n    {\n        "id": 1,\n        "body": "caf\\u00e9"\n    },'), text.slice(0, 80));
    assert.ok(text.endsWith('\n]\n'));
    assert.deepEqual(fs.readdirSync(dest).sort(), Object.keys(CONFIG.tables).map((t) => t + '.json').sort());
    for (const t of [...Object.keys(CONFIG.excluded), ...Object.keys(CONFIG.public_elsewhere)]) {
      assert.ok(!fake.calls.some((c) => c.table === t), `${t} is not fetched`);
    }
  } finally { fake.server.close(); }
});

test('backup-tables.py stops, writing nothing, when a live table is not in the config', async () => {
  const rows = {};
  for (const t of Object.keys(CONFIG.tables)) rows[t] = [];
  const fake = await fakeRest({ live: [...ALL_NAMED, 'brand_new_table'], rows });
  const dest = tmpdir();
  try {
    const r = await run('backup-tables.py', [dest], fake.url);
    assert.equal(r.code, 1);
    assert.match(r.out, /::error::Not in scripts\/backup-tables\.json, so not backed up: brand_new_table/);
    assert.deepEqual(fs.readdirSync(dest), []);
    assert.equal(fake.calls.length, 0, 'checked before any table was read');
  } finally { fake.server.close(); }
});

test('backup-tables.py stops on a config entry the database no longer has', async () => {
  const fake = await fakeRest({ live: ALL_NAMED.filter((t) => t !== 'referrals'), rows: {} });
  try {
    const r = await run('backup-tables.py', [tmpdir()], fake.url);
    assert.equal(r.code, 1);
    assert.match(r.out, /not in the live database: referrals/);
  } finally { fake.server.close(); }
});

test('backup-tables.py refuses a short copy and leaves yesterday\'s files alone', async () => {
  const rows = {};
  for (const t of Object.keys(CONFIG.tables)) rows[t] = [{ id: 1 }];
  const fake = await fakeRest({ live: ALL_NAMED, rows, claimTotal: { th_leads: 5 } });
  const dest = tmpdir();
  fs.writeFileSync(path.join(dest, 'th_leads.json'), 'yesterday');
  try {
    const r = await run('backup-tables.py', [dest], fake.url);
    assert.equal(r.code, 1);
    assert.match(r.out, /th_leads: got 1 rows but the table reported 5/);
    assert.equal(fs.readFileSync(path.join(dest, 'th_leads.json'), 'utf8'), 'yesterday');
    assert.deepEqual(fs.readdirSync(dest), ['th_leads.json'], 'nothing written for any table');
  } finally { fake.server.close(); }
});

test('backup-storage-bucket.py --all backs up every live bucket and pages big folders', async () => {
  const listCalls = [];
  const files = {
    'job-photos': { '2026-09/': Array.from({ length: 1500 }, (_, i) => `p${String(i).padStart(4, '0')}.jpg`) },
    'brand-new-bucket': { '': ['hello.txt'] },
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/storage/v1/bucket') return res.end(JSON.stringify([{ id: 'job-photos' }, { id: 'brand-new-bucket' }]));
    const list = u.pathname.match(/^\/storage\/v1\/object\/list\/(.+)$/);
    if (list) {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const { prefix, limit, offset } = JSON.parse(body);
        listCalls.push({ bucket: list[1], prefix, limit, offset });
        const tree = files[list[1]];
        let entries;
        if (prefix === '' && !tree['']) entries = Object.keys(tree).map((f) => ({ name: f.replace('/', ''), id: null }));
        else entries = (tree[prefix] || []).map((n) => ({ name: n, id: 'x' }));
        res.end(JSON.stringify(entries.slice(offset, offset + limit)));
      });
      return;
    }
    const obj = u.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (obj) return res.end('file:' + decodeURIComponent(obj[2]));
    res.statusCode = 404; res.end('no');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dest = tmpdir();
  try {
    const r = await run('backup-storage-bucket.py', ['--all', dest], `http://127.0.0.1:${server.address().port}`);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 bucket\(s\): brand-new-bucket, job-photos/);
    assert.deepEqual(listCalls.filter((c) => c.prefix === '2026-09/').map((c) => c.offset), [0, 1000]);
    assert.equal(fs.readdirSync(path.join(dest, 'job-photos', '2026-09')).length, 1500);
    assert.equal(fs.readFileSync(path.join(dest, 'job-photos', '2026-09', 'p1499.jpg'), 'utf8'), 'file:2026-09/p1499.jpg');
    assert.equal(fs.readFileSync(path.join(dest, 'brand-new-bucket', 'hello.txt'), 'utf8'), 'file:hello.txt');
  } finally { server.close(); }
});
