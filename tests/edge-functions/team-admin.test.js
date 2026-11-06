// team-admin (Phase 4, 2026-11-04): runs the real handler with stubbed
// database, Auth admin and Resend. No real email is sent and no real
// account is touched. Proves:
//   - only a signed-in internal account past the 2FA gate gets in;
//   - every permission change is an RPC made AS THE CALLER (their JWT, not
//     the service role), so the database's own checks decide;
//   - invite: row first, then a set-password link to /tools/reset-password,
//     then the email; a failure after the row says Resend;
//   - deactivate: row moved first, then the sign-in ban; reactivate: unban,
//     then the row back (and re-ban if the database refuses);
//   - revoke deletes the unused login only after the database agreed;
//   - resend and reactivate check the caller can manage the team.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const SRC = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'team-admin-index.ts'), 'utf8'));
const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const jwt = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';

const MANAGER = 'owner@example.com';
const TECH = 'tech@example.com';
const MANAGER_TOKEN = jwt({ role: 'authenticated', email: MANAGER, sub: 'u-owner', aal: 'aal2' });

function load(seed = {}) {
  const st = {
    staff: seed.staff || { [MANAGER]: { can_manage_roles: true }, [TECH]: { can_manage_roles: false } },
    pending: seed.pending || {},
    users: seed.users || {},
    mfa: seed.mfa !== undefined ? seed.mfa : true,
    rpcErrors: seed.rpcErrors || {},
    linkOk: seed.linkOk !== undefined ? seed.linkOk : true,
    emailOk: seed.emailOk !== undefined ? seed.emailOk : true,
    banOk: seed.banOk !== undefined ? seed.banOk : true,
    archived: seed.archived || [],
    log: [], emails: [], links: [],
  };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const auth = (init.headers || {}).Authorization || '';
    const q = (k) => decodeURIComponent((u.match(new RegExp(`${k}=eq\\.([^&]+)`)) || [])[1] || '');
    if (u.includes('/rest/v1/account_roles_deactivated')) return j((st.archived || []).includes(q('email')) ? [{ email: q('email') }] : []);
    if (u.includes('/rest/v1/account_roles')) {
      assert.equal(auth, 'Bearer srk', 'reads of account_roles use the service role');
      const e = q('email');
      if (u.includes('invited_at=not.is.null')) return j(st.pending[e] ? [st.pending[e]] : []);
      if (u.includes('select=can_manage_roles')) return j(st.staff[e] ? [st.staff[e]] : []);
      if (u.includes('select=display_name')) return j(st.staff[e] ? [{ display_name: st.staff[e].display_name || null }] : []);
      return j(st.staff[e] ? [{ email: e }] : []);
    }
    if (u.endsWith('/rest/v1/rpc/check_internal_mfa_for_edge_function')) return j(st.mfa);
    if (u.endsWith('/rest/v1/rpc/get_auth_user_id_by_email')) return j(st.users[body.p_email] || null);
    const rpc = u.match(/\/rest\/v1\/rpc\/(team_\w+)$/);
    if (rpc) {
      st.log.push(['rpc', rpc[1], auth, body]);
      assert.notEqual(auth, 'Bearer srk', 'team RPCs are made as the caller, never the service role');
      assert.equal(init.headers.apikey, 'anon', 'with the anon key');
      const err = st.rpcErrors[rpc[1]];
      return err ? j({ message: err }, 400) : j(null);
    }
    if (u.endsWith('/auth/v1/admin/generate_link')) {
      st.links.push(body);
      return st.linkOk ? j({ action_link: 'https://example.supabase.co/verify?t=abc' }) : j({ msg: 'no' }, 500);
    }
    if (u.includes('/auth/v1/admin/users/')) {
      st.log.push(['admin', method, u.split('/admin/users/')[1], body]);
      if (method === 'PUT') return st.banOk ? j({}) : j({}, 500);
      return j({});
    }
    if (u === 'https://api.resend.com/emails') { st.emails.push(body); return st.emailOk ? j({ id: 'e' }) : j({}, 500); }
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
  let handler;
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk', SUPABASE_ANON_KEY: 'anon', RESEND_API_KEY: 're', LEAD_EMAIL_FROM: 'team@example.com' };
  vm.runInContext(SRC, vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch, Response, Request, Headers, URL, URLSearchParams, atob, console: { log() {}, error() {} },
    JSON, Math, Date, Promise, Number, String, Array, Object, encodeURIComponent, decodeURIComponent,
  }));
  const call = async (body, token = MANAGER_TOKEN) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/team-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  };
  return { call, st };
}

