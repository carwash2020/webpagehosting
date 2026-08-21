// Tests for the Owner-restricted view in Dev Tools (2026-08-21),
// requested directly: Steve (Owner) only needs Client Registry and
// Account Roles -- code diagnostics and error logs don't matter to
// him -- while Connor (Developer) keeps full, unchanged access.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DEV_TOOLS_PATH = path.join(__dirname, '..', 'tools', 'dev-tools.html');

const DEV_ONLY_HEADINGS = [
  'Live consistency check', 'Data quality check', 'Session & sync',
  'Local data snapshot', 'Appliance Wiki health', 'Device info',
  'Service worker & cache', 'Client errors', 'Push notification test',
  'Push notification history', 'Known issues', 'Flagged pages', 'Deploy history',
  'Regression checker', "What's new", 'Quick links', 'Trigger workflows',
  'Advisor health', 'Storage browser', 'Data integrity check',
];
const OWNER_VISIBLE_HEADINGS = ['Client registry', 'Account roles'];

function loadAs(canManage) {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canManageRoles = () => canManage;
    },
  });
  const { window } = dom;
  window.applyOwnerRestrictedView();
  return window;
}

function panelFor(window, headingText) {
  const heading = [...window.document.querySelectorAll('h2')].find(h => h.textContent.trim() === headingText);
  return heading ? heading.closest('.dev-panel') : null;
}

test('exactly 20 panels are marked dev-owner-hidden, matching the full, deliberate list of code/technical/error-diagnostic panels (19 original + the new Flagged Pages panel)', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const count = (src.match(/class="dev-panel dev-owner-hidden/g) || []).length;
  assert.equal(count, 20);
});

test('an Owner account (canManageRoles false) has every one of the 19 developer-only panels hidden', () => {
  const window = loadAs(false);
  for (const heading of DEV_ONLY_HEADINGS) {
    const panel = panelFor(window, heading);
    assert.ok(panel, `panel "${heading}" not found`);
    assert.equal(panel.style.display, 'none', `"${heading}" should be hidden for an Owner`);
  }
});

test('an Owner account still sees Client Registry and Account Roles -- the two panels requested directly to stay visible', () => {
  const window = loadAs(false);
  for (const heading of OWNER_VISIBLE_HEADINGS) {
    const panel = panelFor(window, heading);
    assert.ok(panel, `panel "${heading}" not found`);
    assert.notEqual(panel.style.display, 'none', `"${heading}" should stay visible for an Owner`);
  }
});

test('a Developer account (canManageRoles true) keeps every panel visible -- full, completely unchanged access', () => {
  const window = loadAs(true);
  for (const heading of [...DEV_ONLY_HEADINGS, ...OWNER_VISIBLE_HEADINGS]) {
    const panel = panelFor(window, heading);
    assert.ok(panel, `panel "${heading}" not found`);
    assert.notEqual(panel.style.display, 'none', `"${heading}" should stay visible for a Developer`);
  }
});

test('applyOwnerRestrictedView uses the real canManageRoles(), not the existing role-preview toggle (effectiveCanManageRoles) -- that preview is deliberately scoped to just the Account Roles panel\'s own display, not a real, permanent restriction', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const fnMatch = src.match(/function applyOwnerRestrictedView\(\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'applyOwnerRestrictedView not found');
  assert.match(fnMatch[0], /if \(canManageRoles\(\)\) return;/);
  assert.doesNotMatch(fnMatch[0], /effectiveCanManageRoles/);
});
