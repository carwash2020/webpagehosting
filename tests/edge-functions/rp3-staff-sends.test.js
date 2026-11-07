// Fix plan Round-2 Phase 3 (2026-11-07): staff send paths and internal
// capability gates. Runs each real handler with a stubbed Deno, database,
// Resend, Auth and Stripe; made-up accounts and clients only, nothing leaves
// the process. Proves:
//   RP3.9  send-invite needs can_manage_clients (D23);
//   RP3.10 send-job-confirmation-email needs the job to be the caller's
//          (assignee, else creator) or can_manage_others_jobs (D23);
//   RP3.15 advisor-health / trigger-workflow need can_access_dev_tools_full;
//   RP3.22 Resend/Auth/database text never comes back to the caller;
//   RP3.23 notify-*-message-email: an unknown sender_type emails nobody;
//   RP3.25 each staff send path is capped per caller (staff-send:<slug>,
//          60/hour), 429 when over, fails OPEN when the limiter is down;
//   RP3.26 a preferences lookup that errors sends nothing (fails CLOSED);
//          a missing preferences row still sends.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SRK = 'service-role-key-for-tests';
const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const jwt = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';
const STAFF = 'office@example.com';
const TECH = 'tech@example.com';
const tokenFor = (email) => jwt({ role: 'authenticated', email, sub: `u-${email}`, aal: 'aal2' });

// st: { roles: {email: {...switches}}, prefs, prefsStatus, overLimit, limiterDown, resendStatus, jobs, ... }
function load(name, st = {}) {
  let src = stripTypeScriptTypes(fs.readFileSync(repo('edge-functions', `${name}-index.ts`), 'utf8'));
  src = src.replace(/^import \{ createClient \} from "npm:@supabase\/supabase-js@2";$/m, '');
  st.calls = []; st.limited = []; st.emails = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : null;
    st.calls.push({ url: u, method, body });
    const p = new URL(u);
    const q = (k) => decodeURIComponent((u.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)) || [])[1] || '');
    if (p.pathname === '/rest/v1/rpc/rate_limit_take') {
      st.limited.push(body);
      if (st.limiterDown) throw new Error('limiter down');
      return j(!st.overLimit);
    }
    if (p.pathname === '/rest/v1/rpc/check_internal_mfa_for_edge_function') return j(true);
    if (p.pathname === '/rest/v1/account_roles') {
      const row = (st.roles || {})[q('email')];
      return j(row ? [{ email: q('email'), ...row }] : []);
    }
    if (p.pathname === '/rest/v1/client_notification_preferences') {
      if (st.prefsThrow) throw new Error('db down');
      if (st.prefsStatus) return j({ message: 'relation "client_notification_preferences" is locked' }, st.prefsStatus);
      return j(st.prefs || []);
    }
    if (p.pathname === '/rest/v1/rpc/get_auth_user_id_by_email') return j(null);
    if (p.pathname === '/rest/v1/rpc/portal_account_status') return j(st.accountStatus || 'none');
    if (p.pathname === '/rest/v1/client_account_codes') return method === 'GET' ? j([{ id: 1 }]) : j([], 201);
    if (p.pathname === '/rest/v1/jobs' && method === 'GET') {
      if (st.jobsFail) return j({ message: 'boom' }, 500);
      const row = (st.jobs || {})[q('id')];
      return j(row ? [row] : []);
    }
    if (p.pathname === '/rest/v1/jobs' && method === 'PATCH') {
      const row = (st.jobs || {})[q('id')];
      if (!row) return j([]);
      if (u.includes('confirmation_sent_at=is.null')) {
        if (row.confirmation_sent_at) return j([]);
        Object.assign(row, body);
        return j([row]);
      }
      Object.assign(row, body);
      return j([]);
    }
    if (p.pathname === '/rest/v1/client_portal_jobs') return j(st.portalJob ? [st.portalJob] : []);
    if (p.pathname === '/rest/v1/client_portal_work_orders') return j(st.portalJob ? [st.portalJob] : []);
    if (p.pathname === '/rest/v1/notification_recipients') return j([{ email: 'staff@example.com' }]);
    if (p.pathname === '/functions/v1/Send-Push') return j({ ok: true });
    if (u === 'https://api.resend.com/emails') {
      st.emails.push(body);
      return st.resendStatus ? j({ message: 'API key re_live_SECRET is invalid' }, st.resendStatus) : j({ id: 'em_1' });
    }
    if (p.hostname === 'api.supabase.com') return st.mgmtStatus ? j({ message: 'PAT sbp_SECRET rejected' }, st.mgmtStatus) : j({ lints: [] });
    if (p.hostname === 'api.github.com') return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };
  const createClient = () => ({
    auth: { admin: { generateLink: async () => (st.linkError ? { data: null, error: { message: st.linkError } } : { data: { properties: { action_link: 'https://example.supabase.co/verify?t=x' } }, error: null }) } },
  });
  let handler = null;
  const env = {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SRK, SUPABASE_ANON_KEY: 'anon',
    RESEND_API_KEY: 're_test', LEAD_EMAIL_FROM: 'office@example.com', LEAD_EMAIL_TO: 'office@example.com',
    MANAGEMENT_API_PAT: 'sbp_test', GITHUB_PAT: 'ghp_test',
  };
  vm.runInContext(src, vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    createClient, fetch, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    Intl, Date, JSON, Math, Promise, Set, Map, Number, String, Array, Object, parseInt, isNaN, encodeURIComponent, decodeURIComponent,
    crypto: globalThis.crypto, TextEncoder, Uint8Array, setTimeout,
  }), { filename: `${name}-index.ts` });
  const call = async (payload, bearer = tokenFor(STAFF)) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(payload),
    }));
    return { status: res.status, body: await res.json() };
  };
  return { call, st };
}

