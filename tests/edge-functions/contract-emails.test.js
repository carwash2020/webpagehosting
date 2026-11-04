// Contract emails (2026-11-04, handoff §3D; Connor's choices that day: send
// the sign email to brand-new clients too, and copy Steve and Connor).
// Runs the real handlers of sync-contract-to-portal, send-contract-
// notification and respond-to-contract with stubbed database and Resend.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const STAFF = jwt({ role: 'authenticated', email: 'steve@triplehenterprisesllc.biz', sub: 'u1', aal: 'aal2', session_id: 's1' });
const CLIENT = jwt({ role: 'authenticated', email: 'tony@example.com', sub: 'u2' });
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgo'.padEnd(140, 'A');

function load(file, fetch) {
  let handler;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk', RESEND_API_KEY: 're', LEAD_EMAIL_FROM: 'leads@example.com' };
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync(repo('edge-functions', file), 'utf8')), vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch, Response, Request, Headers, URL, URLSearchParams, atob, btoa, console: { log() {}, error() {}, warn() {} },
    JSON, Math, Date, Promise, Number, String, Array, Object, Set, Map, Intl, encodeURIComponent, decodeURIComponent, TextEncoder,
  }));
  return async (body, token) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
}

// ---------- sync-contract-to-portal ----------

function sync({ known = false } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.includes('/rest/v1/account_roles')) return j([{ can_manage_contracts: true }]);
    if (u.includes('/rest/v1/rpc/check_internal_mfa_for_edge_function')) return j(true);
    if (u.includes('?client_email=')) return j(known && u.includes('client_portal_invoices') ? [{ id: 1 }] : []);
    if (u.includes('client_portal_contracts?source_contract_id=')) return j([]);
    if (u.includes('client_portal_contracts?on_conflict=')) { calls.push({ upsert: init.headers.Prefer }); return j([{ id: 77 }]); }
    if (u.endsWith('/functions/v1/send-invite')) { calls.push({ fn: 'send-invite' }); return j({ ok: true }); }
    if (u.endsWith('/functions/v1/send-contract-notification')) { calls.push({ fn: 'notify', body: JSON.parse(init.body) }); return j({ ok: true }); }
    throw new Error(`unexpected ${method} ${u}`);
  };
  return { call: load('sync-contract-to-portal-index.ts', fetch), calls };
}
const CONTRACT = { source_contract_id: 5, client_email: 'Tony@Example.com', client_name: 'Tony Perides', contract_type: 'pwo', contract_title: 'Per-Job Work Order', blocks: [] };

test('a brand-new client\'s first contract gets the "Please sign" email, not the "You\'ve been invoiced" invite', async () => {
  const s = sync();
  const r = await s.call(CONTRACT, STAFF);
  assert.equal(r.body.ok, true);
  assert.ok(!s.calls.some((c) => c.fn === 'send-invite'));
  const n = s.calls.find((c) => c.fn === 'notify');
  assert.deepEqual(n.body, { client_email: 'tony@example.com', client_name: 'Tony Perides', contract_title: 'Per-Job Work Order', portal_contract_id: 77, has_portal_account: false });
  assert.match(s.calls.find((c) => c.upsert).upsert, /return=representation/, 'the new row\'s id comes back for the link');
});

test('a known client gets the same email, marked as having an account', async () => {
  const s = sync({ known: true });
  await s.call(CONTRACT, STAFF);
  assert.equal(s.calls.find((c) => c.fn === 'notify').body.has_portal_account, true);
});

// ---------- send-contract-notification ----------

function notify({ optedOut = false } = {}) {
  const sent = [];
  const pushes = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/account_roles')) return j([{ can_manage_contracts: true }]);
    if (u.includes('/rest/v1/rpc/check_internal_mfa_for_edge_function')) return j(true);
    if (u.includes('/rest/v1/client_notification_preferences')) return j(optedOut ? [{ wants_invoice_quote_emails: false }] : []);
    if (u.includes('/rest/v1/rpc/get_auth_user_id_by_email')) return j('u2');
    if (u.endsWith('/functions/v1/Send-Push')) { pushes.push(JSON.parse(init.body)); return j({ ok: true }); }
    if (u === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return j({ id: 'e' }); }
    throw new Error(`unexpected ${u}`);
  };
  return { call: load('send-contract-notification-index.ts', fetch), sent, pushes };
}

