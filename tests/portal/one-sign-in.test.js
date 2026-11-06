// Fix plan FP4.1 (2026-11-06; approved "One sign-in: Triple H Homebase").
// One sign-in page, portal/login.html, for everyone. The password is checked
// once (a supabase-js client that keeps it in memory only); then
// signin_account_kind() decides the path:
//   staff  -> the Workspace's own two-factor steps, then the Workspace's
//             store (th_auth_session) and nowhere else;
//   client -> the portal's store and the portal's own steps.
// One sign-in, never two (A1); one session per device; a role that can't be
// read is a client, never the Workspace. Runs the real portal/login.html with
// the real auth.js, portal-app.js, trusted-device.js and signin-ui.js in
// jsdom; Supabase is faked. Made-up accounts only.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { open, signIn, until, settle, stored, read, URL_, closeAll, jwt, b64, LOGIN } = require('../signin-harness');
after(closeAll);


test('the one page says what it is: Triple H Homebase, for clients and the team, with Create account beside Sign in', async () => {
  const { d } = open(URL_);
  await settle();
  assert.equal(d.querySelector('.login-kicker').textContent, 'Triple H Homebase');
  assert.equal(d.getElementById('loginSub').textContent, 'For Triple H clients and the Triple H team.');
  assert.ok(d.getElementById('tabCreate'));
  assert.equal(d.title, 'Sign in | Triple H Homebase');
});

test('a client signs in ONCE: the password session moves into the portal store and they land in the portal (A1)', async () => {
  const g = open(URL_ + '?return=/portal/contracts.html', { kind: 'client' });
  await signIn(g, 'client@example.com');
  await until(() => g.done.length, 'success');
  assert.equal(g.calls.memSignIn.length, 1, 'one password check');
  assert.equal(g.calls.setSession.length, 1);
  assert.match(g.calls.setSession[0].access_token, /^h\./);
  assert.equal(stored(g.w), null, 'no Workspace session for a client');
  assert.equal(g.w.portalAfterSignInUrl(), '/portal/contracts.html');
});

test('staff without an authenticator (none required): straight into the Workspace store, never the portal store', async () => {
  const g = open(URL_ + '?return=/tools/team.html', { kind: 'staff', role: { email: 'staff@example.com' } });
  await signIn(g, 'staff@example.com', 'right-password', true);
  await until(() => g.done.length, 'success');
  assert.equal(g.calls.setSession.length, 0, 'the portal store is never touched for staff');
  const s = JSON.parse(g.w.localStorage.getItem('th_auth_session'));
  assert.equal(s.email, 'staff@example.com');
  assert.ok(s.remember_until, 'Remember me on: 30 days');
  assert.equal(g.w.staffAfterSignInUrl(), '/tools/team.html');
});

test('staff with an authenticator: the Workspace code step, and NOTHING is stored until the code is right', async () => {
  const g = open(URL_, { kind: 'staff', factor: true, role: { email: 'staff@example.com', can_manage_invoices: true } });
  await signIn(g, 'staff@example.com');
  await until(() => g.d.getElementById('staffCodeView').style.display === 'flex', 'code step');
  assert.equal(stored(g.w), null, 'password alone stores nothing');
  assert.equal(g.d.getElementById('loginForm').style.display, 'none');
  const input = g.d.getElementById('staffCodeInput');
  input.value = '123456';
  input.dispatchEvent(new g.w.Event('input'));
  await until(() => g.done.length, 'success');
  assert.equal(g.calls.verify, 1);
  assert.ok(JSON.parse(stored(g.w)).access_token.startsWith('h.' + b64({ sub: 'u-staff', email: 'staff@example.com', aal: 'aal2' })), 'the verified (aal2) session is the one stored');
  assert.equal(g.calls.setSession.length, 0);
});

test('staff: a wrong code stores nothing and stays on the code step', async () => {
  const g = open(URL_, { kind: 'staff', factor: true, codeOk: false });
  await signIn(g, 'staff@example.com');
  await until(() => g.d.getElementById('staffCodeView').style.display === 'flex', 'code step');
  g.d.getElementById('staffCodeInput').value = '000000';
  g.d.getElementById('staffCodeSubmit').click();
  await until(() => g.d.getElementById('staffCodeError').textContent, 'error');
  assert.equal(stored(g.w), null);
  assert.equal(g.done.length, 0);
});

test('a role that cannot be read is a client -- never the Workspace on a guess', async () => {
  const g = open(URL_, { kindError: true });
  await signIn(g, 'staff@example.com');
  await until(() => g.done.length, 'success');
  assert.equal(stored(g.w), null);
  assert.equal(g.calls.setSession.length, 1);
});

