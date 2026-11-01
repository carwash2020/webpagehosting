// Sign-in rebuild (2026-10-31): the contracts of the shared portal + tools
// sign-in screens that CI can pin without a browser. The real-browser
// behaviour (restart persistence, axe, tap sizes, timing, screenshots) is
// scripts/signin-browser-check.js.
//
// What must hold:
//   - password auth + 2FA are exactly as before (other test files pin the
//     auth calls; here: the new pieces never replace them)
//   - "Remember me for 30 days" is real: ON persists 30 days, OFF ends with
//     the browser, and an already-signed-in session keeps working
//   - "Trust this device for 30 days" exists on both 2FA steps
//   - brand: #F26B1D on ink, Bricolage Grotesque + Geist, no Inter, no
//     purple, no arrows on buttons
//   - the ghost logo, the ~600ms success beat, prefers-reduced-motion

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const PORTAL_LOGIN = read('portal', 'login.html');
const TOOLS_LOGIN = read('tools', 'login.html');
const CSS = read('signin.css');
const UI_JS = read('signin-ui.js');
const PORTAL_APP = read('portal', 'portal-app.js');
const PAGES = { 'portal/login.html': PORTAL_LOGIN, 'tools/login.html': TOOLS_LOGIN };

// ---- ghost logo + shared assets ---------------------------------------------

test('both sign-in pages load the shared stylesheet last and the shared helper', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    assert.match(html, /<link rel="stylesheet" href="\/signin\.css\?v=[a-z0-9]+">/, `${name} links signin.css`);
    assert.match(html, /<script src="\/signin-ui\.js\?v=[a-z0-9]+"><\/script>/, `${name} loads signin-ui.js`);
    assert.match(html, /<body[^>]*class="th-signin si"/, `${name} body opts in`);
    const lastStylesheet = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].pop()[1];
    assert.match(lastStylesheet, /^\/signin\.css/, `${name}: signin.css must be the LAST stylesheet so it wins`);
  }
});

test('the ghost logo is the existing site logo at 8% behind the form, decorative only', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    const img = html.match(/<img class="si-ghost"[^>]*>/);
    assert.ok(img, `${name} has the ghost logo`);
    assert.match(img[0], /src="\/images\/logo-signature-orange\.webp/);
    assert.match(img[0], /alt=""/);
    assert.match(img[0], /aria-hidden="true"/);
    assert.ok(fs.existsSync(path.join(ROOT, 'images', 'logo-signature-orange.webp')), 'the logo file exists');
  }
  const rule = CSS.match(/body\.th-signin \.si-ghost \{([^}]*)\}/);
  assert.ok(rule, 'expected the .si-ghost rule');
  assert.match(rule[1], /opacity:\s*0\.08/);
  assert.match(rule[1], /z-index:\s*0/);
  assert.match(rule[1], /pointer-events:\s*none/);
  assert.match(CSS, /body\.th-signin \.si-main \{[^}]*z-index:\s*1/, 'the form sits above the ghost');
});

// ---- brand --------------------------------------------------------------------

test('brand orange on dark ink; Bricolage Grotesque + Geist self-hosted; no Inter', () => {
  assert.match(CSS, /--si-orange:\s*#f26b1d/i);
  assert.match(CSS, /--si-ink:\s*#0b0a09/i);
  assert.match(CSS, /font-family:\s*"Bricolage Grotesque";[^}]*woff2/s);
  assert.match(CSS, /font-family:\s*"Geist";[^}]*woff2/s);
  for (const f of ['bricolage-grotesque-latin-wght-normal.woff2', 'geist-latin-wght-normal.woff2']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'fonts', 'signin', f)), f + ' is committed');
    assert.ok(CSS.includes('/fonts/signin/' + f));
  }
  const declarations = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\binter\b/i.test(declarations), 'signin.css never uses Inter');
  assert.match(CSS, /--si-display:\s*"Bricolage Grotesque"/);
  assert.match(CSS, /--si-body:\s*"Geist"/);
  for (const [name, html] of Object.entries(PAGES)) {
    assert.match(html, /font-src 'self' https:\/\/fonts\.gstatic\.com;/, `${name}: CSP lets the self-hosted fonts load`);
  }
});

