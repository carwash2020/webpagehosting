// tools/ side of server-side two-factor enforcement (2026-09-25,
// docs/ACTION-ITEMS.md #13). The database now refuses a password-only
// (aal1) session on an internal account that has an authenticator. Two
// things in the browser had to follow:
//
//   1. Signing in with a recovery code. It used to consume the code and keep
//      the password-only session, which the server now refuses. It now calls
//      redeem_internal_recovery_code(), which removes the lost authenticator,
//      and login.html walks the person straight into setting up a new one.
//   2. A stale password-only session (signed in on another device before the
//      authenticator was added) would just see empty pages. requireAuth()
//      now asks the server once and, only if the server says this session is
//      refused, sends it back to sign in with a code.
//
// The login flow below runs the real login.html + auth.js in jsdom against a
// fake Supabase that applies the same rules the real one does: GoTrue
// refuses to enroll a second authenticator on an aal1 session, and
// generate_internal_recovery_codes() refuses an aal1 session.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const AUTH_JS = fs.readFileSync(repo('tools', 'auth.js'), 'utf8');
const LOGIN = fs.readFileSync(repo('tools', 'login.html'), 'utf8');

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (aal, extra = {}) => `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'u1', email: 'connor@triplehenterprisesllc.biz', role: 'authenticated', aal, ...extra })}.sig`;
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// ---- auth.js helpers, run for real in a sandbox ------------------------------------

function authSandbox({ stored, fetchImpl, path: pagePath = '/tools/invoice-generator.html' }) {
  const storage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  };
  const location = { pathname: pagePath, href: 'https://www.triplehenterprisesllc.biz' + pagePath, origin: 'https://www.triplehenterprisesllc.biz' };
  const calls = [];
  const sandbox = {
    localStorage: storage(), sessionStorage: storage(), atob, console,
    window: { location },
    fetch: async (url, init) => { calls.push({ url: String(url), init }); return fetchImpl(String(url), init); },
    setTimeout, Promise, JSON, Date, Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(AUTH_JS, sandbox);
  if (stored) sandbox.localStorage.setItem('th_auth_session', JSON.stringify(stored));
  return { sandbox, calls, location };
}
const fresh = (access_token) => ({ access_token, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'connor@triplehenterprisesllc.biz' });

test('accessTokenAal reads the aal claim locally and returns null for anything unreadable', () => {
  const { sandbox } = authSandbox({ fetchImpl: async () => reply({}) });
  assert.equal(sandbox.accessTokenAal(token('aal2')), 'aal2');
  assert.equal(sandbox.accessTokenAal(token('aal1')), 'aal1');
  assert.equal(sandbox.accessTokenAal('not-a-jwt'), null);
  assert.equal(sandbox.accessTokenAal(undefined), null);
});

test('a verified (aal2) session never costs a status call', async () => {
  const { sandbox, calls } = authSandbox({ stored: fresh(token('aal2')), fetchImpl: async () => reply({ blocked: true }) });
  assert.equal(await sandbox.checkInternalMfaSession(), false);
  assert.equal(calls.length, 0);
});

