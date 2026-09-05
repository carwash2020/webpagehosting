// Tests for the biometric app lock (2026-09-05), requested directly:
// "biometric unlock." Deliberately a local-only WebAuthn gate in
// front of an already-valid Supabase session, NOT Supabase's own
// native passkey feature (a beta, experimental API that would
// replace the actual sign-in mechanism and requires Dashboard
// configuration this code can't perform on its own) -- see
// portal-app.js's own header comment for the full reasoning.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JS = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const CSS = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

const GATED_PAGES = ['home', 'dashboard', 'jobs', 'quotes', 'work-orders'];

test('registration requests a platform authenticator with required user verification, not any authenticator', () => {
  const fnMatch = JS.match(/async function portalRegisterBiometricLock\(email\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate portalRegisterBiometricLock()');
  assert.match(fnMatch[0], /authenticatorAttachment: 'platform'/);
  assert.match(fnMatch[0], /userVerification: 'required'/);
});

test('the unlock prompt returns false on any failure or cancellation, never silently true', () => {
  const fnMatch = JS.match(/async function portalPromptBiometricUnlock\(email\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate portalPromptBiometricUnlock()');
  assert.match(fnMatch[0], /catch \(e\) \{\s*\n\s*return false;/);
  assert.match(fnMatch[0], /if \(!stored\) return false;/);
});

test('the lock is stored per-email, so a shared device with multiple portal accounts keeps them separate', () => {
  const fnMatch = JS.match(/function portalBiometricLockKey\(email\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate portalBiometricLockKey()');
  assert.match(fnMatch[0], /email\.toLowerCase\(\)/);
});

test('the gate is idempotent across a page\u2019s lifetime -- a module-level flag prevents re-prompting on every call to an already-loaded page\u2019s repeated render function', () => {
  assert.match(JS, /let portalBiometricGatePassed = false;/);
  const fnMatch = JS.match(/function portalGuardWithBiometricLock\(email, client\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate portalGuardWithBiometricLock()');
  assert.match(fnMatch[0], /if \(portalBiometricGatePassed\) return Promise\.resolve\(\);/);
});

test('the gate sets the passed flag both on an already-disabled lock and on a real successful unlock -- not just one of the two paths', () => {
  const fnMatch = JS.match(/function portalGuardWithBiometricLock\(email, client\)[\s\S]*?\n\}\n/);
  const setCount = (fnMatch[0].match(/portalBiometricGatePassed = true;/g) || []).length;
  assert.equal(setCount, 2, 'expected the flag set both when the lock is not enabled, and after a real successful unlock');
});

test('the fallback button genuinely signs out and redirects, not just closes the overlay', () => {
  const fnMatch = JS.match(/function portalGuardWithBiometricLock\(email, client\)[\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /biometricFallbackBtn['"]?\)\.addEventListener\('click', async \(\) => \{\s*\n\s*await client\.auth\.signOut\(\);\s*\n\s*window\.location\.replace\('\/portal\/login\.html'\);/);
});

test('every gated page calls the gate right after confirming a real session, before any content-specific rendering', () => {
  for (const page of GATED_PAGES) {
    const html = fs.readFileSync(repo('portal', `${page}.html`), 'utf8');
    const sessionCheckIdx = html.indexOf("if (!session)");
    const gateIdx = html.indexOf('portalGuardWithBiometricLock(session.user.email, client)');
    assert.ok(sessionCheckIdx !== -1 && gateIdx !== -1, `${page}.html: expected both a session check and a real gate call`);
    assert.ok(sessionCheckIdx < gateIdx, `${page}.html: the gate must come after the session check`);
  }
});

test('Settings deliberately does NOT call the gate -- it must stay reachable as the escape hatch for disabling a broken lock', () => {
  // Excludes comment lines before checking -- the explanation for why
  // this is deliberate necessarily mentions the function name as
  // documentation, which isn't the same thing as an actual call.
  const codeLines = SETTINGS.split('\n').filter((line) => !line.trim().startsWith('//'));
  const codeOnly = codeLines.join('\n');
  assert.doesNotMatch(codeOnly, /portalGuardWithBiometricLock\(/);
  // The absence itself isn't provable as deliberate by a test alone,
  // but the explanation for it living in the file is -- confirming
  // it's still there guards against someone silently removing the
  // comment and adding the gate call without re-considering why it
  // was left out.
  assert.match(SETTINGS, /Settings deliberately does NOT call portalGuardWithBiometricLock/);
});

test('Settings shows the toggle and correctly disables the lock via the real localStorage-clearing function, not just hiding UI', () => {
  assert.match(SETTINGS, /id="biometricToggleBtn"/);
  const fnMatch = SETTINGS.match(/function handleDisableBiometric\(email\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate handleDisableBiometric()');
  assert.match(fnMatch[0], /portalDisableBiometricLock\(email\);/);
});

test('enabling shows a real error message on failure rather than silently doing nothing', () => {
  const fnMatch = SETTINGS.match(/async function handleEnableBiometric\(email\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate handleEnableBiometric()');
  assert.match(fnMatch[0], /if \(!result\.ok\) \{/);
  assert.match(fnMatch[0], /msgEl\.textContent = result\.error;/);
});

test('the overlay CSS is a real full-screen fixed layer, not an inline or partial cover that content could show through', () => {
  const block = CSS.match(/\.biometric-lock-overlay \{[\s\S]*?\}/);
  assert.ok(block, 'expected a .biometric-lock-overlay rule');
  assert.match(block[0], /position: fixed;/);
  assert.match(block[0], /inset: 0;/);
});

test('portal-app.js and portal-app.css are precached and CACHE_NAME was bumped again for this change', () => {
  const SW = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');
  assert.match(SW, /'\/portal\/portal-app\.js'/);
  assert.match(SW, /'\/portal\/portal-app\.css'/);
  assert.match(SW, /const CACHE_NAME = 'th-portal-v7';/);
});
