// Face ID instead of the 2FA code (2026-09-23), requested directly:
// "facial recognition AND two factor is way too much. Make it pick facial
// over two factor for the portal, also make two factor optional." On a
// device where the account has Face ID set up, Face ID is the second step
// at sign-in instead of the authenticator code; anywhere else it's the
// code. Two-factor stays optional. And a session that only proved the
// password can no longer skip its second step by refreshing login.html or
// opening a page directly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const APP = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const LOGIN = fs.readFileSync(repo('portal', 'login.html'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

const EMAIL = 'Sarah@Example.com';
const LOCK_KEY = 'th_portal_biometric_lock_sarah@example.com';
const UNLOCKED_KEY = 'th_portal_biometric_unlocked_sarah@example.com';
const STEP_KEY = 'th_portal_second_step_sarah@example.com';

// portal-app.js in a fresh page, with a stand-in WebAuthn (faceId: 'pass',
// 'fail' or 'none') and a record of where portalGo() would have gone.
function page({ faceId = 'none', faceIdOnDevice = false } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', {
    runScripts: 'dangerously', url: 'https://example.com/portal/home.html',
    beforeParse(w) {
      w.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) }); // error capture stays quiet
      if (faceId !== 'none') {
        w.PublicKeyCredential = function PublicKeyCredential() {};
        Object.defineProperty(w.navigator, 'credentials', {
          configurable: true,
          value: { get: async () => { w.faceIdAsks = (w.faceIdAsks || 0) + 1; if (faceId === 'fail') throw new Error('NotAllowedError'); return { id: 'cred' }; } },
        });
      }
      if (faceIdOnDevice) w.localStorage.setItem(LOCK_KEY, w.btoa('cred'));
    },
  });
  const w = dom.window;
  const s = w.document.createElement('script');
  s.textContent = APP;
  w.document.body.appendChild(s);
  w.went = [];
  w.portalGo = (url) => w.went.push(url);
  return w;
}
// A Supabase client stand-in: `level` is what the session proved,
// `twoFactor` whether a verified TOTP factor exists.
function client({ level = 'aal1', twoFactor = true, throws = false } = {}) {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => {
          if (throws) throw new Error('boom');
          return { data: { currentLevel: level, nextLevel: twoFactor ? 'aal2' : level } };
        },
      },
      signOut: async () => {},
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settles(promise, ms = 30) {
  let done = false;
  promise.then(() => { done = true; });
  await new Promise((r) => setTimeout(r, ms));
  return done;
}

test('the second step is owed only when the session proved the password alone on an account with two-factor on, and not after Face ID stood in', async () => {
  const w = page();
  assert.equal(await w.portalSecondStepOwed(EMAIL, client({ level: 'aal1', twoFactor: true })), true);
  assert.equal(await w.portalSecondStepOwed(EMAIL, client({ level: 'aal2', twoFactor: true })), false, 'the code was entered');
  assert.equal(await w.portalSecondStepOwed(EMAIL, client({ level: 'aal1', twoFactor: false })), false, 'two-factor is optional: off means nothing owed');
  assert.equal(await w.portalSecondStepOwed(EMAIL, client({ throws: true })), false, 'an error reads as nothing owed, the behavior before');
  w.sessionStorage.setItem(STEP_KEY, '1');
  assert.equal(await w.portalSecondStepOwed(EMAIL, client()), false, 'Face ID already stood in for the code in this tab');
  w.close();
});

test('owed, with Face ID on this device: Face ID stands in for the code -- one prompt, and it counts as the unlock too', async () => {
  const w = page({ faceId: 'pass', faceIdOnDevice: true });
  const stoodIn = await w.portalRequireSecondStep(EMAIL, client());
  assert.equal(stoodIn, true);
  assert.equal(w.faceIdAsks, 1);
  assert.equal(w.sessionStorage.getItem(STEP_KEY), '1');
  assert.equal(w.sessionStorage.getItem(UNLOCKED_KEY), '1');
  assert.equal(w.document.querySelector('.biometric-lock-overlay'), null, 'the overlay is gone');
  assert.deepEqual(Array.from(w.went), []);
  w.close();
});