test('"Please sign": Steve and Connor bcc\'d, and the button opens that exact contract', async () => {
  const n = notify();
  const r = await n.call({ client_email: 'tony@example.com', client_name: 'Tony Perides', contract_title: 'Per-Job Work Order', portal_contract_id: 77, has_portal_account: true }, STAFF);
  assert.equal(r.body.ok, true);
  const m = n.sent[0];
  assert.deepEqual(m.bcc, ['steve@triplehenterprisesllc.biz', 'connor@triplehenterprisesllc.biz']);
  assert.match(m.html, /<a href="https:\/\/www\.triplehenterprisesllc\.biz\/portal\/contracts\.html#contract-card-77"[^>]*>Review &amp; Sign<\/a>/);
  assert.match(m.text, /Review and sign it here: https:\/\/www\.triplehenterprisesllc\.biz\/portal\/contracts\.html#contract-card-77/);
  assert.doesNotMatch(m.html, /New to the Triple H portal/, 'a known client is not told to create an account');
  assert.equal(n.pushes[0].url, '/portal/contracts.html#contract-card-77');
});

test('a new client is told how to get in: Review & Sign, then Create account with this address', async () => {
  const n = notify();
  await n.call({ client_email: 'tony@example.com', client_name: 'Tony', contract_title: 'Per-Job Work Order', portal_contract_id: 77, has_portal_account: false }, STAFF);
  assert.match(n.sent[0].html, /New to the Triple H portal\? Tap Review &amp; Sign, then Create account with this email address\./);
  assert.match(n.sent[0].text, /New to the Triple H portal\?/);
});

test('no contract id (an older caller): the link falls back to the contracts list', async () => {
  const n = notify();
  await n.call({ client_email: 'tony@example.com', client_name: 'Tony', contract_title: 'X' }, STAFF);
  assert.match(n.sent[0].html, /href="https:\/\/www\.triplehenterprisesllc\.biz\/portal\/contracts\.html"/);
});

// ---------- respond-to-contract ----------

function respond({ confirmed = true, resendFails = false } = {}) {
  const sent = [];
  const patches = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.endsWith('/rest/v1/rpc/portal_account_status')) return j(confirmed ? 'confirmed' : 'unconfirmed');
    if (u.includes('/rest/v1/client_portal_contracts?id=eq.77') && method === 'GET') {
      return j([{ id: 77, client_email: 'tony@example.com', client_name: 'Tony Perides', contract_title: 'Per-Job Work Order', status: 'pending',
        blocks: [{ type: 'heading', text: 'Per-Job Work Order' }, { type: 'sectionLabel', text: 'Scope of work' }, { type: 'paragraph', text: 'Repair the fridge <door>.' }, { type: 'field', label: 'Address', value: '12 Main St' }, { type: 'totalHighlight', label: 'Price', value: '$300.00' }] }]);
    }
    if (u.includes('/rest/v1/client_portal_contracts?id=eq.77') && method === 'PATCH') { patches.push(JSON.parse(init.body)); return j([]); }
    if (u === 'https://api.resend.com/emails') { sent.push(JSON.parse(init.body)); return resendFails ? j({ message: 'down' }, 500) : j({ id: 'e' }); }
    throw new Error(`unexpected ${method} ${u}`);
  };
  return { call: load('respond-to-contract-index.ts', fetch), sent, patches };
}

test('signed: the client gets a copy (contract text, date, signature attached); Steve and Connor get the same', async () => {
  const r = respond();
  const res = await r.call({ contract_id: 77, action: 'sign', client_signature_data_url: SIG }, CLIENT);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status, 'signed');
  assert.match(res.body.signed_on, /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  assert.equal(r.sent.length, 2);
  const team = r.sent.find((m) => Array.isArray(m.to));
  const client = r.sent.find((m) => m.to === 'tony@example.com');
  assert.deepEqual(team.to, ['steve@triplehenterprisesllc.biz', 'connor@triplehenterprisesllc.biz']);
  assert.equal(team.subject, 'Signed: Per-Job Work Order (Tony Perides)');
  assert.equal(client.subject, 'Signed: Per-Job Work Order');
  for (const m of [team, client]) {
    assert.match(m.html, /Repair the fridge &lt;door&gt;\./, 'the contract text, escaped');
    assert.match(m.html, /Address:<\/span> 12 Main St/);
    assert.match(m.text, /Price: \$300\.00/);
    assert.equal(m.attachments[0].filename, 'signature.png');
    assert.equal(m.attachments[0].content, SIG.split(',')[1]);
  }
  assert.match(client.html, /Signed on [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
  assert.match(client.html, /contracts\.html#contract-card-77/);
});

test('declined: Steve and Connor are told; the client is not emailed', async () => {
  const r = respond();
  await r.call({ contract_id: 77, action: 'decline' }, CLIENT);
  assert.equal(r.sent.length, 1);
  assert.deepEqual(r.sent[0].to, ['steve@triplehenterprisesllc.biz', 'connor@triplehenterprisesllc.biz']);
  assert.equal(r.sent[0].subject, 'Declined: Per-Job Work Order (Tony Perides)');
  assert.equal(r.sent[0].attachments, undefined);
});

test('a failed email never undoes or blocks the signature', async () => {
  const r = respond({ resendFails: true });
  const res = await r.call({ contract_id: 77, action: 'sign', client_signature_data_url: SIG }, CLIENT);
  assert.equal(res.body.ok, true);
  assert.equal(r.patches[0].status, 'signed');
});

test('an unconfirmed account cannot sign: nothing is written, nobody is emailed', async () => {
  const r = respond({ confirmed: false });
  const res = await r.call({ contract_id: 77, action: 'sign', client_signature_data_url: SIG }, CLIENT);
  assert.equal(res.status, 403);
  assert.equal(r.patches.length, 0);
  assert.equal(r.sent.length, 0);
});
