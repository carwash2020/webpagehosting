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

test('loadCurrentUserRole() queries all 9 permission booleans directly off account_roles, no join, no email in the URL', () => {
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
  assert.match(body, /select=email,role_name,can_manage_roles,can_access_dev_tools,can_access_dev_tools_full,can_manage_site_content,can_manage_invoices,can_manage_contracts,can_view_finance,can_view_runway,can_manage_reviews/);
  // Checks the actual fetch URL specifically, not the whole function
  // body -- a legitimate historical comment elsewhere in this function
  // (explaining the 2026-09-02 retry fix) still mentions
  // role_definitions by name, which is fine; what must never happen
  // again is the QUERY itself requesting that join.
  const urlLine = body.match(/`\$\{SUPABASE_URL\}\/rest\/v1\/account_roles\?[^`]*`/);
  assert.ok(urlLine, 'expected to find the account_roles fetch URL');
  assert.doesNotMatch(urlLine[0], /role_definitions/);
  // No email=eq.X filter (2026-09-02) -- a real report, reproduced
  // across 3 separate network connections by the same account (ruling
  // out a flaky connection), traced to this being the one query in
  // the app that put a plaintext email address in a URL query string
  // -- some privacy tools specifically block that pattern. RLS
  // already permits any account with a role to read every row
  // (current_user_has_any_role(), no per-row email match), matching
  // fetchAccountRolesData()'s own no-filter query in dev-tools.html,
  // so this costs nothing extra RLS wasn't already allowing.
  assert.doesNotMatch(urlLine[0], /email=eq\./);
  assert.match(body, /allRows\.filter\(r => \(r\.email \|\| ''\)\.toLowerCase\(\) === email\.toLowerCase\(\)\)/,
    'should find the caller\'s own row client-side from the full result set');
});

test('the Access panel groups the 9 permissions into 5 categories, not a flat row and not a single role dropdown', () => {
  assert.match(DEV_TOOLS, /toggleAccountPermission\(this\)/);
  assert.doesNotMatch(DEV_TOOLS, /onchange="changeAccountRole\(this\)"/, 'the old single-dropdown control should be gone');
  // Redesigned 2026-09-02, requested directly, for a cleaner look:
  // PERMISSION_CATEGORIES groups the 9 fields into 5 categories
  // (Dev Tools, Money, Grow, Site, Admin), each with its own nested
  // fields array -- not a flat list of 9 checkboxes shown at once.
  const catsMatch = DEV_TOOLS.match(/const PERMISSION_CATEGORIES = \[[\s\S]*?\n  \];/);
  assert.ok(catsMatch, 'expected to find the PERMISSION_CATEGORIES array definition');
  const allFields = [
    'can_access_dev_tools', 'can_access_dev_tools_full', 'can_manage_invoices',
    'can_manage_contracts', 'can_view_finance', 'can_view_runway',
    'can_manage_reviews', 'can_manage_site_content', 'can_manage_roles',
  ];
  for (const field of allFields) {
    assert.match(catsMatch[0], new RegExp(`field: '${field}'`), `expected ${field} to appear somewhere in the category groups`);
  }
  for (const categoryKey of ['devtools', 'money', 'grow', 'site', 'admin']) {
    assert.match(catsMatch[0], new RegExp(`key: '${categoryKey}'`));
  }
  assert.match(DEV_TOOLS, /data-field="' \+ f\.field \+ '"/);
});

test('only one category is expanded at a time, via a single _openPermCategory, not an independent flag per category', () => {
  assert.match(DEV_TOOLS, /let _openPermCategory = null;/);
  const fnMatch = DEV_TOOLS.match(/function togglePermCategory\(key\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate togglePermCategory()');
  // Toggling the same key closes it; toggling a different key replaces
  // whichever was open -- a single variable assignment, not an array
  // or set of independently-open categories.
  assert.match(fnMatch[0], /_openPermCategory = _openPermCategory === key \? null : key;/);
});

test('each category button shows how many of its own checkboxes are currently on', () => {
  const fnMatch = DEV_TOOLS.match(/function renderPermCategoryUI\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderPermCategoryUI()');
  assert.match(fnMatch[0], /cat\.fields\.filter\(f => account\[f\.field\]\)\.length/, 'expected an on-count computed per category, per account');
});

test('the role-preview simulation feature was removed entirely, not just hidden', () => {
  for (const src of [DEV_TOOLS]) {
    assert.doesNotMatch(src, /rolePreview/i);
    assert.doesNotMatch(src, /effectiveCanManageRoles/);
  }
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

test('a non-manager sees the same categories and checkboxes, disabled, rather than a separate read-only view', () => {
  const fnMatch = DEV_TOOLS.match(/function renderPermCategoryUI\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderPermCategoryUI()');
  assert.match(fnMatch[0], /const disabled = manager \? '' : ' disabled';/);
});

test('adding a new account can start from a preset but the row becomes independently editable', () => {
  const fnMatch = DEV_TOOLS.match(/async function addAccount\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate addAccount()');
  const body = fnMatch[0];
  assert.match(body, /can_manage_roles: preset \? !!preset\.can_manage_roles : false/);
  assert.match(body, /can_access_dev_tools_full: preset \? !!preset\.can_access_dev_tools_full : false/);
  assert.match(body, /can_manage_invoices: preset \? !!preset\.can_manage_invoices : false/);
  assert.match(body, /can_manage_contracts: preset \? !!preset\.can_manage_contracts : false/);
  assert.match(body, /can_view_finance: preset \? !!preset\.can_view_finance : false/);
  assert.match(body, /can_view_runway: preset \? !!preset\.can_view_runway : false/);
  assert.match(body, /can_manage_reviews: preset \? !!preset\.can_manage_reviews : false/);
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

// ---- each of the 5 previously-bundled tools gates on its OWN
// permission now (2026-09-02), requested directly: "Review tool?
// Checkbox." ----

test('each of the 5 previously-bundled tools is gated on its own specific permission, not a shared one', () => {
  const cases = [
    { file: 'review-request.html', fn: /canManageReviews/ },
    { file: 'finance.html', fn: /canViewFinance/ },
    { file: 'runway-dashboard.html', fn: /canViewRunway/ },
  ];
  for (const c of cases) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', c.file), 'utf8');
    assert.match(src, c.fn, `${c.file} should gate on its own dedicated permission`);
    assert.doesNotMatch(src, /canManageBusinessFinances/, `${c.file} should not reference the retired shared permission`);
  }

  // Contract Generator and Invoice Generator each have multiple call
  // sites (page gate, pull-to-refresh, realtime, and the Try again
  // retry button added 2026-09-02), all updated consistently.
  const contractSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'contract-generator.html'), 'utf8');
  assert.equal((contractSrc.match(/canManageContracts/g) || []).length, 7, 'expected 3 gate call sites x 2 (typeof check + call) plus 1 retry-button reference for canManageContracts');
  assert.doesNotMatch(contractSrc, /canManageBusinessFinances/);

  const invoiceSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');
  assert.equal((invoiceSrc.match(/canManageInvoices/g) || []).length, 7, 'expected 3 gate call sites x 2 (typeof check + call) plus 1 retry-button reference for canManageInvoices');
  assert.doesNotMatch(invoiceSrc, /canManageBusinessFinances/);
});

test('the workspace dashboard tiles are each gated on their own permission, not shown/hidden as one block', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'workspace.html'), 'utf8');
  const tilePerms = ['can_manage_contracts', 'can_manage_invoices', 'can_view_finance', 'can_view_runway', 'can_manage_reviews'];
  for (const perm of tilePerms) {
    assert.match(src, new RegExp(`data-tile-perm="${perm}"`), `expected a tile tagged with ${perm}`);
  }
  assert.doesNotMatch(src, /business-finance-tile/, 'the old shared class should be gone');

  const fnMatch = src.match(/function renderBusinessFinanceTileVisibility\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderBusinessFinanceTileVisibility()');
  assert.match(fnMatch[0], /data-tile-perm/, 'should check each tile individually via its own attribute');
});

test('the 27 technical Dev Tools panels are gated on their own permission, decoupled from Manage permissions', () => {
  const fnMatch = DEV_TOOLS.match(/function applyOwnerRestrictedView\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate applyOwnerRestrictedView()');
  assert.match(fnMatch[0], /if \(canAccessDevToolsFull\(\)\) return;/);
  assert.doesNotMatch(fnMatch[0], /canManageRoles\(\)/,
    'seeing the technical panels should no longer require the ability to manage everyone\'s permissions');
});

test('canAccessDevToolsFull() is a real accessor reading its own cached field', () => {
  const fnMatch = AUTH_JS.match(/function canAccessDevToolsFull\(\)[\s\S]*?\n\}/);
  assert.ok(fnMatch, 'expected to find canAccessDevToolsFull()');
  assert.match(fnMatch[0], /_cachedRoleInfo\.canAccessDevToolsFull/);
});
