// Two-factor gate on the internal edge functions (2026-09-25,
// docs/ACTION-ITEMS.md #13; audit 2026-09-23 round 3 finding #4).
//
// These 15 functions only serve internal /tools/ accounts: each checks the
// caller's account_roles row with the service role, which bypasses RLS, so
// the database-side two-factor rule never reached them. Each now also asks
// check_internal_mfa_for_edge_function() (sql/security/enforce_internal_mfa_server_side.sql)
// whether the caller's session is good enough, passing the claims from its
// JWT. These tests run every real handler (types stripped, Deno and fetch
// mocked, same approach as trigger-only-functions-auth.test.js) rather than
// only reading source.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const FUNCTIONS = [
  'advisor-health', 'create-pos-charge', 'delete-portal-invoice', 'send-contract-notification',
  'send-invite', 'send-invoice-notification', 'send-job-confirmation-email', 'send-quote-notification',
  'set-invoice-paid', 'sync-checkup-to-portal', 'sync-contract-to-portal', 'sync-invoice-to-portal',
  'sync-job-to-portal', 'sync-quote-to-portal', 'trigger-workflow',
];

const SERVICE_KEY = 'service-role-key-for-tests';
const CLAIMS = {
  role: 'authenticated',
  email: 'connor@triplehenterprisesllc.biz',
  sub: '22222222-2222-4222-8222-222222222222',
  aal: 'aal1',
  session_id: 'bbbbbbbb-0000-4000-8000-000000000001',
};
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bearer = (claims) => `Bearer ${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.sig`;

// A caller with every internal permission, so each function's own
// account_roles check passes and the two-factor gate is what decides.
const INTERNAL_ROW = {
  email: CLAIMS.email, role_name: 'Developer',
  can_manage_invoices: true, can_manage_contracts: true, can_manage_roles: true,
};

function loadHandler(name, { gate, internal = true }) {
  const src = fs.readFileSync(repo('edge-functions', `${name}-index.ts`), 'utf8');
  const calls = [];
  let handler = null;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const context = vm.createContext({
    Deno: {
      env: { get: (k) => (k === 'SUPABASE_SERVICE_ROLE_KEY' ? SERVICE_KEY : k === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'test-value') },
      serve: (h) => { handler = h; },
    },
    fetch: async (url, init = {}) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes('/rest/v1/rpc/check_internal_mfa_for_edge_function')) return gate(init);
      if (u.includes('/rest/v1/account_roles')) return json(internal ? [INTERNAL_ROW] : []);
      return json([]);
    },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, Intl, Date, JSON, Math, Promise, crypto: globalThis.crypto,
  });
  // send-invite imports supabase-js for its admin client; a stub stands in
  // (no test here gets far enough to use it).
  const js = stripTypeScriptTypes(src).replace(
    /^import \{ createClient \} from "npm:@supabase\/supabase-js@2";$/m,
    'const createClient = () => { throw new Error("admin client should not be reached in these tests"); };',
  );
  assert.doesNotMatch(js, /^import /m, `${name}: unexpected import`);
  vm.runInContext(js, context, { filename: `${name}-index.ts` });
  assert.equal(typeof handler, 'function', `${name}: expected Deno.serve to register a handler`);
  return { handler, calls };
}

const request = (claims = CLAIMS, body = {}) => new Request('https://example.supabase.co/functions/v1/x', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: bearer(claims) },
  body: JSON.stringify(body),
});
const gateReply = (value, status = 200) => async () => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const gateCalls = (calls) => calls.filter((c) => c.url.includes('check_internal_mfa_for_edge_function'));

