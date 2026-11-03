// Tests for the "who can save a card" gate (docs/ACTION-ITEMS.md #15,
// decided 2026-11-03). Public signup was already off (#11), closing the
// stranger-signs-up-and-tests-stolen-cards case; what's left is an invited
// account with no real relationship to the business misusing
// create_setup_intent. The product decision: a "real client" for
// saved-card purposes is an account with at least one invoice, quote, job,
// contract, checkup, OR a work order it submitted itself.
//
// Runs the REAL manage-saved-card-index.ts handler (Node type stripping,
// fake Deno), same harness pattern as tests/payments/stripe-idempotency-
// keys.test.js, with a fake Supabase REST layer answered from in-memory
// state. Nothing leaves the process.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const TABLES = ['client_portal_invoices', 'client_portal_quotes', 'client_portal_jobs',
  'client_portal_contracts', 'client_portal_checkups', 'client_portal_work_orders'];

const st = {};
function reset() {
  st.customers = [];
  st.records = Object.fromEntries(TABLES.map((t) => [t, []]));
  st.setupIntents = 0;
}
reset();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(url, init = {}) {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();

  if (u.host === 'api.stripe.com') {
    const p = u.pathname.replace('/v1/', '');
    if (p === 'customers') return json({ id: 'cus_new', object: 'customer' });
    if (p === 'setup_intents') {
      st.setupIntents += 1;
      return json({ id: `seti_${st.setupIntents}`, client_secret: `seti_${st.setupIntents}_secret` });
    }
    throw new Error(`unexpected Stripe call ${p}`);
  }

  if (u.pathname === '/rest/v1/stripe_customers') {
    if (method === 'GET') {
      const email = (u.searchParams.get('client_email') || '').replace(/^eq\./, '');
      const row = st.customers.find((c) => c.client_email === email);
      return json(row ? [row] : []);
    }
    for (const row of JSON.parse(init.body)) if (!st.customers.some((c) => c.client_email === row.client_email)) st.customers.push(row);
    return new Response(null, { status: 201 });
  }

  if (u.pathname === '/rest/v1/card_authorizations') return new Response(null, { status: 201 });

  const table = TABLES.find((t) => u.pathname === `/rest/v1/${t}`);
  if (table) {
    assert.equal(method, 'GET', `expected only a read of ${table}, got ${method}`);
    assert.equal(u.searchParams.get('select'), 'id');
    assert.equal(u.searchParams.get('limit'), '1');
    const email = (u.searchParams.get('client_email') || '').replace(/^eq\./, '');
    const rows = st.records[table].filter((r) => r.client_email === email);
    return json(rows.slice(0, 1));
  }

  throw new Error(`unexpected fetch ${method} ${u}`);
}

let handler;
let tmpDir;
before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saved-card-gate-'));
  const env = { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'srk',
    STRIPE_CLIENT_CARDS_SECRET_KEY: 'rk_test_cards' };
  globalThis.fetch = fakeFetch;
  let captured;
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { captured = h; } };
  const file = path.join(tmpDir, 'manage-saved-card.ts');
  fs.copyFileSync(path.join(ROOT, 'edge-functions', 'manage-saved-card-index.ts'), file);
  await import(file);
  handler = captured;
});
after(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

const jwt = (email) => 'h.' + Buffer.from(JSON.stringify({ role: 'authenticated', email, sub: 'u1' })).toString('base64url') + '.s';
async function createSetupIntent(email) {
  const res = await handler(new Request('https://x/functions/v1/manage-saved-card', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + jwt(email), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'create_setup_intent', signer_name: 'Pat Client', signature_image: 'data:image/png;base64,AAAA' }),
  }));
  return { status: res.status, body: await res.json() };
}

test('an account with none of the 6 record types is refused with a clear error, not a silent no-op', async () => {
  reset();
  const r = await createSetupIntent('nobody@example.com');
  assert.equal(r.status, 403);
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /invoice, quote, job, contract, checkup, or work order/);
  assert.equal(st.setupIntents, 0, 'no SetupIntent should have been created');
});

for (const table of TABLES) {
  test(`an account with only a ${table} row is let through`, async () => {
    reset();
    const email = `has-${table}@example.com`;
    st.records[table].push({ id: 1, client_email: email });
    const r = await createSetupIntent(email);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.ok(r.body.client_secret);
    assert.equal(st.setupIntents, 1);
  });
}

test('a work order row is enough on its own -- "submitted by self" needs no extra check because the table structurally cannot hold anything else', async () => {
  // client_portal_work_orders has no internal/staff INSERT policy at all
  // (sql/portal/create_client_portal_work_orders.sql) -- the only way a row
  // gets created is the client's own authenticated INSERT, enforced by RLS
  // requiring client_email = auth.email(). So its mere existence already
  // proves self-submission; this test documents that the gate does not (and
  // need not) look for any separate "submitted_by"/"created_by" column.
  reset();
  const email = 'submitted-own-work-order@example.com';
  st.records.client_portal_work_orders.push({ id: 1, client_email: email, status: 'submitted' });
  const r = await createSetupIntent(email);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
});

test('the gate runs before the signature requirement, so a gated account sees the real reason, not "needs_signature"', async () => {
  reset();
  const res = await handler(new Request('https://x/functions/v1/manage-saved-card', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + jwt('nobody@example.com'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'create_setup_intent' }), // no signer_name / signature_image at all
  }));
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.needs_signature, undefined);
});

test('the gate checks the real Postgres tables with the service-role key, never a client-supplied flag', () => {
  const src = fs.readFileSync(path.join(ROOT, 'edge-functions', 'manage-saved-card-index.ts'), 'utf8');
  const fnMatch = src.match(/async function accountHasBusinessRecord\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate accountHasBusinessRecord()');
  assert.match(fnMatch[0], /apikey: SERVICE_ROLE_KEY, Authorization: `Bearer \$\{SERVICE_ROLE_KEY\}`/);
  assert.doesNotMatch(fnMatch[0], /req\.json\(\)/);
});
