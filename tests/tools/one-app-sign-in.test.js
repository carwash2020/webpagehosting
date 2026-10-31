// One app (2026-10-31): after sign-in the role decides where you land.
// Clients go to the portal, staff to the Workspace. Password sign-in and the
// two-factor rules are unchanged, and nothing is handed between the two
// sign-in stacks: the wrong door clears its own session and sends the person
// to the right one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const AUTH = fs.readFileSync(repo('tools', 'auth.js'), 'utf8');
const TOOLS_LOGIN = fs.readFileSync(repo('tools', 'login.html'), 'utf8');
const PORTAL_LOGIN = fs.readFileSync(repo('portal', 'login.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected ${name}`);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const from = src.lastIndexOf('async ', start) === start - 6 ? start - 6 : start;
  return src.slice(from, i);
}

function isInternalWith(fetchImpl, { email = 'me@example.com', token = 'tok' } = {}) {
  const ctx = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', fetch: fetchImpl, Array, Promise,
    ensureFreshToken: async () => {}, getCurrentUserEmail: () => email, getAuthToken: () => token,
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(AUTH, 'isInternalAccount') + ';this.f = isInternalAccount;', ctx);
  return ctx.f;
}
const reply = (body, ok = true) => async () => ({ ok, json: async () => body });

test('isInternalAccount: true for an account with a role row, false for none, null when it cannot tell', async () => {
  assert.equal(await isInternalWith(reply([{ email: 'ME@example.com' }, { email: 'other@x.com' }]))(), true);
  assert.equal(await isInternalWith(reply([{ email: 'other@x.com' }]))(), false);
  assert.equal(await isInternalWith(reply([]))(), false);
  assert.equal(await isInternalWith(reply({}, false))(), null, 'an error status is "unknown", never "client"');
  assert.equal(await isInternalWith(async () => { throw new Error('offline'); })(), null);
  assert.equal(await isInternalWith(reply([]), { email: '' })(), null, 'no signed-in email: unknown');
});

test('Workspace sign-in: a client account (no role) never keeps a Workspace session and is sent to the portal; unknown counts as staff', () => {
  const fn = extractFn(TOOLS_LOGIN, 'finishSignInFlow');
  assert.match(fn, /if \(\(await isInternalAccount\(\)\) === false\) \{ await handOffClientToPortal\(email\); return; \}/);
  const hand = extractFn(TOOLS_LOGIN, 'handOffClientToPortal');
  assert.match(hand, /clearStoredSession\(\);/);
  assert.match(hand, /window\.location\.href = '\/portal\/login\.html'/);
  assert.doesNotMatch(hand, /access_token|refresh_token/, 'no token is handed across');
});

test('Workspace sign-in: password and two-factor are unchanged -- the role check runs only after the session is stored, i.e. after MFA / mandatory enrollment', () => {
  // Every finishSignInFlow() call comes right after persistSession().
  const calls = [...TOOLS_LOGIN.matchAll(/finishSignInFlow\(\);/g)].map((m) => TOOLS_LOGIN.slice(Math.max(0, m.index - 500), m.index));
  assert.ok(calls.length >= 4);
  for (const before of calls.filter((c) => !/async function|redirectAfterLogin/.test(c))) assert.match(before, /persistSession\(/);
  assert.match(TOOLS_LOGIN, /requiresMfaForRole\(roleInfo\)\) \{\s*await startMandatoryEnrollment\(\);/);
  assert.match(TOOLS_LOGIN, /mfaListVerifiedTotpFactor\(pendingSession\.access_token\)/);
  assert.match(TOOLS_LOGIN, /signIn\(email, password, rememberMe, \{ skipPersist: true \}\)/);
});

test('the return= allowlist is kept, and unlisted paths still fall back to the Workspace', () => {
  const fn = extractFn(TOOLS_LOGIN, 'redirectAfterLogin');
  assert.match(fn, /ALLOWED_RETURN_PATHS\.has\(returnTo\) \? returnTo : '\/tools\/workspace\.html'/);
  assert.match(TOOLS_LOGIN, /'\/tools\/workspace\.html',\n  \]\);/);
});

test('portal sign-in: a staff account (positive role read) gets no portal session and is sent to the Workspace sign-in; failures count as a client', async () => {
  const fn = extractFn(PORTAL_LOGIN, 'goHomeAfterSignIn');
  assert.match(fn, /portalAccountIsStaff\(\)/);
  assert.match(fn, /client\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(fn, /window\.location\.replace\('\/tools\/login\.html'\)/);
  assert.match(fn, /window\.location\.replace\('\/portal\/home\.html'\)/);
  const run = async (result) => {
    const ctx = { Array, client: { from: () => ({ select: () => ({ limit: async () => result }) }) } };
    vm.createContext(ctx);
    vm.runInContext(extractFn(PORTAL_LOGIN, 'portalAccountIsStaff') + ';this.f = portalAccountIsStaff;', ctx);
    return ctx.f();
  };
  assert.equal(await run({ data: [{ email: 'a@b.c' }], error: null }), true);
  assert.equal(await run({ data: [], error: null }), false, 'RLS hides account_roles from a client');
  assert.equal(await run({ data: null, error: { message: 'x' } }), false);
});

test('portal sign-in: every path home goes through the role check, the already-signed-in one included', () => {
  assert.doesNotMatch(PORTAL_LOGIN.replace(/async function goHomeAfterSignIn[\s\S]*?\n  \}\n/, ''), /window\.location\.replace\('\/portal\/home\.html'\)/);
  assert.match(PORTAL_LOGIN, /signingInEmail = email;\n    goHomeAfterSignIn\(\);\n  \}\);/);
});

test('each door pre-fills the email for the other, through sessionStorage (not the URL)', () => {
  assert.match(TOOLS_LOGIN, /sessionStorage\.getItem\('th_signin_email_hint'\)/);
  assert.match(PORTAL_LOGIN, /sessionStorage\.getItem\('th_signin_email_hint'\)/);
  assert.match(TOOLS_LOGIN, /sessionStorage\.setItem\('th_signin_email_hint'/);
  assert.match(PORTAL_LOGIN, /sessionStorage\.setItem\('th_signin_email_hint'/);
  assert.doesNotMatch(TOOLS_LOGIN + PORTAL_LOGIN, /login\.html\?email=/);
});