function hexToHsl(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2; const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let hue;
  if (max === r) hue = ((g - b) / d) % 6; else if (max === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
  return { h: (hue * 60 + 360) % 360, s, l };
}

test('no purple anywhere in the sign-in palette', () => {
  const hexes = [...new Set(CSS.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g))];
  assert.ok(hexes.length > 8);
  for (const hex of hexes) {
    const { h, s } = hexToHsl(hex);
    assert.ok(!(h >= 255 && h <= 320 && s > 0.12), `${hex} is purple-ish (hue ${Math.round(h)})`);
  }
});

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('WCAG 2.2 AA colour contrast of the palette (text 4.5:1, controls 3:1), even over the ghost logo', () => {
  const tok = (n) => CSS.match(new RegExp('--si-' + n + ':\\s*(#[0-9a-fA-F]{6})'))[1];
  const ink = tok('ink');
  // Worst case under the ghost: ink lifted by an 8%-opacity white area of the logo.
  const ghosted = '#' + [0, 1, 2].map(() => Math.round(0x0b + (255 - 0x0b) * 0.08).toString(16).padStart(2, '0')).join('');
  for (const bg of [ink, ghosted]) {
    assert.ok(ratio(tok('text'), bg) >= 4.5, 'text on ' + bg);
    assert.ok(ratio(tok('dim'), bg) >= 4.5, 'dim text on ' + bg);
    assert.ok(ratio(tok('orange'), bg) >= 4.5, 'orange text on ' + bg);
    assert.ok(ratio(tok('orange-hi'), bg) >= 4.5, 'orange-hi (Show/Hide) on ' + bg);
    assert.ok(ratio(tok('err'), bg) >= 4.5, 'error text on ' + bg);
    assert.ok(ratio(tok('line'), bg) >= 3, 'field border (non-text) on ' + bg);
  }
  assert.ok(ratio(ink, tok('orange')) >= 4.5, 'ink label on the orange button');
  assert.ok(ratio('#ffffff', tok('orange')) < 4.5, 'documents why the button label is ink, not white');
});

test('no arrows on buttons (markup or generated content)', () => {
  const arrow = /[←-⇿⟵-⟿➔-➿⬀-⯿]|&[lr]arr;|&#(?:8592|8594|10140);|&[lr]Arr;/;
  for (const [name, html] of Object.entries(PAGES)) {
    for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      assert.ok(!arrow.test(m[1]), `${name}: arrow in a button: ${m[1].trim()}`);
    }
    // JS that sets a button label must not add one either.
    assert.ok(!/textContent = [^;]*(?:[←-⇿]|&[lr]arr;)/.test(html), name);
  }
  assert.ok(!/content:\s*["'][^"']*[←-⇿]/.test(CSS));
});

// ---- fields + toggles ---------------------------------------------------------

test('email + password with Show/Hide, a real Remember me switch, and Forgot password on both screens', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    assert.match(html, /<div class="si-pw" data-si-pw>\s*<input type="password"[^>]*autocomplete="current-password"/, `${name}: password field in the Show/Hide wrapper`);
    assert.match(html, /<button type="button" class="si-toggle" aria-label="Show password" aria-pressed="false" aria-controls="[a-zA-Z]+">Show<\/button>/, `${name}: Show/Hide button`);
    assert.match(html, /<input type="checkbox" id="rememberMe" role="switch" checked>/, `${name}: Remember me switch`);
    assert.match(html, /Remember me for 30 days/);
    assert.match(html, /signed out when you close the browser/, `${name}: says what OFF does`);
    assert.match(html, /Forgot your password\?/);
    assert.match(html, /<h1 class="login-title/, `${name}: one h1`);
  }
  // Forgot password was a href-less <a> (not keyboard reachable); now a real button.
  assert.match(PORTAL_LOGIN, /<button type="button" class="forgot-link" id="forgotLink">/);
});

