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
// One sign-in since fix plan FP4.1 (2026-11-06): the Workspace steps live here.
const LOGIN = fs.readFileSync(repo('portal', 'login.html'), 'utf8');
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

test('the sign-in makes every Workspace two-factor call with raw fetch() (auth.js); supabase-js only checks the password, in memory, pinned with SRI', () => {
  // One sign-in since FP4.1 (2026-11-06): portal/login.html. supabase-js is
  // the portal's; for staff it only runs the password check on a client
  // that stores nothing (persistSession: false).
  assert.match(LOGIN, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.js" integrity="sha384-[^"]+" crossorigin="anonymous"><\/script>/);
  const staff = LOGIN.slice(LOGIN.indexOf('// ---- Staff path'), LOGIN.indexOf('// Sent here by checkInternalMfaSession()'));
  assert.ok(staff.length > 1000, 'the staff section was found');
  assert.doesNotMatch(staff, /signinClient\.|client\.auth\.mfa/, 'the staff steps never use supabase-js');
  assert.match(staff, /mfaChallengeAndVerify\(staffPending\.access_token/);
});

test('mfaEnroll() calls the real Supabase Auth REST endpoint with factor_type totp', () => {
  const start = AUTH_JS.indexOf('async function mfaEnroll(');
  assert.ok(start >= 0);
  const body = AUTH_JS.slice(start, AUTH_JS.indexOf('async function mfaChallenge('));
  assert.match(body, /\$\{SUPABASE_URL\}\/auth\/v1\/factors/);
  assert.match(body, /factor_type: 'totp'/);
});

test('mfaEnroll() turns the bare SVG qr_code into a URL-encoded data URI (an unencoded "#" broke the image, 2026-10-04)', () => {
  const start = AUTH_JS.indexOf('async function mfaEnroll(');
  const body = AUTH_JS.slice(start, AUTH_JS.indexOf('async function mfaChallenge('));
  assert.match(body, /data\.totp\.qr_code = mfaQrImageSrc\(data\.totp\.qr_code\);/);
  assert.match(AUTH_JS, /'data:image\/svg\+xml;charset=utf-8,' \+ encodeURIComponent\(raw\)/);
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
// The sign-in's staff steps -- the mandatory gate and the challenge flow
// (moved from tools/login.html to portal/login.html in FP4.1, 2026-11-06)
// ---------------------------------------------------------------------------

test('sign-in never persists a staff session before checking MFA -- the password session is held in memory only', () => {
  assert.match(LOGIN, /\{ auth: \{ storage: memoryStore, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false \} \}/);
  assert.equal((LOGIN.match(/persistSession\(/g) || []).length, 1, 'one place stores a Workspace session');
  assert.match(LOGIN, /function staffStoreAndFinish\(session\) \{\s*persistSession\(session, staffRememberMe\);/);
});

test('sign-in challenges for an already-enrolled factor before ever storing or redirecting', () => {
  const cont = LOGIN.slice(LOGIN.indexOf('async function staffContinueSignIn('), LOGIN.indexOf('async function staffSignInOnTrustedDevice('));
  assert.match(cont, /const factor = await mfaListVerifiedTotpFactor\(staffPending\.access_token\);/);
  const factorCheckIdx = cont.indexOf('const factor = await mfaListVerifiedTotpFactor(');
  const storeIdx = cont.lastIndexOf('staffStoreAndFinish(staffPending);');
  assert.ok(storeIdx > factorCheckIdx, 'the unconditional store-and-go must come after the factor check, not before it');
  assert.match(cont, /staffShow\('staffCodeView'\);\s*document\.getElementById\('staffCodeInput'\)\.focus\(\);\s*return;/, 'with a factor, the code step returns first');
});

test('sign-in forces enrollment for a role that requires MFA and has none enrolled yet, before granting access', () => {
  assert.match(LOGIN, /const roleInfo = await loadCurrentUserRole\(staffPending\.access_token, staffPending\.email\);\s*if \(requiresMfaForRole\(roleInfo\)\) \{ await staffStartEnrollment\(\); return; \}\s*staffStoreAndFinish\(staffPending\);/);
});

test('sign-in shows a real challenge view and verifies via Supabase before persisting a session', () => {
  assert.match(LOGIN, /id="staffCodeView"/);
  const submitStart = LOGIN.indexOf("document.getElementById('staffCodeSubmit').addEventListener");
  const cancelStart = LOGIN.indexOf("document.getElementById('staffCodeCancel').addEventListener");
  const body = LOGIN.slice(submitStart, cancelStart);
  assert.match(body, /const result = await mfaChallengeAndVerify\(staffPending\.access_token, staffFactorId, code\);/);
  assert.match(body, /if \(!result\.ok\) \{ errorEl\.textContent = result\.error; staffShakeBoxes\(\); return; \}/);
  assert.match(body, /staffPending = \{ access_token: result\.access_token,[^\n]*\};\s*staffStoreAndFinish\(staffPending\);/);
});

test('sign-in offers a recovery-code path for a lost authenticator device', () => {
  assert.match(LOGIN, /id="staffRecoveryInput"/);
  assert.match(LOGIN, /const result = await redeemRecoveryCode\(staffPending\.access_token, code\);/);
  assert.match(LOGIN, /if \(!result\.ok \|\| !result\.valid\)/);
});

test("sign-in's challenge/enroll Cancel discards the pending (never-persisted) session rather than leaving it half-authenticated", () => {
  const start = LOGIN.indexOf('function staffBackToSignIn()');
  assert.ok(start > 0);
  assert.match(LOGIN.slice(start, start + 200), /staffPending = null;/);
  // Enrollment's Cancel additionally unenrolls the just-created factor so a
  // dead, unverified one doesn't linger on the account.
  assert.match(LOGIN, /mfaUnenroll\(staffPending\.access_token, staffFactorId\)\.catch\(\(\) => \{\}\);\s*staffBackToSignIn\(\);/);
});

test('sign-in generates and displays recovery codes exactly once, right after a first-time mandatory enrollment', () => {
  assert.match(LOGIN, /id="staffCodesView"/);
  const enrollVerifyStart = LOGIN.indexOf("document.getElementById('staffEnrollVerify').addEventListener");
  const cancelStart = LOGIN.indexOf("document.getElementById('staffEnrollCancel').addEventListener");
  const body = LOGIN.slice(enrollVerifyStart, cancelStart);
  assert.match(body, /const codes = await generateRecoveryCodes\(staffPending\.access_token, 10\);/);
  assert.match(body, /staffShow\('staffCodesView'\);/);
});

test('sign-in does not add any new external origins to the CSP for this feature', () => {
  const cspMatch = LOGIN.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(cspMatch);
  assert.match(cspMatch[1], /connect-src 'self' https:\/\/csvfqdjuobylgafgolho\.supabase\.co;/);
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
  // Whole function body (2026-11-01: a trusted-device guard made it longer
  // than the old fixed 900-character window).
  const body = SETTINGS.match(/async function handleDisableMfaSettings\(\)[\s\S]*?\n  \}\n/)[0];
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
