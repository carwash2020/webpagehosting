// portal-email-alias (fix plan FP4.2, 2026-11-06; D11). Runs the real handler
// with a fake database, Auth admin, Stripe and Resend. Made-up accounts only.
//
// Pinned: adding an email links nothing until the code sent TO that email is
// entered; "add" reads the same for any address; an email with its own
// account, a staff email, or one linked elsewhere is never linked (said only
// after the code); codes are per account, expire and lock after 5 wrong
// tries; staff need Workspace + two-factor + Clients; a staff-started add
// links only when the right account opens the link; a merge locks B, detaches
// B's saved cards and gives A B's email, and needs an explicit confirm.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const SRC = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'portal-email-alias-index.ts'), 'utf8'));
const j = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (u) => 'h.' + b64u({ sub: u.id, email: u.email, role: 'authenticated', aal: u.aal || 'aal1', session_id: 's' }) + '.sig';

const SAM = { id: 'u-sam', email: 'sam@example.com' };
const KIM = { id: 'u-kim', email: 'kim@example.com' };
const OWNER = { id: 'u-owner', email: 'owner@example.com', aal: 'aal2' };
const TECH = { id: 'u-tech', email: 'tech@example.com', aal: 'aal2' };

function load(seed = {}) {
  const st = {
    users: [SAM, KIM, OWNER, TECH].map((u) => ({ id: u.id, email: u.email, banned: false })),
    staff: { [OWNER.email]: { can_manage_clients: true }, [TECH.email]: { can_manage_clients: false } },
    mfaOk: seed.mfaOk !== false,
    aliases: [],
    records: seed.records || { 'sam.work@example.com': { client_portal_invoices: 2, client_portal_quotes: 1 } },
    stripeCustomers: seed.stripeCustomers || {},
    cards: seed.cards || {},
    detached: [], emails: [], bans: [],
  };
  let now = Date.parse('2026-11-06T18:00:00Z');
  const filters = (u) => {
    const out = {};
    for (const [k, v] of new URL(u).searchParams) if (/^eq\./.test(v)) out[k] = decodeURIComponent(v.slice(3));
    return out;
  };
  const match = (row, f) => Object.entries(f).every(([k, v]) => String(row[k]) === v);
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') || (init.body && init.body.startsWith && init.body.startsWith('[')) ? JSON.parse(init.body) : null;
    if (u.includes('/rest/v1/account_roles')) { const e = filters(u).email; return j(st.staff[e] ? [{ email: e, ...st.staff[e] }] : []); }
    if (u.endsWith('/rest/v1/rpc/get_auth_user_id_by_email')) return j((st.users.find((x) => x.email === body.p_email) || {}).id || null);
    if (u.endsWith('/rest/v1/rpc/check_internal_mfa_for_edge_function')) return j(st.mfaOk && body.p_aal === 'aal2');
    if (u.includes('/rest/v1/client_email_aliases')) {
      const f = filters(u);
      if (method === 'GET') return j(st.aliases.filter((r) => match(r, f)).map((r) => ({ ...r })));
      if (method === 'POST') {
        for (const row of body) {
          const i = st.aliases.findIndex((r) => r.user_id === row.user_id && r.email === row.email);
          if (row.status === 'confirmed' && st.aliases.some((r) => r.email === row.email && r.status === 'confirmed' && r.user_id !== row.user_id)) return j({ message: 'duplicate key client_email_aliases_one_owner' }, 409);
          if (i >= 0) Object.assign(st.aliases[i], row); else st.aliases.push({ created_at: new Date(now).toISOString(), confirmed_at: null, ...row });
        }
        return j([]);
      }
      if (method === 'PATCH') { st.aliases.filter((r) => match(r, f)).forEach((r) => Object.assign(r, body)); return j([]); }
      if (method === 'DELETE') { st.aliases = st.aliases.filter((r) => !match(r, f)); return j([]); }
    }
    const rec = u.match(/\/rest\/v1\/(client_portal_[a-z]+)\?/);
    if (rec) { const n = ((st.records[filters(u).client_email] || {})[rec[1]]) || 0; return j([], 200, { 'content-range': `0-0/${n}` }); }
    if (u.includes('/rest/v1/stripe_customers')) { const c = st.stripeCustomers[filters(u).client_email]; return j(c ? [{ stripe_customer_id: c }] : []); }
    if (u.startsWith('https://api.stripe.com/v1/payment_methods?')) { const c = new URL(u).searchParams.get('customer'); return j({ data: (st.cards[c] || []).map((id) => ({ id })) }); }
    const det = u.match(/^https:\/\/api\.stripe\.com\/v1\/payment_methods\/([^/]+)\/detach$/);
    if (det) { st.detached.push(det[1]); return j({ id: det[1] }); }
    if (u.includes('/auth/v1/admin/users/')) { const id = decodeURIComponent(u.split('/admin/users/')[1]); st.users.find((x) => x.id === id).banned = body.ban_duration !== 'none'; st.bans.push(id); return j({ id }); }
    if (u === 'https://api.resend.com/emails') { st.emails.push(body); return j({ id: 'e' }); }
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
  let handler;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk', RESEND_API_KEY: 're', LEAD_EMAIL_FROM: 'hello@example.com', STRIPE_CLIENT_CARDS_SECRET_KEY: 'sk_test_x' };
  const FakeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
  vm.runInContext(SRC, vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch, Response, Request, Headers, URL, URLSearchParams, console: { log() {}, error() {} }, atob,
    JSON, Math, Date: FakeDate, Promise, Number, String, Array, Object, Uint8Array, Uint32Array, TextEncoder, crypto: globalThis.crypto, encodeURIComponent, decodeURIComponent,
  }));
  const call = async (who, body) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/portal-email-alias', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenFor(who) }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
  const lastCode = () => (st.emails.at(-1).text.match(/\b(\d{6})\b/) || [])[1];
  const lastToken = () => (st.emails.at(-1).text.match(/confirm_email=([a-f0-9]{48})/) || [])[1];
  const confirmed = (userId) => st.aliases.filter((a) => a.user_id === userId && a.status === 'confirmed').map((a) => a.email).sort();
  return { call, st, lastCode, lastToken, confirmed, advance: (ms) => { now += ms; } };
}