const SENDS = [
  { name: 'send-invoice-notification', roles: { [STAFF]: { can_manage_invoices: true } }, payload: { client_email: 'client@example.com', client_name: 'Pat Client', invoice_number: 'INV-1', total: 100 } },
  { name: 'send-quote-notification', roles: { [STAFF]: { can_manage_invoices: true } }, payload: { client_email: 'client@example.com', client_name: 'Pat Client', quote_number: 'Q-1', total: 100 } },
  { name: 'send-contract-notification', roles: { [STAFF]: { can_manage_contracts: true } }, payload: { client_email: 'client@example.com', client_name: 'Pat Client', contract_title: 'Deck repair', portal_contract_id: 4 } },
];

for (const s of SENDS) {
  test(`${s.name} RP3.26: a preferences lookup that errors sends nothing and says so (503); no row still sends`, async () => {
    for (const bad of [{ prefsStatus: 500 }, { prefsStatus: 404 }, { prefsThrow: true }]) {
      const g = load(s.name, { roles: s.roles, ...bad });
      const r = await g.call(s.payload);
      assert.equal(r.status, 503, JSON.stringify(bad));
      assert.equal(r.body.ok, false);
      assert.equal(g.st.emails.length, 0, 'fails closed: no email');
      assert.doesNotMatch(JSON.stringify(r.body), /relation|locked/);
    }
    const none = load(s.name, { roles: s.roles, prefs: [] });
    assert.deepEqual((await none.call(s.payload)).body, { ok: true });
    assert.equal(none.st.emails.length, 1);
    const out = load(s.name, { roles: s.roles, prefs: [{ wants_invoice_quote_emails: false }] });
    const r = await out.call(s.payload);
    assert.equal(r.body.ok, true);
    assert.match(r.body.skipped, /opted out/);
    assert.equal(out.st.emails.length, 0);
  });

  test(`${s.name} RP3.25: capped per caller (staff-send:${s.name}, 60/hour); over the cap is a 429 with nothing sent; limiter down = allowed`, async () => {
    const g = load(s.name, { roles: s.roles });
    await g.call(s.payload);
    assert.deepEqual(g.st.limited, [{ p_bucket: `staff-send:${s.name}`, p_key: STAFF, p_max: 60, p_window_seconds: 3600 }]);
    const over = load(s.name, { roles: s.roles, overLimit: true });
    const r = await over.call(s.payload);
    assert.equal(r.status, 429);
    assert.match(r.body.error, /Too many emails/);
    assert.equal(over.st.emails.length, 0);
    const down = load(s.name, { roles: s.roles, limiterDown: true });
    assert.equal((await down.call(s.payload)).status, 200);
    assert.equal(down.st.emails.length, 1);
  });

  test(`${s.name} RP3.22: Resend's error text never reaches the caller`, async () => {
    const g = load(s.name, { roles: s.roles, resendStatus: 401 });
    const r = await g.call(s.payload);
    assert.equal(r.status, 502);
    assert.doesNotMatch(JSON.stringify(r.body), /re_live_SECRET|API key/);
  });
}

// ---------------------------------------------------------------- send-invite

