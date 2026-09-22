// Two-factor authentication for internal /tools/ accounts (2026-09-22).
//
// Owner/Developer/Employee accounts (account_roles/role_definitions) had
// zero MFA option before this, even though the client portal shipped real
// TOTP MFA for client-facing accounts on 2026-09-16 (portal-mfa.test.js).
// This mirrors that proven pattern -- real, server-verified Supabase Auth
// TOTP, not a local-only flag -- but via raw fetch() against the same
// Auth REST endpoints (matching auth.js's existing no-supabase-js-loaded
// convention) instead of a loaded @supabase/supabase-js client, and adds a
// login-time gate that is MANDATORY for any account whose real permissions
// require it, plus a custom recovery-code system for lockout. Full design
// reasoning: docs/specialist-logs/security.md's 2026-09-22 entry.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AUTH_JS = fs.readFileSync(repo('tools', 'auth.js'), 'utf8');
const LOGIN = fs.readFileSync(repo('tools', 'login.html'), 'utf8');
const SETTINGS = fs.readFileSync(repo('tools', 'settings.html'), 'utf8');
const SQL = fs.readFileSync(repo('sql', 'security', 'add_internal_mfa_recovery_codes.sql'), 'utf8');
const SEARCH_PATH_FIX_SQL = fs.readFileSync(repo('sql', 'security', 'fix_internal_mfa_recovery_codes_search_path.sql'), 'utf8');

// ---------------------------------------------------------------------------
// auth.js -- helper functions and the mandatory/optional decision
// ---------------------------------------------------------------------------

test('auth.js defines raw-fetch MFA helpers (enroll/challenge/verify/unenroll/list), no new SDK dependency', () => {
  assert.match(AUTH_JS, /async function mfaListVerifiedTotpFactor\(accessToken\)/);
  assert.match(AUTH_JS, /async function mfaEnroll\(accessToken\)/);
  assert.match(AUTH_JS, /async function mfaChallenge\(accessToken, factorId\)/);
  assert.match(AUTH_JS, /async function mfaVerify\(accessToken, factorId, challengeId, code\)/);
  assert.match(AUTH_JS, /async function mfaChallengeAndVerify\(accessToken, factorId, code\)/);
  assert.match(AUTH_JS, /async function mfaUnenroll\(accessToken, factorId\)/);
});

test('login.html does not load @supabase/supabase-js as a <script> for this feature -- raw fetch() only, matching auth.js', () => {
  assert.doesNotMatch(LOGIN, /<script[^>]*supabase-js/);
});

test('mfaEnroll() calls the real Supabase Auth REST endpoint with factor_type totp', () => {
  const start = AUTH_JS.indexOf('async function mfaEnroll(');
  assert.ok(start >= 0);
  const body = AUTH_JS.slice(start, AUTH_JS.indexOf('async function mfaChallenge('));
  assert.match(body, /\$\{SUPABASE_URL\}\/auth\/v1\/factors/);
  assert.match(body, /factor_type: 'totp'/);
});

test('mfaEnroll() wraps a bare SVG qr_code as a data URI, matching what the SDK does internally', () => {
  const start = AUTH_JS.indexOf('async function mfaEnroll(');
  const body = AUTH_JS.slice(start, AUTH_JS.indexOf('async function mfaChallenge('));
  assert.match(body, /data:image\/svg\+xml;utf-8,/);
});

test('mfaVerify() hits /factors/:id/verify and returns the new (stepped-up) session', () => {
  const start = AUTH_JS.indexOf('async function mfaVerify(');
  const body = AUTH_JS.slice(start, AUTH_JS.indexOf('async function mfaChallengeAndVerify('));
  assert.match(body, /\/auth\/v1\/factors\/\$\{factorId\}\/verify/);
  assert.match(body, /challenge_id: challengeId/);
  assert.match(body, /access_token: data\.access_token/);
  assert.match(body, /refresh_token: data\.refresh_token/);
});

