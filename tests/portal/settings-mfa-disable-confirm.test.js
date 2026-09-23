// Confirmation added before disabling two-factor authentication
// (2026-09-19), from a portal audit finding: removing a saved card two
// sections above already requires a portalConfirm() (removeSavedCard()),
// but turning off MFA -- at least as consequential a change -- used to
// happen on a single click with no guardrail at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SETTINGS = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'settings.html'), 'utf8');

test('handleDisableMfa() confirms before unenrolling, same portalConfirm pattern as removeSavedCard()', () => {
  const fnMatch = SETTINGS.match(/async function handleDisableMfa\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate handleDisableMfa()');
  const body = fnMatch[0];
  assert.match(body, /await portalConfirm\('Turn off two-factor authentication/);
  assert.match(body, /if \(!confirmed\) return;/);
  // The confirm gate must come before the actual unenroll, not after.
  // Since 2026-09-23 the unenroll itself is unenrollMfa(), reached after a
  // code step when the session was let through by Face ID.
  const confirmIdx = body.indexOf('portalConfirm(');
  const unenrollIdx = body.indexOf('await unenrollMfa();');
  assert.ok(confirmIdx > 0 && unenrollIdx > 0 && confirmIdx < unenrollIdx);
  assert.match(SETTINGS.match(/async function unenrollMfa\(\)[\s\S]*?\n  \}\n/)[0], /client\.auth\.mfa\.unenroll\(\{ factorId: mfaFactorId \}\)/);
});

test('the mfaFactorId guard still runs before anything else (no confirm dialog for a no-op disable)', () => {
  const fnMatch = SETTINGS.match(/async function handleDisableMfa\(\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  const guardIdx = body.indexOf('if (!mfaFactorId) return;');
  const confirmIdx = body.indexOf('portalConfirm(');
  assert.ok(guardIdx > 0 && confirmIdx > 0 && guardIdx < confirmIdx);
});