test('send-invite RP3.9 / D23: only an account with can_manage_clients can send a portal invite', async () => {
  const roles = { [STAFF]: { can_manage_clients: true }, [TECH]: { can_manage_clients: false, can_manage_invoices: true } };
  const g = load('send-invite', { roles });
  const denied = await g.call({ client_email: 'new.client@example.com', client_name: 'New Client' }, tokenFor(TECH));
  assert.equal(denied.status, 403);
  assert.equal(g.st.emails.length, 0);
  const noRow = await g.call({ client_email: 'new.client@example.com' }, tokenFor('stranger@example.com'));
  assert.equal(noRow.status, 403);
  const ok = await g.call({ client_email: 'new.client@example.com', client_name: 'New Client' }, tokenFor(STAFF));
  assert.deepEqual(ok.body, { ok: true, was_resend: false });
  assert.equal(g.st.emails.length, 1);
  assert.equal(g.st.emails[0].to, 'new.client@example.com');
});

test('send-invite RP3.25: throttled per caller; RP3.22: Auth/Resend text is not returned', async () => {
  const roles = { [STAFF]: { can_manage_clients: true } };
  const over = load('send-invite', { roles, overLimit: true });
  const r = await over.call({ client_email: 'new.client@example.com' });
  assert.equal(r.status, 429);
  assert.equal(over.st.emails.length, 0);
  assert.deepEqual(over.st.limited[0], { p_bucket: 'staff-send:send-invite', p_key: STAFF, p_max: 60, p_window_seconds: 3600 });
  const link = load('send-invite', { roles, linkError: 'Database error saving new user: duplicate key in auth.identities' });
  const r2 = await link.call({ client_email: 'new.client@example.com' });
  assert.equal(r2.status, 502);
  assert.doesNotMatch(JSON.stringify(r2.body), /auth\.identities|Database error/);
  const mail = load('send-invite', { roles, resendStatus: 403 });
  const r3 = await mail.call({ client_email: 'new.client@example.com' });
  assert.equal(r3.status, 502);
  assert.doesNotMatch(JSON.stringify(r3.body), /re_live_SECRET/);
});

// ------------------------------------------------ send-job-confirmation-email

const job = (over = {}) => ({ id: 501, title: 'Fix fence', client: 'Pat Client', client_email: 'client@example.com', job_date: '2026-12-01', created_by: TECH, confirmation_sent_at: null, ...over });

test('send-job-confirmation-email RP3.10 / D23: the job\'s owner may send it; someone else may not, unless they can manage others\' jobs', async () => {
  const roles = { [TECH]: { can_manage_others_jobs: false }, 'other@example.com': { can_manage_others_jobs: false }, [STAFF]: { can_manage_others_jobs: true } };
  // Not theirs, no switch: 403, nothing claimed, nothing sent.
  const g = load('send-job-confirmation-email', { roles, jobs: { 501: job() } });
  const denied = await g.call({ job_id: 501 }, tokenFor('other@example.com'));
  assert.equal(denied.status, 403);
  assert.equal(g.st.jobs[501].confirmation_sent_at, null, 'not claimed');
  assert.equal(g.st.emails.length, 0);
  // The creator (no assignee) may.
  const mine = await g.call({ job_id: 501 }, tokenFor(TECH));
  assert.equal(mine.status, 200);
  assert.equal(g.st.emails.length, 1);
  // can_manage_others_jobs may, for anyone's job.
  const office = load('send-job-confirmation-email', { roles, jobs: { 501: job() } });
  assert.equal((await office.call({ job_id: 501 }, tokenFor(STAFF))).status, 200);
});

test('send-job-confirmation-email RP3.10: an assignee wins over the creator when the row carries one', async () => {
  const roles = { [TECH]: { can_manage_others_jobs: false }, 'assignee@example.com': { can_manage_others_jobs: false } };
  const g = load('send-job-confirmation-email', { roles, jobs: { 501: job({ assignee: 'Assignee@Example.com' }) } });
  assert.equal((await g.call({ job_id: 501 }, tokenFor(TECH))).status, 403, 'the creator no longer owns an assigned job');
  assert.equal((await g.call({ job_id: 501 }, tokenFor('assignee@example.com'))).status, 200);
});

test('send-job-confirmation-email RP3.10: an unreadable job fails closed (502), a missing one is the old 409', async () => {
  const roles = { [STAFF]: { can_manage_others_jobs: true } };
  const down = load('send-job-confirmation-email', { roles, jobsFail: true });
  assert.equal((await down.call({ job_id: 501 })).status, 502);
  assert.equal(down.st.emails.length, 0);
  const none = load('send-job-confirmation-email', { roles, jobs: {} });
  assert.equal((await none.call({ job_id: 999 })).status, 409);
});

