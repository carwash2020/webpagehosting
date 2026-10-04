// Two-factor setup could lock an account out (2026-10-04, Steve's phone):
//  1. The QR code was blank: the raw SVG went into a data: URL unencoded,
//     and the first "#" in a colour ended the URL.
//  2. One abandoned setup (an unverified TOTP factor) made every later
//     attempt fail: 'A factor with the friendly name "" for this user
//     already exists'.
//  3. With setup failed there was no factor id, and Verify sent the code
//     anyway: "factor_id must be an UUID".
// Runs the real mfaQrImageSrc(), mfaClearUnverifiedTotpFactors(),
// mfaEnroll() and mfaUnenroll() from tools/auth.js against a fake Supabase
// Auth, and the real login.html enrollment step in jsdom.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const AUTH = fs.readFileSync(path.join(TOOLS, 'auth.js'), 'utf8');
const LOGIN = fs.readFileSync(path.join(TOOLS, 'login.html'), 'utf8');
const grab = (src, start, end) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf(end, i)); };
const AUTH_FNS = grab(AUTH, '// An <img src> for the QR code.', 'async function mfaChallenge(') +
  grab(AUTH, 'async function mfaUnenroll(', '// ---- Recovery codes');

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path fill="#000000" d="M0 0h7v7H0z"/><rect fill="#ffffff" width="1" height="1"/></svg>';

