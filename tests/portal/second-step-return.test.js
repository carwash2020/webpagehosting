// Fix plan RP4.1 (2026-11-07): a signed-in client who still owes the 2FA
// code is sent to login.html's code step WITH ?return=<this page and #card>,
// so a contract email link lands back on the contract after the code, not
// on Home. Covers portal-app.js's redirect (no Face ID, and Face ID's "Use
// my 2FA code instead") and login.html honoring ?return= with ?step=code.
// Made-up accounts only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const APP = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const UI_JS = fs.readFileSync(repo('signin-ui.js'), 'utf8');
const TRUSTED_JS = fs.readFileSync(repo('trusted-device.js'), 'utf8');
const LOGIN = fs.readFileSync(repo('portal', 'login.html'), 'utf8');

const windows = [];
after(() => { for (const w of windows) { try { w.close(); } catch (e) { /* closed */ } } });
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(check, what) {
  for (let i = 0; i < 200; i++) { if (check()) return; await settle(5); }
  assert.fail('timed out: ' + what);
}

const EMAIL = 'dana@example.com';
const owesCode = () => ({
  auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } }) }, signOut: async () => {} },
  rpc: async () => ({ data: false, error: null }),
});

function portalPage(url, { faceIdOnDevice = false } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', {
    runScripts: 'dangerously', url,
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });
      if (faceIdOnDevice) {
        w.PublicKeyCredential = function PublicKeyCredential() {};
        Object.defineProperty(w.navigator, 'credentials', { configurable: true, value: { get: async () => { throw new Error('NotAllowedError'); } } });
        w.localStorage.setItem('th_portal_biometric_lock_' + EMAIL, w.btoa('cred'));
      }
    },
  });
  windows.push(dom.window);
  const w = dom.window;
  const s = w.document.createElement('script');
  s.textContent = APP;
  w.document.body.appendChild(s);
  w.went = [];
  w.portalGo = (u) => w.went.push(u);
  return w;
}

test('no Face ID on this device: the code step carries the contract page and its #card as ?return=', async () => {
  const w = portalPage('https://www.triplehenterprisesllc.biz/portal/contracts.html#contract-card-7');
  w.portalRequireSecondStep(EMAIL, owesCode());
  await until(() => w.went.length === 1, 'redirect');
  assert.equal(w.went[0], '/portal/login.html?return=%2Fportal%2Fcontracts.html%23contract-card-7&step=code');
});

test('Face ID failing, "Use my 2FA code instead": same return-carrying URL', async () => {
  const w = portalPage('https://www.triplehenterprisesllc.biz/portal/dashboard.html', { faceIdOnDevice: true });
  w.portalRequireSecondStep(EMAIL, owesCode());
  await until(() => w.document.getElementById('faceIdStepCodeBtn') && !w.document.getElementById('faceIdStepBtn').disabled, 'Face ID step');
  w.document.getElementById('faceIdStepCodeBtn').click();
  assert.deepEqual(Array.from(w.went), ['/portal/login.html?return=%2Fportal%2Fdashboard.html&step=code']);
});

test('a page not on the return list still gets the plain code step', async () => {
  const w = portalPage('https://www.triplehenterprisesllc.biz/portal/set-password.html');
  w.portalRequireSecondStep(EMAIL, owesCode());
  await until(() => w.went.length === 1, 'redirect');
  assert.equal(w.went[0], '/portal/login.html?step=code');
});

test('login.html with ?return=...&step=code: asks for the code, then goes back to the contract', async () => {
  const calls = { verify: [] };
  let level = 'aal1';
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u-dana', email: EMAIL } } } }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: level, nextLevel: 'aal2' } }),
        listFactors: async () => ({ data: { totp: [{ id: 'f1', status: 'verified' }] } }),
        challengeAndVerify: async (a) => { calls.verify.push(a); level = 'aal2'; return { error: null }; },
      },
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    rpc: async () => ({ data: null, error: null }),
  };
  const html = LOGIN
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]*"[^>]*><\/script>/, '<script>window.supabase = { createClient: () => window.__client };</script>')
    .replace(/<script src="\/portal\/portal-app\.js\?v=[^"]*"><\/script>/, () => '<script>' + APP + '</script>')
    .replace(/<script src="\/trusted-device\.js\?v=[^"]*"><\/script>/, () => '<script>' + TRUSTED_JS + '</script>')
    .replace(/<script src="\/signin-ui\.js\?v=[^"]*"><\/script>/, () => '<script>' + UI_JS + '</script>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/portal/login.html?return=%2Fportal%2Fcontracts.html%23contract-card-7&step=code',
    beforeParse(w) {
      w.__client = client;
      w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
      w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    },
  });
  windows.push(dom.window);
  const w = dom.window;
  const d = w.document;
  const done = [];
  w.ThSignin.success = (fn) => done.push(fn);
  await until(() => d.getElementById('mfaChallengeOverlay').style.display === 'flex', 'code step');
  d.getElementById('mfaChallengeCodeInput').value = '246810';
  d.getElementById('mfaChallengeSubmit').click();
  await until(() => done.length === 1, 'signed in');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.verify[0])), { factorId: 'f1', code: '246810' });
  assert.equal(w.portalAfterSignInUrl(), '/portal/contracts.html#contract-card-7', 'where goHomeAfterSignIn() sends them');
});
