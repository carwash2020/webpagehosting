// Shared jsdom harness for the one sign-in page, portal/login.html (fix plan
// FP4.1, 2026-11-06). Loads the real page with the real auth.js,
// portal-app.js, trusted-device.js and signin-ui.js; supabase-js and the
// network are faked. Two fake clients, as on the real page: the in-memory
// one the password is checked on (persistSession: false) and the portal's
// own. Made-up accounts only.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const LOGIN = read('portal', 'login.html');
const inline = (src) => () => '<script>' + src + '</script>';

const windows = [];
function closeAll() { for (const w of windows.splice(0)) { try { w.close(); } catch (e) { /* closed */ } } }

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => 'h.' + b64(claims) + '.s';
const SESSION = (email, aal = 'aal1') => ({
  access_token: jwt({ sub: 'u-' + email, email, aal, role: 'authenticated' }),
  refresh_token: 'r-' + email, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u-' + email, email },
});

function open(url, { kind = 'client', kindError = false, factor = null, role = null, codeOk = true, workspaceSession = null, portalSession = null } = {}) {
  const calls = { memSignIn: [], setSession: [], portalSignOut: 0, logout: 0, recover: [], verify: 0, rpc: [] };
  const memory = {
    auth: {
      signInWithPassword: async (a) => { calls.memSignIn.push(a); return a.password === 'right-password' ? { data: { session: SESSION(a.email) }, error: null } : { data: {}, error: { message: 'Invalid login credentials', status: 400 } }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async (name) => { calls.rpc.push(name); return kindError ? { data: null, error: { message: 'boom' } } : { data: kind, error: null }; },
  };
  let portalSessionNow = portalSession;
  const portal = {
    auth: {
      getSession: async () => ({ data: { session: portalSessionNow } }),
      setSession: async (t) => { calls.setSession.push(t); portalSessionNow = { ...t, user: { email: 'x' } }; return { data: { session: portalSessionNow }, error: null }; },
      signInWithPassword: async () => ({ data: {}, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }), listFactors: async () => ({ data: { totp: [] } }) },
      signOut: async () => { calls.portalSignOut++; portalSessionNow = null; return { error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    rpc: async (name) => ({ data: name === 'signin_account_kind' ? kind : null, error: null }),
  };
  const html = LOGIN
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]*"[^>]*><\/script>/, '<script>window.supabase = { createClient: (u, k, o) => (o && o.auth && o.auth.persistSession === false ? window.__memory : window.__portal) };</script>')
    .replace(/<script src="\/tools\/auth\.js\?v=[^"]*"><\/script>/, inline(read('tools', 'auth.js')))
    .replace(/<script src="\/portal\/portal-app\.js\?v=[^"]*"><\/script>/, inline(read('portal', 'portal-app.js')))
    .replace(/<script src="\/trusted-device\.js\?v=[^"]*"><\/script>/, inline(read('trusted-device.js')))
    .replace(/<script src="\/signin-ui\.js\?v=[^"]*"><\/script>/, inline(read('signin-ui.js')));
  const done = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url,
    beforeParse(w) {
      w.__memory = memory;
      w.__portal = portal;
      w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
      if (workspaceSession) w.localStorage.setItem('th_auth_session', JSON.stringify(workspaceSession));
      w.fetch = async (u, init = {}) => {
        const s = String(u);
        const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b });
        if (s.endsWith('/auth/v1/user')) return json({ factors: factor ? [{ id: 'f1', factor_type: 'totp', status: 'verified' }] : [] });
        if (s.includes('/rest/v1/account_roles')) return json(role ? [role] : []);
        if (s.includes('/auth/v1/factors/f1/challenge')) return json({ id: 'ch1' });
        if (s.includes('/auth/v1/factors/f1/verify')) { calls.verify++; return codeOk ? json({ ...SESSION('staff@example.com', 'aal2'), access_token: jwt({ sub: 'u-staff', email: 'staff@example.com', aal: 'aal2' }) }) : json({ msg: 'Invalid TOTP code entered' }, 422); }
        if (s.includes('/rest/v1/rpc/use_trusted_device')) return json(false);
        if (s.includes('/rest/v1/rpc/')) return json(null);
        if (s.includes('/auth/v1/logout')) { calls.logout++; return json({}); }
        if (s.includes('/auth/v1/recover')) { calls.recover.push(decodeURIComponent(s)); return json({}); }
        return json({});
      };
    },
  });
  windows.push(dom.window);
  const w = dom.window;
  w.ThSignin.success = (fn) => { done.push(fn); };
  return { w, d: w.document, calls, done };
}
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(check, what) {
  for (let i = 0; i < 300; i++) { if (check()) return; await settle(5); }
  assert.fail('timed out: ' + what);
}
async function signIn(g, email, password = 'right-password', remember = false) {
  await settle();
  g.d.getElementById('clientEmail').value = email;
  g.d.getElementById('clientPassword').value = password;
  g.d.getElementById('rememberMe').checked = remember;
  g.d.getElementById('loginForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
}
const stored = (w) => w.localStorage.getItem('th_auth_session') || w.sessionStorage.getItem('th_auth_session');
const URL_ = 'https://www.triplehenterprisesllc.biz/portal/login.html';

// The page on a test's own fake GoTrue/PostgREST `fetch` (the Workspace
// two-factor tests): the in-memory client's password check is the real
// POST /auth/v1/token on that backend, so its routes and logs stay the test's.
// `kind` is what signin_account_kind() answers. Success counts in __redirects.
function openOnBackend(fetchImpl, { url = URL_, kind = 'staff', beforeParse } = {}) {
  const BASE = 'https://csvfqdjuobylgafgolho.supabase.co';
  const memory = {
    auth: {
      signInWithPassword: async ({ email, password }) => {
        let res;
        try {
          res = await fetchImpl(BASE + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        } catch (e) {
          return { data: { session: null, user: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } };
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { data: { session: null, user: null }, error: { name: 'AuthApiError', status: res.status, message: body.error_description || body.msg || 'error' } };
        return { data: { session: body, user: body.user }, error: null };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async (name) => ({ data: name === 'signin_account_kind' ? kind : null, error: null }),
  };
  const portal = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      setSession: async () => ({ data: { session: null }, error: { message: 'not in these tests' } }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }), listFactors: async () => ({ data: { totp: [] } }) },
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    rpc: async () => ({ data: null, error: null }),
  };
  const html = LOGIN
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]*"[^>]*><\/script>/, '<script>window.supabase = { createClient: (u, k, o) => (o && o.auth && o.auth.persistSession === false ? window.__memory : window.__portal) };</script>')
    .replace(/<script src="\/tools\/auth\.js\?v=[^"]*"><\/script>/, inline(read('tools', 'auth.js')))
    .replace(/<script src="\/portal\/portal-app\.js\?v=[^"]*"><\/script>/, inline(read('portal', 'portal-app.js')))
    .replace(/<script src="\/trusted-device\.js\?v=[^"]*"><\/script>/, inline(read('trusted-device.js')))
    .replace(/<script src="\/signin-ui\.js\?v=[^"]*"><\/script>/, inline(read('signin-ui.js')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url,
    beforeParse(w) {
      w.__memory = memory;
      w.__portal = portal;
      w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
      w.fetch = fetchImpl;
      if (beforeParse) beforeParse(w);
    },
  });
  windows.push(dom.window);
  const w = dom.window;
  w.__redirects = 0;
  w.ThSignin.success = () => { w.__redirects++; };
  return w;
}

module.exports = { openOnBackend, open, signIn, until, settle, stored, SESSION, jwt, b64, read, URL_, closeAll, LOGIN };
