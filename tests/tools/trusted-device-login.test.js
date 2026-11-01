// Trusted devices on the Workspace (2026-11-01): "trusted device skips 2FA
// for 30 days." Runs the real tools/login.html, settings.html and
// reset-password.html with the real auth.js and the shared /trusted-device.js
// in jsdom, against a fake Supabase whose trusted-device functions follow the
// same rules as sql/security/add_trusted_devices.sql (those rules themselves
// are proved against real Postgres in tests/security/trusted-devices-db.test.js).
//
// Pinned here: the password is always asked for; a trusted device skips only
// the code; any other device, an expired or revoked one, or a server that says
// no, gets the code exactly as before; trust is only created after a correct
// code with the switch on; and the browser never holds anything but the
// server-issued id + token.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const AUTH_JS = fs.readFileSync(repo('tools', 'auth.js'), 'utf8');
const TRUSTED_JS = fs.readFileSync(repo('trusted-device.js'), 'utf8');
const LOGIN = fs.readFileSync(repo('tools', 'login.html'), 'utf8');
const SETTINGS = fs.readFileSync(repo('tools', 'settings.html'), 'utf8');
const RESET = fs.readFileSync(repo('tools', 'reset-password.html'), 'utf8');

const EMAIL = 'connor@triplehenterprisesllc.biz';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const DEVICE_KEY = `th_trusted_device:${USER_ID}`;
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (aal, session = 's1') => `${b64url({ alg: 'HS256' })}.${b64url({ sub: USER_ID, email: EMAIL, role: 'authenticated', aal, session_id: session })}.sig`;
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const aalOf = (init) => {
  try { return JSON.parse(Buffer.from(init.headers.Authorization.split('.')[1], 'base64url').toString()).aal; } catch (e) { return null; }
};

// A fake Supabase. `devices` is the server's table: id -> { token, revoked, expired }.
function fakeSupabase({ devices = {}, gateBlocks = false, rpcMissing = false, role = { can_manage_roles: true } } = {}) {
  const state = { devices, log: [], rpcArgs: {}, gateBlocks, sessions: 0 };
  const rpc = (name, handler) => (st, init) => {
    if (rpcMissing) return reply({ code: 'PGRST202', message: 'Could not find the function' }, 404);
    const args = JSON.parse(init.body || '{}');
    (st.rpcArgs[name] = st.rpcArgs[name] || []).push({ args, aal: aalOf(init) });
    return handler(st, args, init);
  };
  const ROUTES = {
    'POST /auth/v1/token': (st) => { st.sessions++; return reply({ access_token: token('aal1', 's' + st.sessions), refresh_token: 'r1', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { email: EMAIL } }); },
    'GET /auth/v1/user': () => reply({ email: EMAIL, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] }),
    'POST /auth/v1/factors/f1/challenge': () => reply({ id: 'c1' }),
    'POST /auth/v1/factors/f1/verify': (st, init) => (JSON.parse(init.body).code === '123456'
      ? reply({ access_token: token('aal2', 's-verified'), refresh_token: 'r2', expires_in: 3600, user: { email: EMAIL } })
      : reply({ msg: 'Invalid TOTP code entered' }, 422)),
    'GET /rest/v1/account_roles': () => reply([{ email: EMAIL, role_name: 'Developer', ...role }]),
    'POST /rest/v1/rpc/use_trusted_device': rpc('use_trusted_device', (st, a) => {
      const d = st.devices[a.p_device_id];
      return reply(!!d && !d.revoked && !d.expired && d.token === a.p_token);
    }),
    'POST /rest/v1/rpc/internal_mfa_session_status': rpc('internal_mfa_session_status', (st) => reply({ internal: true, meets: !st.gateBlocks, blocked: st.gateBlocks })),
    'POST /rest/v1/rpc/trust_this_device': rpc('trust_this_device', (st, a, init) => {
      if (aalOf(init) !== 'aal2') return reply({ message: 'Enter your authenticator code before trusting this device.' }, 403);
      const id = 'dev-' + (Object.keys(st.devices).length + 1);
      st.devices[id] = { token: 'tok-' + id, label: a.p_label, surface: a.p_surface };
      return reply({ id, token: 'tok-' + id, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() });
    }),
    'POST /rest/v1/rpc/list_my_trusted_devices': rpc('list_my_trusted_devices', (st) => reply(Object.entries(st.devices)
      .filter(([, d]) => !d.revoked && !d.expired)
      .map(([id, d]) => ({ id, label: d.label, surface: d.surface || 'tools', created_at: '2026-10-20T10:00:00Z', expires_at: '2026-11-19T10:00:00Z', last_used_at: null })))),
    'POST /rest/v1/rpc/revoke_trusted_device': rpc('revoke_trusted_device', (st, a) => {
      const d = st.devices[a.p_device_id];
      if (!d || d.revoked) return reply(false);
      d.revoked = true;
      return reply(true);
    }),
    'POST /rest/v1/rpc/revoke_all_trusted_devices': rpc('revoke_all_trusted_devices', (st) => {
      let n = 0;
      for (const d of Object.values(st.devices)) if (!d.revoked) { d.revoked = true; n++; }
      return reply(n);
    }),
    'POST /rest/v1/rpc/count_unused_internal_recovery_codes': () => reply(8),
    'DELETE /auth/v1/factors/f1': (st, init) => (aalOf(init) === 'aal2' ? reply({}) : reply({ msg: 'AAL2 required to unenroll verified factor' }, 403)),
    'POST /rest/v1/rpc/delete_internal_recovery_codes': () => reply(null),
    'PUT /auth/v1/user': () => reply({ id: USER_ID }),
  };
  state.fetch = async (url, init = {}) => {
    const { pathname } = new URL(String(url));
    const key = `${init.method || 'GET'} ${pathname}`;
    state.log.push(key);
    return (ROUTES[key] || (() => reply({ message: `unexpected ${key}` }, 500)))(state, init);
  };
  return state;
}