test('signIn() supports a skipPersist option so a password check never stores a session before MFA clears', () => {
  const start = AUTH_JS.indexOf('async function signIn(email, password, rememberMe, options)');
  assert.ok(start >= 0, 'expected signIn() to accept an options param');
  const body = AUTH_JS.slice(start, AUTH_JS.indexOf('function persistSession('));
  assert.match(body, /if \(options\.skipPersist\)/);
  assert.match(body, /return Object\.assign\(\{ ok: true \}, sessionFields\);/);
  // The normal (no options) path must still persist exactly as before.
  assert.match(body, /storeSession\(sessionFields, !!rememberMe\);/);
});

test('loadCurrentUserRole() accepts an override token/email without polluting the real cached session', () => {
  const start = AUTH_JS.indexOf('async function loadCurrentUserRole(overrideAccessToken, overrideEmail)');
  assert.ok(start >= 0);
  const end = AUTH_JS.indexOf('function getCurrentUserRole()');
  const body = AUTH_JS.slice(start, end);
  assert.match(body, /const usingOverride = !!overrideAccessToken;/);
  assert.match(body, /if \(!usingOverride\) _cachedRoleInfo = /);
  assert.match(body, /if \(!usingOverride\) \{/);
  assert.match(body, /window\.dispatchEvent\(new CustomEvent\('th-role-loaded'/);
});

test('requiresMfaForRole() is keyed off real permission booleans, not just the roleName label', () => {
  const start = AUTH_JS.indexOf('function requiresMfaForRole(roleInfo)');
  assert.ok(start >= 0);
  const body = AUTH_JS.slice(start, start + 700);
  assert.match(body, /roleInfo\.canManageRoles/);
  assert.match(body, /roleInfo\.canAccessDevTools/);
  assert.match(body, /roleInfo\.canManageInvoices/);
  assert.match(body, /roleInfo\.canViewFinance/);
  assert.doesNotMatch(body, /roleInfo\.roleName ===/);
});

test('requiresMfaForRole() behaves correctly for real account shapes (executed, not just pattern-matched)', () => {
  // Execute the real function body in isolation (same technique this repo
  // already uses -- see e.g. tests/sync/*.test.js -- to actually run a
  // shared function rather than only regex-match its source).
  const start = AUTH_JS.indexOf('function requiresMfaForRole(roleInfo)');
  const braceStart = AUTH_JS.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < AUTH_JS.length; i++) {
    if (AUTH_JS[i] === '{') depth++;
    else if (AUTH_JS[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const src = AUTH_JS.slice(start, i) + '\nrequiresMfaForRole;';
  const requiresMfaForRole = vm.runInNewContext(src);

  assert.equal(requiresMfaForRole(null), false, 'no role assigned at all -- not mandatory (nothing to gate)');
  assert.equal(requiresMfaForRole({}), false, 'a bare account with every boolean falsy -- optional, not mandatory');
  assert.equal(requiresMfaForRole({ canViewFinance: true }), true, 'any one elevated boolean is enough to require it');
  assert.equal(requiresMfaForRole({ canAccessDevToolsFull: true }), true, 'Developer-tier capability requires it');
  assert.equal(requiresMfaForRole({ canManageRoles: true }), true, 'role-management capability requires it');
  assert.equal(
    requiresMfaForRole({ roleName: 'Employee', canManageRoles: false, canAccessDevTools: false, canManageSiteContent: false, canManageInvoices: false, canManageContracts: false, canViewFinance: false, canViewRunway: false, canManageReviews: false }),
    false,
    'an Employee-labeled account with every real permission off is optional-tier, regardless of the label'
  );
});

// ---------------------------------------------------------------------------
// login.html -- the mandatory gate and the challenge flow
// ---------------------------------------------------------------------------

test('login.html never persists a session before checking MFA -- signIn is called with skipPersist', () => {
  assert.match(LOGIN, /await signIn\(email, password, rememberMe, \{ skipPersist: true \}\);/);
});

test('login.html challenges for an already-enrolled factor before ever redirecting', () => {
  assert.match(LOGIN, /const factor = await mfaListVerifiedTotpFactor\(pendingSession\.access_token\);/);
  const factorCheckIdx = LOGIN.indexOf('const factor = await mfaListVerifiedTotpFactor(');
  const redirectIdx = LOGIN.indexOf('persistSession(pendingSession, pendingRememberMe);\n    redirectAfterLogin();');
  assert.ok(redirectIdx > factorCheckIdx, 'the unconditional success redirect must come after the factor check, not before it');
});

test('login.html forces enrollment for a role that requires MFA and has none enrolled yet, before granting access', () => {
  assert.match(LOGIN, /const roleInfo = await loadCurrentUserRole\(pendingSession\.access_token, pendingSession\.email\);/);
  assert.match(LOGIN, /if \(requiresMfaForRole\(roleInfo\)\) \{\s*\n\s*await startMandatoryEnrollment\(\);\s*\n\s*return;\s*\n\s*\}/);
});

test('login.html shows a real challenge view and verifies via Supabase before persisting a session', () => {
  assert.match(LOGIN, /id="mfaChallengeView"/);
  assert.match(LOGIN, /const result = await mfaChallengeAndVerify\(pendingSession\.access_token, pendingFactorId, code\);/);
  const submitStart = LOGIN.indexOf("document.getElementById('mfaChallengeSubmitBtn').addEventListener");
  const cancelStart = LOGIN.indexOf("document.getElementById('mfaChallengeCancelLink').addEventListener");
  const body = LOGIN.slice(submitStart, cancelStart);
  assert.match(body, /if \(!result\.ok\) \{ errorEl\.textContent = result\.error; return; \}/);
  assert.match(body, /persistSession\(\{/);
});

test('login.html offers a recovery-code path for a lost authenticator device', () => {
  assert.match(LOGIN, /id="mfaRecoveryCodeInput"/);
  assert.match(LOGIN, /const result = await verifyRecoveryCode\(pendingSession\.access_token, code\);/);
  assert.match(LOGIN, /if \(!result\.ok \|\| !result\.valid\)/);
});

test("login.html's challenge/enroll Cancel discards the pending (never-persisted) session rather than leaving it half-authenticated", () => {
  assert.match(LOGIN, /function cancelPendingLoginAndReset\(\)/);
  const start = LOGIN.indexOf('function cancelPendingLoginAndReset()');
  const body = LOGIN.slice(start, start + 400);
  assert.match(body, /pendingSession = null;/);
  // Enrollment's Cancel additionally unenrolls the just-created factor so a
  // dead, unverified one doesn't linger on the account.
  assert.match(LOGIN, /mfaUnenroll\(pendingSession\.access_token, pendingFactorId\)\.catch\(\(\) => \{\}\);/);
});

test('login.html generates and displays recovery codes exactly once, right after a first-time mandatory enrollment', () => {
  assert.match(LOGIN, /id="mfaRecoveryCodesView"/);
  const enrollVerifyStart = LOGIN.indexOf("document.getElementById('mfaEnrollVerifyBtn').addEventListener");
  const cancelLinkStart = LOGIN.indexOf("document.getElementById('mfaEnrollCancelLink').addEventListener");
  const body = LOGIN.slice(enrollVerifyStart, cancelLinkStart);
  assert.match(body, /const codesResult = await generateRecoveryCodes\(pendingSession\.access_token, 10\);/);
  assert.match(body, /showStep\('mfaRecoveryCodesView'\);/);
});

test('login.html does not add any new external origins to the CSP for this feature', () => {
  const cspMatch = LOGIN.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(cspMatch);
  assert.match(cspMatch[1], /connect-src 'self' https:\/\/\*\.supabase\.co;/);
});

// ---------------------------------------------------------------------------
// settings.html -- the self-serve enroll/disable card
// ---------------------------------------------------------------------------

test('settings.html has a Two-Factor Authentication card that reflects mandatory vs. optional per account', () => {
  assert.match(SETTINGS, /<h2>Two-Factor Authentication<\/h2>/);
  assert.match(SETTINGS, /Required for your account/);
  assert.match(SETTINGS, /Optional, but recommended/);
});

test('settings.html enrolls/disables via the same raw-fetch auth.js helpers login.html uses, not a duplicate implementation', () => {
  assert.match(SETTINGS, /await mfaListVerifiedTotpFactor\(getAuthToken\(\)\)/);
  assert.match(SETTINGS, /await mfaEnroll\(getAuthToken\(\)\)/);
  assert.match(SETTINGS, /await mfaChallengeAndVerify\(getAuthToken\(\), mfaPendingFactorId, code\)/);
  assert.match(SETTINGS, /await mfaUnenroll\(getAuthToken\(\), mfaFactorId\)/);
});

test('settings.html confirms before turning two-factor authentication off', () => {
  const start = SETTINGS.indexOf('async function handleDisableMfaSettings()');
  assert.ok(start >= 0);
  const body = SETTINGS.slice(start, start + 700);
  assert.match(body, /await showConfirm\('Turn off two-factor authentication\?/);
  assert.match(body, /if \(!confirmed\) return;/);
});

test('settings.html deletes recovery codes when two-factor authentication is turned off', () => {
  const start = SETTINGS.indexOf('async function handleDisableMfaSettings()');
  const body = SETTINGS.slice(start, start + 900);
  assert.match(body, /await deleteRecoveryCodes\(getAuthToken\(\)\);/);
});

test('settings.html can regenerate recovery codes and shows how many are left', () => {
  assert.match(SETTINGS, /await countRemainingRecoveryCodes\(getAuthToken\(\)\)/);
  assert.match(SETTINGS, /async function handleRegenerateRecoveryCodes\(\)/);
  assert.match(SETTINGS, /await generateRecoveryCodes\(getAuthToken\(\), 10\)/);
});

test('settings.html initializes the 2FA card on load', () => {
  const initStart = SETTINGS.indexOf('document.addEventListener(\'DOMContentLoaded\'');
  const body = SETTINGS.slice(initStart, initStart + 4000);
  assert.match(body, /await renderMfaSettingsCard\(\);/);
});

// ---------------------------------------------------------------------------
// SQL -- the custom recovery-code table/functions
// ---------------------------------------------------------------------------

test('the recovery-codes table denies all direct access -- every path goes through a SECURITY DEFINER function', () => {
  assert.match(SQL, /alter table internal_mfa_recovery_codes enable row level security;/);
  assert.match(SQL, /revoke all on internal_mfa_recovery_codes from anon, authenticated;/);
  // No CREATE POLICY at all on this table -- default-deny is the point.
  assert.doesNotMatch(SQL, /create policy[\s\S]*?on internal_mfa_recovery_codes/i);
});

test('every recovery-code function is keyed to auth.uid(), never a caller-supplied user id', () => {
  const fns = [
    'generate_internal_recovery_codes',
    'verify_and_consume_internal_recovery_code',
    'count_unused_internal_recovery_codes',
    'delete_internal_recovery_codes',
  ];
  for (const fn of fns) {
    const start = SQL.indexOf(`create or replace function ${fn}(`);
    assert.ok(start >= 0, `expected ${fn} to exist`);
    const end = SQL.indexOf('$$;', start);
    const body = SQL.slice(start, end);
    assert.match(body, /security definer/);
    assert.match(body, /auth\.uid\(\)/);
    // No p_user_id / p_email style parameter that would let a caller name
    // a different account's rows.
    assert.doesNotMatch(body, /p_user_id|p_email/);
  }
});

test('recovery codes are stored hashed (bcrypt via pgcrypto), never in plaintext', () => {
  assert.match(SQL, /create extension if not exists pgcrypto;/);
  assert.match(SQL, /code_hash text not null/);
  assert.match(SQL, /crypt\(v_code, gen_salt\('bf'\)\)/);
  assert.match(SQL, /code_hash = crypt\(p_code, code_hash\)/);
  // The table's only per-code column is the hash -- no plaintext "code"
  // column stored alongside it.
  assert.doesNotMatch(SQL, /\bcode\s+text\s+not\s+null/);
});

test('a recovery code is one-time use -- verifying it marks it used, and the lookup excludes already-used codes', () => {
  const start = SQL.indexOf('create or replace function verify_and_consume_internal_recovery_code');
  const end = SQL.indexOf('$$;', start);
  const body = SQL.slice(start, end);
  assert.match(body, /and used_at is null/);
  assert.match(body, /update internal_mfa_recovery_codes set used_at = now\(\)/);
});

test('generating new codes replaces the old set -- an old written-down code cannot outlive a regeneration', () => {
  const start = SQL.indexOf('create or replace function generate_internal_recovery_codes');
  const end = SQL.indexOf('$$;', start);
  const body = SQL.slice(start, end);
  assert.match(body, /delete from internal_mfa_recovery_codes where user_id = v_user_id;/);
});

test("generate/verify functions' search_path includes extensions, where pgcrypto actually lives on this project -- the original migration's search_path = public alone made every gen_random_bytes/crypt/gen_salt call fail live, confirmed by simulating an authenticated RPC call, fixed in fix_internal_mfa_recovery_codes_search_path.sql", () => {
  for (const fnName of ['generate_internal_recovery_codes', 'verify_and_consume_internal_recovery_code']) {
    const start = SEARCH_PATH_FIX_SQL.indexOf(`create or replace function ${fnName}`);
    assert.ok(start >= 0, `${fnName} not found in the search_path fix file`);
    const end = SEARCH_PATH_FIX_SQL.indexOf('$$;', start);
    const body = SEARCH_PATH_FIX_SQL.slice(start, end);
    assert.match(body, /set search_path = public, extensions/);
    // Guard against the original bug's exact shape reappearing here.
    assert.doesNotMatch(body, /set search_path = public;/);
  }
  // The two functions that never call a pgcrypto function were correctly
  // left untouched -- confirm the fix file doesn't redefine them.
  assert.doesNotMatch(SEARCH_PATH_FIX_SQL, /create or replace function count_unused_internal_recovery_codes/);
  assert.doesNotMatch(SEARCH_PATH_FIX_SQL, /create or replace function delete_internal_recovery_codes/);
});

test('EXECUTE is revoked from public and granted only to authenticated for every recovery-code function', () => {
  const fns = [
    'generate_internal_recovery_codes(int)',
    'verify_and_consume_internal_recovery_code(text)',
    'count_unused_internal_recovery_codes()',
    'delete_internal_recovery_codes()',
  ];
  for (const fn of fns) {
    assert.match(SQL, new RegExp(`revoke all on function ${escapeRegex(fn)} from public;`));
    assert.match(SQL, new RegExp(`grant execute on function ${escapeRegex(fn)} to authenticated;`));
  }
});

// ---------------------------------------------------------------------------
// workspace.html -- the transition-period nag for a stale pre-feature session
// ---------------------------------------------------------------------------

test('workspace.html nags a mandatory-tier account that is not yet enrolled, without permanently silencing it', () => {
  const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
  const start = WORKSPACE.indexOf('async function renderMfaNagBanner()');
  assert.ok(start >= 0);
  const body = WORKSPACE.slice(start, start + 2200);
  assert.match(body, /requiresMfaForRole\(role\)/);
  assert.match(body, /mfaListVerifiedTotpFactor\(getAuthToken\(\)\)/);
  assert.match(body, /if \(factor\) return;/);
  // Session-only dismissal, not localStorage -- it must resurface on the
  // next real visit until the account actually enrolls.
  assert.match(body, /sessionStorage\.setItem\('th_mfa_nag_dismissed', '1'\)/);
  assert.doesNotMatch(body, /localStorage\.setItem\('th_mfa_nag_dismissed'/);
});
