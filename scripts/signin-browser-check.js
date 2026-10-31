#!/usr/bin/env node
// Real-browser check of the Triple H sign-in screens (portal/login.html and
// tools/login.html), added with the 2026-10-31 sign-in rebuild.
//
// What it does, against a local static server and a MOCKED Supabase (no real
// account, no network to the live project):
//   1. Asserts the behaviour the jsdom tests can't: "Remember me" persistence
//      across a simulated browser restart, the 30-day cutoff, "Trust this
//      device", wrong-password and wrong-code states, the ~600ms success
//      beat, prefers-reduced-motion, fonts actually loading, tap-target
//      sizes, and an axe-core WCAG 2.2 AA scan of every state.
//   2. With --screenshots, saves every state at 390x844 and 1440x900.
//
// Dev-only, like scripts/check-visual-snapshot.js: it needs Playwright, which
// is deliberately NOT a dependency of this repo (the deployed site has no
// build step and CI runs jsdom only). Run it where Playwright is installed:
//
//   SUPABASE_UMD=/path/to/supabase.js AXE_JS=/path/to/axe.min.js \
//     node scripts/signin-browser-check.js [--screenshots]
//
// SUPABASE_UMD / AXE_JS are only needed when the machine can't reach
// cdn.jsdelivr.net (the pages load supabase-js from there); AXE_JS is
// optional (the axe scan is skipped without it).

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.argv.includes('--screenshots');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots', 'signin');
const SUPABASE_UMD = process.env.SUPABASE_UMD;
const AXE_JS = process.env.AXE_JS;
const SB = 'https://csvfqdjuobylgafgolho.supabase.co';
const STORAGE_KEY = 'sb-csvfqdjuobylgafgolho-auth-token';
const VIEWPORTS = [
  { tag: '390x844', width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 },
  { tag: '1440', width: 1440, height: 900, isMobile: false, deviceScaleFactor: 1 },
];