test('a password-only session the server refuses is cleared and sent to sign in again, keeping the page to return to', async () => {
  const { sandbox, calls, location } = authSandbox({
    stored: fresh(token('aal1')),
    fetchImpl: async () => reply({ internal: true, meets: false, blocked: true }),
  });
  assert.equal(await sandbox.checkInternalMfaSession(), true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/internal_mfa_session_status$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token('aal1')}`);
  assert.equal(sandbox.localStorage.getItem('th_auth_session'), null, 'session cleared');
  assert.equal(location.href, '/tools/login.html?reason=mfa&return=%2Ftools%2Finvoice-generator.html');
});

test('a password-only session the server still accepts (no authenticator, or the dry run) is left alone', async () => {
  for (const status of [{ internal: true, meets: true, blocked: false }, { internal: true, meets: false, blocked: false }, { internal: false }]) {
    const { sandbox, location } = authSandbox({ stored: fresh(token('aal1')), fetchImpl: async () => reply(status) });
    assert.equal(await sandbox.checkInternalMfaSession(), false);
    assert.ok(sandbox.localStorage.getItem('th_auth_session'), 'session kept');
    assert.doesNotMatch(location.href, /login\.html/);
  }
});

test('if the status check fails in any way, the page is left alone (the database is the real gate)', async () => {
  for (const fetchImpl of [async () => reply({ message: 'x' }, 500), async () => reply({ message: 'x' }, 404), async () => { throw new Error('offline'); }, async () => reply(null)]) {
    const { sandbox, location } = authSandbox({ stored: fresh(token('aal1')), fetchImpl });
    assert.equal(await sandbox.checkInternalMfaSession(), false);
    assert.ok(sandbox.localStorage.getItem('th_auth_session'));
    assert.doesNotMatch(location.href, /login\.html/);
  }
});

test('requireAuth() runs the check on both of its success paths, without awaiting it', async () => {
  const body = AUTH_JS.slice(AUTH_JS.indexOf('async function requireAuth()'), AUTH_JS.indexOf('// The `aal` claim of an access token'));
  assert.equal(body.split('checkInternalMfaSession();').length - 1, 2);
  assert.doesNotMatch(body, /await checkInternalMfaSession/);
  const { sandbox, calls } = authSandbox({ stored: fresh(token('aal1')), fetchImpl: async () => reply({ internal: true, meets: true, blocked: false }) });
  assert.equal(await sandbox.requireAuth(), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.filter((c) => c.url.includes('internal_mfa_session_status')).length, 1);
});

test('redeemRecoveryCode calls the new RPC, and falls back to the old name only when the new one is missing (404)', async () => {
  const seen = [];
  const { sandbox } = authSandbox({
    fetchImpl: async (url, init) => { seen.push([url.replace(/.*\/rpc\//, ''), JSON.parse(init.body).p_code]); return reply(true); },
  });
  const ok = await sandbox.redeemRecoveryCode('t', 'ABCD-1234');
  assert.equal(ok.valid, true);
  assert.deepEqual(seen, [['redeem_internal_recovery_code', 'ABCD-1234']]);

  seen.length = 0;
  const { sandbox: old } = authSandbox({
    fetchImpl: async (url, init) => {
      const fn = url.replace(/.*\/rpc\//, '');
      seen.push([fn, JSON.parse(init.body).p_code]);
      return fn === 'redeem_internal_recovery_code' ? reply({ code: 'PGRST202', message: 'not found' }, 404) : reply(true);
    },
  });
  assert.equal((await old.redeemRecoveryCode('t', 'ABCD-1234')).valid, true);
  assert.deepEqual(seen, [['redeem_internal_recovery_code', 'ABCD-1234'], ['verify_and_consume_internal_recovery_code', 'ABCD-1234']]);

  seen.length = 0;
  const { sandbox: denied } = authSandbox({ fetchImpl: async (url) => { seen.push(url); return reply({ message: 'permission denied' }, 403); } });
  const res = await denied.redeemRecoveryCode('t', 'x');
  assert.equal(res.ok, false);
  assert.equal(seen.length, 1, 'no fallback for a real error, only for a missing function');
});

// ---- login.html, end to end in jsdom --------------------------------------------------

function fakeSupabase({ factorVerified = true, redeemRemovesFactor = true, role = { can_manage_roles: true } } = {}) {
  const state = {
    factors: factorVerified ? [{ id: 'old-factor', factor_type: 'totp', status: 'verified' }] : [],
    codes: new Set(['ABCD-1234']),
    log: [],
  };
  const aalOf = (init) => {
    const auth = (init && init.headers && init.headers.Authorization) || '';
    try { return JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString()).aal; } catch (e) { return null; }
  };
  const hasVerified = () => state.factors.some((f) => f.status === 'verified');
  state.fetch = async (url, init = {}) => {
    const u = String(url);
    const route = u.replace('https://csvfqdjuobylgafgolho.supabase.co', '');
    state.log.push(`${init.method || 'GET'} ${route.replace(/\?.*/, '')}`);
    if (route.startsWith('/auth/v1/token?grant_type=password')) {
      return reply({ access_token: token('aal1'), refresh_token: 'r1', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { email: 'connor@triplehenterprisesllc.biz' } });
    }
    if (route === '/auth/v1/user') return reply({ email: 'connor@triplehenterprisesllc.biz', factors: state.factors });
    if (route === '/rest/v1/rpc/redeem_internal_recovery_code') {
      const code = JSON.parse(init.body).p_code;
      if (!state.codes.delete(code)) return reply(false);
      if (redeemRemovesFactor) state.factors = [];
      return reply(true);
    }
    if (route.startsWith('/rest/v1/account_roles')) return reply([{ email: 'connor@triplehenterprisesllc.biz', role_name: 'Developer', ...role }]);
    if (route === '/auth/v1/factors' && init.method === 'POST') {
      // GoTrue: a second authenticator needs an aal2 session.
      if (hasVerified() && aalOf(init) !== 'aal2') return reply({ msg: 'AAL2 required to enroll a new factor' }, 403);
      state.factors.push({ id: 'new-factor', factor_type: 'totp', status: 'unverified' });
      return reply({ id: 'new-factor', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'NEWSECRET' } });
    }
    if (route === '/auth/v1/factors/new-factor/challenge') return reply({ id: 'challenge-1' });
    if (route === '/auth/v1/factors/new-factor/verify') {
      state.factors.find((f) => f.id === 'new-factor').status = 'verified';
      return reply({ access_token: token('aal2'), refresh_token: 'r2', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { email: 'connor@triplehenterprisesllc.biz' } });
    }
    if (route === '/rest/v1/rpc/generate_internal_recovery_codes') {
      if (aalOf(init) !== 'aal2') return reply({ message: 'Sign out, then sign back in with your authenticator code before generating new recovery codes.' }, 403);
      return reply(['NEW1-AAAA', 'NEW2-BBBB']);
    }
    return reply({ message: `unexpected ${route}` }, 500);
  };
  return state;
}

function loadLogin(backend, url = 'https://www.triplehenterprisesllc.biz/tools/login.html') {
  const html = LOGIN
    .replace(/<script src="\/tools\/auth\.js\?v=[^"]*"><\/script>/, () => '<script>' + AUTH_JS + '</script>')
    .replace(/<script src="\/tools\/tools-[a-z-]+\.js\?v=[^"]*" defer><\/script>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url,
    beforeParse(w) { w.fetch = backend.fetch; },
  });
  const w = dom.window;
  w.__redirects = 0;
  w.redirectAfterLogin = () => { w.__redirects++; };
  return w;
}
const visible = (w, id) => w.document.getElementById(id).style.display !== 'none';
async function until(check, what) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for: ${what}`);
}
async function signInAndOfferRecovery(w) {
  w.document.getElementById('loginEmail').value = 'connor@triplehenterprisesllc.biz';
  w.document.getElementById('loginPassword').value = 'correct horse';
  w.document.getElementById('loginForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => visible(w, 'mfaChallengeView'), 'the code prompt');
  w.document.getElementById('mfaUseRecoveryCodeLink').click();
  assert.ok(visible(w, 'mfaRecoveryCodeInput'));
}
const storedSession = (w) => JSON.parse(w.localStorage.getItem('th_auth_session') || 'null');

test('login.html: a lost-phone recovery redeems the code, sets up a new authenticator, and only then stores a verified session', async () => {
  const backend = fakeSupabase();
  const w = loadLogin(backend);
  await signInAndOfferRecovery(w);
  assert.equal(storedSession(w), null, 'nothing stored after the password alone');

  w.document.getElementById('mfaRecoveryCodeInput').value = 'ABCD-1234';
  w.document.getElementById('mfaChallengeSubmitBtn').click();
  await until(() => visible(w, 'mfaEnrollView'), 'the new-authenticator step');
  assert.equal(w.document.getElementById('mfaEnrollTitle').textContent, 'Set up a new authenticator');
  assert.match(w.document.getElementById('mfaEnrollSub').textContent, /Recovery code accepted\. Your old authenticator was removed and your other devices were signed out\./);
  assert.equal(storedSession(w), null, 'still nothing stored: the new authenticator comes first');
  assert.equal(w.__redirects, 0);

  w.document.getElementById('mfaEnrollCodeInput').value = '123456';
  w.document.getElementById('mfaEnrollVerifyBtn').click();
  await until(() => visible(w, 'mfaRecoveryCodesView'), 'the new recovery codes');
  assert.match(w.document.getElementById('mfaRecoveryCodesList').textContent, /NEW1-AAAA/);

  w.document.getElementById('mfaRecoveryCodesContinueBtn').click();
  assert.equal(w.__redirects, 1);
  const s = storedSession(w);
  assert.equal(s.access_token, token('aal2'), 'the stored session is the verified one, which the server accepts');
  assert.ok(backend.log.includes('POST /rest/v1/rpc/redeem_internal_recovery_code'));
  assert.ok(!backend.log.some((l) => l.includes('verify_and_consume')), 'the new RPC was there, so no fallback');
});

test('login.html: a wrong recovery code shows an error and stores nothing', async () => {
  const w = loadLogin(fakeSupabase());
  await signInAndOfferRecovery(w);
  w.document.getElementById('mfaRecoveryCodeInput').value = 'WRNG-0000';
  w.document.getElementById('mfaChallengeSubmitBtn').click();
  await until(() => w.document.getElementById('mfaChallengeError').textContent, 'an error');
  assert.equal(w.document.getElementById('mfaChallengeError').textContent, 'That recovery code is invalid or already used.');
  assert.equal(storedSession(w), null);
  assert.equal(w.__redirects, 0);
  assert.ok(visible(w, 'mfaChallengeView'));
});

test('login.html: an account whose permissions do not require two-factor goes straight in after a recovery code', async () => {
  const backend = fakeSupabase({ role: { can_manage_roles: false } });
  const w = loadLogin(backend);
  await signInAndOfferRecovery(w);
  w.document.getElementById('mfaRecoveryCodeInput').value = 'ABCD-1234';
  w.document.getElementById('mfaChallengeSubmitBtn').click();
  await until(() => w.__redirects === 1, 'the redirect');
  assert.equal(storedSession(w).access_token, token('aal1'), 'no authenticator left, so the server accepts this session');
  assert.ok(!visible(w, 'mfaEnrollView'));
});

test('login.html: if the database is rolled back to consume-only codes (authenticator kept), recovery signs in exactly as before', async () => {
  const backend = fakeSupabase({ redeemRemovesFactor: false });
  const w = loadLogin(backend);
  await signInAndOfferRecovery(w);
  w.document.getElementById('mfaRecoveryCodeInput').value = 'ABCD-1234';
  w.document.getElementById('mfaChallengeSubmitBtn').click();
  await until(() => w.__redirects === 1, 'the redirect');
  assert.ok(!visible(w, 'mfaEnrollView'), 'no attempt to enroll a second authenticator (GoTrue would refuse it)');
  assert.ok(!backend.log.includes('POST /auth/v1/factors'));
  assert.equal(storedSession(w).access_token, token('aal1'));
});

test('login.html: a normal first-time mandatory enrollment keeps its original wording', async () => {
  const backend = fakeSupabase({ factorVerified: false });
  const w = loadLogin(backend);
  w.document.getElementById('loginEmail').value = 'connor@triplehenterprisesllc.biz';
  w.document.getElementById('loginPassword').value = 'correct horse';
  w.document.getElementById('loginForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => visible(w, 'mfaEnrollView'), 'the enrollment step');
  assert.equal(w.document.getElementById('mfaEnrollTitle').textContent, 'Set up two-factor authentication');
  assert.match(w.document.getElementById('mfaEnrollSub').textContent, /^Your account requires two-factor authentication/);
});

test('login.html: arriving from a refused session explains why, and a normal visit does not', () => {
  const sent = loadLogin(fakeSupabase(), 'https://www.triplehenterprisesllc.biz/tools/login.html?reason=mfa&return=%2Ftools%2Fjobs.html');
  assert.equal(sent.document.querySelector('.login-sub').textContent, 'For your security, sign in again with your authenticator code.');
  const normal = loadLogin(fakeSupabase());
  assert.equal(normal.document.querySelector('.login-sub').textContent, 'Sign in to continue.');
});
