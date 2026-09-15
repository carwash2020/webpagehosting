// Tests for SECURITY.md's leaked-password-protection/MFA entry.
//
// Originally (audit item #10) this full-repo audit found the gap
// SECURITY.md documented as a deliberately "accepted" risk was stale --
// the client portal now creates one real Supabase Auth account per
// client who has ever logged in to view a quote, contract, invoice, or
// job, a growing client-facing population the original note never
// accounted for -- so the doc was corrected to re-flag leaked-password
// protection as something to turn on now rather than defer.
//
// That setting has since actually been flipped by hand in the Supabase
// dashboard (confirmed 2026-09-15), so SECURITY.md now documents it as
// done rather than pending. MFA is still a real, explicitly-still-open
// decision, not silently dropped.
//
// Neither setting can be flipped from this repo -- both are Supabase
// Auth dashboard-only project settings, confirmed directly against the
// Supabase MCP tools available here (apply_migration, execute_sql,
// deploy_edge_function, get_advisors, and the various list_*/get_*
// tools include nothing that reads or writes Auth project config).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SECURITY = fs.readFileSync(repo('SECURITY.md'), 'utf8');

test('the leaked-password-protection entry reflects it is now ON, not a pending "should be turned on" gap', () => {
  assert.doesNotMatch(SECURITY, /Leaked-password protection is off/);
  assert.doesNotMatch(SECURITY, /a 2-account system/);
  assert.match(SECURITY, /Leaked-password protection is now ON/);
});

test('the leaked-password-protection entry still explains the client-portal population it protects', () => {
  const idx = SECURITY.indexOf('Leaked-password protection is now ON');
  assert.ok(idx !== -1);
  const section = SECURITY.slice(idx, idx + 700);
  assert.match(section, /client[ -]portal/i);
});

test('the leaked-password-protection entry names the exact dashboard path it was flipped in', () => {
  const idx = SECURITY.indexOf('Leaked-password protection is now ON');
  const section = SECURITY.slice(idx, idx + 500);
  assert.match(section, /Authentication ->\s*\n\s*Providers -> Email/);
});

test('the MFA entry still names the dashboard-only setting and explains why full enrollment/step-up UI is a separate decision', () => {
  const idx = SECURITY.indexOf('No MFA enforcement');
  assert.ok(idx !== -1);
  const section = SECURITY.slice(idx, idx + 900);
  assert.match(section, /Authentication ->\s*\n\s*MFA/);
  assert.match(section, /separate, much larger feature decision \(new\s*\n\s*screens/);
});

test('the MFA entry still acknowledges no Supabase MCP tool can change it from this repo', () => {
  const idx = SECURITY.indexOf('No MFA enforcement');
  const section = SECURITY.slice(idx, idx + 900);
  assert.match(section, /no scriptable path from\s*\n\s*this repo/);
});
