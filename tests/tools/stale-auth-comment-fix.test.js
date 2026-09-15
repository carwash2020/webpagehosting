// Tests for fixing the stale "exactly one account, not a multi-user
// system" comment in tools/auth.js (audit item #22), and the same
// stale claim copy-pasted into 19 other pages' own inline comments
// plus one user-visible sentence in workspace.html's "Getting
// Started" guide. Confirmed live via account_roles/role_definitions:
// two real accounts (connor@..., steve@...) with distinct roles
// (Developer, Owner), out of three real roles the system supports
// (Owner, Developer, Employee) -- a genuine, server-enforced,
// role-based multi-user system, not the single shared login the old
// comment described.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');

test('auth.js no longer claims "exactly one account" as a live, current fact', () => {
  const authJs = fs.readFileSync(path.join(TOOLS_DIR, 'auth.js'), 'utf8');
  // The old claim only survives as a quoted, explicitly-labeled-stale
  // reference inside the fix's own explanatory comment ("this used to
  // say..."), never as a live description of the current system.
  assert.doesNotMatch(authJs, /This is a SECURITY GATE, not a multi-user system\. There's exactly one/);
  assert.match(authJs, /this used to say "exactly one/);
});

test('auth.js now accurately describes the real role-based system (account_roles/role_definitions, no public sign-up)', () => {
  const authJs = fs.readFileSync(path.join(TOOLS_DIR, 'auth.js'), 'utf8');
  assert.match(authJs, /account_roles\/role_definitions/);
  assert.match(authJs, /no public\s*\n?\/\/ sign-up/);
});

const PAGES_WITH_INLINE_COMMENT = [
  'calendar.html', 'client-detail.html', 'clients.html', 'contact-card.html',
  'contract-generator.html', 'dev-tools.html', 'expense-logger.html',
  'finance.html', 'invoice-generator.html', 'job-cost-lookup.html',
  'job-detail.html', 'job-tracker.html', 'parts-reference.html', 'pos.html',
  'review-request.html', 'route-planner.html', 'settings.html',
  'site-content.html', 'workspace.html',
];

for (const name of PAGES_WITH_INLINE_COMMENT) {
  test(`${name}'s requireAuth() comment no longer repeats the stale "single shared account, not a multi-user system" claim`, () => {
    const html = fs.readFileSync(path.join(TOOLS_DIR, name), 'utf8');
    assert.doesNotMatch(html, /shared account keeping randoms out, not a multi-user system/);
    assert.match(html, /role-based multi-user system now -- account_roles\/role_definitions/);
  });
}

test("workspace.html's user-visible \"Getting Started\" guide no longer tells real users there's exactly one account", () => {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.doesNotMatch(html, /There's exactly one account, meant to keep the data private/);
  assert.match(html, /Each account has its own role \(Owner, Developer, or Employee\) controlling what it can see and do/);
});