// A fake GoTrue: factors per user, the friendly-name rule, unenroll.
function fakeAuth(factors) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (url.endsWith('/auth/v1/user') && method === 'GET') return json(200, { factors: factors.slice() });
    const del = url.match(/\/auth\/v1\/factors\/([^/]+)$/);
    if (del && method === 'DELETE') {
      const i = factors.findIndex((f) => f.id === del[1]);
      if (i < 0) return json(404, { msg: 'not found' });
      if (factors[i].status === 'verified') return json(403, { msg: 'AAL2 required' });
      factors.splice(i, 1);
      return json(200, {});
    }
    if (url.endsWith('/auth/v1/factors') && method === 'POST') {
      const name = JSON.parse(init.body).friendly_name || '';
      if (factors.some((f) => (f.friendly_name || '') === name)) {
        return json(422, { msg: `A factor with the friendly name "${name}" for this user already exists` });
      }
      const f = { id: '11111111-2222-3333-4444-555555555555', factor_type: 'totp', status: 'unverified', friendly_name: name };
      factors.push(f);
      return json(200, { id: f.id, type: 'totp', totp: { qr_code: SVG, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' } });
    }
    return json(500, { msg: 'unexpected ' + method + ' ' + url });
  };
  const ctx = { fetch, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', encodeURIComponent, Date, JSON, String };
  vm.createContext(ctx);
  vm.runInContext(AUTH_FNS + '\nthis.api = { mfaQrImageSrc, mfaClearUnverifiedTotpFactors, mfaEnroll };', ctx);
  return { api: ctx.api, calls, factors };
}

test('the QR image src is URL-encoded, so a "#" colour no longer cuts it short, and decodes back to the SVG', () => {
  const { api } = fakeAuth([]);
  const src = api.mfaQrImageSrc(SVG);
  assert.match(src, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.ok(!src.includes('#'), 'no raw # left to end the URL');
  assert.equal(decodeURIComponent(src.split(',').slice(1).join(',')), SVG);
  // An SDK-style prefixed but unencoded URI is fixed too; encoded and base64 ones are left alone.
  assert.equal(api.mfaQrImageSrc('data:image/svg+xml;utf-8,' + SVG), src);
  assert.equal(api.mfaQrImageSrc(src), src);
  assert.equal(api.mfaQrImageSrc('data:image/svg+xml;base64,PHN2Zz4='), 'data:image/svg+xml;base64,PHN2Zz4=');
  assert.equal(api.mfaQrImageSrc(''), '');
});

test("Steve's case: a leftover unverified setup is removed, and a new one starts with a QR code", async () => {
  const { api, calls, factors } = fakeAuth([{ id: '8c115aad-9e70-4a11-bd9b-4559d63e0775', factor_type: 'totp', status: 'unverified', friendly_name: '' }]);
  const r = await api.mfaEnroll('tok');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.factorId, '11111111-2222-3333-4444-555555555555');
  assert.match(r.totp.qr_code, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  assert.equal(r.totp.secret, 'JBSWY3DPEHPK3PXP');
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/factors/8c115aad-9e70-4a11-bd9b-4559d63e0775')));
  assert.deepEqual(Array.from(factors, (f) => f.id), ['11111111-2222-3333-4444-555555555555']);
  const post = calls.find((c) => c.method === 'POST');
  assert.match(post.body.friendly_name, /^Triple H Workspace \d{4}-\d\d-\d\dT/);
  assert.equal(post.body.factor_type, 'totp');
});

test('a verified authenticator is never removed by the cleanup', async () => {
  const { api, calls, factors } = fakeAuth([{ id: 'v-1', factor_type: 'totp', status: 'verified', friendly_name: 'Triple H Workspace' }]);
  await api.mfaClearUnverifiedTotpFactors('tok');
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
  assert.equal(factors.length, 1);
});

test('enroll still reports a real failure plainly, and returns no factor id with it', async () => {
  // A server that refuses enrollment outright.
  const failing = async (url, init = {}) => (url.endsWith('/auth/v1/factors') && init.method === 'POST')
    ? { ok: false, status: 422, json: async () => ({ msg: 'MFA enroll is disabled for TOTP' }) }
    : { ok: true, status: 200, json: async () => ({ factors: [] }) };
  const ctx = { fetch: failing, SUPABASE_URL: 'https://x', SUPABASE_ANON_KEY: 'a', encodeURIComponent, Date, JSON, String };
  vm.createContext(ctx);
  vm.runInContext(AUTH_FNS + '\nthis.e = mfaEnroll;', ctx);
  const r = await ctx.e('tok');
  assert.deepEqual({ ok: r.ok, error: r.error, factorId: r.factorId }, { ok: false, error: 'MFA enroll is disabled for TOTP', factorId: undefined });
});

// --- login.html: the enrollment step ---------------------------------------
const START = grab(LOGIN, '  let lastEnrollOptions;', '  // Shared clipboard helper');
const VERIFY = grab(LOGIN, "  document.getElementById('mfaEnrollVerifyBtn').addEventListener('click', async () => {", "  document.getElementById('mfaEnrollCancelLink')");

function loginPage(enrollResults) {
  const dom = new JSDOM('<!doctype html><body>' +
    '<div id="mfaEnrollTitle">Set up two-factor authentication</div><div id="mfaEnrollSub">sub</div>' +
    '<img id="mfaEnrollQrImg"><div id="mfaEnrollSecretFallback"></div><button id="mfaEnrollCopySecretBtn"></button>' +
    '<input id="mfaEnrollCodeInput"><div id="mfaEnrollError"></div><button id="mfaEnrollVerifyBtn">Verify &amp; Continue</button>' +
    '</body>', { runScripts: 'outside-only' });
  const w = dom.window;
  const out = { enrolls: 0, verifies: [] };
  w.pendingSession = { access_token: 'tok' };
  w.showStep = () => {};
  w.mfaEnroll = async () => { out.enrolls++; return enrollResults.shift(); };
  w.mfaChallengeAndVerify = async (t, id, code) => { out.verifies.push([id, code]); return { ok: false, error: 'Invalid code' }; };
  w.copyTextToClipboard = async () => true;
  w.eval('var pendingFactorId = null;\nvar MFA_ENROLL_COPY = { title: "Set up two-factor authentication", sub: "sub" };\n' + START + VERIFY + '\nwindow.__start = startMandatoryEnrollment;');
  const $ = (id) => w.document.getElementById(id);
  return { w, out, $ };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('setup that fails to start shows the error and a Try again button -- never sends a code with no factor', async () => {
  const { w, out, $ } = loginPage([
    { ok: false, error: 'A factor with the friendly name "" for this user already exists' },
    { ok: true, factorId: 'f-2', totp: { qr_code: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E', secret: 'ABC' } },
  ]);
  await w.__start();
  assert.equal($('mfaEnrollError').textContent, 'A factor with the friendly name "" for this user already exists');
  assert.equal($('mfaEnrollVerifyBtn').textContent, 'Try again');
  assert.equal($('mfaEnrollVerifyBtn').disabled, false);
  $('mfaEnrollCodeInput').value = '788888';
  $('mfaEnrollVerifyBtn').click();
  await tick(); await tick();
  assert.equal(out.verifies.length, 0, 'no verify call without a factor id');
  assert.equal(out.enrolls, 2, 'Try again started setup over');
  assert.equal($('mfaEnrollVerifyBtn').textContent, 'Verify & Continue');
  assert.equal($('mfaEnrollQrImg').getAttribute('src'), 'data:image/svg+xml;charset=utf-8,%3Csvg%3E');
  assert.match($('mfaEnrollSecretFallback').textContent, /Enter this code manually: ABC/);
  assert.equal($('mfaEnrollError').textContent, '');
});

test('once setup has started, Verify sends the code with the real factor id', async () => {
  const { w, out, $ } = loginPage([{ ok: true, factorId: 'f-1', totp: { qr_code: 'data:x', secret: 'S' } }]);
  await w.__start();
  $('mfaEnrollCodeInput').value = '123456';
  $('mfaEnrollVerifyBtn').click();
  await tick(); await tick();
  assert.deepEqual(out.verifies, [['f-1', '123456']]);
});
