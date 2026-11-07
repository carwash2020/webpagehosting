// Fix plan RP3.34 / D31 (2026-11-07): a Workspace session remembered before
// the 30-day cap (localStorage th_auth_session with no remember_until) is
// cleared ONCE per device and the person signs in again; a one-time flag
// means it never repeats. Sessions with remember_until, and sessionStorage
// sessions, are untouched. Runs the real tools/auth.js in a sandbox, plus
// the notice on portal/login.html. Made-up accounts only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const AUTH_JS = fs.readFileSync(repo('tools', 'auth.js'), 'utf8');
const KEY = 'th_auth_session';
const FLAG = 'th_auth_uncapped_session_retired';

function sandbox({ local = {}, session = {} } = {}) {
  const storage = (seed) => {
    const m = new Map(Object.entries(seed));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  };
  const sb = { localStorage: storage(local), sessionStorage: storage(session), atob, console, window: { location: { pathname: '/tools/workspace.html' } }, fetch: async () => ({ ok: true, json: async () => ({}) }), setTimeout, Promise, JSON, Date, Math };
  vm.createContext(sb);
  vm.runInContext(AUTH_JS, sb);
  return sb;
}
const s = (extra) => JSON.stringify(Object.assign({ access_token: 'tok', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'sam@example.com' }, extra));

test('a pre-cap remembered session is cleared once, with the sign-in-again notice', () => {
  const sb = sandbox({ local: { [KEY]: s() } });
  assert.equal(sb.hasValidSession(), false, 'signed out');
  assert.equal(sb.localStorage.getItem(KEY), null);
  assert.equal(sb.localStorage.getItem(FLAG), '1');
  assert.equal(sb.sessionStorage.getItem('th_signin_again_notice'), '1');
});

test('it never repeats: with the flag set, an uncapped session is left as it is', () => {
  const sb = sandbox({ local: { [KEY]: s(), [FLAG]: '1' } });
  assert.equal(sb.hasValidSession(), true);
  assert.ok(sb.localStorage.getItem(KEY));
  assert.equal(sb.sessionStorage.getItem('th_signin_again_notice'), null);
});

test('untouched: a session with remember_until, and a sessionStorage session', () => {
  const capped = sandbox({ local: { [KEY]: s({ remember_until: Date.now() + 86400000 }) } });
  assert.equal(capped.hasValidSession(), true);
  assert.equal(capped.localStorage.getItem(FLAG), '1', 'the check ran');
  assert.equal(capped.sessionStorage.getItem('th_signin_again_notice'), null);
  const tab = sandbox({ session: { [KEY]: s() } });
  assert.equal(tab.hasValidSession(), true);
  assert.ok(tab.sessionStorage.getItem(KEY));
  assert.equal(tab.sessionStorage.getItem('th_signin_again_notice'), null);
});

test('a new sign-in after the check is stored normally (Remember me on = remember_until)', () => {
  const sb = sandbox({ local: { [KEY]: s() } });
  sb.getStoredSession();
  sb.persistSession({ access_token: 'new', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'sam@example.com' }, true);
  const stored = JSON.parse(sb.localStorage.getItem(KEY));
  assert.equal(stored.access_token, 'new');
  assert.ok(stored.remember_until > Date.now());
  assert.equal(sb.hasValidSession(), true);
});

// ---- portal/login.html says why, once ----

const SIGNIN = require('../signin-harness');
after(SIGNIN.closeAll);

test('login.html: after a pre-cap Workspace session is cleared, the page says to sign in again (once)', async () => {
  const g = SIGNIN.open(SIGNIN.URL_, { workspaceSession: JSON.parse(s()) });
  await SIGNIN.settle();
  const note = g.d.getElementById('loginSuccess');
  assert.equal(note.style.display, 'block');
  assert.equal(note.textContent, 'For your security, please sign in again. You only need to do this once on this device.');
  assert.equal(g.w.localStorage.getItem(KEY), null);
  assert.equal(g.d.getElementById('signedInView').style.display, 'none', 'not shown as signed in');
  assert.equal(g.w.sessionStorage.getItem('th_signin_again_notice'), null, 'shown once');
});

test('login.html: a current remembered Workspace session shows no notice', async () => {
  const g = SIGNIN.open(SIGNIN.URL_, { workspaceSession: JSON.parse(s({ remember_until: Date.now() + 86400000 })) });
  await SIGNIN.until(() => g.d.getElementById('signedInView').style.display === 'flex', 'signed-in card');
  assert.equal(g.d.getElementById('loginSuccess').style.display, 'none');
});
