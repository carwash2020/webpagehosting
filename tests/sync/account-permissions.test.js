// Tests for the permission model redesign (2026-09-02): replaces
// role-locked permissions (fixed Owner/Developer/Employee tiers) with
// per-account, individually-toggleable checkboxes that take effect
// immediately. Source-inspection style for the UI wiring (the real
// contract -- retry, fail-closed, the exact query shape -- is already
// covered directly in tests/sync/role-check-retry.test.js and
// tests/sync/data-layer.test.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const AUTH_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'auth.js'), 'utf8');
const DEV_TOOLS = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools.html'), 'utf8');

// The single most important invariant this redesign depends on: NO
// client-side or edge-function code should still query
// account_roles?...&select=role_definitions(...) -- that shape
// silently stops working (or worse, silently returns nothing useful)
// once role_definitions is no longer meant to be authoritative.
test('nothing still queries account_roles with a role_definitions(...) join', () => {
  const searchRoots = [
    path.join(__dirname, '..', '..', 'tools'),
    path.join(__dirname, '..', '..', 'edge-functions'),
  ];
  const offenders = [];
  for (const root of searchRoots) {
    for (const file of fs.readdirSync(root)) {
      const full = path.join(root, file);
      if (!fs.statSync(full).isFile()) continue;
      const src = fs.readFileSync(full, 'utf8');
      if (/select=role_definitions\(/.test(src) || /select=[^&"'`]*role_definitions\(/.test(src)) {
        offenders.push(full);
      }
    }
  }
  assert.deepEqual(offenders, [], 'these files still request the old joined shape: ' + offenders.join(', '));
});

test('loadCurrentUserRole() queries the 4 permission booleans directly off account_roles, no join', () => {
  const startIdx = AUTH_JS.indexOf('async function loadCurrentUserRole()');
  assert.ok(startIdx !== -1, 'expected to find loadCurrentUserRole()');
  // The function is at top-level scope, so its closing brace sits
  // alone on its own line at column 0 -- matching up to the first
  // such line (rather than a naive non-greedy "\n}", which would stop
  // at the first inner brace instead) is what actually captures the
  // whole function, try/catch/finally included.
  const endIdx = AUTH_JS.indexOf('\n}', startIdx);
  assert.ok(endIdx !== -1, 'expected to find the function\'s closing brace');
  const body = AUTH_JS.slice(startIdx, endIdx);
  assert.match(body, /select=role_name,can_manage_roles,can_access_dev_tools,can_manage_site_content,can_manage_business_finances/);
  // Checks the actual fetch URL specifically, not the whole function
  // body -- a legitimate historical comment elsewhere in this function
  // (explaining the 2026-09-02 retry fix) still mentions
  // role_definitions by name, which is fine; what must never happen
  // again is the QUERY itself requesting that join.
  const urlLine = body.match(/`\$\{SUPABASE_URL\}\/rest\/v1\/account_roles\?[^`]*`/);
  assert.ok(urlLine, 'expected to find the account_roles fetch URL');
  assert.doesNotMatch(urlLine[0], /role_definitions/);
});

test('the Access panel renders one checkbox per permission per account, not a single role dropdown', () => {
  assert.match(DEV_TOOLS, /toggleAccountPermission\(this\)/);
  assert.doesNotMatch(DEV_TOOLS, /onchange="changeAccountRole\(this\)"/, 'the old single-dropdown control should be gone');
  // The checkbox's data-field attribute is built dynamically from
  // p.field (a JS string concatenation), not a literal HTML attribute
  // anywhere in the source -- so what's actually checkable here is
  // that the PERMISSIONS array driving that loop lists all 4 fields.
  const permsMatch = DEV_TOOLS.match(/const PERMISSIONS = \[[\s\S]*?\];/);
  assert.ok(permsMatch, 'expected to find the PERMISSIONS array definition');
  for (const field of ['can_access_dev_tools', 'can_manage_business_finances', 'can_manage_site_content', 'can_manage_roles']) {
    assert.match(permsMatch[0], new RegExp(`field: '${field}'`));
  }
  assert.match(DEV_TOOLS, /data-field="' \+ p\.field \+ '"/);
});

test('toggling a permission is a live PATCH to that one account\'s row, not a batch save', () => {
  const fnMatch = DEV_TOOLS.match(/async function toggleAccountPermission\(checkboxEl\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate toggleAccountPermission()');
  const body = fnMatch[0];
  assert.match(body, /method: 'PATCH'/);
  assert.match(body, /account_roles\?email=eq\.' \+ encodeURIComponent\(email\)/);
  // Exactly one field changes per call -- confirms this is a
  // per-checkbox PATCH, not resaving every permission at once.
  assert.match(body, /body: JSON\.stringify\(\{ \[field\]: newValue \}\)/);
});

test('a non-manager sees the same checkboxes, disabled, rather than a separate read-only view', () => {
  const fnMatch = DEV_TOOLS.match(/async function renderAccountRoles\(\)[\s\S]*?\n  \}\n\n  let _cachedRoleDefsForPresets/);
  assert.ok(fnMatch, 'expected to isolate renderAccountRoles()');
  assert.match(fnMatch[0], /const disabled = manager \? '' : ' disabled';/);
});

test('adding a new account can start from a preset but the row becomes independently editable', () => {
  const fnMatch = DEV_TOOLS.match(/async function addAccount\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate addAccount()');
  const body = fnMatch[0];
  assert.match(body, /can_manage_roles: preset \? !!preset\.can_manage_roles : false/);
  assert.match(body, /role_name: presetName \|\| null/);
});

test('role_definitions is only read for presets in the Add-account form, never to gate access', () => {
  const fetchDefsMatch = DEV_TOOLS.match(/async function fetchRoleDefinitions\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fetchDefsMatch);
  // The only two call sites of fetchRoleDefinitions(): renderAccountRoles
  // (to populate the preset dropdown) via Promise.all, nothing else.
  const callSites = [...DEV_TOOLS.matchAll(/fetchRoleDefinitions\(\)/g)];
  assert.equal(callSites.length, 2, 'expected exactly the definition itself plus one call site');
});