test('only a signed-in internal account past the 2FA gate gets in', async () => {
  const g = load();
  assert.equal((await g.call({ action: 'invite', email: 'a@example.com' }, jwt({ role: 'anon' }))).status, 401);
  assert.equal((await g.call({ action: 'invite', email: 'a@example.com' }, jwt({ role: 'authenticated', email: 'client@example.com' }))).status, 403);
  const noMfa = load({ mfa: false });
  const r = await noMfa.call({ action: 'invite', email: 'a@example.com' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'mfa_required');
  assert.equal(g.st.log.length + noMfa.st.log.length, 0, 'nothing was changed');
});

test('invite: the database adds them first (as the caller), then a set-password link to the Workspace, then the email', async () => {
  const g = load();
  const r = await g.call({ action: 'invite', email: ' New@Example.com ', name: 'New Person' });
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(g.st.log[0], ['rpc', 'team_add_invited', 'Bearer ' + MANAGER_TOKEN, { p_email: 'new@example.com', p_name: 'New Person' }]);
  assert.deepEqual(g.st.links, [{ type: 'invite', email: 'new@example.com', redirect_to: 'https://www.triplehenterprisesllc.biz/tools/reset-password.html' }]);
  assert.equal(g.st.emails.length, 1);
  assert.equal(g.st.emails[0].to, 'new@example.com');
  assert.equal(g.st.emails[0].subject, "You're invited to the Triple H Workspace");
  assert.match(g.st.emails[0].html, /Hi New, Owner added you to the team\./, 'the inviter by name, never their email (fix plan FP1)');
  assert.match(g.st.emails[0].html, /href="https:\/\/example\.supabase\.co\/verify\?t=abc"/);
});

test('invite: an address that already has a login gets a set-password (recovery) link; the database refusing stops everything', async () => {
  const g = load({ users: { 'old@example.com': 'u-old' } });
  await g.call({ action: 'invite', email: 'old@example.com', name: 'Old' });
  assert.equal(g.st.links[0].type, 'recovery');

  const no = load({ rpcErrors: { team_add_invited: "Not allowed: you can't manage the team." } });
  const r = await no.call({ action: 'invite', email: 'x@example.com' }, jwt({ role: 'authenticated', email: TECH }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /can't manage the team/);
  assert.equal(no.st.links.length + no.st.emails.length, 0);
});

test('invite: if the link or the email fails after the row is made, it says they are pending and to use Resend', async () => {
  for (const seed of [{ linkOk: false }, { emailOk: false }]) {
    const g = load(seed);
    const r = await g.call({ action: 'invite', email: 'new@example.com', name: 'N' });
    assert.equal(r.status, 502);
    assert.equal(r.body.invited, true);
    assert.match(r.body.error, /Invite pending.*Use Resend/);
  }
});

test('resend: only a team manager, only for a pending invite; a fresh recovery link by email', async () => {
  const g = load({ pending: { 'p@example.com': { display_name: 'Pat Doe' } }, users: { 'p@example.com': 'u-p' } });
  assert.equal((await g.call({ action: 'resend', email: 'p@example.com' }, jwt({ role: 'authenticated', email: TECH }))).status, 403);
  assert.equal((await g.call({ action: 'resend', email: 'nobody@example.com' })).status, 404);
  const r = await g.call({ action: 'resend', email: 'p@example.com' });
  assert.deepEqual(r.body, { ok: true });
  assert.equal(g.st.links.at(-1).type, 'recovery');
  assert.equal(g.st.emails.at(-1).subject, 'Your Triple H Workspace link');
  assert.match(g.st.emails.at(-1).html, /Hi Pat,/);
});

test('revoke: the database decides first; the unused login is deleted only after it agreed', async () => {
  const g = load({ users: { 'p@example.com': 'u-p' } });
  const r = await g.call({ action: 'revoke', email: 'p@example.com' });
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(g.st.log.map((x) => x.slice(0, 3)), [['rpc', 'team_revoke_invite', 'Bearer ' + MANAGER_TOKEN], ['admin', 'DELETE', 'u-p']]);
  const no = load({ users: { 'p@example.com': 'u-p' }, rpcErrors: { team_revoke_invite: 'They have already signed in. Deactivate them instead.' } });
  const r2 = await no.call({ action: 'revoke', email: 'p@example.com' });
  assert.equal(r2.status, 400);
  assert.match(r2.body.error, /already signed in/);
  assert.deepEqual(no.st.log.map((x) => x[0]), ['rpc'], 'no login deleted');
});

test('deactivate: the row moves first (as the caller), then the sign-in ban; the database refusing (self, last admin) stops it', async () => {
  const g = load({ users: { [TECH]: 'u-tech' } });
  const r = await g.call({ action: 'deactivate', email: TECH });
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(g.st.log.map((x) => x.slice(0, 3)), [['rpc', 'team_deactivate', 'Bearer ' + MANAGER_TOKEN], ['admin', 'PUT', 'u-tech']]);
  assert.deepEqual(g.st.log[1][3], { ban_duration: '876000h' });

  const no = load({ users: { [MANAGER]: 'u-owner' }, rpcErrors: { team_deactivate: "You can't deactivate yourself." } });
  const r2 = await no.call({ action: 'deactivate', email: MANAGER });
  assert.equal(r2.status, 400);
  assert.equal(r2.body.error, "You can't deactivate yourself.");
  assert.equal(no.st.log.filter((x) => x[0] === 'admin').length, 0, 'no ban when the database refused');

  const banFail = load({ users: { [TECH]: 'u-tech' }, banOk: false });
  const r3 = await banFail.call({ action: 'deactivate', email: TECH });
  assert.equal(r3.status, 502);
  assert.equal(r3.body.deactivated, true, 'access already stopped; says so and to try again');

  // The retry: the database says they're no longer active (already moved),
  // and the archive has them, so it goes straight to the sign-in block.
  const retry = load({ users: { [TECH]: 'u-tech' }, archived: [TECH], rpcErrors: { team_deactivate: 'No active account with that email.' } });
  const r4 = await retry.call({ action: 'deactivate', email: TECH });
  assert.deepEqual(r4.body, { ok: true });
  assert.deepEqual(retry.st.log.map((x) => x.slice(0, 3)), [['rpc', 'team_deactivate', 'Bearer ' + MANAGER_TOKEN], ['admin', 'PUT', 'u-tech']]);
  // ...but not for someone who can't manage the team, and not for someone never deactivated.
  const notMgr = load({ users: { [TECH]: 'u-tech' }, archived: [TECH], rpcErrors: { team_deactivate: "Not allowed: you can't manage the team." } });
  assert.equal((await notMgr.call({ action: 'deactivate', email: TECH }, jwt({ role: 'authenticated', email: TECH }))).status, 400);
  assert.equal(notMgr.st.log.filter((x) => x[0] === 'admin').length, 0);
  const never = load({ users: { 'x@example.com': 'u-x' }, rpcErrors: { team_deactivate: 'No active account with that email.' } });
  assert.equal((await never.call({ action: 'deactivate', email: 'x@example.com' })).status, 400);
  assert.equal(never.st.log.filter((x) => x[0] === 'admin').length, 0);
});

test('reactivate: a team manager only; unban, then the row back; re-banned if the database refuses', async () => {
  const g = load({ users: { [TECH]: 'u-tech' } });
  assert.equal((await g.call({ action: 'reactivate', email: TECH }, jwt({ role: 'authenticated', email: TECH }))).status, 403);
  const r = await g.call({ action: 'reactivate', email: TECH });
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(g.st.log.map((x) => x.slice(0, 3)), [['admin', 'PUT', 'u-tech'], ['rpc', 'team_reactivate', 'Bearer ' + MANAGER_TOKEN]]);
  assert.deepEqual(g.st.log[0][3], { ban_duration: 'none' });

  const no = load({ users: { [TECH]: 'u-tech' }, rpcErrors: { team_reactivate: 'No deactivated account with that email.' } });
  const r2 = await no.call({ action: 'reactivate', email: TECH });
  assert.equal(r2.status, 400);
  assert.deepEqual(no.st.log.filter((x) => x[0] === 'admin').map((x) => x[3]), [{ ban_duration: 'none' }, { ban_duration: '876000h' }], 'back to banned');
});

test('bad input and unknown actions are refused before anything changes; the email escapes the name', async () => {
  const g = load();
  assert.equal((await g.call({ action: 'invite', email: 'not-an-email' })).status, 400);
  assert.equal((await g.call({ action: 'explode', email: 'a@example.com' })).status, 400);
  assert.equal(g.st.log.length, 0);
  await g.call({ action: 'invite', email: 'x@example.com', name: '<img src=x onerror=alert(1)> Bob' });
  assert.doesNotMatch(g.st.emails[0].html, /<img/);
});

test('the invite link lands on the Workspace set-password page, which accepts type=invite with first-time wording (and still type=recovery)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'reset-password.html'), 'utf8');
  assert.match(page, /const isInvite = tokenType === 'invite';\n  if \(!recoveryToken \|\| \(tokenType !== 'recovery' && !isInvite\)\) \{/);
  assert.match(page, /isInvite \? 'Set Your Password' : 'Set a New Password'/);
  assert.match(page, /Choose a password to finish joining the Triple H Workspace\./);
});

// Fix plan FP1 follow-up (2026-11-06, Connor: "fix the invite email"): the
// email names the person who sent it by their name, never their email.
test('the invite email names the inviter by their Team name; with no name saved, the email prefix capitalized -- never the address', async () => {
  const named = load({ staff: { [MANAGER]: { can_manage_roles: true, display_name: 'Pat Owner' } } });
  await named.call({ action: 'invite', email: 'new@example.com', name: 'New Person' });
  const e = named.st.emails[0];
  assert.match(e.html, /Hi New, Pat Owner added you to the team\./);
  assert.match(e.text, /Pat Owner added you to the Triple H Workspace team\./);
  assert.doesNotMatch(e.html + e.text, /owner@example\.com/);

  const unnamed = load();
  await unnamed.call({ action: 'invite', email: 'new@example.com', name: 'New Person' });
  assert.match(unnamed.st.emails[0].html, /Owner added you to the team\./);
  assert.doesNotMatch(unnamed.st.emails[0].html + unnamed.st.emails[0].text, /owner@example\.com/);

  const escaped = load({ staff: { [MANAGER]: { can_manage_roles: true, display_name: '<b>Pat</b>' } } });
  await escaped.call({ action: 'invite', email: 'new@example.com', name: 'New' });
  assert.match(escaped.st.emails[0].html, /&lt;b&gt;Pat&lt;\/b&gt; added you/);
});