test('?return= is checked per role: staff only to Workspace pages, clients only to portal pages', async () => {
  const evil = open(URL_ + '?return=https://evil.example/x', { kind: 'staff' });
  await settle();
  assert.equal(evil.w.staffAfterSignInUrl(), '/tools/workspace.html');
  assert.equal(evil.w.portalAfterSignInUrl(), '/portal/home.html');
  const crossed = open(URL_ + '?return=/tools/finance.html');
  await settle();
  assert.equal(crossed.w.portalAfterSignInUrl(), '/portal/home.html', 'a client is never sent to a Workspace page');
});

test('a wrong password says so and starts nothing', async () => {
  const g = open(URL_, { kind: 'staff' });
  await signIn(g, 'staff@example.com', 'wrong');
  await until(() => g.d.getElementById('loginError').textContent, 'error');
  assert.equal(g.d.getElementById('loginError').textContent, 'Incorrect email or password.');
  assert.equal(g.calls.rpc.length, 0);
  assert.equal(stored(g.w), null);
});

test('already signed in (Workspace): "You\'re signed in", Continue to Homebase, and switching signs out both stores first', async () => {
  const ws = { access_token: 'tok', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'steve@triplehenterprisesllc.biz', remember_until: Date.now() + 864e5 };
  const g = open(URL_, { workspaceSession: ws });
  await until(() => g.d.getElementById('signedInView').style.display === 'flex', 'signed-in card');
  assert.match(g.d.getElementById('signedInWho').textContent, /Steve · steve@triplehenterprisesllc\.biz/);
  assert.equal(g.d.getElementById('signedInContinue').textContent, 'Continue to Homebase');
  g.d.getElementById('signedInSwitch').click();
  await until(() => g.d.getElementById('signedInView').style.display === 'none', 'back to the form');
  assert.equal(stored(g.w), null, 'the Workspace session is gone');
  assert.equal(g.calls.logout, 1, 'and revoked on the server');
  assert.equal(g.calls.portalSignOut, 1, 'the portal store is cleared too');
  assert.equal(g.d.getElementById('loginForm').style.display, '');
});

test('"Create a client account" from a signed-in staff session signs out first, then opens Create account', async () => {
  const ws = { access_token: 'tok', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, email: 'steve@triplehenterprisesllc.biz', remember_until: Date.now() + 864e5 };
  const g = open(URL_, { workspaceSession: ws });
  await until(() => g.d.getElementById('signedInView').style.display === 'flex', 'signed-in card');
  g.d.getElementById('signedInCreate').click();
  await until(() => g.d.getElementById('tabCreate').getAttribute('aria-pressed') === 'true', 'create mode');
  assert.equal(stored(g.w), null);
  assert.equal(g.d.getElementById('pageTitle').textContent, 'Create your account');
});

test('a leftover portal session that belongs to staff is cleared, not used', async () => {
  const g = open(URL_, { kind: 'staff', portalSession: { access_token: jwt({ email: 'staff@example.com' }), user: { email: 'staff@example.com' } } });
  await until(() => g.calls.portalSignOut === 1, 'cleared');
  assert.equal(g.d.getElementById('signedInView').style.display, 'none');
});

test('forgot password: one reset link for everyone, to the reset page that ends back here', async () => {
  const g = open(URL_);
  await settle();
  g.d.getElementById('forgotLink').click();
  g.d.getElementById('clientEmail').value = 'someone@example.com';
  g.d.getElementById('loginForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await until(() => g.calls.recover.length, 'reset requested');
  assert.match(g.calls.recover[0], /redirect_to=https:\/\/www\.triplehenterprisesllc\.biz\/tools\/reset-password\.html/);
  assert.match(read('tools', 'reset-password.html'), /id="backToLoginLink" href="\/portal\/login\.html"/);
});

test('the old Workspace sign-in forwards here with its query, and every Workspace guard points here', () => {
  const stub = read('tools', 'login.html');
  assert.match(stub, /location\.replace\('\/portal\/login\.html' \+ location\.search \+ location\.hash\)/);
  const AUTH = read('tools', 'auth.js');
  assert.match(AUTH, /window\.location\.href = '\/portal\/login\.html\?return=' \+ returnTo;/);
  assert.match(AUTH, /'\/portal\/login\.html\?reason=mfa&return='/);
  assert.doesNotMatch(LOGIN, /sendStaffToWorkspace|th_signin_email_hint|handOffClientToPortal/);
  assert.doesNotMatch(AUTH + LOGIN, /'\/tools\/login\.html/);
});
