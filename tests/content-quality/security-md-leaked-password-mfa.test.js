// Tests for correcting SECURITY.md's leaked-password-protection/MFA
// entry (audit item #10). This full-repo audit found the same gap
// SECURITY.md already documented as a deliberately "accepted" risk --
// but the reasoning it was accepted under ("a 2-account system") is
// stale: the client portal now creates one real Supabase Auth account
// per client who has ever logged in to view a quote, contract,
// invoice, or job, a growing client-facing population the original
// note never accounted for.
//
// Neither setting can actually be flipped from this repo -- both are
// Supabase Auth dashboard-only project settings, confirmed directly
// against the Supabase MCP tools available here (apply_migration,
// execute_sql, deploy_edge_function, get_advisors, and the various
// list_*/get_* tools include nothing that reads or writes Auth
// project config). So the fix here is the doc correction itself:
// re-flagging leaked-password protection as something that should be
// turned on now rather than deferred, and keeping MFA as a real,
// explicitly-still-open decision rather than silently dropping it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SECURITY = fs.readFileSync(repo('SECURITY.md'), 'utf8');

test('the leaked-password-protection entry no longer claims this is just a "2-account system"', () => {
  assert.doesNotMatch(SECURITY, /a 2-account system/);
});

test('the leaked-password-protection entry explains it is re-flagged because of client portal accounts', () => {
  const idx = SECURITY.indexOf('Leaked-password protection is off');
  assert.ok(idx !== -1);
  const section = SECURITY.slice(idx, idx + 1500);
  assert.match(section, /client portal/i);
  assert.match(section, /This should be turned on now,\s*\n\s*not deferred further/);
});

test('the leaked-password-protection entry names the exact dashboard path to flip it', () => {
  const idx = SECURITY.indexOf('Leaked-password protection is off');
  const section = SECURITY.slice(idx, idx + 1000);
  assert.match(section, /Authentication -> Providers -> Email/);
});

test('the MFA entry still names the dashboard-only setting and explains why full enrollment/step-up UI is a separate decision', () => {
  const idx = SECURITY.indexOf('No MFA enforcement');
  assert.ok(idx !== -1);
  const section = SECURITY.slice(idx, idx + 900);
  assert.match(section, /Authentication ->\s*\n\s*MFA/);
  assert.match(section, /separate, much larger feature decision \(new\s*\n\s*screens/);
});

test('both entries acknowledge no Supabase MCP tool can change these settings from this repo', () => {
  const idx = SECURITY.indexOf('Leaked-password protection is off');
  const section = SECURITY.slice(idx, idx + 2600);
  assert.match(section, /no scriptable path from\s*\n\s*this repo|no migration, edge function, or API call that can flip it from code/);
});