test('both 2FA steps offer "Trust this device for 30 days"', () => {
  assert.match(PORTAL_LOGIN, /id="portalTrustDevice"[\s\S]{0,300}Trust this device for 30 days/);
  assert.match(TOOLS_LOGIN, /id="thTrustDevice"[\s\S]{0,300}Trust this device for 30 days/);
  assert.match(PORTAL_LOGIN, /portalSetRemember\(document\.getElementById\('portalTrustDevice'\)\.checked\);\s*ThSignin\.setBusy\(submitBtn[\s\S]*?challengeAndVerify/, 'portal: trust chosen BEFORE the code is verified, code check unchanged');
  assert.match(TOOLS_LOGIN, /pendingRememberMe = document\.getElementById\('thTrustDevice'\)\.checked;/);
  assert.match(TOOLS_LOGIN, /persistSession\(\{\s*access_token: result\.access_token,[\s\S]*?\}, pendingRememberMe\);/, 'tools: the verified session is stored with the trust choice');
});

test('Trust helper copy does not promise to skip the code; headings match on both screens', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    assert.match(html, /Stay signed in here for 30 days\. Leave off on a shared computer\./, name);
    assert.ok(!/aren't asked for a code/.test(html), `${name} must not say the code is skipped`);
  }
  assert.match(PORTAL_LOGIN, /id="pageTitle">Sign in<\/h1>/);
  assert.match(TOOLS_LOGIN, /id="loginTitle">Sign in<\/h1>/);
});

test('code boxes keep breathing room from the screen edge (focus ring included)', () => {
  assert.match(CSS, /body\.th-signin \.th-code-boxes-wrap \{ padding: 0 6px; \}/);
});

