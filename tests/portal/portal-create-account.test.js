// Portal Create account (2026-11-04, handoff §2 and §5; Connor chose the
// server-side path). Runs the real portal/login.html with the real
// portal-app.js and signin-ui.js in jsdom, portal-signup stubbed: Create
// account sits next to Sign in; the 6-digit code step confirms; the page
// then signs in with the password just chosen and lands where the visitor
// was headed (back on the contract from a Review & Sign email).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const APP = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const UI_JS = fs.readFileSync(repo('signin-ui.js'), 'utf8');
const TRUSTED_JS = fs.readFileSync(repo('trusted-device.js'), 'utf8');
const LOGIN = fs.readFileSync(repo('portal', 'login.html'), 'utf8');

const windows = [];
after(() => { for (const w of windows) { try { w.close(); } catch (e) { /* closed */ } } });

function open(url, { signup, signInOk = true } = {}) {
  const calls = { signup: [], signIn: [], replaced: [] };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: async (a) => { calls.signIn.push(a); return signInOk ? { data: {}, error: null } : { error: { message: 'Email not confirmed', status: 400 } }; },
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }) },
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
    runScripts: 'dangerously', url,
    beforeParse(w) {
      w.__client = client;
      w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }); // reduced motion: no animation delay
      w.fetch = async (u, init) => {
        if (String(u).endsWith('/functions/v1/portal-signup')) {
          const body = JSON.parse(init.body);
          calls.signup.push(body);
          const a = (signup || {})[body.action] || { ok: true, next: 'code' };
          return { ok: a.ok, status: a.ok ? 200 : 400, json: async () => a };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };
    },
  });
  windows.push(dom.window);
  const w = dom.window;
  // Where the page would go (location.replace can't be spied in jsdom).
  w.ThSignin && (w.ThSignin.success = (done) => done());
  return { w, d: w.document, calls };
}
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(check, what) {
  for (let i = 0; i < 200; i++) { if (check()) return; await settle(5); }
  assert.fail('timed out: ' + what);
}

test('Create account sits next to Sign in and switches the form to the approved wording', async () => {
  const { d } = open('https://www.triplehenterprisesllc.biz/portal/login.html');
  await settle();
  assert.equal(d.getElementById('tabSignIn').getAttribute('aria-pressed'), 'true');
  assert.equal(d.getElementById('rememberMe').checked, false, 'Remember me starts OFF (handoff §5)');
  d.getElementById('tabCreate').click();
  assert.equal(d.getElementById('pageTitle').textContent, 'Create your account');
  assert.equal(d.getElementById('loginSub').textContent, "Use the email address Triple H sends your invoices and quotes to. We'll match you to them automatically.");
  assert.equal(d.querySelector('label[for="clientPassword"]').textContent, 'Choose a password');
  assert.equal(d.getElementById('clientPassword').autocomplete, 'new-password');
  assert.equal(d.getElementById('loginSubmitBtn').textContent, 'Create account');
  assert.equal(d.getElementById('createNextHint').hidden, false);
  assert.equal(d.getElementById('forgotLink').style.display, 'none');
  d.getElementById('tabSignIn').click();
  assert.equal(d.getElementById('pageTitle').textContent, 'Sign in');
  assert.equal(d.getElementById('createNextHint').hidden, true);
});

