// Real bug fix (2026-09-25): turning on two-factor from Settings forgot
// "Remember me". handleVerifyMfaEnrollSettings() in settings.html stores
// the new (aal2) session Supabase returns from the TOTP verify with
// persistSession({...}, undefined), meaning "keep whichever store the
// session already lives in". But persistSession() in auth.js was
// storeSession(sessionFields, !!rememberMe), and !!undefined is false, so
// storeSession() took its explicit rememberMe=false branch: the session
// moved from localStorage to sessionStorage, lost remember_until, and a
// "Remember me for 30 days" sign-in ended when the browser closed.
//
// These tests run the real pages (real auth.js inlined in place of its
// <script src>, since jsdom here loads no external files) against a
// stubbed Supabase fetch, then check where the session ended up:
//   1. Settings enrollment keeps a remembered session in localStorage with
//      its original remember_until, and keeps a this-session-only one in
//      sessionStorage without adding one.
//   2. login.html's explicit choice still wins: unchecked goes to
//      sessionStorage (and clears an old remembered session), checked goes
//      to localStorage with a fresh 30-day remember_until.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const AUTH_JS = read('auth.js');
const KEY = 'th_auth_session';
const DAY = 24 * 60 * 60 * 1000;

const windows = [];
after(() => windows.forEach((w) => w.close()));

// A fake Supabase: just enough of GoTrue's MFA endpoints and the recovery
// code RPCs for the enroll, challenge and verify flows.
function fakeSupabase({ enrolled = false } = {}) {
  const calls = [];
  const state = { enrolled };
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  async function fetch(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const { pathname, searchParams } = new URL(String(url));
    calls.push(`${method} ${pathname}`);
    if (pathname === '/auth/v1/token' && searchParams.get('grant_type') === 'password') {
      return reply(200, { access_token: 'aal1-token', refresh_token: 'aal1-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { email: 'steve@example.com' } });
    }
    if (pathname === '/auth/v1/user') {
      return reply(200, { email: 'steve@example.com', factors: state.enrolled ? [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }] : [] });
    }
    if (pathname === '/auth/v1/factors' && method === 'POST') {
      return reply(200, { id: 'factor-1', totp: { qr_code: '<svg></svg>', secret: 'SECRET' } });
    }
    if (pathname === '/auth/v1/factors/factor-1/challenge') return reply(200, { id: 'challenge-1' });
    if (pathname === '/auth/v1/factors/factor-1/verify') {
      state.enrolled = true;
      return reply(200, { access_token: 'aal2-token', refresh_token: 'aal2-refresh', expires_in: 3600, user: { email: 'steve@example.com' } });
    }
    if (pathname === '/rest/v1/rpc/generate_internal_recovery_codes') return reply(200, Array.from({ length: 10 }, (_, i) => `code-${i}`));
    if (pathname === '/rest/v1/rpc/count_unused_internal_recovery_codes') return reply(200, 10);
    return reply(200, []);
  }
  return { fetch, calls };
}

function openPage(file, { local = {}, session = {}, supabase, beforeParse } = {}) {
  assert.ok(!/<\/script/i.test(AUTH_JS), 'auth.js must not contain </script> to be inlined');
  const tag = /<script src="\/tools\/auth\.js\?v=[a-z0-9]+"><\/script>/;
  const html = read(file);
  assert.match(html, tag, `${file} loads auth.js`);
  const virtualConsole = new VirtualConsole(); // swallows jsdom's "navigation not implemented"
  const dom = new JSDOM(html.replace(tag, () => `<script>${AUTH_JS}</script>`), {
    url: 'https://triplehenterprisesllc.biz/tools/' + file,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(w) {
      for (const [k, v] of Object.entries(local)) w.localStorage.setItem(k, JSON.stringify(v));
      for (const [k, v] of Object.entries(session)) w.sessionStorage.setItem(k, JSON.stringify(v));
      w.fetch = supabase.fetch;
      if (beforeParse) beforeParse(w);
    },
  });
  windows.push(dom.window);
  return dom.window;
}

const stored = (store) => JSON.parse(store.getItem(KEY) || 'null');

async function until(cond, label) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('timed out waiting for ' + label);
}

// ---- 1. Settings: turning on two-factor keeps the existing store ----------