test('send-job-confirmation-email RP3.25: throttled per caller, before anything is claimed', async () => {
  const roles = { [TECH]: { can_manage_others_jobs: false } };
  const g = load('send-job-confirmation-email', { roles, jobs: { 501: job() }, overLimit: true });
  const r = await g.call({ job_id: 501 }, tokenFor(TECH));
  assert.equal(r.status, 429);
  assert.equal(g.st.jobs[501].confirmation_sent_at, null);
  assert.deepEqual(g.st.limited[0], { p_bucket: 'staff-send:send-job-confirmation-email', p_key: TECH, p_max: 60, p_window_seconds: 3600 });
});

// ------------------------------------------- advisor-health, trigger-workflow

for (const [name, payload] of [['advisor-health', {}], ['trigger-workflow', { workflow: 'check-links.yml' }]]) {
  test(`${name} RP3.15: an internal account without can_access_dev_tools_full is refused, whatever its role row says`, async () => {
    const roles = {
      [TECH]: { role_name: 'Employee', can_access_dev_tools: true, can_access_dev_tools_full: false },
      'bare@example.com': { role_name: 'Owner' },
      [STAFF]: { role_name: 'Developer', can_access_dev_tools_full: true },
    };
    const g = load(name, { roles });
    for (const who of [TECH, 'bare@example.com', 'nobody@example.com']) {
      const r = await g.call(payload, tokenFor(who));
      assert.equal(r.status, 403, who);
    }
    assert.equal(g.st.calls.filter((c) => /api\.(supabase|github)\.com/.test(c.url)).length, 0, 'no upstream call for a refused caller');
    assert.match(g.st.calls.find((c) => c.url.includes('/account_roles')).url, /select=can_access_dev_tools_full/);
    const ok = await g.call(payload, tokenFor(STAFF));
    assert.equal(ok.status, 200);
  });
}

test('advisor-health RP3.22: the Management API\'s error text stays in the logs', async () => {
  const g = load('advisor-health', { roles: { [STAFF]: { can_access_dev_tools_full: true } }, mgmtStatus: 401 });
  const r = await g.call({});
  assert.equal(r.status, 502);
  assert.doesNotMatch(JSON.stringify(r.body), /sbp_SECRET/);
});

// ------------------------------------------------------- notify-*-message-email

for (const [name, table, idKey] of [
  ['notify-job-message-email', 'client_portal_job_messages', 'job_id'],
  ['notify-work-order-message-email', 'client_portal_work_order_messages', 'work_order_id'],
]) {
  const portalJob = { title: 'Leaky tap', client_email: 'client@example.com', client_name: 'Pat Client' };
  const msg = (sender_type) => ({ type: 'INSERT', table, record: { [idKey]: 7, sender_type, message: 'Hello' } });

  test(`${name} RP3.23: only sender_type 'client' emails staff; an unknown one is a 400 and emails nobody`, async () => {
    for (const bad of [null, undefined, 'Client', 'staff', '']) {
      const g = load(name, { portalJob });
      const r = await g.call(msg(bad), SRK);
      assert.equal(r.status, 400, String(bad));
      assert.equal(g.st.emails.length, 0, `${bad}: nobody emailed`);
    }
    const c = load(name, { portalJob });
    const r = await c.call(msg('client'), SRK);
    assert.deepEqual(r.body, { ok: true, sent_to: 1 });
    assert.equal(c.st.emails[0].to, 'staff@example.com');
  });

  test(`${name} RP3.26: internal -> client fails closed on a preferences error; a missing row still sends`, async () => {
    const bad = load(name, { portalJob, prefsStatus: 500 });
    const r = await bad.call(msg('internal'), SRK);
    assert.equal(r.status, 503);
    assert.equal(bad.st.emails.length, 0);
    const ok = load(name, { portalJob, prefs: [] });
    assert.deepEqual((await ok.call(msg('internal'), SRK)).body, { ok: true, sent_to: 1 });
    assert.equal(ok.st.emails[0].to, 'client@example.com');
  });
}

test('notify-work-order-scheduled-email RP3.26: fails closed on a preferences error', async () => {
  const payload = { type: 'UPDATE', table: 'client_portal_work_orders', record: { id: 3, client_email: 'client@example.com', client_name: 'Pat Client', title: 'Leaky tap', scheduled_at: '2026-12-01T16:00:00Z' } };
  const bad = load('notify-work-order-scheduled-email', { prefsStatus: 500 });
  assert.equal((await bad.call(payload, SRK)).status, 503);
  assert.equal(bad.st.emails.length, 0);
  const ok = load('notify-work-order-scheduled-email', { prefs: [] });
  assert.equal((await ok.call(payload, SRK)).status, 200);
  assert.equal(ok.st.emails.length, 1);
});
