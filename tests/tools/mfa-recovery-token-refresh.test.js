// Real bug fix (2026-09-22): "Could not generate recovery codes. Please try
// again." Root cause: getAuthToken() in tools/auth.js falls back to the
// Supabase anon key whenever the stored access token has expired
// (hasValidSession() returns false) -- it does NOT refresh first. The
// Settings-page MFA/recovery-code handlers called getAuthToken() directly
// without first awaiting ensureFreshToken() (unlike loadCurrentUserRole()
// elsewhere in auth.js, which already does this for the identical reason).
// Net effect: an access token that expired since Settings loaded (normal
// after enough time on the page) meant every recovery-code RPC went out
// authenticated as anon, auth.uid() resolved to null inside the
// SECURITY DEFINER function, it raised "not authenticated", and the
// generic catch-all error in generateRecoveryCodes() covered up what
// actually happened.
//
// This file covers both halves of the fix:
//   1. every MFA/recovery-code handler in settings.html now awaits
//      ensureFreshToken() before its first getAuthToken() call, not just
//      the two obviously-named recovery-code ones;
//   2. generateRecoveryCodes()/redeemRecoveryCode() in auth.js now surface
//      the real error detail instead of only ever the generic fallback,
//      matching what mfaUnenroll() already did a few lines above them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const AUTH_JS = fs.readFileSync(repo('tools', 'auth.js'), 'utf8');
const SETTINGS = fs.readFileSync(repo('tools', 'settings.html'), 'utf8');

function extractFn(src, name) {
  let start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  // Include a leading "async " if this is an async function declaration --
  // a bare `indexOf('function NAME(')` lands right after "async ", which
  // would otherwise silently strip it from the extracted source and make
  // every `await` inside it a syntax error when run standalone.
  if (src.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// ---------------------------------------------------------------------------
// 1. Static check: every Settings-page MFA handler that calls getAuthToken()
//    calls ensureFreshToken() first (audited across the whole MFA section,
//    not just handleRegenerateRecoveryCodes/the enroll-then-show-codes path).
// ---------------------------------------------------------------------------

const SETTINGS_MFA_HANDLERS = [
  'renderMfaSettingsCard',
  'handleStartMfaEnrollSettings',
  'handleVerifyMfaEnrollSettings',
  'handleCancelMfaEnrollSettings',
  'handleDisableMfaSettings',
  'handleRegenerateRecoveryCodes',
];

for (const name of SETTINGS_MFA_HANDLERS) {
  test(`settings.html's ${name}() awaits ensureFreshToken() before its first getAuthToken() call`, () => {
    const body = extractFn(SETTINGS, name);
    const freshIdx = body.indexOf('ensureFreshToken()');
    const tokenIdx = body.indexOf('getAuthToken()');
    assert.ok(freshIdx >= 0, `${name}() never calls ensureFreshToken()`);
    assert.ok(tokenIdx >= 0, `${name}() never calls getAuthToken() (test may be stale)`);
    assert.ok(freshIdx < tokenIdx, `${name}() calls getAuthToken() before ensureFreshToken()`);
    assert.match(body, /await ensureFreshToken\(\);/, `${name}() must AWAIT ensureFreshToken(), not fire-and-forget it`);
  });
}

test('handleCancelMfaEnrollSettings is async (required to await ensureFreshToken before its getAuthToken() call)', () => {
  assert.match(SETTINGS, /async function handleCancelMfaEnrollSettings\(\)/);
});

// ---------------------------------------------------------------------------
// 2. Runtime check: generateRecoveryCodes()/redeemRecoveryCode() surface the
//    real error detail on a genuine RPC failure, not just the generic
//    fallback message -- this is what actually makes the bug diagnosable in
//    the UI/console next time, rather than only fixing this one occurrence.
// ---------------------------------------------------------------------------

function makeAuthSandbox(fetchImpl) {
  const sandbox = {
    fetch: fetchImpl,
    console,
    logClientError: () => {},
  };
  vm.createContext(sandbox);
  const src = `
    const SUPABASE_URL = 'https://example.supabase.co';
    const SUPABASE_ANON_KEY = 'anon-key';
    ${extractFn(AUTH_JS, 'generateRecoveryCodes')}
    ${extractFn(AUTH_JS, 'redeemRecoveryCode')}
  `;
  vm.runInContext(src, sandbox);
  return sandbox;
}

test('generateRecoveryCodes() surfaces the real PostgREST error message on a genuine RPC failure (e.g. "not authenticated" from an anon-key call), not the generic fallback', async () => {
  const sandbox = makeAuthSandbox(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: 'not authenticated', code: 'PGRST100' }),
  }));
  const result = await sandbox.generateRecoveryCodes('some-token', 10);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not authenticated');
  assert.notEqual(result.error, 'Could not generate recovery codes. Please try again.');
});

test('generateRecoveryCodes() falls back to the generic message only when the server gives no real detail at all', async () => {
  const sandbox = makeAuthSandbox(async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  }));
  const result = await sandbox.generateRecoveryCodes('some-token', 10);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Could not generate recovery codes. Please try again.');
});

test('generateRecoveryCodes() still succeeds and returns the codes on a real 2xx response', async () => {
  const sandbox = makeAuthSandbox(async () => ({
    ok: true,
    status: 200,
    json: async () => (['CODE1-AAAA', 'CODE2-BBBB']),
  }));
  const result = await sandbox.generateRecoveryCodes('some-token', 10);
  assert.equal(result.ok, true);
  // Not assert.deepEqual(result.codes, [...]) -- the array/objects here come
  // from a separate vm context with its own Array/Object prototypes, so a
  // strict structural comparison against a main-realm array fails on
  // prototype identity even though the actual values match. Compare the
  // values directly instead.
  assert.equal(Array.from(result.codes).join(','), 'CODE1-AAAA,CODE2-BBBB');
});

// redeemRecoveryCode() replaced verifyRecoveryCode() on 2026-09-25 (server-side
// two-factor enforcement) and keeps the same error handling.
test('redeemRecoveryCode() surfaces the real error message on a genuine RPC failure instead of only the generic fallback', async () => {
  const sandbox = makeAuthSandbox(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ message: 'not authenticated' }),
  }));
  const result = await sandbox.redeemRecoveryCode('some-token', 'ABCD-1234');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not authenticated');
  assert.notEqual(result.error, 'Could not check that recovery code. Please try again.');
});

test('redeemRecoveryCode() still resolves valid: true/false correctly on success', async () => {
  // Not assert.deepEqual against a plain object literal -- same cross-realm
  // prototype mismatch as the codes array above. Individual field checks
  // avoid it entirely.
  const sandboxTrue = makeAuthSandbox(async () => ({ ok: true, status: 200, json: async () => true }));
  const resTrue = await sandboxTrue.redeemRecoveryCode('t', 'c');
  assert.equal(resTrue.ok, true);
  assert.equal(resTrue.valid, true);

  const sandboxFalse = makeAuthSandbox(async () => ({ ok: true, status: 200, json: async () => false }));
  const resFalse = await sandboxFalse.redeemRecoveryCode('t', 'c');
  assert.equal(resFalse.ok, true);
  assert.equal(resFalse.valid, false);
});