async function enrollFromSettings({ local, session }) {
  const supabase = fakeSupabase();
  const w = openPage('settings.html', {
    local, session, supabase,
    // Settings' load handler needs tools-tour.js/tools-nav-pwa.js, which
    // aren't loaded here; it fails at its first line and nothing else runs.
    beforeParse(w) { w.showInitErrorBanner = () => {}; },
  });
  await w.handleStartMfaEnrollSettings();
  assert.ok(supabase.calls.includes('POST /auth/v1/factors'), 'enrollment started');
  w.document.getElementById('mfaSettingsCodeInput').value = '123456';
  await w.handleVerifyMfaEnrollSettings();
  assert.ok(supabase.calls.includes('POST /auth/v1/factors/factor-1/verify'), 'code verified');
  assert.equal(w.document.getElementById('mfaSettingsMsg').textContent, 'Two-factor authentication is on.');
  return w;
}

const aal1 = (extra) => Object.assign({
  access_token: 'aal1-token', refresh_token: 'aal1-refresh',
  expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'steve@example.com',
}, extra);

test('Settings: turning on two-factor keeps a "Remember me" session in localStorage with its original remember_until', async () => {
  const rememberUntil = Date.now() + 12 * DAY; // signed in 18 days ago
  const w = await enrollFromSettings({ local: { [KEY]: aal1({ remember_until: rememberUntil }) } });
  const s = stored(w.localStorage);
  assert.ok(s, 'session is still in localStorage');
  assert.equal(s.access_token, 'aal2-token', 'the new aal2 session replaced the old one');
  assert.equal(s.refresh_token, 'aal2-refresh');
  assert.equal(s.remember_until, rememberUntil, 'the 30-day cap is kept, not dropped or restarted');
  assert.equal(w.sessionStorage.getItem(KEY), null, 'nothing moved to sessionStorage');
  assert.equal(w.hasValidSession(), true);
});

test('Settings: turning on two-factor keeps a this-session-only sign-in in sessionStorage, without adding remember_until', async () => {
  const w = await enrollFromSettings({ session: { [KEY]: aal1() } });
  const s = stored(w.sessionStorage);
  assert.ok(s, 'session is still in sessionStorage');
  assert.equal(s.access_token, 'aal2-token');
  assert.equal('remember_until' in s, false);
  assert.equal(w.localStorage.getItem(KEY), null, 'not promoted to localStorage');
});

// ---- 2. login.html: an explicit Remember me choice still decides ----------

async function signInWithMfa({ remember, local }) {
  const supabase = fakeSupabase({ enrolled: true });
  const w = openPage('login.html', { local, supabase });
  const doc = w.document;
  doc.getElementById('loginEmail').value = 'steve@example.com';
  doc.getElementById('loginPassword').value = 'correct horse';
  doc.getElementById('rememberMe').checked = remember;
  doc.getElementById('loginForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => doc.getElementById('mfaChallengeView').style.display === '', 'the MFA challenge step');
  assert.notEqual((stored(w.localStorage) || {}).access_token, 'aal1-token', 'nothing is stored before the code clears');
  assert.equal(w.sessionStorage.getItem(KEY), null, 'nothing is stored before the code clears');
  doc.getElementById('mfaChallengeCodeInput').value = '123456';
  doc.getElementById('mfaChallengeSubmitBtn').click();
  await until(() => (stored(w.localStorage) || stored(w.sessionStorage) || {}).access_token === 'aal2-token', 'the verified session to be stored');
  return w;
}

test('login.html: signing in with "Remember me" unchecked stores the session in sessionStorage only', async () => {
  const w = await signInWithMfa({ remember: false });
  const s = stored(w.sessionStorage);
  assert.equal(s.access_token, 'aal2-token');
  assert.equal('remember_until' in s, false);
  assert.equal(w.localStorage.getItem(KEY), null);
});

test('login.html: unchecked "Remember me" also clears an old remembered session instead of keeping its store', async () => {
  // An expired remembered session, so login.html shows the form rather
  // than redirecting straight to the Workspace.
  const old = aal1({ access_token: 'old-token', expires_at: Math.floor(Date.now() / 1000) - 60, remember_until: Date.now() + 5 * DAY });
  const w = await signInWithMfa({ remember: false, local: { [KEY]: old } });
  assert.equal(w.localStorage.getItem(KEY), null, 'the old remembered session is gone');
  const s = stored(w.sessionStorage);
  assert.equal(s.access_token, 'aal2-token');
  assert.equal('remember_until' in s, false, 'remember_until is not carried over from the old session');
});

test('login.html: signing in with "Remember me" checked stores the session in localStorage with a fresh 30-day remember_until', async () => {
  const before = Date.now();
  const w = await signInWithMfa({ remember: true });
  const s = stored(w.localStorage);
  assert.equal(s.access_token, 'aal2-token');
  assert.ok(s.remember_until >= before + 30 * DAY && s.remember_until <= Date.now() + 30 * DAY, 'remember_until is 30 days from sign-in');
  assert.equal(w.sessionStorage.getItem(KEY), null);
});
