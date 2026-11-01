#!/usr/bin/env node
// Screenshots for the trusted-devices PR (2026-11-01). Dev-only; nothing
// loads this. Same idea as scripts/signin-browser-check.js and the
// docs/workspace-*/harness/ scripts: a local static server for the repo, every
// supabase.co request answered by a mock (no real account, nothing live), and
// Playwright at 390x844 in dark mode. The pages run the REAL supabase-js build
// (SUPABASE_UMD, the version portal/settings.html pins) so the portal's own
// SDK calls are exercised, not stubbed. REAL_FONTS=1 serves the repo's
// fonts/pdf/ copies for the blocked Google Fonts request, as the Workspace
// harnesses do; the sign-in pages' own fonts are self-hosted already.
//
//   SUPABASE_UMD=/path/to/supabase.js REAL_FONTS=1 \
//     PLAYWRIGHT=/path/to/playwright node docs/trusted-devices-2026-11-01/harness/shoot.js

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const OUT = path.join(__dirname, '..');
const SB = 'https://csvfqdjuobylgafgolho.supabase.co';
const UMD = process.env.SUPABASE_UMD ? fs.readFileSync(process.env.SUPABASE_UMD) : null;
const REAL_FONTS = !!process.env.REAL_FONTS;
const FONT_DIR = path.join(ROOT, 'fonts/pdf/');
const FONT_FILES = { 'anton.ttf': 'Anton-Regular.ttf', 'archivo4.ttf': 'Archivo-Regular.ttf', 'archivo6.ttf': 'Archivo-SemiBold.ttf', 'oswald.ttf': 'Oswald-Medium.ttf' };
const FONT_CSS = "@font-face{font-family:'Anton';src:url(https://fonts.gstatic.com/th/anton.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:100 500;src:url(https://fonts.gstatic.com/th/archivo4.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:501 900;src:url(https://fonts.gstatic.com/th/archivo6.ttf)}" +
  "@font-face{font-family:'Oswald';font-weight:100 900;src:url(https://fonts.gstatic.com/th/oswald.ttf)}";

const USERS = {
  portal: { id: '33333333-3333-4333-8333-333333333333', email: 'sarah@example.com' },
  tools: { id: '22222222-2222-4222-8222-222222222222', email: 'connor@triplehenterprisesllc.biz' },
};
const DEVICES = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', label: 'Safari on iPhone', token: 'a'.repeat(64), created_at: '2026-10-28T15:04:00Z', expires_at: '2026-11-27T15:04:00Z' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', label: 'Chrome on Windows', token: 'b'.repeat(64), created_at: '2026-10-12T19:30:00Z', expires_at: '2026-11-11T19:30:00Z' },
];

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json', '.ico': 'image/x-icon' };
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

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(user, aal, sessionId) {
  const now = Math.floor(Date.now() / 1000);
  return [b64({ alg: 'HS256', typ: 'JWT' }), b64({ iss: SB + '/auth/v1', sub: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, aal, session_id: sessionId, amr: [{ method: 'password', timestamp: now }], iat: now, exp: now + 3600 }), 'sig'].join('.');
}
const FACTOR = { id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Authenticator' };
function session(user, aal, sessionId) {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: jwt(user, aal, sessionId), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'r-' + aal,
    user: { id: user.id, aud: 'authenticated', email: user.email, factors: [FACTOR], app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
}

async function mock(page, user, state) {
  if (UMD) await page.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: UMD }));
  await page.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: REAL_FONTS ? FONT_CSS : '' }));
  await page.route(/fonts\.gstatic\.com/, (r) => {
    const f = FONT_FILES[r.request().url().split('/').pop()];
    return f && REAL_FONTS ? r.fulfill({ status: 200, contentType: 'font/ttf', body: fs.readFileSync(FONT_DIR + f) }) : r.fulfill({ status: 404, body: '' });
  });
  await page.route(SB + '/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const body = (() => { try { return JSON.parse(req.postData() || '{}'); } catch (e) { return {}; } })();
    const json = (status, b) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    state.calls.push(req.method() + ' ' + p);
    if (p === '/auth/v1/token') return json(200, session(user, 'aal1', 'bbbbbbbb-0000-4000-8000-000000000001'));
    if (p === '/auth/v1/user') return json(200, session(user, 'aal1', 'x').user);
    if (/\/factors\/f1\/challenge$/.test(p)) return json(200, { id: 'c1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 });
    if (/\/factors\/f1\/verify$/.test(p)) return json(200, session(user, 'aal2', 'bbbbbbbb-0000-4000-8000-000000000002'));
    if (p.startsWith('/rest/v1/account_roles')) return json(200, [{ email: USERS.tools.email, role_name: 'Developer', can_manage_roles: true, can_access_dev_tools: true, can_manage_invoices: true }]);
    if (p === '/rest/v1/rpc/use_trusted_device') return json(200, DEVICES.some((d) => d.id === body.p_device_id && d.token === body.p_token));
    if (p === '/rest/v1/rpc/current_session_is_trusted') return json(200, state.trusted);
    if (p === '/rest/v1/rpc/internal_mfa_session_status') return json(200, { internal: true, meets: true, blocked: false });
    if (p === '/rest/v1/rpc/list_my_trusted_devices') return json(200, DEVICES.map(({ token, ...d }) => ({ ...d, surface: state.surface, last_used_at: null })));
    if (p === '/rest/v1/rpc/count_unused_internal_recovery_codes') return json(200, 9);
    if (p === '/rest/v1/rpc/get_my_referral_code' || p.startsWith('/functions/')) return json(200, {});
    return json(200, []);
  });
}