test('the whole path: email + password -> code -> confirmed -> signed in with that password', async () => {
  const { d, calls } = open('https://www.triplehenterprisesllc.biz/portal/login.html');
  await settle();
  d.getElementById('tabCreate').click();
  d.getElementById('clientEmail').value = 'Tony@Example.com';
  d.getElementById('clientPassword').value = 'fridge-fixed-1';
  d.getElementById('loginForm').dispatchEvent(new d.defaultView.Event('submit', { cancelable: true }));
  await until(() => d.getElementById('signupCodeOverlay').style.display === 'flex', 'code step');
  assert.deepEqual(calls.signup[0], { action: 'start', email: 'Tony@Example.com', password: 'fridge-fixed-1' });
  // Fix plan RP4.2 (2026-11-07): neutral -- never "we sent".
  assert.equal(d.getElementById('signupCodeSub').textContent, "If Tony@Example.com doesn't have an account yet, a 6-digit code is on its way. Check spam.");
  assert.equal(calls.signIn.length, 0, 'nothing signs in before the code');

  d.getElementById('signupCodeInput').value = '482913';
  d.getElementById('signupCodeSubmit').click();
  await until(() => calls.signIn.length === 1, 'sign-in');
  assert.deepEqual(calls.signup[1], { action: 'verify', email: 'tony@example.com', code: '482913' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls.signIn[0])), { email: 'tony@example.com', password: 'fridge-fixed-1' });
});