test('owed, Face ID on this device but failing: it waits on the button, and "Use my 2FA code instead" goes to the code', async () => {
  const w = page({ faceId: 'fail', faceIdOnDevice: true });
  const p = w.portalRequireSecondStep(EMAIL, client());
  await tick(); await tick();
  const box = w.document.querySelector('.biometric-lock-overlay');
  assert.ok(box, 'the Face ID step is showing');
  assert.equal(box.querySelector('#faceIdStepTitle').textContent, 'Confirm it’s you');
  assert.equal(box.querySelector('#faceIdStepBtn').textContent, 'Continue with Face ID', 'back to the button after the failed try');
  assert.equal(box.querySelector('#faceIdStepBtn').disabled, false);
  box.querySelector('#faceIdStepCodeBtn').click();
  assert.deepEqual(Array.from(w.went), ['/portal/login.html?step=code']);
  assert.equal(w.document.querySelector('.biometric-lock-overlay'), null);
  assert.equal(await settles(p), false, 'never resolves: the page must not render as if Face ID had passed');
  assert.equal(w.sessionStorage.getItem(STEP_KEY), null);
  w.close();
});

test('owed, with no Face ID on this device: straight to the code, and the page never renders', async () => {
  const w = page({ faceId: 'pass', faceIdOnDevice: false });
  const p = w.portalRequireSecondStep(EMAIL, client());
  assert.equal(await settles(p), false);
  assert.deepEqual(Array.from(w.went), ['/portal/login.html?step=code']);
  assert.equal(w.faceIdAsks, undefined, 'no Face ID prompt on a device without it');
  w.close();
});

test('the page guard: Face ID standing in for the code is the only prompt; with nothing owed the ordinary lock works as before', async () => {
  const w = page({ faceId: 'pass', faceIdOnDevice: true });
  await w.portalGuardWithBiometricLock(EMAIL, client());
  assert.equal(w.faceIdAsks, 1, 'one Face ID prompt, not the step and then the lock');
  w.close();

  const plain = page({ faceId: 'pass', faceIdOnDevice: true });
  await plain.portalGuardWithBiometricLock(EMAIL, client({ twoFactor: false }));
  assert.equal(plain.faceIdAsks, 1, 'no two-factor: the ordinary Face ID lock');
  await plain.portalGuardWithBiometricLock(EMAIL, client({ twoFactor: false }));
  assert.equal(plain.faceIdAsks, 1, 'unlocked for the rest of the tab');
  plain.close();

  const signedIn = page({ faceId: 'pass', faceIdOnDevice: true });
  signedIn.portalMarkSignedIn(EMAIL);
  await signedIn.portalGuardWithBiometricLock(EMAIL, client({ level: 'aal2' }));
  assert.equal(signedIn.faceIdAsks, undefined, 'right after a fresh sign-in, no Face ID lock');
  signedIn.close();
});

// --- login.html ------------------------------------------------------------

test('login.html: after the password, a Face ID device gets Face ID instead of the code (the code one tap away); elsewhere the code', () => {
  const submit = LOGIN.slice(LOGIN.indexOf("document.getElementById('loginForm').addEventListener('submit'"), LOGIN.indexOf('function openMfaChallenge('));
  assert.match(submit, /if \(portalIsBiometricLockEnabled\(email\)\) \{\s*await portalFaceIdInsteadOfCode\(email, \(\) => openMfaChallenge\(factorId\)\);\s*window\.location\.replace\('\/portal\/home\.html'\);\s*return;\s*\}\s*openMfaChallenge\(factorId\);/);
  const faceIdIdx = submit.indexOf('portalFaceIdInsteadOfCode(');
  const aalIdx = submit.indexOf('getAuthenticatorAssuranceLevel()');
  assert.ok(aalIdx > 0 && faceIdIdx > aalIdx, 'only for an account the assurance check says owes a second step');
  assert.match(submit, /\/\/ The password was just typed: no Face ID lock straight after it\.\s*portalMarkSignedIn\(email\);\s*window\.location\.replace\('\/portal\/home\.html'\);/);
});

