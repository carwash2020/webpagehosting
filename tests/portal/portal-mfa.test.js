// Two-factor authentication (2026-09-16): real, server-verified TOTP via
// Supabase Auth MFA, added because MFA availability was enabled on the
// Supabase project (docs/ACTION-ITEMS.md) but no enrollment UI or
// login-time challenge existed yet -- enabling it dashboard-side alone
// does nothing for an end user. Two halves: settings.html lets a client
// enroll/disable a TOTP factor, login.html challenges for a code at sign-in
// when one is already enrolled. Deliberately separate from the existing
// biometric-unlock toggle (portal-app.js), which is a local, device-only
// app lock and never touches the account itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const LOGIN = fs.readFileSync(repo('portal', 'login.html'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

test('settings.html has a Two-Factor Authentication card, separate from the device (biometric) lock card', () => {
  // Both now live in the "Sign-in & security" section (2026-09-22), but
  // stay separate cards: 2FA protects the account everywhere, the device
  // lock only this browser.
  assert.match(SETTINGS, /<span class="set-card-title">Two-Factor Authentication<\/span>/);
  const pane = SETTINGS.slice(SETTINGS.indexOf('id="pane-security"'), SETTINGS.indexOf('id="pane-referral"'));
  const cards = pane.split('<div class="set-card">').slice(1);
  const mfaCard = cards.findIndex((c) => c.includes('id="mfaToggleBtn"'));
  const bioCard = cards.findIndex((c) => c.includes('id="biometricToggleBtn"'));
  assert.ok(mfaCard >= 0 && bioCard >= 0, 'both toggles live in the security section');
  assert.notEqual(mfaCard, bioCard, 'expected 2FA and the device lock in separate cards');
});

test('settings.html enrolls a real TOTP factor via Supabase MFA, not a local-only flag', () => {
  assert.match(SETTINGS, /client\.auth\.mfa\.listFactors\(\)/);
  assert.match(SETTINGS, /client\.auth\.mfa\.enroll\(\{\s*factorType:\s*'totp'\s*\}\)/);
  assert.match(SETTINGS, /client\.auth\.mfa\.challengeAndVerify\(\{\s*factorId:\s*mfaPendingFactorId,\s*code\s*\}\)/);
  assert.match(SETTINGS, /client\.auth\.mfa\.unenroll\(/);
});

test('settings.html renders the QR code Supabase returns from enroll(), and requires a 6-digit code before verifying', () => {
  assert.match(SETTINGS, /document\.getElementById\('mfaQrImg'\)\.src = data\.totp\.qr_code;/);
  assert.match(SETTINGS, /\/\^\\d\{6\}\$\//);
});

test('settings.html cleans up an abandoned enrollment attempt: Cancel unenrolls the pending factor', () => {
  const start = SETTINGS.indexOf('function handleCancelMfaEnroll(');
  assert.ok(start >= 0, 'expected handleCancelMfaEnroll to exist');
  const braceStart = SETTINGS.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < SETTINGS.length; i++) {
    if (SETTINGS[i] === '{') depth++;
    else if (SETTINGS[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const body = SETTINGS.slice(start, i);
  assert.match(body, /client\.auth\.mfa\.unenroll\(\{\s*factorId:\s*mfaPendingFactorId\s*\}\)/);
});

test('settings.html toggle button reads real enrollment state (verified factor -> turn off, none -> set up)', () => {
  assert.match(SETTINGS, /\(data\.totp \|\| \[\]\)\.find\(\(f\) => f\.status === 'verified'\)/);
  assert.match(SETTINGS, /btn\.textContent = 'Turn off two-factor authentication';/);
  assert.match(SETTINGS, /btn\.textContent = 'Set up two-factor authentication';/);
});

test('settings.html uses the shared showToast() for enroll/disable outcomes, not a one-off UI', () => {
  assert.match(SETTINGS, /showToast\('Two-factor authentication is on\.'\)/);
  assert.match(SETTINGS, /showToast\('Two-factor authentication is off\.'\)/);
});

test('settings.html initializes the 2FA card on load, alongside the existing biometric toggle', () => {
  const initStart = SETTINGS.indexOf('async function init()');
  assert.ok(initStart >= 0);
  const braceStart = SETTINGS.indexOf('{', initStart);
  let depth = 0, i = braceStart;
  for (; i < SETTINGS.length; i++) {
    if (SETTINGS[i] === '{') depth++;
    else if (SETTINGS[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const body = SETTINGS.slice(initStart, i);
  assert.match(body, /renderBiometricToggle\(email\);/);
  assert.match(body, /renderMfaToggle\(\);/);
});

test('login.html checks the real assurance level after a correct password, not just the password itself', () => {
  assert.match(LOGIN, /const \{ error \} = await client\.auth\.signInWithPassword\(\{ email, password \}\);/);
  const signInIdx = LOGIN.indexOf('await client.auth.signInWithPassword(');
  const aalIdx = LOGIN.indexOf('client.auth.mfa.getAuthenticatorAssuranceLevel()');
  assert.ok(aalIdx > signInIdx, 'expected the AAL check to happen after signInWithPassword, not before');
});

test('login.html only redirects immediately when no step-up to aal2 is required', () => {
  const aalIdx = LOGIN.indexOf('client.auth.mfa.getAuthenticatorAssuranceLevel()');
  const redirectIdx = LOGIN.lastIndexOf("window.location.replace('/portal/home.html')");
  assert.ok(redirectIdx > aalIdx, 'the unconditional redirect should come after the AAL check, not before it');
  assert.match(LOGIN, /aal\.nextLevel === 'aal2' && aal\.currentLevel !== 'aal2'/);
});

test('login.html shows a real challenge overlay and verifies the code via Supabase before redirecting', () => {
  assert.match(LOGIN, /id="mfaChallengeOverlay"/);
  assert.match(LOGIN, /function openMfaChallenge\(factorId\)/);
  assert.match(LOGIN, /client\.auth\.mfa\.challengeAndVerify\(\{ factorId, code \}\)/);
  // The redirect inside verify() must be gated on a successful challenge,
  // not fired unconditionally once the overlay is shown.
  const openStart = LOGIN.indexOf('function openMfaChallenge(');
  const verifyStart = LOGIN.indexOf('async function verify()', openStart);
  const cancelStart = LOGIN.indexOf('async function cancel()', openStart);
  const verifyBody = LOGIN.slice(verifyStart, cancelStart);
  assert.match(verifyBody, /if \(error\) \{[\s\S]*?return;[\s\S]*?\}/);
  assert.match(verifyBody, /window\.location\.replace\('\/portal\/home\.html'\);/);
});

test("login.html's challenge Cancel signs the just-created session out rather than leaving it half-authenticated", () => {
  const openStart = LOGIN.indexOf('function openMfaChallenge(');
  const cancelStart = LOGIN.indexOf('async function cancel()', openStart);
  const wireStart = LOGIN.indexOf('submitBtn.addEventListener', openStart);
  const cancelBody = LOGIN.slice(cancelStart, wireStart);
  assert.match(cancelBody, /await client\.auth\.signOut\(\);/);
});

test('the MFA challenge overlay CSP-compatible: no new external origins introduced', () => {
  const cspMatch = LOGIN.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(cspMatch);
  assert.match(cspMatch[1], /connect-src 'self' https:\/\/csvfqdjuobylgafgolho\.supabase\.co;/);
});
