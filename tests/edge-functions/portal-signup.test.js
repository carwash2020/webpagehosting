// portal-signup (2026-11-04, handoff §2; Connor chose server-side sign-up
// so public sign-up stays OFF). Runs the real handler with stubbed Auth
// admin, database and Resend: a new client gets a 6-digit code and an
// UNCONFIRMED account; the right code confirms it; nothing about the
// answer tells a stranger whether an address has an account.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const SRC = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'portal-signup-index.ts'), 'utf8'));
const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function load(seed = {}) {
  const st = {
    users: seed.users || [], // {id, email, password, confirmed}
    staff: seed.staff || [],
    codes: {}, ips: {}, emails: [], admin: [],
    limits: {}, limitCalls: [], limiterDown: !!seed.limiterDown,
  };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const q = (k) => decodeURIComponent((u.match(new RegExp(`${k}=eq\\.([^&]+)`)) || [])[1] || '');
    if (u.includes('/rest/v1/account_roles')) return j(st.staff.includes(q('email')) ? [{ email: q('email') }] : []);
    if (u.endsWith('/rest/v1/rpc/portal_account_status')) {
      const x = st.users.find((v) => v.email === body.p_email);
      return j(!x ? 'none' : x.confirmed ? 'confirmed' : 'unconfirmed');
    }
    // The shared limiter (sql/security/group5_backend_hardening.sql):
    // true while the count after this hit is <= p_max.
    if (u.endsWith('/rest/v1/rpc/rate_limit_take')) {
      st.limitCalls.push(body);
      if (st.limiterDown) return j({ message: 'down' }, 503);
      const k = body.p_bucket + '|' + body.p_key;
      st.limits[k] = (st.limits[k] || 0) + 1;
      return j(st.limits[k] <= body.p_max);
    }
    if (u.endsWith('/rest/v1/rpc/get_auth_user_id_by_email')) return j((st.users.find((v) => v.email === body.p_email) || {}).id || null);
    if (u.includes('/rest/v1/portal_signup_ip_limits')) {
      if (method === 'GET') return j(st.ips[q('ip_hash')] ? [st.ips[q('ip_hash')]] : []);
      if (method === 'POST') { st.ips[body[0].ip_hash] = body[0]; return j([]); }
      if (method === 'PATCH') { Object.assign(st.ips[q('ip_hash')], body); return j([]); }
    }
    if (u.includes('/rest/v1/portal_signup_codes')) {
      if (method === 'GET') return j(st.codes[q('email')] ? [st.codes[q('email')]] : []);
      if (method === 'POST') { st.codes[body[0].email] = body[0]; return j([]); }
      if (method === 'PATCH') { Object.assign(st.codes[q('email')], body); return j([]); }
      if (method === 'DELETE') { delete st.codes[q('email')]; return j([]); }
    }
    if (u.includes('/auth/v1/admin/users')) {
      st.admin.push({ method, url: u, body });
      if (method === 'POST') { const id = 'u' + (st.users.length + 1); st.users.push({ id, email: body.email, password: body.password, confirmed: body.email_confirm === true }); return j({ id }); }
      const id = decodeURIComponent(u.split('/admin/users/')[1]);
      const x = st.users.find((v) => v.id === id);
      if (body.password) x.password = body.password;
      if (body.email_confirm === true) x.confirmed = true;
      return j({ id });
    }
    if (u === 'https://api.resend.com/emails') { st.emails.push(body); return j({ id: 'e' }); }
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
  let handler;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk', RESEND_API_KEY: 're', LEAD_EMAIL_FROM: 'leads@example.com' };
  vm.runInContext(SRC, vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch, Response, Request, Headers, URL, URLSearchParams, console: { log() {}, error() {} },
    JSON, Math, Date, Promise, Number, String, Array, Object, Uint8Array, Uint32Array, TextEncoder, crypto: globalThis.crypto, encodeURIComponent, decodeURIComponent,
  }));
  const call = async (body, ip = '203.0.113.5', extraHeaders = {}) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/portal-signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...extraHeaders }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
  const lastCode = () => (st.emails.at(-1).text.match(/\b(\d{6})\b/) || [])[1];
  return { call, st, lastCode };
}

const EMAIL = 'tony@example.com';

test('a new client: an UNCONFIRMED account with their password, and a 6-digit code by email', async () => {
  const g = load();
  const r = await g.call({ action: 'start', email: ' Tony@Example.com ', password: 'fridge-fixed-1' });
  assert.deepEqual(r.body, { ok: true, next: 'code' });
  assert.deepEqual(g.st.users, [{ id: 'u1', email: EMAIL, password: 'fridge-fixed-1', confirmed: false }]);
  assert.equal(g.st.admin[0].body.email_confirm, false, 'never confirmed up front');
  assert.equal(g.st.emails.length, 1);
  assert.equal(g.st.emails[0].to, EMAIL);
  assert.match(g.st.emails[0].subject, /^\d{6} is your Triple H confirmation code$/);
  const row = g.st.codes[EMAIL];
  assert.ok(!JSON.stringify(row).includes(g.lastCode()), 'the code itself is never stored');
});