test('2FA is not weakened: no client flag lets a device skip the code', () => {
  // Trust only chooses WHERE the verified session lives. The password step still hands over to the code step whenever a factor exists.
  assert.match(PORTAL_LOGIN, /aal\.nextLevel === 'aal2' && aal\.currentLevel !== 'aal2'/);
  assert.match(TOOLS_LOGIN, /const factor = await mfaListVerifiedTotpFactor\(pendingSession\.access_token\);\s*if \(factor\) \{/);
  assert.match(TOOLS_LOGIN, /if \(requiresMfaForRole\(roleInfo\)\) \{\s*await startMandatoryEnrollment\(\);/, 'employees without a factor are still forced to enrol');
  assert.ok(!/trusted_device|th_trusted|skipMfa|skip2fa/i.test(PORTAL_LOGIN + TOOLS_LOGIN + UI_JS + PORTAL_APP));
});

// ---- states -------------------------------------------------------------------

test('loading, wrong-password and success states are wired on both screens', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    assert.match(html, /ThSignin\.setBusy\(btn, true, 'Signing/, `${name}: loading state`);
    assert.match(html, /ThSignin\.setInvalid\(\[emailInput, passwordInput\], errorEl, true\)/, `${name}: wrong-entry state`);
    assert.match(html, /ThSignin\.shake\(/);
    assert.match(html, /id="loginError" role="alert"/, `${name}: errors are announced`);
    assert.match(html, /id="siLive" role="status" aria-live="polite"/, `${name}: success is announced`);
    assert.match(html, /Incorrect email or password\./);
  }
  assert.match(CSS, /button\[aria-busy="true"\]::before/, 'spinner on a busy button');
  assert.match(CSS, /input\[aria-invalid="true"\] \{ border-color: var\(--si-err\)/);
});

test('every redirect still happens; success only delays it by the animation', () => {
  assert.match(PORTAL_LOGIN, /async function goHomeAfterSignIn\(\) \{[\s\S]*?ThSignin\.success\(\(\) => window\.location\.replace\('\/portal\/home\.html'\)\);\s*\}/);
  assert.match(PORTAL_LOGIN, /\}\s*window\.location\.replace\('\/portal\/home\.html'\);\s*\}\);/, 'already-signed-in visitors are still sent straight to Home, no animation');
  assert.match(TOOLS_LOGIN, /ALLOWED_RETURN_PATHS\.has\(returnTo\) \? returnTo : '\/tools\/workspace\.html'/);
  assert.match(TOOLS_LOGIN, /ThSignin\.success\(\(\) => \{ window\.location\.href = target; \}\);/);
});

function loadUi({ reduced }) {
  const dom = new JSDOM('<body class="th-signin"><div id="siLive"></div></body>', { runScripts: 'outside-only', url: 'https://example.com/portal/login.html' });
  const w = dom.window;
  w.matchMedia = () => ({ matches: reduced });
  const delays = [];
  w.setTimeout = (fn, ms) => { delays.push(ms); fn(); return 0; };
  w.eval(UI_JS);
  return { w, delays };
}

test('success runs the ~600ms beat once, then the redirect; reduced motion shortens it', () => {
  for (const [reduced, check] of [[false, (d) => d === 600], [true, (d) => d <= 200]]) {
    const { w, delays } = loadUi({ reduced });
    let done = 0;
    w.ThSignin.success(() => { done++; });
    w.ThSignin.success(() => { done++; }); // a double submit must not redirect twice
    assert.equal(done, 1);
    assert.ok(w.document.body.classList.contains('is-success'));
    assert.match(w.document.getElementById('siLive').textContent, /Signed in/);
    assert.equal(delays.length, 1);
    assert.ok(check(delays[0]), `delay ${delays[0]} (reduced=${reduced})`);
  }
  assert.match(CSS, /--si-success-ms:\s*600ms/);
});

test('prefers-reduced-motion switches off every transition, spinner spin and shake', () => {
  const block = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block, /\.si-ghost,[\s\S]*?\.login-box,[\s\S]*?transition: none; animation: none;/);
  assert.match(block, /\.si-shake \{ animation: none; \}/);
  assert.match(block, /button\[aria-busy="true"\]::before \{ animation: none;/);
  assert.match(block, /\.is-success \.si-ghost \{ transform: none; \}/);
  assert.match(CSS, /body\.th-signin\.is-success \.si-ghost \{ opacity: 1;/, 'the logo un-ghosts');
  assert.match(CSS, /body\.th-signin\.is-success\.si\[class\] \.login-box \{ transform: translateY\(14px\)/, 'the form settles');
});

test('big tap targets: fields 56px, buttons 58px, links and toggles 48px+', () => {
  assert.match(CSS, /\.login-field input,[\s\S]*?min-height: 56px/);
  assert.match(CSS, /\.login-btn,[\s\S]*?min-height: 58px/);
  assert.match(CSS, /\.si-toggle \{[^}]*height: 48px/);
  assert.match(CSS, /\.forgot-link,[\s\S]*?min-height: 52px/);
  assert.match(CSS, /\.si-switch \{[^}]*min-height: 56px/);
  assert.match(CSS, /\.th-step-back \{[^}]*height: 48px/);
  assert.match(CSS, /:focus-visible \{ outline: 3px solid/, 'visible focus ring');
});

// ---- Remember me: the storage rules -------------------------------------------

function loadPortalApp(local, session) {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://example.com/portal/login.html' });
  const w = dom.window;
  for (const [k, v] of Object.entries(local || {})) w.localStorage.setItem(k, v);
  for (const [k, v] of Object.entries(session || {})) w.sessionStorage.setItem(k, v);
  w.eval(PORTAL_APP);
  return w;
}
const TOKEN = 'sb-test-auth-token';
const DAY = 24 * 60 * 60 * 1000;
// A "browser restart" keeps localStorage and drops sessionStorage.
const restart = (w) => loadPortalApp(Object.fromEntries(Object.keys(w.localStorage).map((k) => [k, w.localStorage.getItem(k)])), {});

test('Remember me ON: session persists in localStorage with a 30-day cutoff and survives a browser restart', () => {
  const w = loadPortalApp();
  w.portalSetRemember(true);
  const storage = w.eval('portalAuthStorage()');
  storage.setItem(TOKEN, '{"s":1}');
  assert.equal(w.localStorage.getItem(TOKEN), '{"s":1}');
  assert.equal(w.sessionStorage.getItem(TOKEN), null);
  const days = (Number(w.localStorage.getItem('th_portal_remember_until')) - Date.now()) / DAY;
  assert.ok(days > 29.99 && days <= 30, 'cutoff is 30 days out: ' + days);
  assert.equal(restart(w).eval('portalAuthStorage()').getItem(TOKEN), '{"s":1}');
});

test('Remember me OFF: session lives in sessionStorage only and is gone after a browser restart', () => {
  const w = loadPortalApp();
  w.portalSetRemember(false);
  const storage = w.eval('portalAuthStorage()');
  storage.setItem(TOKEN, '{"s":2}');
  assert.equal(w.localStorage.getItem(TOKEN), null);
  assert.equal(w.sessionStorage.getItem(TOKEN), '{"s":2}');
  assert.equal(w.localStorage.getItem('th_portal_remember_until'), null);
  assert.equal(storage.getItem(TOKEN), '{"s":2}', 'other pages in the same tab still see it');
  assert.equal(restart(w).eval('portalAuthStorage()').getItem(TOKEN), null);
});

test('the 30-day cutoff is enforced on read and purges the stored session', () => {
  const w = loadPortalApp({ [TOKEN]: '{"s":3}', th_portal_remember_until: String(Date.now() - 1000) });
  assert.equal(w.eval('portalAuthStorage()').getItem(TOKEN), null);
  assert.equal(w.localStorage.getItem(TOKEN), null, 'purged, not just hidden');
  assert.equal(w.localStorage.getItem('th_portal_remember_until'), null);
});

test('a session from before this change (localStorage, no cutoff) keeps working untouched', () => {
  const w = loadPortalApp({ [TOKEN]: '{"s":4}' });
  const storage = w.eval('portalAuthStorage()');
  assert.equal(storage.getItem(TOKEN), '{"s":4}');
  storage.setItem(TOKEN, '{"s":5}'); // a silent token refresh
  assert.equal(w.localStorage.getItem(TOKEN), '{"s":5}', 'refresh stays where it was');
  assert.equal(w.sessionStorage.getItem(TOKEN), null);
});

test('changing the choice at the 2FA step moves the next write and removes the other copy', () => {
  const w = loadPortalApp();
  w.portalSetRemember(true);
  const storage = w.eval('portalAuthStorage()');
  storage.setItem(TOKEN, 'aal1'); // password step
  w.portalSetRemember(false); // trust switched off at the code step
  storage.setItem(TOKEN, 'aal2'); // supabase-js writes the verified session
  assert.equal(w.sessionStorage.getItem(TOKEN), 'aal2');
  assert.equal(w.localStorage.getItem(TOKEN), null, 'no stale remembered copy left behind');
  w.portalSetRemember(true);
  storage.setItem(TOKEN, 'aal2b');
  assert.equal(w.localStorage.getItem(TOKEN), 'aal2b');
  assert.equal(w.sessionStorage.getItem(TOKEN), null);
  storage.removeItem(TOKEN);
  assert.equal(w.localStorage.getItem(TOKEN), null);
});

test('storage that throws (private mode) never breaks sign-in', () => {
  const w = loadPortalApp();
  const storage = w.eval('portalAuthStorage()');
  Object.defineProperty(w, 'localStorage', { get() { throw new Error('blocked'); } });
  assert.doesNotThrow(() => { w.portalSetRemember(true); storage.setItem(TOKEN, 'x'); storage.getItem(TOKEN); storage.removeItem(TOKEN); });
});

test('every portal page builds its Supabase client on the shared storage, so Remember me holds across pages', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'portal')).filter((n) => n.endsWith('.html'))) {
    const html = read('portal', f);
    const calls = [...html.matchAll(/createClient\(([\s\S]*?)\);/g)].filter((m) => !/const \{ createClient \}/.test(m[0]));
    for (const c of calls) assert.match(c[1], /portalAuthStorage\(\)/, `${f}: createClient without the shared storage`);
    if (calls.length) assert.match(html, /portal-app\.js/, `${f} loads portal-app.js (defines portalAuthStorage)`);
  }
});