// ---- tiny static server -----------------------------------------------------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---- mocked Supabase --------------------------------------------------------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(email, aal) {
  const now = Math.floor(Date.now() / 1000);
  return [b64({ alg: 'HS256', typ: 'JWT' }), b64({ iss: SB + '/auth/v1', sub: 'user-' + email, aud: 'authenticated', role: 'authenticated', email, aal, amr: [{ method: 'password', timestamp: now }], session_id: 'sess-1', iat: now, exp: now + 3600 }), 'sig'].join('.');
}
const FACTOR = { id: 'factor-1', factor_type: 'totp', status: 'verified', friendly_name: 'Authenticator' };
const USERS = {
  'client@example.com': { password: 'correct-horse', factors: [] },
  'client2fa@example.com': { password: 'correct-horse', factors: [FACTOR] },
  'steve@triplehenterprisesllc.biz': { password: 'correct-horse', factors: [FACTOR], role: true },
  'newhire@triplehenterprisesllc.biz': { password: 'correct-horse', factors: [], role: true },
};
function sessionBody(email, aal) {
  const u = USERS[email];
  const now = Math.floor(Date.now() / 1000);
  return { access_token: jwt(email, aal), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'refresh-' + aal, user: { id: 'user-' + email, aud: 'authenticated', email, factors: u.factors, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
}

async function mockSupabase(page, ctl) {
  if (SUPABASE_UMD) {
    await page.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SUPABASE_UMD) }));
  }
  // Fonts/CSS from Google are not needed; keep the run offline-safe.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const p = url.pathname;
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = JSON.parse(req.postData() || '{}');
      ctl.tokenCalls++;
      if (ctl.hold) await ctl.hold;
      if (ctl.offline) return route.abort('failed');
      const u = USERS[email];
      if (!u || u.password !== password) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', error: 'invalid_grant', error_description: 'Invalid login credentials' });
      ctl.lastEmail = email;
      return json(200, sessionBody(email, 'aal1'));
    }
    if (p === '/auth/v1/user') {
      const email = ctl.lastEmail || 'client@example.com';
      return json(200, sessionBody(email, 'aal1').user);
    }
    if (/\/auth\/v1\/factors\/[^/]+\/challenge$/.test(p)) return json(200, { id: 'challenge-1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
    if (/\/auth\/v1\/factors\/[^/]+\/verify$/.test(p)) {
      const { code } = JSON.parse(req.postData() || '{}');
      if (code !== '123456') return json(400, { code: 400, error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered', error_description: 'Invalid TOTP code entered' });
      return json(200, sessionBody(ctl.lastEmail || 'client2fa@example.com', 'aal2'));
    }
    if (p === '/auth/v1/factors' && req.method() === 'POST') {
      const qr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M2 2h7v7H2zM20 2h7v7h-7zM2 20h7v7H2zM12 4h3v3h-3zM11 12h7v3h-3v4h-4zM21 14h6v3h-6zM13 22h8v3h-8z" fill="#000"/></svg>';
      return json(200, { id: 'factor-new', type: 'totp', totp: { qr_code: qr, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' } });
    }
    if (p === '/auth/v1/recover') return json(200, {});
    if (p.startsWith('/rest/v1/account_roles')) {
      return json(200, [{ email: 'steve@triplehenterprisesllc.biz', role_name: 'Owner', can_manage_roles: true, can_manage_invoices: true }, { email: 'newhire@triplehenterprisesllc.biz', role_name: 'Employee', can_manage_invoices: true }]);
    }
    if (p === '/rest/v1/rpc/generate_internal_recovery_codes') return json(200, ['K7QM-4XD2', 'R9TB-6HNW', 'C3LA-8PZV', 'W5YE-2JGF', 'D8NS-7KUQ', 'M2VH-9BRX', 'T6FC-3ZAE', 'Q4JP-5WLD', 'H1XU-8MNG', 'B7RZ-2YKT']);
    return json(200, []);
  });
}

// ---- assertions -------------------------------------------------------------
let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

async function newPage(browser, base, vp, ctl, extra) {
  const context = await browser.newContext(Object.assign({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.isMobile, deviceScaleFactor: vp.deviceScaleFactor, serviceWorkers: 'block' }, extra || {}));
  const page = await context.newPage();
  await mockSupabase(page, ctl);
  // The post-login destinations: a stub, so a redirect is observable without a real session behind it.
  await page.route(/\/(portal\/home|tools\/workspace)\.html/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>dest</title><body>signed in</body>' }));
  page.on('pageerror', (e) => {
    // Chromium logs this when the redirect target (a bare stub page here) does not opt in to cross-document view transitions. Not a sign-in problem.
    if (/ViewTransition opt-in disabled/.test(e.message)) return;
    failures++; console.log('  FAIL page error: ' + e.message);
  });
  return { context, page, base };
}

const PORTAL = { name: 'portal', path: '/portal/login.html', email: '#clientEmail', pw: '#clientPassword', submit: '#loginSubmitBtn', err: '#loginError', remember: '#rememberMe', forgot: '#forgotLink', dest: '/portal/home.html' };
const TOOLS = { name: 'tools', path: '/tools/login.html', email: '#loginEmail', pw: '#loginPassword', submit: '#loginBtn', err: '#loginError', remember: '#rememberMe', forgot: '#forgotPasswordLink', dest: '/tools/workspace.html' };

async function fill(page, s, email, pw) {
  await page.fill(s.email, email);
  await page.fill(s.pw, pw);
}
const store = (page, kind, key) => page.evaluate(([k, key2]) => { try { return window[k].getItem(key2); } catch (e) { return null; } }, [kind, key]);

async function shot(page, vp, name, settleMs) {
  if (!SHOTS) return;
  await page.mouse.move(2, 2); // no hover state in the photos
  await page.waitForTimeout(settleMs === undefined ? 450 : settleMs); // shake / fade finished
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}-${vp.tag}.png`) });
}

async function axeScan(page, label) {
  if (!AXE_JS) return;
  await page.addScriptTag({ content: fs.readFileSync(AXE_JS, 'utf8') });
  const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }));
  const bad = res.violations.filter((v) => v.impact !== 'minor').map((v) => v.id + ' x' + v.nodes.length);
  check('axe WCAG A/AA clean: ' + label, bad.length === 0, bad);
}

async function targetSizes(page, selectors, label) {
  const small = await page.evaluate((sels) => sels.map((s) => {
    const el = document.querySelector(s);
    if (!el) return s + ' missing';
    const r = (el.closest('label') || el).getBoundingClientRect();
    return r.height >= 48 && r.width >= 48 ? null : s + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
  }).filter(Boolean), selectors);
  check('tap targets >= 48px: ' + label, small.length === 0, small);
}

async function runScreen(browser, base, S, vp) {
  console.log(`\n== ${S.name} @ ${vp.tag}`);
  const pre = S.name === 'portal' ? 'p' : 't';
  const ctl = { tokenCalls: 0 };
  let { page, context } = await newPage(browser, base, vp, ctl);
  await page.goto(base + S.path);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);

  // -- default
  const ghost = await page.evaluate(() => { const g = document.querySelector('.si-ghost'); const cs = getComputedStyle(g); return { op: cs.opacity, src: g.getAttribute('src'), w: g.getBoundingClientRect().width, vw: innerWidth, aria: g.getAttribute('aria-hidden') }; });
  check('ghost logo at 8% opacity', ghost.op === '0.08', ghost);
  check('ghost logo is the existing site logo, decorative', /logo-signature-orange\.webp/.test(ghost.src) && ghost.aria === 'true');
  check('ghost logo is big', ghost.w >= Math.min(ghost.vw * 0.55, 480), ghost.w);
  const fonts = await page.evaluate(() => ({ h1: getComputedStyle(document.querySelector('h1')).fontFamily, input: getComputedStyle(document.querySelector('input')).fontFamily, bricolage: document.fonts.check('700 20px "Bricolage Grotesque"'), geist: document.fonts.check('16px "Geist"'), h1Weight: getComputedStyle(document.querySelector('h1')).fontWeight }));
  check('display font is Bricolage Grotesque, loaded', /^"?Bricolage Grotesque/.test(fonts.h1) && fonts.bricolage, fonts);
  check('body font is Geist, loaded', /^"?Geist/.test(fonts.input) && fonts.geist, fonts);
  check('no Inter anywhere in computed fonts', await page.evaluate(() => ![...document.querySelectorAll('body *')].some((e) => /\bInter\b/.test(getComputedStyle(e).fontFamily))));
  const btnBg = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, S.submit);
  check('primary button is brand orange #F26B1D', btnBg === 'rgb(242, 107, 29)', btnBg);
  check('no arrows in any button', await page.evaluate(() => ![...document.querySelectorAll('button')].some((b) => /[←-⇿⟵-⟹➔-➿]|&[lr]arr;|(->|=>)/.test(b.textContent))));
  await targetSizes(page, [S.email, S.pw, S.submit, S.remember, S.forgot, '.si-toggle'], 'default');
  await shot(page, vp, `${pre}01-default`);
  await axeScan(page, S.name + ' default');

  // -- show / hide password
  await page.fill(S.email, 'client@example.com');
  await page.fill(S.pw, 'hunter2-example');
  await shot(page, vp, `${pre}02-password-hidden-filled`);
  await page.click('.si-toggle');
  check('Show reveals the password', (await page.getAttribute(S.pw, 'type')) === 'text' && (await page.textContent('.si-toggle')) === 'Hide' && (await page.getAttribute('.si-toggle', 'aria-pressed')) === 'true');
  await shot(page, vp, `${pre}03-password-shown`);
  await page.click('.si-toggle');
  check('Hide masks it again', (await page.getAttribute(S.pw, 'type')) === 'password');

  // -- loading
  let release;
  ctl.hold = new Promise((r) => { release = r; });
  await page.fill(S.pw, 'wrong-password');
  await page.click(S.submit);
  await page.waitForFunction((sel) => document.querySelector(sel).getAttribute('aria-busy') === 'true', S.submit);
  check('loading: button disabled + aria-busy + label', (await page.isDisabled(S.submit)) && /Signing/i.test(await page.textContent(S.submit)));
  const spinner = await page.evaluate((sel) => { const cs = getComputedStyle(document.querySelector(sel), '::before'); return { content: cs.content, width: cs.width, position: cs.position, anim: cs.animationName }; }, S.submit);
  check('loading: the spinner is actually drawn in the button', spinner.content !== 'none' && spinner.width === '18px' && spinner.position === 'static' && spinner.anim === 'si-spin', spinner);
  await shot(page, vp, `${pre}04-loading`, 0);
  ctl.hold = null; release();

  // -- wrong password
  await page.waitForFunction((sel) => document.querySelector(sel).textContent.trim().length > 0, S.err);
  check('wrong password: message shown', (await page.textContent(S.err)).trim() === 'Incorrect email or password.');
  check('wrong password: field marked invalid + focused, button usable', (await page.getAttribute(S.pw, 'aria-invalid')) === 'true' && (await page.evaluate((sel) => document.activeElement === document.querySelector(sel), S.pw)) && !(await page.isDisabled(S.submit)));
  check('wrong password: error is announced (role=alert)', (await page.getAttribute(S.err, 'role')) === 'alert');
  await shot(page, vp, `${pre}05-wrong-password`);
  await axeScan(page, S.name + ' wrong password');
  await page.type(S.pw, 'x');
  check('typing again clears the invalid state', (await page.getAttribute(S.pw, 'aria-invalid')) === null);

  // -- forgot password
  await page.click(S.forgot);
  await page.waitForTimeout(80);
  await shot(page, vp, `${pre}06-forgot-password`);
  await axeScan(page, S.name + ' forgot password');
  if (S.name === 'portal') {
    await page.click(S.submit);
  } else {
    await page.click('#sendResetBtn');
  }
  await page.waitForTimeout(250);
  await shot(page, vp, `${pre}07-reset-link-sent`);
  await context.close();

  // -- 2FA step (account with a verified factor)
  const twoFaUser = S.name === 'portal' ? 'client2fa@example.com' : 'steve@triplehenterprisesllc.biz';
  const c2 = { tokenCalls: 0 };
  ({ page, context } = await newPage(browser, base, vp, c2));
  await page.goto(base + S.path);
  await page.waitForLoadState('networkidle');
  await fill(page, S, twoFaUser, 'correct-horse');
  await page.click(S.submit);
  const trustSel = S.name === 'portal' ? '#portalTrustDevice' : '#thTrustDevice';
  await page.waitForSelector(trustSel, { state: 'visible' });
  const trustLabel = await page.evaluate((s) => document.querySelector(s).closest('label').textContent.replace(/\s+/g, ' ').trim(), trustSel);
  check('2FA step has "Trust this device for 30 days"', /Trust this device for 30 days/.test(trustLabel), trustLabel);
  await targetSizes(page, [trustSel, '#mfaChallengeCodeInput'].filter(() => true).slice(0, 1), '2FA trust switch');
  await page.waitForTimeout(80);
  await shot(page, vp, `${pre}08-2fa-code`);
  await axeScan(page, S.name + ' 2FA step');
  await page.type('#mfaChallengeCodeInput', '123', { delay: 10 });
  await shot(page, vp, `${pre}09-2fa-code-typing`);
  await page.fill('#mfaChallengeCodeInput', '');
  await page.type('#mfaChallengeCodeInput', '000000', { delay: 10 });
  if (S.name === 'portal') await page.click('#mfaChallengeSubmit');
  await page.waitForFunction(() => document.querySelector('#mfaChallengeError').textContent.trim().length > 0);
  await page.waitForTimeout(50);
  await shot(page, vp, `${pre}10-2fa-wrong-code`);
  await context.close();

  // -- success: logo un-ghosts, form settles (paused mid-way, then done)
  const c3 = { tokenCalls: 0 };
  ({ page, context } = await newPage(browser, base, vp, c3));
  // Freeze only the 600ms redirect timer so the page stays put and can be photographed mid-animation.
  await page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...rest) => (ms === 600 ? 0 : st(fn, ms, ...rest)); });
  await page.goto(base + S.path);
  await page.waitForLoadState('networkidle');
  await fill(page, S, 'client@example.com', 'correct-horse');
  if (S.name === 'tools') await page.evaluate(() => { localStorage.setItem('th_workspace_faceid_offered_client@example.com', '1'); });
  // Tools: this fake account has no role row requiring 2FA, so it goes straight through.
  await page.click(S.submit);
  await page.waitForFunction(() => document.body.classList.contains('is-success'));
  await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 300; }));
  await shot(page, vp, `${pre}11-success-midway`, 0);
  await page.evaluate(() => document.getAnimations().forEach((a) => { a.currentTime = 600; }));
  await shot(page, vp, `${pre}12-success-done`, 0);
  await context.close();

  // -- tap targets / axe on tools enrollment + recovery codes (employee mandatory 2FA)
  if (S.name === 'tools') {
    const c4 = { tokenCalls: 0 };
    ({ page, context } = await newPage(browser, base, vp, c4));
    await page.goto(base + S.path);
    await page.waitForLoadState('networkidle');
    await fill(page, S, 'newhire@triplehenterprisesllc.biz', 'correct-horse');
    await page.click(S.submit);
    await page.waitForSelector('#mfaEnrollView', { state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#mfaEnrollQrImg').getAttribute('src'));
    check('employee without 2FA is forced into setup (mandatory)', true);
    await page.waitForTimeout(150);
    await shot(page, vp, 't13-mandatory-2fa-setup');
    await axeScan(page, 'tools mandatory setup');
    await page.fill('#mfaEnrollCodeInput', '123456');
    await page.waitForSelector('#mfaRecoveryCodesView', { state: 'visible' });
    await page.waitForTimeout(100);
    await shot(page, vp, 't14-recovery-codes');
    await context.close();
  }
}

// ---- behaviour: persistence, trust, redirects, timing ------------------------
async function runBehaviour(browser, base) {
  const vp = VIEWPORTS[0];
  console.log('\n== portal: Remember me (30 days) vs session-only');
  for (const remember of [true, false]) {
    const ctl = { tokenCalls: 0 };
    const { page, context } = await newPage(browser, base, vp, ctl);
    await page.goto(base + PORTAL.path);
    await page.waitForLoadState('networkidle');
    if (!remember) await page.click('label[for="rememberMe"]');
    check(`remember switch is ${remember ? 'on' : 'off'} as set`, (await page.isChecked('#rememberMe')) === remember);
    await fill(page, PORTAL, 'client@example.com', 'correct-horse');
    const t0 = Date.now();
    await Promise.all([page.waitForURL('**/portal/home.html'), page.click(PORTAL.submit)]);
    const dt = Date.now() - t0;
    check('sign-in still redirects to /portal/home.html', true);
    check('success beat is ~600ms before redirect', dt >= 550 && dt < 1500, dt);
    const inLocal = await store(page, 'localStorage', STORAGE_KEY);
    const inSession = await store(page, 'sessionStorage', STORAGE_KEY);
    const until = Number(await store(page, 'localStorage', 'th_portal_remember_until'));
    if (remember) {
      check('ON: session persisted in localStorage', !!inLocal && !inSession);
      const days = (until - Date.now()) / 86400000;
      check('ON: hard 30-day cutoff recorded', days > 29.9 && days <= 30, days);
    } else {
      check('OFF: session lives in sessionStorage only', !inLocal && !!inSession);
      check('OFF: no 30-day cutoff recorded', !until);
    }
    // browser restart = new context carrying only what is persisted on disk (localStorage), no sessionStorage
    const state = await context.storageState();
    await context.close();
    const ctl2 = { tokenCalls: 0 };
    const again = await newPage(browser, base, vp, ctl2, { storageState: state });
    await again.page.goto(base + PORTAL.path);
    await again.page.waitForTimeout(700);
    const landedHome = /\/portal\/home\.html$/.test(again.page.url());
    check(remember ? 'ON: after browser restart still signed in (goes straight to Home)' : 'OFF: after browser restart signed out (sign-in form shown)', remember ? landedHome : !landedHome && (await again.page.isVisible('#loginForm')));
    if (remember) {
      // 31 days later the cutoff has passed: the stored session must be refused
      const expired = JSON.parse(JSON.stringify(state));
      for (const o of expired.origins) for (const it of o.localStorage) if (it.name === 'th_portal_remember_until') it.value = String(Date.now() - 1000);
      const old = await newPage(browser, base, vp, { tokenCalls: 0 }, { storageState: expired });
      await old.page.goto(base + PORTAL.path);
      await old.page.waitForTimeout(700);
      check('ON: after the 30 days pass the session is refused', !/\/portal\/home\.html$/.test(old.page.url()) && (await old.page.isVisible('#loginForm')));
      await old.context.close();
    }
    await again.context.close();
  }

  console.log('\n== portal: legacy session (signed in before this change) keeps working');
  {
    const ctl = { tokenCalls: 0 };
    const seed = await newPage(browser, base, vp, ctl);
    await seed.page.goto(base + PORTAL.path);
    await fill(seed.page, PORTAL, 'client@example.com', 'correct-horse');
    await Promise.all([seed.page.waitForURL('**/portal/home.html'), seed.page.click(PORTAL.submit)]);
    const token = await store(seed.page, 'localStorage', STORAGE_KEY);
    await seed.context.close();
    const legacy = { cookies: [], origins: [{ origin: base, localStorage: [{ name: STORAGE_KEY, value: token }] }] };
    const old = await newPage(browser, base, vp, { tokenCalls: 0 }, { storageState: legacy });
    await old.page.goto(base + PORTAL.path);
    await old.page.waitForTimeout(700);
    check('session with no cutoff record (pre-existing) still lands on Home', /\/portal\/home\.html$/.test(old.page.url()));
    await old.context.close();
  }

  console.log('\n== portal: "Trust this device for 30 days" on the 2FA step');
  for (const [remember, trust] of [[true, true], [true, false], [false, true], [false, false]]) {
    const ctl = { tokenCalls: 0 };
    const { page, context } = await newPage(browser, base, vp, ctl);
    await page.goto(base + PORTAL.path);
    await page.waitForLoadState('networkidle');
    if (!remember) await page.click('label[for="rememberMe"]');
    await fill(page, PORTAL, 'client2fa@example.com', 'correct-horse');
    await page.click(PORTAL.submit);
    await page.waitForSelector('#portalTrustDevice', { state: 'visible' });
    check(`trust switch starts from Remember me (${remember})`, (await page.isChecked('#portalTrustDevice')) === remember);
    if ((await page.isChecked('#portalTrustDevice')) !== trust) await page.click('label[for="portalTrustDevice"]');
    await page.type('#mfaChallengeCodeInput', '123456', { delay: 10 });
    await Promise.all([page.waitForURL('**/portal/home.html'), page.click('#mfaChallengeSubmit')]);
    const inLocal = await store(page, 'localStorage', STORAGE_KEY);
    const inSession = await store(page, 'sessionStorage', STORAGE_KEY);
    const tokenAal = JSON.parse(inLocal || inSession || '{}').access_token || '';
    const aal = tokenAal ? JSON.parse(Buffer.from(tokenAal.split('.')[1], 'base64url').toString()).aal : null;
    check(`remember=${remember} trust=${trust}: verified (aal2) session kept ${trust ? '30 days in localStorage' : 'in sessionStorage only'}`, aal === 'aal2' && (trust ? !!inLocal && !inSession : !inLocal && !!inSession), { aal, inLocal: !!inLocal, inSession: !!inSession });
    await context.close();
  }

  console.log('\n== tools: Remember me + trust (employee 2FA stays mandatory)');
  for (const [remember, trust] of [[true, true], [false, false], [true, false]]) {
    const ctl = { tokenCalls: 0 };
    const { page, context } = await newPage(browser, base, vp, ctl);
    await page.goto(base + TOOLS.path);
    await page.waitForLoadState('networkidle');
    if (!remember) await page.click('label[for="rememberMe"]');
    await page.evaluate(() => localStorage.setItem('th_workspace_faceid_offered_steve@triplehenterprisesllc.biz', '1'));
    await fill(page, TOOLS, 'steve@triplehenterprisesllc.biz', 'correct-horse');
    await page.click(TOOLS.submit);
    await page.waitForSelector('#thTrustDevice', { state: 'visible' });
    check('employee with 2FA is always asked for the code', true);
    check('nothing stored before the code is verified', !(await store(page, 'localStorage', 'th_auth_session')) && !(await store(page, 'sessionStorage', 'th_auth_session')));
    if ((await page.isChecked('#thTrustDevice')) !== trust) await page.click('label[for="thTrustDevice"]');
    await page.type('#mfaChallengeCodeInput', '123456', { delay: 10 });
    await page.waitForURL('**/tools/workspace.html');
    const inLocal = await store(page, 'localStorage', 'th_auth_session');
    const inSession = await store(page, 'sessionStorage', 'th_auth_session');
    check(`tools remember=${remember} trust=${trust}: session in ${trust ? 'localStorage (30d)' : 'sessionStorage'}`, trust ? !!inLocal && !inSession : !inLocal && !!inSession);
    await context.close();
  }
  console.log('\n== reduced motion + success timing');
  for (const S of [PORTAL, TOOLS]) {
    const ctl = { tokenCalls: 0 };
    const { page, context } = await newPage(browser, base, vp, ctl, { reducedMotion: 'reduce' });
    await page.goto(base + S.path);
    await page.waitForLoadState('networkidle');
    const t = await page.evaluate(() => ({ dur: getComputedStyle(document.querySelector('.si-ghost')).transitionDuration, card: getComputedStyle(document.querySelector('.login-box')).transitionDuration }));
    // styles.css's global reduced-motion rule reports 1e-06s for 'none'; anything under a millisecond is no motion.
    const seconds = (v) => Math.max(...v.split(',').map((x) => parseFloat(x)));
    check(`${S.name}: reduced motion removes the ghost/form transitions`, seconds(t.dur) < 0.001 && seconds(t.card) < 0.001, t);
    await fill(page, S, 'client@example.com', 'correct-horse');
    if (S.name === 'tools') await page.evaluate(() => localStorage.setItem('th_workspace_faceid_offered_client@example.com', '1'));
    const t0 = Date.now();
    await Promise.all([page.waitForURL('**' + S.dest), page.click(S.submit)]);
    check(`${S.name}: reduced motion redirects without the 600ms animation`, Date.now() - t0 < 550, Date.now() - t0);
    await context.close();
  }
  for (const S of [PORTAL, TOOLS]) {
    const { page, context } = await newPage(browser, base, vp, { tokenCalls: 0 });
    // Freeze only the 600ms redirect timer so the final opacity can be read on the page.
    await page.addInitScript(() => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...rest) => (ms === 600 ? 0 : st(fn, ms, ...rest)); });
    await page.goto(base + S.path);
    await page.waitForLoadState('networkidle');
    await fill(page, S, 'client@example.com', 'correct-horse');
    if (S.name === 'tools') await page.evaluate(() => localStorage.setItem('th_workspace_faceid_offered_client@example.com', '1'));
    await page.click(S.submit);
    await page.waitForFunction(() => document.body.classList.contains('is-success'));
    const op = await page.evaluate(() => new Promise((r) => setTimeout(() => r(getComputedStyle(document.querySelector('.si-ghost')).opacity), 650)));
    check(`${S.name}: on success the logo un-ghosts to full opacity`, Number(op) >= 0.99, op);
    await context.close();
  }

  console.log('\n== tools: ?return= still honoured');
  {
    const ctl = { tokenCalls: 0 };
    const { page, context } = await newPage(browser, base, vp, ctl);
    await page.route((u) => u.pathname === '/tools/finance.html', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'finance' }));
    await page.goto(base + '/tools/login.html?return=/tools/finance.html');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => localStorage.setItem('th_workspace_faceid_offered_client@example.com', '1'));
    await fill(page, TOOLS, 'client@example.com', 'correct-horse');
    await Promise.all([page.waitForURL('**/tools/finance.html'), page.click(TOOLS.submit)]);
    check('post-login redirect honours an allowed ?return= path', true);
    await context.close();
  }
}

(async () => {
  const { chromium } = require('playwright');
  const server = await startServer();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    if (!process.argv.includes('--only-behaviour')) {
      for (const vp of VIEWPORTS) {
        await runScreen(browser, base, PORTAL, vp);
        await runScreen(browser, base, TOOLS, vp);
      }
    }
    await runBehaviour(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll sign-in browser checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