test('the right code confirms the account; then it is a normal confirmed account', async () => {
  const g = load();
  await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  const r = await g.call({ action: 'verify', email: EMAIL, code: g.lastCode() });
  assert.deepEqual(r.body, { ok: true });
  assert.equal(g.st.users[0].confirmed, true);
  assert.equal(g.st.codes[EMAIL], undefined, 'a used code is gone');
  const again = await g.call({ action: 'verify', email: EMAIL, code: '000000' });
  assert.equal(again.status, 400);
});

test('wrong codes: five tries, then a new code is needed; an expired code never works', async () => {
  const g = load();
  await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  const good = g.lastCode();
  const bad = good === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i++) assert.equal((await g.call({ action: 'verify', email: EMAIL, code: bad })).status, 400);
  const locked = await g.call({ action: 'verify', email: EMAIL, code: good });
  assert.match(locked.body.error, /Too many wrong tries\. Please wait an hour/);
  assert.equal(g.st.users[0].confirmed, false);

  const h = load();
  await h.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  h.st.codes[EMAIL].expires_at = new Date(Date.now() - 1000).toISOString();
  const late = await h.call({ action: 'verify', email: EMAIL, code: h.lastCode() });
  assert.match(late.body.error, /expired/);
  assert.equal(h.st.users[0].confirmed, false);
});

test('the same answer for every address: new, existing client, staff -- and no account is touched for the last two', async () => {
  const g = load({ users: [{ id: 'u1', email: EMAIL, password: 'theirs', confirmed: true }], staff: ['steve@triplehenterprisesllc.biz'] });
  const a = await g.call({ action: 'start', email: 'new@example.com', password: 'whatever-123' });
  const b = await g.call({ action: 'start', email: EMAIL, password: 'attacker-pw' });
  const c = await g.call({ action: 'start', email: 'steve@triplehenterprisesllc.biz', password: 'attacker-pw' });
  for (const r of [a, b, c]) assert.deepEqual([r.status, r.body], [200, { ok: true, next: 'code' }]);
  assert.equal(g.st.users.find((u) => u.email === EMAIL).password, 'theirs', 'an existing account\'s password is never changed here');
  assert.ok(!g.st.users.some((u) => u.email.startsWith('steve')), 'no portal account is ever made for a staff address');
  assert.deepEqual(g.st.emails.map((e) => [e.to, /already have/.test(e.subject)]), [['new@example.com', false], [EMAIL, true]], 'existing client is told to sign in; staff gets nothing');
});

test('a client Steve already invited but who never finished: the password is set and a code sent', async () => {
  const g = load({ users: [{ id: 'u7', email: EMAIL, password: null, confirmed: false }] });
  await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  assert.equal(g.st.users[0].password, 'fridge-fixed-1');
  assert.equal(g.st.users.length, 1, 'no second account');
  await g.call({ action: 'verify', email: EMAIL, code: g.lastCode() });
  assert.equal(g.st.users[0].confirmed, true);
});

test('limits: five codes an hour per address, ten sign-ups an hour per network address', async () => {
  const g = load();
  for (let i = 0; i < 7; i++) await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' }, '198.51.100.' + i);
  assert.equal(g.st.emails.length, 5);
  const h = load();
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await h.call({ action: 'start', email: `p${i}@example.com`, password: 'fridge-fixed-1' })).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
  assert.equal(statuses[10], 429);
  assert.equal(h.st.emails.length, 10);
});

test('input checks: a bad email or short password is refused before anything happens', async () => {
  const g = load();
  assert.equal((await g.call({ action: 'start', email: 'nope', password: 'fridge-fixed-1' })).status, 400);
  assert.equal((await g.call({ action: 'start', email: EMAIL, password: 'short' })).status, 400);
  assert.equal((await g.call({ action: 'verify', email: EMAIL, code: '12ab56' })).status, 400);
  assert.equal(g.st.admin.length + g.st.emails.length, 0);
});

test('the code email: big code, 15 minutes, and "nothing is shown until this code is entered"', async () => {
  const g = load();
  await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  const m = g.st.emails[0];
  assert.match(m.html, new RegExp(`>${g.lastCode()}</p>`));
  assert.match(m.text, /It works for 15 minutes\./);
  assert.match(m.text, /Nothing is shown to anyone until this code is entered\./);
});

// --- Fix plan RP3.30 (2026-11-07) -------------------------------------------

test('RP3.30: a re-sent code does not reset the wrong tries -- five per address per hour window, not five per code', async () => {
  const g = load();
  await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  const bad = (c) => (c === '111111' ? '222222' : '111111');
  for (let i = 0; i < 3; i++) await g.call({ action: 'verify', email: EMAIL, code: bad(g.lastCode()) });
  await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  assert.equal(g.st.codes[EMAIL].attempts, 3, 'the re-send kept the 3 wrong tries');
  for (let i = 0; i < 2; i++) await g.call({ action: 'verify', email: EMAIL, code: bad(g.lastCode()) });
  const locked = await g.call({ action: 'verify', email: EMAIL, code: g.lastCode() });
  assert.match(locked.body.error, /Too many wrong tries/, 'the right code no longer works after 5 wrong in the window');
  assert.equal(g.st.users[0].confirmed, false);

  // A new hour window starts the count again.
  g.st.codes[EMAIL].window_started_at = new Date(Date.now() - 2 * 3600_000).toISOString();
  await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  assert.equal(g.st.codes[EMAIL].attempts, 0);
  assert.deepEqual((await g.call({ action: 'verify', email: EMAIL, code: g.lastCode() })).body, { ok: true });
});