test('a wrong code shows the server\'s reason and signs nobody in; Send a new code asks again', async () => {
  const { d, calls } = open('https://www.triplehenterprisesllc.biz/portal/login.html', { signup: { verify: { ok: false, error: "That code didn't work. Check the latest email from us, or send a new code." } } });
  await settle();
  d.getElementById('tabCreate').click();
  d.getElementById('clientEmail').value = 'tony@example.com';
  d.getElementById('clientPassword').value = 'fridge-fixed-1';
  d.getElementById('loginForm').dispatchEvent(new d.defaultView.Event('submit', { cancelable: true }));
  await until(() => d.getElementById('signupCodeOverlay').style.display === 'flex', 'code step');
  d.getElementById('signupCodeInput').value = '111111';
  d.getElementById('signupCodeSubmit').click();
  await until(() => d.getElementById('signupCodeError').textContent, 'error');
  assert.match(d.getElementById('signupCodeError').textContent, /didn't work/);
  assert.equal(calls.signIn.length, 0);
  d.getElementById('signupCodeResend').click();
  await until(() => calls.signup.length === 3, 'resend');
  assert.equal(calls.signup[2].action, 'start');
});

test('a short password is caught on the page; nothing is sent', async () => {
  const { d, calls } = open('https://www.triplehenterprisesllc.biz/portal/login.html');
  await settle();
  d.getElementById('tabCreate').click();
  d.getElementById('clientEmail').value = 'tony@example.com';
  d.getElementById('clientPassword').value = 'short';
  d.getElementById('loginForm').dispatchEvent(new d.defaultView.Event('submit', { cancelable: true }));
  await settle();
  assert.equal(d.getElementById('loginError').textContent, 'Password needs to be at least 8 characters.');
  assert.equal(calls.signup.length, 0);
});

test('opened from a contract email: the page says a contract is waiting', async () => {
  const { d } = open('https://www.triplehenterprisesllc.biz/portal/login.html?return=%2Fportal%2Fcontracts.html%23contract-card-7');
  await settle();
  assert.equal(d.getElementById('loginSub').textContent, 'A contract is waiting for your signature. Sign in or create your account and it opens right away.');
});

test('the old "No sign-up here" line is replaced by an honest pointer to Create account', () => {
  assert.doesNotMatch(LOGIN, /<p[^>]*>No sign-up here/, 'gone from the page (it survives only in the history comment)');
  assert.match(LOGIN, /New here\? Tap <strong>Create account<\/strong> and use the email your invoice or quote was sent to\./);
});

test('return path: only listed portal pages and a plain #anchor are ever followed', () => {
  const ctx = { URLSearchParams, encodeURIComponent, window: { location: { search: '', pathname: '/portal/contracts.html', hash: '#contract-card-7' } } };
  vm.createContext(ctx);
  const src = APP.slice(APP.indexOf('const PORTAL_RETURN_PAGES'), APP.indexOf('// Every signed-in page\'s check that the second step'));
  vm.runInContext(src + ';this.t = portalReturnTarget; this.a = portalAfterSignInUrl; this.l = portalLoginUrl;', ctx);
  assert.equal(ctx.a('?return=%2Fportal%2Fcontracts.html%23contract-card-7'), '/portal/contracts.html#contract-card-7');
  assert.equal(ctx.a('?return=%2Fportal%2Fdashboard.html'), '/portal/dashboard.html');
  for (const bad of ['https://evil.example/portal/home.html', '//evil.example', '/tools/workspace.html', '/portal/login.html', '/portal/contracts.html#"><script>', 'javascript:alert(1)', '/portal/../tools/x.html']) {
    assert.equal(ctx.a('?return=' + encodeURIComponent(bad)), '/portal/home.html', bad);
  }
  assert.equal(ctx.a(''), '/portal/home.html');
  assert.equal(ctx.l(), '/portal/login.html?return=%2Fportal%2Fcontracts.html%23contract-card-7');
  ctx.window.location.pathname = '/portal/set-password.html'; ctx.window.location.hash = '';
  assert.equal(ctx.l(), '/portal/login.html', 'a page not on the list just goes to sign in');
});

// --- Fix plan RP4.2 (2026-11-07) --------------------------------------------

async function toCodeStep(opts) {
  const g = open('https://www.triplehenterprisesllc.biz/portal/login.html', opts);
  await settle();
  g.d.getElementById('tabCreate').click();
  g.d.getElementById('clientEmail').value = 'tony@example.com';
  g.d.getElementById('clientPassword').value = 'fridge-fixed-1';
  g.d.getElementById('loginForm').dispatchEvent(new g.d.defaultView.Event('submit', { cancelable: true }));
  await until(() => g.d.getElementById('signupCodeOverlay').style.display === 'flex', 'code step');
  return g;
}

test('RP4.2: the code step is neutral and offers Sign in instead; nothing on it says a code was definitely sent', async () => {
  const { d } = await toCodeStep();
  const overlay = d.getElementById('signupCodeOverlay').textContent;
  assert.doesNotMatch(overlay, /We sent/);
  assert.match(overlay, /Already have an account\? Sign in instead\./);
  assert.equal(d.getElementById('signupCodeNote').style.display, 'none');
  d.getElementById('signupCodeSignIn').click();
  assert.equal(d.getElementById('signupCodeOverlay').style.display, 'none');
  assert.equal(d.getElementById('pageTitle').textContent, 'Sign in');
  assert.equal(d.getElementById('clientEmail').value, 'tony@example.com', 'email kept');
  assert.equal(d.getElementById('clientPassword').value, '', 'the new-account password is not reused');
});

test('RP4.2: Resend never claims a new code is definitely coming', async () => {
  const { d, calls } = await toCodeStep();
  d.getElementById('signupCodeResend').click();
  await until(() => d.getElementById('signupCodeNote').style.display === 'block', 'note');
  assert.equal(calls.signup[1].action, 'start');
  assert.equal(d.getElementById('signupCodeNote').textContent, "If this email doesn't have an account yet, a new code is on its way. Use the newest one.");
  assert.doesNotMatch(d.getElementById('signupCodeNote').textContent, /^A new code is on its way/);
});

test('RP4.2: the server\'s `limited` answer says plainly that no new code was sent (first try and Resend)', async () => {
  const limited = { start: { ok: true, next: 'code', limited: true } };
  const { d } = await toCodeStep({ signup: limited });
  assert.equal(d.getElementById('signupCodeNote').style.display, 'block');
  assert.equal(d.getElementById('signupCodeNote').textContent, 'No new code was sent. Try again in a little while.');
  d.getElementById('signupCodeNote').style.display = 'none';
  d.getElementById('signupCodeResend').click();
  await until(() => d.getElementById('signupCodeNote').style.display === 'block', 'note');
  assert.equal(d.getElementById('signupCodeNote').textContent, 'No new code was sent. Try again in a little while.');
});