test('login.html: a signed-in session that still owes the code stays for the code on load -- refreshing no longer skips it', () => {
  const onLoad = LOGIN.slice(LOGIN.indexOf('client.auth.getSession().then(async'), LOGIN.indexOf('async function verifiedTotpFactorId()'));
  assert.match(onLoad, /if \(await portalSecondStepOwed\(email, client\)\) \{/);
  assert.match(onLoad, /const wantsCode = new URLSearchParams\(window\.location\.search\)\.get\('step'\) === 'code' \|\| !portalIsBiometricLockEnabled\(email\);/);
  assert.match(onLoad, /openMfaChallenge\(factorId\);\s*return;/);
  assert.ok(onLoad.indexOf('openMfaChallenge(') < onLoad.indexOf("window.location.replace('/portal/home.html')"), 'the code comes before any redirect');
  assert.match(onLoad, /await client\.auth\.signOut\(\{ scope: 'local' \}\);\s*return;\s*\}\s*\}\s*window\.location\.replace/, 'no factor to ask for: stay on the form, never bounce back to home.html (which would send it straight back here)');
  const verify = LOGIN.slice(LOGIN.indexOf('async function verify()'), LOGIN.indexOf('async function cancel()'));
  assert.match(verify, /if \(signingInEmail\) portalMarkSignedIn\(signingInEmail\);\s*window\.location\.replace\('\/portal\/home\.html'\);/, 'password and code just done: no Face ID lock after');
});

// --- settings.html ---------------------------------------------------------

test('Settings says two-factor is optional and that Face ID replaces the code on this device', () => {
  assert.match(SETTINGS, /<div class="set-card-sub">Optional\. A code from an authenticator app as a second step when you sign in, on top of your password\. On a device with Face ID set up below, Face ID is used instead of the code\.<\/div>/);
  assert.match(SETTINGS, /If you have two-factor on, it also replaces the code when you sign in here\./);
});

test('Settings asks for an owed second step too, so it is not a way around two-factor, but still skips the plain Face ID lock', () => {
  const init = SETTINGS.slice(SETTINGS.indexOf('async function init()'));
  const sessionIdx = init.indexOf('if (!session)');
  const stepIdx = init.indexOf('await portalRequireSecondStep(email, client);');
  const renderIdx = init.indexOf("document.getElementById('clientEmailDisplay')");
  assert.ok(sessionIdx > 0 && stepIdx > sessionIdx && renderIdx > stepIdx, 'after the session check, before anything renders');
});

test('turning two-factor off from a Face ID session asks for the code once (Supabase only removes a factor from a code-proved session)', () => {
  const disable = SETTINGS.match(/async function handleDisableMfa\(\)[\s\S]*?\n  \}\n/)[0];
  assert.match(disable, /if \(!aal \|\| aal\.currentLevel !== 'aal2'\) \{[\s\S]*?mfaDisableArea'\)\.style\.display = 'block';[\s\S]*?return;\s*\}\s*await unenrollMfa\(\);/);
  const verify = SETTINGS.match(/async function handleVerifyMfaDisable\(\)[\s\S]*?\n  \}\n/)[0];
  assert.match(verify, /await client\.auth\.mfa\.challengeAndVerify\(\{ factorId: mfaFactorId, code \}\);/);
  assert.ok(verify.indexOf('if (error) {') < verify.indexOf('await unenrollMfa();'), 'a wrong code never turns it off');
  assert.match(SETTINGS, /id="mfaDisableCodeInput" inputmode="numeric" pattern="\[0-9\]\*" autocomplete="one-time-code"/);
});
