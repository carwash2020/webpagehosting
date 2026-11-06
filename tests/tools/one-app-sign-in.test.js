// One app (2026-10-31): after sign-in the role decides where you land.
// Clients go to the portal, staff to the Workspace. Since fix plan FP4.1
// (2026-11-06) there is one door, /portal/login.html: the password is checked
// once, on a client that stores nothing, and the session goes to exactly one
// store -- the portal's for a client, the Workspace's for staff (after its
// two-factor step). The behaviour is driven end to end in
// tests/portal/one-sign-in.test.js; these pin the shape.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const AUTH = fs.readFileSync(repo('tools', 'auth.js'), 'utf8');
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

test('one door: the role is asked of the server, and only a positive "staff" answer counts as staff', async () => {
  const run = async (rpcClient) => {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(extractFn(PORTAL_LOGIN, 'accountKind') + ';this.f = accountKind;', ctx);
    return ctx.f(rpcClient);
  };
  const answering = (result) => ({ rpc: async (name) => { assert.equal(name, 'signin_account_kind'); return result; } });
  assert.equal(await run(answering({ data: 'staff', error: null })), 'staff');
  assert.equal(await run(answering({ data: 'client', error: null })), 'client');
  assert.equal(await run(answering({ data: null, error: { message: 'missing function' } })), 'client', 'an error is never "staff"');
  assert.equal(await run({ rpc: async () => { throw new Error('offline'); } }), 'client');
});

test('one door: the password is checked on a client that stores nothing, and each kind of account gets exactly one store', () => {
  assert.match(PORTAL_LOGIN, /const signinClient = createClient\([\s\S]*?\{ auth: \{ storage: memoryStore, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false \} \}/);
  assert.match(PORTAL_LOGIN, /await signinClient\.auth\.signInWithPassword\(\{ email, password \}\)/);
  // Only one place stores a Workspace session, and only one hands a session to the portal store.
  assert.equal((PORTAL_LOGIN.match(/persistSession\(/g) || []).length, 1);
  assert.equal((PORTAL_LOGIN.match(/client\.auth\.setSession\(/g) || []).length, 1);
  const submit = PORTAL_LOGIN.slice(PORTAL_LOGIN.indexOf('await signinClient.auth.signInWithPassword('), PORTAL_LOGIN.indexOf('// ---- Staff path'));
  const staffAt = submit.indexOf("if ((await accountKind(signinClient)) === 'staff') {");
  const staffEnd = submit.indexOf('return;', staffAt);
  assert.ok(staffAt > 0 && staffAt < submit.indexOf('client.auth.setSession('), 'staff branch off before anything reaches the portal store');
  assert.doesNotMatch(submit.slice(staffAt, staffEnd), /setSession|portalSetRemember/, 'staff never get a portal session');
});

test('Workspace two-factor is unchanged: the Workspace session is stored only after the code, a recovery code, or required setup', () => {
  const store = extractFn(PORTAL_LOGIN, 'staffStoreAndFinish');
  assert.match(store, /persistSession\(session, staffRememberMe\);/);
  const cont = extractFn(PORTAL_LOGIN, 'staffContinueSignIn');
  assert.match(cont, /const factor = await mfaListVerifiedTotpFactor\(staffPending\.access_token\);/);
  assert.match(cont, /if \(requiresMfaForRole\(roleInfo\)\) \{ await staffStartEnrollment\(\); return; \}/);
  assert.ok(cont.indexOf('staffShow(\'staffCodeView\')') < cont.lastIndexOf('staffStoreAndFinish(staffPending)'), 'with a factor, the code step returns before any store');
});

test('the Workspace return= allowlist is kept, and unlisted paths still fall back to the Workspace', () => {
  const fn = extractFn(PORTAL_LOGIN, 'staffAfterSignInUrl');
  assert.match(fn, /STAFF_RETURN_PATHS\.has\(r\) \? r : '\/tools\/workspace\.html'/);
  assert.match(PORTAL_LOGIN, /'\/tools\/workspace\.html',\n  \]\);/);
});

test('a leftover portal session that belongs to staff is signed out, and every path home for a client is the same one', () => {
  assert.match(PORTAL_LOGIN, /if \(\(await accountKind\(client\)\) === 'staff'\) \{ await client\.auth\.signOut\(\{ scope: 'local' \}\); return; \}/);
  assert.match(extractFn(PORTAL_LOGIN, 'confirmSignupCode'), /goHomeAfterSignIn\(\);/, 'a brand-new account takes the same way in');
  const trusted = PORTAL_LOGIN.match(/async function portalSignInOnTrustedDevice\(email\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(trusted, /goHomeAfterSignIn\(\);/);
});

test('the two-door hand-off is gone: no email hint between pages, nothing in the URL', () => {
  assert.doesNotMatch(PORTAL_LOGIN, /th_signin_email_hint|portalAccountIsStaff|sendStaffToWorkspace/);
  assert.doesNotMatch(PORTAL_LOGIN, /login\.html\?email=/);
  assert.doesNotMatch(PORTAL_LOGIN, /location\.(replace|href)\s*=?\s*\(?'\/tools\/login\.html/);
});
