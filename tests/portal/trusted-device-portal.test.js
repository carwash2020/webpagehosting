// Trusted devices on the client portal (2026-11-01): "trusted device skips
// 2FA for 30 days." Runs the real portal/login.html, settings.html and
// set-password.html with the real portal-app.js and the shared
// /trusted-device.js in jsdom, on a stand-in supabase-js client whose
// trusted-device RPCs follow sql/security/add_trusted_devices.sql (proved
// against real Postgres in tests/security/trusted-devices-db.test.js). The
// Workspace equivalents are in tests/tools/trusted-device-login.test.js.

const { test, after } = require('node:test');
const windows = [];
after(() => { for (const w of windows) { try { w.close(); } catch (e) { /* already closed */ } } });
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const APP = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const TRUSTED_JS = fs.readFileSync(repo('trusted-device.js'), 'utf8');
const UI_JS = fs.readFileSync(repo('signin-ui.js'), 'utf8');
const LOGIN = fs.readFileSync(repo('portal', 'login.html'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
const SET_PASSWORD = fs.readFileSync(repo('portal', 'set-password.html'), 'utf8');

const EMAIL = 'sarah@example.com';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const DEVICE_KEY = `th_trusted_device:${USER_ID}`;
const STEP_KEY = `th_portal_second_step_${EMAIL}`;

// The server: devices (id -> { token, revoked, expired, label }), the
// sessions use_trusted_device() recorded as trusted, and the current session.
function server({ devices = {}, factor = true, rpcMissing = false } = {}) {
  return { devices, factor, rpcMissing, trustedSessions: new Set(), calls: [], session: null, sessionSeq: 0 };
}

function stubClient(srv) {
  const sessionObj = () => (srv.session ? { access_token: 'at-' + srv.session.id, user: { id: USER_ID, email: EMAIL } } : null);
  const RPCS = {
    use_trusted_device: (a) => {
      const d = srv.devices[a.p_device_id];
      const ok = !!d && !d.revoked && !d.expired && d.token === a.p_token;
      if (ok) srv.trustedSessions.add(srv.session.id);
      return ok;
    },
    current_session_is_trusted: () => !!srv.session && srv.trustedSessions.has(srv.session.id)
      && [...Object.values(srv.devices)].some((d) => !d.revoked && !d.expired),
    trust_this_device: (a) => {
      if (!srv.session || srv.session.aal !== 'aal2') return { error: { message: 'Enter your authenticator code before trusting this device.' } };
      const id = 'dev-' + (Object.keys(srv.devices).length + 1);
      srv.devices[id] = { token: 'tok-' + id, label: a.p_label, surface: a.p_surface };
      return { id, token: 'tok-' + id, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() };
    },
    list_my_trusted_devices: () => Object.entries(srv.devices).filter(([, d]) => !d.revoked && !d.expired)
      .map(([id, d]) => ({ id, label: d.label, surface: d.surface || 'portal', created_at: '2026-10-20T10:00:00Z', expires_at: '2026-11-19T10:00:00Z', last_used_at: null })),
    revoke_trusted_device: (a) => { const d = srv.devices[a.p_device_id]; if (!d || d.revoked) return false; d.revoked = true; return true; },
    revoke_all_trusted_devices: () => { let n = 0; for (const d of Object.values(srv.devices)) if (!d.revoked) { d.revoked = true; n++; } return n; },
  };
  const thenable = () => new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res) => res({ data: [], error: null });
      return () => thenable();
    },
  });
  return {
    auth: {
      signInWithPassword: async ({ password }) => {
        srv.calls.push('signInWithPassword');
        if (password !== 'correct horse') return { error: { message: 'Invalid login credentials', status: 400 } };
        srv.session = { id: 's' + (++srv.sessionSeq), aal: 'aal1' };
        return { data: { session: sessionObj() }, error: null };
      },
      getSession: async () => ({ data: { session: sessionObj() } }),
      getUser: async () => ({ data: { user: sessionObj() && sessionObj().user } }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: srv.session ? srv.session.aal : null, nextLevel: srv.factor ? 'aal2' : 'aal1' } }),
        listFactors: async () => ({ data: { totp: srv.factor ? [{ id: 'f1', status: 'verified' }] : [] }, error: null }),
        challengeAndVerify: async ({ code }) => {
          srv.calls.push('challengeAndVerify');
          if (code !== '123456') return { error: { message: 'Invalid TOTP code' } };
          srv.session.aal = 'aal2';
          return { data: {}, error: null };
        },
        unenroll: async () => {
          if (srv.session.aal !== 'aal2') return { error: { message: 'AAL2 required' } };
          srv.factor = false; srv.calls.push('unenroll'); return { data: {}, error: null };
        },
        enroll: async () => ({ data: { id: 'f2', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>' } }, error: null }),
      },
      signOut: async () => { srv.session = null; return { error: null }; },
      updateUser: async () => { srv.calls.push('updateUser'); return { data: {}, error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async (name, args) => {
      srv.calls.push('rpc:' + name);
      if (srv.rpcMissing) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      const out = RPCS[name] ? RPCS[name](args || {}) : null;
      if (out && out.error) return { data: null, error: out.error };
      return { data: out, error: null };
    },
    from: () => thenable(),
    channel: () => thenable(),
    removeChannel: () => {},
  };
}

function inline(html) {
  return html
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]*"[^>]*><\/script>/, '<script>window.supabase = { createClient: () => window.__client };</script>')
    .replace(/<script src="\/portal\/portal-app\.js\?v=[^"]*"><\/script>/, () => '<script>' + APP + '</script>')
    .replace(/<script src="\/trusted-device\.js\?v=[^"]*"><\/script>/, () => '<script>' + TRUSTED_JS + '</script>')
    .replace(/<script src="\/signin-ui\.js\?v=[^"]*"><\/script>/, () => '<script>' + UI_JS + '</script>');
}

function load(html, srv, url, { stored, beforeParse } = {}) {
  const dom = new JSDOM(inline(html), {
    runScripts: 'dangerously', url,
    beforeParse(w) {
      w.__client = stubClient(srv);
      w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      if (stored) w.localStorage.setItem(DEVICE_KEY, JSON.stringify(stored));
      if (beforeParse) beforeParse(w);
    },
  });
  windows.push(dom.window);
  return dom.window;
}

function loadLogin(srv, opts) {
  const w = load(LOGIN, srv, 'https://www.triplehenterprisesllc.biz/portal/login.html', opts);
  w.__home = 0;
  w.goHomeAfterSignIn = () => { w.__home++; };
  return w;
}
async function until(check, what) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for: ${what}`);
}
const codeShown = (w) => w.document.getElementById('mfaChallengeOverlay').style.display === 'flex';
async function submitPassword(w, password = 'correct horse') {
  w.document.getElementById('clientEmail').value = EMAIL;
  w.document.getElementById('clientPassword').value = password;
  w.document.getElementById('loginForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
}
const deviceRecord = (w) => JSON.parse(w.localStorage.getItem(DEVICE_KEY) || 'null');
const IN_A_DAY = new Date(Date.now() + 86400000).toISOString();
const validStored = () => ({ id: 'dev-1', token: 'tok-dev-1', expires_at: IN_A_DAY });

// ---- sign-in ------------------------------------------------------------------------------

test('portal: a trusted device skips the code after a correct password', async () => {
  const srv = server({ devices: { 'dev-1': { token: 'tok-dev-1', label: 'Safari on iPhone' } } });
  const w = loadLogin(srv, { stored: validStored() });
  await submitPassword(w);
  await until(() => w.__home === 1, 'home');
  assert.ok(!codeShown(w), 'no code step');
  assert.ok(srv.calls.includes('signInWithPassword'), 'the password was checked');
  assert.ok(!srv.calls.includes('challengeAndVerify'));
  assert.equal(srv.session.aal, 'aal1', 'the session is the password one; the server recorded it as trusted');
  assert.ok(srv.trustedSessions.has(srv.session.id));
  assert.equal(w.sessionStorage.getItem(STEP_KEY), '1');
});

test('portal: an untrusted device still gets the code', async () => {
  const srv = server({ devices: { 'dev-1': { token: 'tok-dev-1' } } });
  const w = loadLogin(srv);
  await submitPassword(w);
  await until(() => codeShown(w), 'the code step');
  assert.equal(w.__home, 0);
  assert.ok(!srv.calls.includes('rpc:use_trusted_device'));
});

test('portal: an expired or removed device gets the code and forgets its token; a wrong token too', async () => {
  for (const [flag, stored] of [['expired', validStored()], ['revoked', validStored()], ['wrong', { id: 'dev-1', token: 'nope' }]]) {
    const devices = { 'dev-1': { token: 'tok-dev-1' } };
    if (flag !== 'wrong') devices['dev-1'][flag] = true;
    const srv = server({ devices });
    const w = loadLogin(srv, { stored });
    await submitPassword(w);
    await until(() => codeShown(w), `the code step (${flag})`);
    assert.equal(w.__home, 0, flag);
    assert.equal(deviceRecord(w), null, flag);
  }
});

test('portal: a wrong password never reaches the trusted-device check', async () => {
  const srv = server({ devices: { 'dev-1': { token: 'tok-dev-1' } } });
  const w = loadLogin(srv, { stored: validStored() });
  await submitPassword(w, 'wrong');
  await until(() => w.document.getElementById('loginError').textContent, 'error');
  assert.ok(!srv.calls.includes('rpc:use_trusted_device'));
  assert.equal(w.__home, 0);
});

test('portal: a correct code with "Trust this device" on trusts it with the verified session; next time, no code', async () => {
  const srv = server();
  const w = loadLogin(srv);
  w.document.getElementById('rememberMe').checked = true;
  await submitPassword(w);
  await until(() => codeShown(w), 'the code step');
  assert.equal(w.document.getElementById('portalTrustDevice').checked, true);
  w.document.getElementById('mfaChallengeCodeInput').value = '123456';
  w.document.getElementById('mfaChallengeSubmit').click();
  await until(() => w.__home === 1, 'home');
  assert.ok(srv.calls.indexOf('challengeAndVerify') < srv.calls.indexOf('rpc:trust_this_device'), 'trusted only after the code: ' + srv.calls.join(','));
  assert.equal(srv.devices['dev-1'].surface, 'portal');
  const rec = deviceRecord(w);
  assert.deepEqual(Object.keys(rec).sort(), ['expires_at', 'id', 'token']);

  srv.session = null; // a new visit: the first page's session is gone
  const again = loadLogin(srv, { stored: rec });
  await submitPassword(again);
  await until(() => again.__home === 1, 'home again');
  assert.ok(!codeShown(again));
});

test('portal: with "Trust this device" off, nothing is trusted', async () => {
  const srv = server();
  const w = loadLogin(srv);
  await submitPassword(w);
  await until(() => codeShown(w), 'the code step');
  w.document.getElementById('portalTrustDevice').checked = false;
  w.document.getElementById('mfaChallengeCodeInput').value = '123456';
  w.document.getElementById('mfaChallengeSubmit').click();
  await until(() => w.__home === 1, 'home');
  assert.ok(!srv.calls.includes('rpc:trust_this_device'));
  assert.equal(deviceRecord(w), null);
});

test('portal: before the migration is applied, sign-in with the code works exactly as before', async () => {
  const srv = server({ rpcMissing: true });
  const w = loadLogin(srv, { stored: validStored() });
  await submitPassword(w);
  await until(() => codeShown(w), 'the code step');
  w.document.getElementById('mfaChallengeCodeInput').value = '123456';
  w.document.getElementById('mfaChallengeSubmit').click();
  await until(() => w.__home === 1, 'home');
  assert.deepEqual(deviceRecord(w), validStored(), 'an error is not a "no": the token is kept');
});

// ---- every portal page's second-step check ---------------------------------------------------

function appPage(srv) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'dangerously', url: 'https://www.triplehenterprisesllc.biz/portal/home.html' });
  const w = dom.window;
  windows.push(w);
  w.fetch = async () => ({ ok: true, json: async () => ({}) });
  w.eval(APP);
  return { w, client: stubClient(srv) };
}

test('portal pages: a trusted session owes no second step, asked of the server (not a local flag)', async () => {
  const srv = server({ devices: { 'dev-1': { token: 'tok-dev-1' } } });
  srv.session = { id: 's9', aal: 'aal1' };
  srv.trustedSessions.add('s9');
  const { w, client } = appPage(srv);
  assert.equal(await w.portalSecondStepOwed(EMAIL, client), false);
  assert.ok(srv.calls.includes('rpc:current_session_is_trusted'));
  assert.equal(w.sessionStorage.getItem(STEP_KEY), '1', 'remembered for this tab, like Face ID');
});

test('portal pages: a password-only session the server does not trust still owes the code', async () => {
  const srv = server({ devices: { 'dev-1': { token: 'tok-dev-1' } } });
  srv.session = { id: 's9', aal: 'aal1' };
  const { w, client } = appPage(srv);
  w.localStorage.setItem(DEVICE_KEY, JSON.stringify(validStored()));
  assert.equal(await w.portalSecondStepOwed(EMAIL, client), true, 'holding a token locally proves nothing');
  srv.trustedSessions.add('s9');
  srv.devices['dev-1'].revoked = true;
  assert.equal(await w.portalSecondStepOwed(EMAIL, client), true, 'revoked: owed again');
});

test('portal pages: an aal2 session or an account without 2FA makes no extra call; a failed check means the code is owed', async () => {
  const srv = server();
  srv.session = { id: 's1', aal: 'aal2' };
  const { w, client } = appPage(srv);
  assert.equal(await w.portalSecondStepOwed(EMAIL, client), false);
  assert.ok(!srv.calls.includes('rpc:current_session_is_trusted'));
  const missing = server({ rpcMissing: true });
  missing.session = { id: 's2', aal: 'aal1' };
  const page = appPage(missing);
  assert.equal(await page.w.portalSecondStepOwed(EMAIL, page.client), true);
  const noRpc = { auth: stubClient(missing).auth };
  assert.equal(await page.w.portalSecondStepOwed(EMAIL, noRpc), true, 'a client without rpc still asks for the code');
});

// ---- Settings ---------------------------------------------------------------------------------

async function loadSettings(srv, { aal = 'aal2', stored } = {}) {
  srv.session = { id: 's1', aal };
  const w = load(SETTINGS, srv, 'https://www.triplehenterprisesllc.biz/portal/settings.html', {
    stored,
    beforeParse(win) {
      win.portalConfirm = async () => true;
      win.requestAnimationFrame = (cb) => setTimeout(cb, 0);
      win.portalPushSupported = () => false;
      win.isPortalPushEnabled = async () => false;
      win.enablePortalPushNotifications = async () => false;
      win.disablePortalPushNotifications = async () => false;
    },
  });
  w.portalConfirm = async () => true;
  await w.renderMfaToggle();
  return w;
}

test('portal Settings: Trusted devices lists each device with a Remove button; Remove revokes only that one', async () => {
  const srv = server({ devices: {
    'dev-1': { token: 't1', label: 'Chrome on Windows' },
    'dev-2': { token: 't2', label: 'Safari on iPhone' },
  } });
  const w = await loadSettings(srv, { stored: { id: 'dev-2', token: 't2' } });
  await until(() => w.document.querySelectorAll('[data-remove-trusted-device]').length === 2, 'two rows');
  assert.notEqual(w.document.getElementById('trustedDevicesCard').style.display, 'none');
  const keys = [...w.document.querySelectorAll('#trustedDevicesBody .set-row-key')].map((k) => k.textContent);
  assert.deepEqual(keys, ['Chrome on WindowsTrusted Oct 20, 2026 · until Nov 19, 2026', 'Safari on iPhone This deviceTrusted Oct 20, 2026 · until Nov 19, 2026']);

  w.document.querySelector('[data-remove-trusted-device="dev-1"]').click();
  await until(() => w.document.querySelectorAll('[data-remove-trusted-device]').length === 1, 'one row');
  assert.equal(srv.devices['dev-1'].revoked, true);
  assert.ok(!srv.devices['dev-2'].revoked);
});

test('portal Settings: the card is hidden while two-factor is off', async () => {
  const srv = server({ factor: false });
  const w = await loadSettings(srv);
  assert.equal(w.document.getElementById('trustedDevicesCard').style.display, 'none');
});

test('portal Settings: changing the password revokes every trusted device', async () => {
  const srv = server({ devices: { 'dev-1': { token: 't1', label: 'A' }, 'dev-2': { token: 't2', label: 'B' } } });
  const w = await loadSettings(srv, { stored: { id: 'dev-1', token: 't1' } });
  w.document.getElementById('newPassword').value = 'a-new-password';
  w.document.getElementById('confirmPassword').value = 'a-new-password';
  await w.updatePassword();
  assert.ok(srv.calls.indexOf('updateUser') < srv.calls.indexOf('rpc:revoke_all_trusted_devices'));
  assert.ok(srv.devices['dev-1'].revoked && srv.devices['dev-2'].revoked);
  assert.equal(deviceRecord(w), null);
  assert.match(w.document.getElementById('passwordMsg').textContent, /Trusted devices will ask for your 2FA code again/);
});

test('portal Settings: turning 2FA off revokes every trusted device', async () => {
  const srv = server({ devices: { 'dev-1': { token: 't1', label: 'A' } } });
  const w = await loadSettings(srv, { stored: { id: 'dev-1', token: 't1' } });
  await w.handleDisableMfa();
  await until(() => srv.calls.includes('rpc:revoke_all_trusted_devices'), 'revoke all');
  assert.ok(srv.calls.indexOf('unenroll') < srv.calls.indexOf('rpc:revoke_all_trusted_devices'));
  assert.equal(srv.devices['dev-1'].revoked, true);
});

test('portal Settings: setting 2FA up again revokes every trusted device', async () => {
  const srv = server({ factor: false, devices: { 'dev-1': { token: 't1', label: 'left over' } } });
  const w = await loadSettings(srv);
  await w.handleStartMfaEnroll();
  w.document.getElementById('mfaCodeInput').value = '123456';
  srv.session.aal = 'aal1';
  await w.handleVerifyMfaEnroll();
  assert.ok(srv.calls.includes('rpc:revoke_all_trusted_devices'));
  assert.equal(srv.devices['dev-1'].revoked, true);
});

// ---- set-password (reset / invite link) -----------------------------------------------------

test('portal set-password: a new password revokes every trusted device', async () => {
  const srv = server({ devices: { 'dev-1': { token: 't1' } } });
  srv.session = { id: 's1', aal: 'aal1' };
  const w = load(SET_PASSWORD, srv, 'https://www.triplehenterprisesllc.biz/portal/set-password.html', { stored: { id: 'dev-1', token: 't1' } });
  w.setTimeout = () => 0; // keep the post-success redirect from firing
  await until(() => w.document.getElementById('newPassword'), 'form');
  w.document.getElementById('newPassword').value = 'a-new-password';
  w.document.getElementById('confirmPassword').value = 'a-new-password';
  const form = w.document.getElementById('newPassword').closest('form');
  form.dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => srv.calls.includes('rpc:revoke_all_trusted_devices'), 'revoke all');
  assert.ok(srv.calls.indexOf('updateUser') < srv.calls.indexOf('rpc:revoke_all_trusted_devices'));
  assert.equal(srv.devices['dev-1'].revoked, true);
  await until(() => deviceRecord(w) === null, 'local token cleared');
});