test('RP3.30: verify is limited to 30 an hour per network address (shared limiter), and fails CLOSED when the limiter is down', async () => {
  const g = load();
  await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await g.call({ action: 'verify', email: `x${i}@example.com`, code: '123456' }, '198.51.100.9')).status);
  assert.deepEqual(statuses.slice(0, 30), Array(30).fill(400));
  assert.equal(statuses[30], 429);
  const vcalls = g.st.limitCalls.filter((c) => c.p_bucket === 'portal-signup:verify');
  assert.deepEqual([vcalls[0].p_key, vcalls[0].p_max, vcalls[0].p_window_seconds], ['198.51.100.9', 30, 3600]);
  // Another network address is unaffected; the right code still works there.
  assert.deepEqual((await g.call({ action: 'verify', email: EMAIL, code: g.lastCode() })).body, { ok: true });

  const h = load();
  await h.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' });
  h.st.limiterDown = true;
  const r = await h.call({ action: 'verify', email: EMAIL, code: h.lastCode() });
  assert.equal(r.status, 500, 'limiter unreachable: refused, not checked');
  assert.equal(h.st.users[0].confirmed, false);
});

test('RP3.30: the network address is the gateway-set one, not the caller-written first x-forwarded-for entry', async () => {
  const g = load();
  const statuses = [];
  // A caller rotating the FIRST x-forwarded-for entry stays in one bucket.
  for (let i = 0; i < 11; i++) statuses.push((await g.call({ action: 'start', email: `p${i}@example.com`, password: 'fridge-fixed-1' }, `10.0.0.${i}, 203.0.113.77`)).status);
  assert.equal(statuses[10], 429, 'spoofed first entries share the real (last) address bucket');
  // cf-connecting-ip wins over x-forwarded-for.
  const h = load();
  await h.call({ action: 'verify', email: EMAIL, code: '123456' }, '10.9.9.9', { 'cf-connecting-ip': '192.0.2.44' });
  assert.equal(h.st.limitCalls.find((c) => c.p_bucket === 'portal-signup:verify').p_key, '192.0.2.44');
});

test('RP3.30: the code check is a constant-time compare, not !==', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'portal-signup-index.ts'), 'utf8');
  assert.match(src, /function sameHex\(a: string, b: string\): boolean \{[\s\S]*?diff \|= a\.charCodeAt\(i\) \^ b\.charCodeAt\(i\);[\s\S]*?return diff === 0;/);
  assert.match(src, /if \(!sameHex\(await hmac\(`\$\{email\}:\$\{code\}`\), String\(row\.code_hash \|\| ""\)\)\)/);
  assert.doesNotMatch(src, /\) !== row\.code_hash/);
  assert.doesNotMatch(src, /split\(","\)\[0\]/, 'never the first x-forwarded-for entry');
});

// --- Fix plan RP4.2 (2026-11-07) --------------------------------------------

test('RP4.2: over 5 starts an hour, EVERY address gets the same "limited" answer -- new, unconfirmed, confirmed client, staff', async () => {
  const g = load({ users: [{ id: 'u1', email: EMAIL, password: 'theirs', confirmed: true }, { id: 'u2', email: 'half@example.com', password: null, confirmed: false }], staff: ['steve@triplehenterprisesllc.biz'] });
  const addrs = ['new@example.com', 'half@example.com', EMAIL, 'steve@triplehenterprisesllc.biz'];
  const answers = {};
  for (const a of addrs) {
    answers[a] = [];
    for (let i = 0; i < 6; i++) answers[a].push((await g.call({ action: 'start', email: a, password: 'whatever-123' }, `198.51.100.${addrs.indexOf(a) * 10 + i}`)).body);
  }
  for (const a of addrs) {
    assert.deepEqual(answers[a].slice(0, 5), Array(5).fill({ ok: true, next: 'code' }), a);
    assert.deepEqual(answers[a][5], { ok: true, next: 'code', limited: true }, a);
  }
  const confirmedMails = g.st.emails.filter((e) => e.to === EMAIL);
  assert.equal(confirmedMails.length, 5, 'the "already have an account" email is capped too');
});

test('RP4.2: the per-address limiter failing open still answers SENT; the per-code-row cap still holds', async () => {
  const g = load({ limiterDown: true });
  const bodies = [];
  for (let i = 0; i < 7; i++) bodies.push((await g.call({ action: 'start', email: EMAIL, password: 'fridge-fixed-1' }, '198.51.100.' + i)).body);
  assert.ok(bodies.every((b) => b.ok === true && b.next === 'code' && !b.limited));
  assert.equal(g.st.emails.length, 5);
});