test('add sends a code to THAT email; nothing is linked until the code is right; then the records show up', async () => {
  const g = load();
  const r = await g.call(SAM, { action: 'add', email: ' Sam.Work@Example.com ' });
  assert.deepEqual(r.body, { ok: true, next: 'code' });
  assert.equal(g.st.emails.at(-1).to, 'sam.work@example.com');
  assert.deepEqual(g.confirmed(SAM.id), [], 'pending only');
  assert.ok(!JSON.stringify(g.st.aliases).includes(g.lastCode()), 'the code itself is never stored');
  const ok = await g.call(SAM, { action: 'verify', email: 'sam.work@example.com', code: g.lastCode() });
  assert.equal(ok.body.outcome, 'confirmed');
  assert.deepEqual(ok.body.records, { invoice: 2, quote: 1, job: 0, contract: 0, checkup: 0 });
  assert.deepEqual(g.confirmed(SAM.id), ['sam.work@example.com']);
  const list = await g.call(SAM, { action: 'list' });
  assert.equal(list.body.signin, SAM.email);
  assert.deepEqual(list.body.emails.map((e) => [e.email, e.status]), [['sam.work@example.com', 'confirmed']]);
});

test('"add" reads the same for any address -- staff, someone with their own account, an email linked elsewhere', async () => {
  const g = load();
  g.st.aliases.push({ user_id: KIM.id, email: 'shared@example.com', status: 'confirmed' });
  for (const email of [OWNER.email, KIM.email, 'shared@example.com', 'nobody@example.com']) {
    assert.deepEqual((await g.call(SAM, { action: 'add', email })).body, { ok: true, next: 'code' }, email);
  }
});

test('after the right code: an email with its own account, a staff email, or one linked elsewhere is never linked', async () => {
  const g = load();
  g.st.aliases.push({ user_id: KIM.id, email: 'shared@example.com', status: 'confirmed' });
  for (const [email, outcome] of [[KIM.email, 'own_account'], [OWNER.email, 'not_allowed'], ['shared@example.com', 'linked_elsewhere']]) {
    await g.call(SAM, { action: 'add', email });
    const r = await g.call(SAM, { action: 'verify', email, code: g.lastCode() });
    assert.equal(r.body.outcome, outcome, email);
    assert.deepEqual(g.confirmed(SAM.id), [], 'nothing moved');
    assert.ok(!g.st.aliases.some((a) => a.user_id === SAM.id && a.email === email), 'the attempt is cleared');
  }
  assert.deepEqual(g.confirmed(KIM.id), ['shared@example.com'], 'Kim keeps hers');
});

test('codes: wrong tries count and lock at 5, they expire in 15 minutes, and one account cannot use another\'s', async () => {
  const g = load();
  await g.call(SAM, { action: 'add', email: 'sam.work@example.com' });
  const code = g.lastCode();
  const other = code === '000000' ? '111111' : '000000';
  assert.equal((await g.call(KIM, { action: 'verify', email: 'sam.work@example.com', code })).body.ok, false, 'Kim cannot use Sam\'s code');
  for (let i = 0; i < 5; i++) assert.equal((await g.call(SAM, { action: 'verify', email: 'sam.work@example.com', code: other })).body.ok, false);
  assert.match((await g.call(SAM, { action: 'verify', email: 'sam.work@example.com', code })).body.error, /Too many wrong tries/);
  await g.call(SAM, { action: 'add', email: 'sam.work@example.com' });
  g.advance(16 * 60_000);
  assert.match((await g.call(SAM, { action: 'verify', email: 'sam.work@example.com', code: g.lastCode() })).body.error, /expired/);
  assert.deepEqual(g.confirmed(SAM.id), []);
});