function inline(html) {
  return html
    .replace(/<script src="\/tools\/auth\.js\?v=[^"]*"><\/script>/, () => '<script>' + AUTH_JS + '</script>')
    .replace(/<script src="\/trusted-device\.js\?v=[^"]*"><\/script>/, () => '<script>' + TRUSTED_JS + '</script>')
    .replace(/<script src="\/tools\/tools-[a-z-]+\.js\?v=[^"]*" defer><\/script>/g, '');
}

function loadLogin(backend, { stored } = {}) {
  const dom = new JSDOM(inline(LOGIN), {
    runScripts: 'dangerously', url: 'https://www.triplehenterprisesllc.biz/tools/login.html',
    beforeParse(w) {
      w.fetch = backend.fetch;
      if (stored) w.localStorage.setItem(DEVICE_KEY, JSON.stringify(stored));
    },
  });
  const w = dom.window;
  w.__redirects = 0;
  w.redirectAfterLogin = () => { w.__redirects++; };
  w.finishSignInFlow = () => { w.__redirects++; };
  return w;
}
const visible = (w, id) => w.document.getElementById(id).style.display !== 'none';
async function until(check, what) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for: ${what}`);
}
async function submitPassword(w) {
  w.document.getElementById('loginEmail').value = EMAIL;
  w.document.getElementById('loginPassword').value = 'correct horse';
  w.document.getElementById('rememberMe').checked = true;
  w.document.getElementById('loginForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
}
const storedSession = (w) => JSON.parse(w.localStorage.getItem('th_auth_session') || 'null');
const deviceRecord = (w) => JSON.parse(w.localStorage.getItem(DEVICE_KEY) || 'null');
const trustedDevice = () => ({ 'dev-1': { token: 'tok-dev-1', label: 'Chrome on Mac', surface: 'tools' } });

// ---- sign-in ----------------------------------------------------------------------------

test('Workspace: a trusted device skips the code after a correct password, and stores the password session', async () => {
  const backend = fakeSupabase({ devices: trustedDevice() });
  const w = loadLogin(backend, { stored: { id: 'dev-1', token: 'tok-dev-1', expires_at: new Date(Date.now() + 86400000).toISOString() } });
  await submitPassword(w);
  await until(() => w.__redirects === 1, 'signed in');
  assert.ok(!visible(w, 'mfaChallengeView'), 'the code step never showed');
  assert.ok(backend.log.includes('POST /auth/v1/token'), 'the password was checked');
  assert.deepEqual(backend.rpcArgs.use_trusted_device.map((c) => c.args), [{ p_device_id: 'dev-1', p_token: 'tok-dev-1' }]);
  assert.equal(backend.rpcArgs.use_trusted_device[0].aal, 'aal1', 'asked with the session the password produced');
  assert.equal(backend.rpcArgs.internal_mfa_session_status.length, 1, 'and the Workspace gate was asked before storing');
  assert.equal(storedSession(w).access_token, token('aal1', 's1'));
  assert.ok(!backend.log.some((l) => l.includes('/factors/f1/verify')), 'no code was sent');
});

test('Workspace: an untrusted device still gets the code, and nothing is stored after the password alone', async () => {
  const backend = fakeSupabase({ devices: trustedDevice() });
  const w = loadLogin(backend);
  await submitPassword(w);
  await until(() => visible(w, 'mfaChallengeView'), 'the code step');
  assert.equal(storedSession(w), null);
  assert.equal(w.__redirects, 0);
  assert.equal(backend.rpcArgs.use_trusted_device, undefined, 'no token on this device, so nothing to ask');
});

test('Workspace: a device past its 30 days (or removed, or after a password change) gets the code, and forgets its token', async () => {
  for (const flag of ['expired', 'revoked']) {
    const devices = trustedDevice();
    devices['dev-1'][flag] = true;
    const backend = fakeSupabase({ devices });
    const w = loadLogin(backend, { stored: { id: 'dev-1', token: 'tok-dev-1', expires_at: new Date(Date.now() + 86400000).toISOString() } });
    await submitPassword(w);
    await until(() => visible(w, 'mfaChallengeView'), `the code step (${flag})`);
    assert.equal(storedSession(w), null, flag);
    assert.equal(deviceRecord(w), null, `${flag}: a token the server refused is dropped`);
  }
});

test('Workspace: a token whose local expiry has passed is not even sent', async () => {
  const backend = fakeSupabase({ devices: trustedDevice() });
  const w = loadLogin(backend, { stored: { id: 'dev-1', token: 'tok-dev-1', expires_at: new Date(Date.now() - 1000).toISOString() } });
  await submitPassword(w);
  await until(() => visible(w, 'mfaChallengeView'), 'the code step');
  assert.equal(backend.rpcArgs.use_trusted_device, undefined);
  assert.equal(deviceRecord(w), null);
});

test("Workspace: if the server's 2FA gate refuses the trusted session, the code is asked for (no sign-in loop)", async () => {
  const backend = fakeSupabase({ devices: trustedDevice(), gateBlocks: true });
  const w = loadLogin(backend, { stored: { id: 'dev-1', token: 'tok-dev-1' } });
  await submitPassword(w);
  await until(() => visible(w, 'mfaChallengeView'), 'the code step');
  assert.equal(storedSession(w), null);
  assert.equal(w.__redirects, 0);
});

test('Workspace: before the migration is applied (functions missing), sign-in works exactly as before', async () => {
  const backend = fakeSupabase({ rpcMissing: true });
  const w = loadLogin(backend, { stored: { id: 'dev-1', token: 'tok-dev-1' } });
  await submitPassword(w);
  await until(() => visible(w, 'mfaChallengeView'), 'the code step');
  w.document.getElementById('thTrustDevice').checked = true;
  w.document.getElementById('mfaChallengeCodeInput').value = '123456';
  w.document.getElementById('mfaChallengeSubmitBtn').click();
  await until(() => w.__redirects === 1, 'signed in with the code');
  assert.equal(storedSession(w).access_token, token('aal2', 's-verified'));
  assert.deepEqual(deviceRecord(w), { id: 'dev-1', token: 'tok-dev-1' }, 'a network/missing-function error never deletes the token');
});

test('Workspace: a correct code with "Trust this device" on trusts it, using the verified session; the browser keeps only id + token', async () => {
  const backend = fakeSupabase();
  const w = loadLogin(backend);
  await submitPassword(w);
  await until(() => visible(w, 'mfaChallengeView'), 'the code step');
  assert.equal(w.document.getElementById('thTrustDevice').checked, true, 'starts from Remember me');
  w.document.getElementById('mfaChallengeCodeInput').value = '123456';
  w.document.getElementById('mfaChallengeSubmitBtn').click();
  await until(() => w.__redirects === 1, 'signed in');
  const calls = backend.rpcArgs.trust_this_device;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].aal, 'aal2', 'trust is minted with the session that entered the code');
  assert.equal(calls[0].args.p_surface, 'tools');
  assert.equal(typeof calls[0].args.p_label, 'string');
  const rec = deviceRecord(w);
  assert.deepEqual(Object.keys(rec).sort(), ['expires_at', 'id', 'token']);
  assert.equal(rec.id, 'dev-1');
  assert.equal(rec.token, 'tok-dev-1');

  // Next time on this device: password, no code.
  const again = loadLogin(backend, { stored: rec });
  await submitPassword(again);
  await until(() => again.__redirects === 1, 'signed in again');
  assert.ok(!visible(again, 'mfaChallengeView'));
});

test('Workspace: with "Trust this device" off, a correct code signs in without trusting the device', async () => {
  const backend = fakeSupabase();
  const w = loadLogin(backend);
  await submitPassword(w);
  await until(() => visible(w, 'mfaChallengeView'), 'the code step');
  w.document.getElementById('thTrustDevice').checked = false;
  w.document.getElementById('mfaChallengeCodeInput').value = '123456';
  w.document.getElementById('mfaChallengeSubmitBtn').click();
  await until(() => w.__redirects === 1, 'signed in');
  assert.equal(backend.rpcArgs.trust_this_device, undefined);
  assert.equal(deviceRecord(w), null);
});

test('Workspace: a wrong code still fails and trusts nothing', async () => {
  const backend = fakeSupabase();
  const w = loadLogin(backend);
  await submitPassword(w);
  await until(() => visible(w, 'mfaChallengeView'), 'the code step');
  w.document.getElementById('mfaChallengeCodeInput').value = '000000';
  w.document.getElementById('mfaChallengeSubmitBtn').click();
  await until(() => w.document.getElementById('mfaChallengeError').textContent, 'an error');
  assert.equal(backend.rpcArgs.trust_this_device, undefined);
  assert.equal(storedSession(w), null);
});

test('Workspace: a wrong password never reaches the trusted-device check', async () => {
  const backend = fakeSupabase({ devices: trustedDevice() });
  const orig = backend.fetch;
  backend.fetch = async (url, init) => (String(url).includes('/auth/v1/token') ? reply({ error_description: 'Invalid login credentials' }, 400) : orig(url, init));
  const w = loadLogin(backend, { stored: { id: 'dev-1', token: 'tok-dev-1' } });
  await submitPassword(w);
  await until(() => w.document.getElementById('loginError').textContent, 'the error');
  assert.equal(w.document.getElementById('loginError').textContent, 'Incorrect email or password.');
  assert.equal(backend.rpcArgs.use_trusted_device, undefined);
  assert.equal(w.__redirects, 0);
});

// ---- Settings --------------------------------------------------------------------------

function loadSettings(backend, { aal = 'aal2', stored } = {}) {
  const html = inline(SETTINGS)
    .replace(/<script src="\/tools\/(?:sync|data-layer|push-notifications|tools-nav-pwa|tools-tour)\.js\?v=[^"]*"(?: defer)?><\/script>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://www.triplehenterprisesllc.biz/tools/settings.html',
    beforeParse(w) {
      w.fetch = backend.fetch;
      w.localStorage.setItem('th_auth_session', JSON.stringify({ access_token: token(aal, 's1'), refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: EMAIL }));
      if (stored) w.localStorage.setItem(DEVICE_KEY, JSON.stringify(stored));
      w.showConfirm = async () => true;
      w.initAppTour = () => {};
      w.refreshSettingsPushState = async () => {};
    },
  });
  return dom.window;
}

test('Workspace Settings: Trusted devices lists each device with a Remove button; Remove revokes only that one', async () => {
  const backend = fakeSupabase({ devices: {
    'dev-1': { token: 't1', label: 'Chrome on Mac', surface: 'tools' },
    'dev-2': { token: 't2', label: 'Safari on iPhone', surface: 'tools' },
  } });
  const w = loadSettings(backend, { stored: { id: 'dev-2', token: 't2' } });
  await w.renderMfaSettingsCard();
  await until(() => w.document.querySelectorAll('[data-remove-trusted-device]').length === 2, 'two rows');
  assert.ok(visible(w, 'trustedDevicesSection'));
  const rows = [...w.document.querySelectorAll('#trustedDevicesList [data-trusted-device]')];
  assert.deepEqual(rows.map((r) => r.querySelector('.settings-row-label').textContent), ['Chrome on Mac', 'Safari on iPhone This device']);
  assert.match(rows[0].querySelector('.settings-row-sub').textContent, /^Trusted Oct 20, 2026 · until Nov 19, 2026 · Workspace$/);

  w.document.querySelector('[data-remove-trusted-device="dev-1"]').click();
  await until(() => w.document.querySelectorAll('[data-remove-trusted-device]').length === 1, 'one row left');
  assert.deepEqual(backend.rpcArgs.revoke_trusted_device.map((c) => c.args), [{ p_device_id: 'dev-1' }]);
  assert.equal(backend.devices['dev-1'].revoked, true);
  assert.ok(!backend.devices['dev-2'].revoked, 'the other device is untouched');
  assert.ok(deviceRecord(w), "removing another device leaves this device's token");

  w.document.querySelector('[data-remove-trusted-device="dev-2"]').click();
  await until(() => !w.document.querySelector('[data-remove-trusted-device]'), 'no rows left');
  assert.equal(deviceRecord(w), null, 'removing this device forgets its token here too');
  assert.match(w.document.getElementById('trustedDevicesList').textContent, /No trusted devices/);
});

test('Workspace Settings: a device label is shown as text, never as markup', async () => {
  const backend = fakeSupabase({ devices: { 'dev-1': { token: 't1', label: '<img src=x onerror=alert(1)>', surface: 'tools' } } });
  const w = loadSettings(backend);
  await w.renderMfaSettingsCard();
  await until(() => w.document.querySelector('[data-remove-trusted-device]'), 'a row');
  assert.equal(w.document.querySelector('#trustedDevicesList img'), null);
  assert.match(w.document.querySelector('#trustedDevicesList .settings-row-label').textContent, /<img src=x/);
});

test('Workspace Settings: turning 2FA off revokes every trusted device', async () => {
  const backend = fakeSupabase({ devices: trustedDevice() });
  const w = loadSettings(backend, { stored: { id: 'dev-1', token: 'tok-dev-1' } });
  await w.renderMfaSettingsCard();
  await w.handleDisableMfaSettings();
  assert.equal(backend.rpcArgs.revoke_all_trusted_devices.length, 1);
  assert.equal(backend.devices['dev-1'].revoked, true);
  assert.equal(deviceRecord(w), null);
});

test('Workspace Settings: on a trusted (code-skipped) session, turning 2FA off asks for a fresh sign-in with the code instead', async () => {
  const backend = fakeSupabase({ devices: trustedDevice() });
  const w = loadSettings(backend, { aal: 'aal1' });
  await w.renderMfaSettingsCard();
  await w.handleDisableMfaSettings();
  assert.ok(!backend.log.includes('DELETE /auth/v1/factors/f1'));
  assert.match(w.document.getElementById('mfaSettingsMsg').textContent, /sign back in and enter your 6-digit code/);
  assert.equal(backend.rpcArgs.revoke_all_trusted_devices, undefined);
});

test('Workspace Settings: setting 2FA up (again) revokes every trusted device', async () => {
  const body = SETTINGS.slice(SETTINGS.indexOf('async function handleVerifyMfaEnrollSettings()'), SETTINGS.indexOf('async function handleCancelMfaEnrollSettings()'));
  assert.match(body, /persistSession\([\s\S]*?await revokeAllTrustedDevicesSettings\(\);\s*\n\s*const codesResult = await generateRecoveryCodes/);
});

// ---- Password reset ------------------------------------------------------------------------

test('Workspace password reset: a new password revokes every trusted device', async () => {
  const backend = fakeSupabase({ devices: trustedDevice() });
  const recovery = token('aal1', 'recovery');
  const dom = new JSDOM(inline(RESET), {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/tools/reset-password.html#access_token=' + recovery + '&type=recovery',
    beforeParse(w) {
      w.fetch = backend.fetch;
      w.localStorage.setItem(DEVICE_KEY, JSON.stringify({ id: 'dev-1', token: 'tok-dev-1' }));
    },
  });
  const w = dom.window;
  w.document.getElementById('newPassword').value = 'a-new-password';
  w.document.getElementById('confirmPassword').value = 'a-new-password';
  w.document.getElementById('resetForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await until(() => backend.rpcArgs.revoke_all_trusted_devices, 'revoke all');
  assert.ok(backend.log.indexOf('PUT /auth/v1/user') < backend.log.indexOf('POST /rest/v1/rpc/revoke_all_trusted_devices'), 'after the password is saved');
  assert.equal(backend.devices['dev-1'].revoked, true);
  await until(() => w.localStorage.getItem(DEVICE_KEY) === null, 'local token cleared');
});

// ---- the shared helper -------------------------------------------------------------------

test('trusted-device.js: device labels name the browser and platform only', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'dangerously' });
  dom.window.eval(TRUSTED_JS);
  const label = dom.window.ThTrustedDevice.deviceLabel;
  assert.equal(label('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari on iPhone');
  assert.equal(label('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'), 'Chrome on Mac');
  assert.equal(label('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'), 'Edge on Windows');
  assert.equal(label('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'), 'Chrome on Android');
  assert.equal(label(''), 'Unknown device');
});