for (const name of FUNCTIONS) {
  test(`${name}: a session the gate refuses gets 403 mfa_required, and nothing past the checks runs`, async () => {
    const { handler, calls } = loadHandler(name, { gate: gateReply(false) });
    const res = await handler(request());
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'mfa_required');
    assert.match(body.error, /sign back in with your authenticator code/);
    assert.deepEqual(calls.map((c) => c.url.replace(/\?.*/, '')), [
      'https://example.supabase.co/rest/v1/account_roles',
      'https://example.supabase.co/rest/v1/rpc/check_internal_mfa_for_edge_function',
    ], 'only the two checks -- no read, write, email, Stripe or GitHub call');
  });

  test(`${name}: the gate gets this caller's own claims and the function's name, with the service role`, async () => {
    const { handler, calls } = loadHandler(name, { gate: gateReply(true) });
    await handler(request());
    const [call] = gateCalls(calls);
    assert.ok(call, 'the gate is called');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, `Bearer ${SERVICE_KEY}`);
    assert.deepEqual(JSON.parse(call.init.body), {
      p_user_id: CLAIMS.sub, p_email: CLAIMS.email, p_session_id: CLAIMS.session_id, p_aal: CLAIMS.aal, p_function: name,
    });
  });

  test(`${name}: when the gate allows it (verified session, no authenticator, or dry run), the function carries on as before`, async () => {
    const { handler, calls } = loadHandler(name, { gate: gateReply(true) });
    const res = await handler(request());
    const body = await res.json().catch(() => ({}));
    assert.notEqual(body.code, 'mfa_required');
    assert.notEqual(res.status, 401);
    assert.ok(!(res.status === 403 && /isn't recognized|no assigned role|can't manage/.test(body.error || '')), 'past the account check');
    assert.equal(gateCalls(calls).length, 1);
  });

  test(`${name}: fails closed if the gate can't answer (error status, bad body, or network failure)`, async () => {
    for (const gate of [
      gateReply({ message: 'boom' }, 500),
      gateReply({ message: 'function not found' }, 404),
      gateReply('true'),
      async () => { throw new Error('network down'); },
    ]) {
      const { handler } = loadHandler(name, { gate });
      const res = await handler(request());
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, 'mfa_required');
    }
  });

  test(`${name}: a caller without an internal account is turned away by the existing check, before the gate is asked`, async () => {
    const { handler, calls } = loadHandler(name, { gate: gateReply(true), internal: false });
    const res = await handler(request({ ...CLAIMS, email: 'stranger@example.com' }));
    assert.equal(res.status, 403);
    assert.notEqual((await res.json()).code, 'mfa_required');
    assert.equal(gateCalls(calls).length, 0);
  });

  test(`${name}: the gate sits right after the account check and before the request body is read`, () => {
    const src = fs.readFileSync(repo('edge-functions', `${name}-index.ts`), 'utf8');
    const serve = src.indexOf('Deno.serve(');
    const accountCheck = src.indexOf('(await caller', serve);
    const gate = src.indexOf(`await callerPassesInternalMfa(claims, "${name}")`);
    const body = src.indexOf('await req.json()', serve);
    assert.ok(accountCheck > serve && gate > accountCheck, `${name}: the gate comes after the account check`);
    // advisor-health takes no request body at all.
    if (name !== 'advisor-health') assert.ok(body > gate, `${name}: the body is read only after the gate`);
    else assert.equal(body, -1);
    assert.equal(src.split('callerPassesInternalMfa(claims').length - 1, 1, 'called exactly once');
  });
}

test('the 15 gated functions are exactly the ones whose caller check reads account_roles for a user session', () => {
  const dir = repo('edge-functions');
  const gated = fs.readdirSync(dir)
    .filter((f) => f.endsWith('-index.ts'))
    .filter((f) => /async function caller\w+\(email: string\)[\s\S]*?\/rest\/v1\/account_roles/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map((f) => f.replace(/-index\.ts$/, ''))
    .sort();
  assert.deepEqual(gated, [...FUNCTIONS].sort());
});

test('trigger-workflow allows the renamed backup workflow Dev Tools actually sends (repo brought in line with the live copy)', () => {
  const src = fs.readFileSync(repo('edge-functions', 'trigger-workflow-index.ts'), 'utf8');
  const devTools = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');
  assert.match(devTools, /data-workflow="backup-sensitive-data\.yml"/);
  assert.match(src, /"backup-sensitive-data\.yml"/);
  assert.doesNotMatch(src, /"backup-business-data\.yml"/);
  assert.ok(fs.existsSync(repo('.github', 'workflows', 'backup-sensitive-data.yml')));
});