test('at most 5 codes an hour per email (quietly), and the sign-in email or a confirmed one is refused up front', async () => {
  const g = load();
  for (let i = 0; i < 7; i++) await g.call(SAM, { action: 'add', email: 'sam.work@example.com' });
  assert.equal(g.st.emails.length, 5);
  assert.match((await g.call(SAM, { action: 'add', email: SAM.email })).body.error, /sign in with/);
});

test('remove hides it again; the sign-in email is not in the list to remove', async () => {
  const g = load();
  await g.call(SAM, { action: 'add', email: 'sam.work@example.com' });
  await g.call(SAM, { action: 'verify', email: 'sam.work@example.com', code: g.lastCode() });
  const r = await g.call(SAM, { action: 'remove', email: 'sam.work@example.com' });
  assert.deepEqual(r.body.emails, []);
  assert.deepEqual(g.confirmed(SAM.id), []);
  await g.call(SAM, { action: 'remove', email: SAM.email });
  assert.equal(g.st.users.find((u) => u.id === SAM.id).banned, false);
});

test('staff only, with two-factor and Clients; a Workspace account has no portal emails', async () => {
  const g = load();
  assert.equal((await g.call(SAM, { action: 'staff_list', account_email: KIM.email })).status, 403, 'a client');
  assert.equal((await g.call(TECH, { action: 'staff_list', account_email: KIM.email })).status, 403, 'staff without Clients');
  assert.equal((await g.call({ ...OWNER, aal: 'aal1' }, { action: 'staff_list', account_email: KIM.email })).status, 403, 'password only');
  assert.equal((await g.call(OWNER, { action: 'staff_list', account_email: KIM.email })).body.ok, true);
  assert.equal((await g.call(OWNER, { action: 'list' })).status, 403);
});

test('staff add: a link to that email, which links only when the right account opens it', async () => {
  const g = load();
  const r = await g.call(OWNER, { action: 'staff_add', account_email: SAM.email, email: 'sam.work@example.com' });
  assert.deepEqual(r.body.emails.map((e) => [e.email, e.status, e.added_by]), [['sam.work@example.com', 'pending', 'staff']]);
  assert.equal(g.st.emails.at(-1).to, 'sam.work@example.com');
  assert.match(g.st.emails.at(-1).text, /s\*\*\*@example\.com/, 'names the account only masked');
  const t = g.lastToken();
  assert.equal((await g.call(KIM, { action: 'confirm_link', token: t })).status, 403, 'another account');
  assert.deepEqual(g.confirmed(SAM.id), []);
  assert.equal((await g.call(SAM, { action: 'confirm_link', token: t })).body.outcome, 'confirmed');
  assert.deepEqual(g.confirmed(SAM.id), ['sam.work@example.com']);
  assert.equal((await g.call(SAM, { action: 'confirm_link', token: t })).body.ok, false, 'used once');
  const own = await g.call(OWNER, { action: 'staff_add', account_email: SAM.email, email: KIM.email });
  assert.equal(own.body.outcome, 'own_account', 'an email with its own account is a merge, not an add');
});

test('merge B into A: preview first; then B is locked, B\'s saved cards are detached, and A gets B\'s emails', async () => {
  const g = load({ stripeCustomers: { [KIM.email]: 'cus_kim' }, cards: { cus_kim: ['pm_1', 'pm_2'] } });
  g.st.aliases.push({ user_id: KIM.id, email: 'kim.work@example.com', status: 'confirmed' });
  const p = await g.call(OWNER, { action: 'merge_preview', account_email: SAM.email, merge_email: KIM.email });
  assert.equal(p.body.saved_cards, 2);
  assert.deepEqual(p.body.their_emails, ['kim.work@example.com']);
  assert.deepEqual(g.st.bans, [], 'a preview changes nothing');
  assert.equal((await g.call(OWNER, { action: 'merge', account_email: SAM.email, merge_email: KIM.email })).body.ok, false, 'needs confirm');
  const m = await g.call(OWNER, { action: 'merge', account_email: SAM.email, merge_email: KIM.email, confirm: true });
  assert.equal(m.body.detached_cards, 2);
  assert.deepEqual(g.st.detached, ['pm_1', 'pm_2']);
  assert.equal(g.st.users.find((u) => u.id === KIM.id).banned, true);
  assert.deepEqual(g.confirmed(SAM.id), ['kim.work@example.com', KIM.email].sort());
  assert.deepEqual(g.confirmed(KIM.id), []);
  const again = await g.call(OWNER, { action: 'merge', account_email: SAM.email, merge_email: KIM.email, confirm: true });
  assert.equal(again.body.ok, true, 'safe to retry');
  assert.equal((await g.call(TECH, { action: 'merge', account_email: SAM.email, merge_email: KIM.email, confirm: true })).status, 403);
  assert.equal((await g.call(OWNER, { action: 'merge', account_email: SAM.email, merge_email: OWNER.email, confirm: true })).body.ok, false, 'never a staff account');
});