// ---- the committed screenshots ------------------------------------------------

test('every sign-in state has a committed 390x844 and 1440 screenshot', () => {
  const states = [
    '01-default', '02-password-hidden-filled', '03-password-shown', '04-loading', '05-wrong-password',
    '06-forgot-password', '07-reset-link-sent', '08-2fa-code', '09-2fa-code-typing', '10-2fa-wrong-code',
    '11-success-midway', '12-success-done',
  ];
  const dir = path.join(ROOT, 'docs', 'screenshots', 'signin');
  const want = [];
  for (const pre of ['p', 't']) for (const s of states) for (const vp of ['390x844', '1440']) want.push(`${pre}${s}-${vp}.png`);
  for (const vp of ['390x844', '1440']) want.push(`t13-mandatory-2fa-setup-${vp}.png`, `t14-recovery-codes-${vp}.png`);
  const missing = want.filter((f) => !fs.existsSync(path.join(dir, f)));
  assert.deepEqual(missing, [], 'regenerate with: node scripts/signin-browser-check.js --screenshots');
  for (const f of want) {
    const buf = fs.readFileSync(path.join(dir, f));
    const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (f.endsWith('390x844.png')) assert.ok(w === 390 && h === 844, `${f} is ${w}x${h}`);
    else assert.ok(w === 1440, `${f} is ${w}x${h}`);
  }
});