async function newPage(browser, { user, surface, storage = {}, trusted = false }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await context.newPage();
  const state = { calls: [], trusted, surface };
  await mock(page, user, state);
  await page.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, storage);
  return { page, state, context };
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); console.log('  ' + name); };
const deviceKey = (user) => 'th_trusted_device:' + user.id;
const deviceRecord = (d) => JSON.stringify({ id: d.id, token: d.token, expires_at: d.expires_at });

async function signInFlow(browser, base, surface, trusted) {
  const user = USERS[surface];
  const storage = trusted ? { [deviceKey(user)]: deviceRecord(DEVICES[0]) } : {};
  if (surface === 'tools') storage['th_workspace_faceid_offered_' + user.email] = '1'; // the one-time Face ID sheet, already seen
  const { page, state, context } = await newPage(browser, { user, surface, storage });
  const isPortal = surface === 'portal';
  await page.goto(base + (isPortal ? '/portal/login.html' : '/tools/login.html'));
  await page.fill(isPortal ? '#clientEmail' : '#loginEmail', user.email);
  await page.fill(isPortal ? '#clientPassword' : '#loginPassword', 'correct horse battery');
  // Hold the redirect at the success beat so the "signed in, no code" moment can be captured.
  await page.evaluate(() => { window.ThSignin && (window.ThSignin.success = (done) => { document.body.classList.add('is-success'); window.__done = done; }); });
  await page.click(isPortal ? '#loginSubmitBtn' : '#loginBtn');
  const tag = isPortal ? 'p' : 't';
  if (trusted) {
    await page.waitForSelector('body.is-success', { timeout: 10000 });
    await page.waitForTimeout(700);
    const codeVisible = await page.isVisible(isPortal ? '#mfaChallengeOverlay' : '#mfaChallengeView');
    if (codeVisible) throw new Error(surface + ': code step visible on a trusted device');
    if (!state.calls.includes('POST /rest/v1/rpc/use_trusted_device')) throw new Error(surface + ': use_trusted_device never called');
    await shot(page, `${tag}-01-trusted-device-signed-in-no-code-390x844.png`);
  } else {
    await page.waitForSelector(isPortal ? '#mfaChallengeOverlay[style*="flex"]' : '#mfaChallengeView:not([style*="none"])', { timeout: 10000 });
    await page.waitForTimeout(400);
    if (state.calls.includes('POST /rest/v1/rpc/use_trusted_device')) throw new Error(surface + ': untrusted device should not ask');
    await shot(page, `${tag}-02-untrusted-device-code-prompt-390x844.png`);
  }
  await context.close();
}

async function portalSettings(browser, base) {
  const user = USERS.portal;
  const s = session(user, 'aal2', 'bbbbbbbb-0000-4000-8000-000000000003');
  const storage = {
    'sb-csvfqdjuobylgafgolho-auth-token': JSON.stringify(s),
    th_portal_remember_until: String(Date.now() + 864e5),
    [deviceKey(user)]: deviceRecord(DEVICES[0]),
  };
  const { page, context } = await newPage(browser, { user, surface: 'portal', storage });
  await page.goto(base + '/portal/settings.html#security');
  await page.waitForSelector('[data-remove-trusted-device]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('trustedDevicesCard').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shot(page, 'p-03-settings-trusted-devices-390x844.png');
  await context.close();
}

async function toolsSettings(browser, base) {
  const user = USERS.tools;
  const s = session(user, 'aal2', 'bbbbbbbb-0000-4000-8000-000000000004');
  const storage = {
    th_auth_session: JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, email: user.email, remember_until: Date.now() + 864e5 }),
    [deviceKey(user)]: deviceRecord(DEVICES[0]),
    th_app_tour_seen: '1', th_tour_completed: '1',
  };
  const { page, context } = await newPage(browser, { user, surface: 'tools', storage });
  await page.goto(base + '/tools/settings.html');
  await page.waitForSelector('[data-remove-trusted-device]', { timeout: 15000 });
  await page.waitForTimeout(600);
  // Settings re-renders a couple of times as it loads; scroll once it has settled.
  await page.waitForTimeout(1500);
  await page.locator('#trustedDevicesSection').scrollIntoViewIfNeeded();
  await page.evaluate(() => { const el = document.getElementById('trustedDevicesSection'); window.scrollBy(0, el.getBoundingClientRect().top - 120); });
  await page.waitForTimeout(500);
  await shot(page, 't-03-settings-trusted-devices-390x844.png');
  await context.close();
}

(async () => {
  const server = await startServer();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const surface of ['portal', 'tools']) {
      await signInFlow(browser, base, surface, true);
      await signInFlow(browser, base, surface, false);
    }
    await portalSettings(browser, base);
    await toolsSettings(browser, base);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
