// Tests for the Owner-restricted view in Dev Tools (2026-08-21),
// requested directly: Steve (Owner) only needs Client Registry and
// Account permissions -- code diagnostics and error logs don't matter
// to him -- while Connor (Developer) keeps full, unchanged access.
// Panel renamed 'Account roles' -> 'Account permissions' 2026-09-02
// alongside the permission model redesign, which ALSO decoupled this
// restriction from canManageRoles() ("Manage permissions") onto its
// own dedicated canAccessDevToolsFull() ("Dev Tools (full technical)")
// -- seeing the 27 technical panels no longer requires also being
// able to manage everyone's permissions, a conflation that was never
// actually the intent.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DEV_TOOLS_PATH = path.join(__dirname, '..', '..', 'tools', 'dev-tools.html');

const DEV_ONLY_HEADINGS = [
  'Live consistency check', 'Data quality check', 'Session & sync',
  'Local data snapshot', 'Appliance Wiki health', 'Device info',
  'Service worker & cache', 'Client errors', 'Push notification test',
  'Push notification history', 'Booking notification test', 'Recent bookings', 'Known issues', 'Flagged pages', 'Uptime monitoring', 'Deploy history',
  'Regression checker', "What's new", 'Quick links', 'Trigger workflows',
  'Advisor health', 'Storage browser', 'Data integrity check',
  'Booking funnel health', 'Lead response time', 'Uptime trend',
];
const OWNER_VISIBLE_HEADINGS = ['Client registry', 'Account permissions'];

function loadAs(canAccessFull) {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canAccessDevToolsFull = () => canAccessFull;
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

test('exactly 27 panels are marked dev-owner-hidden, matching the full, deliberate list of code/technical/error-diagnostic panels (26 previous + the new Graveyard panel)', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const count = (src.match(/class="dev-panel dev-owner-hidden/g) || []).length;
  assert.equal(count, 27);
});

test('an account without the full-technical permission has every one of the 23 developer-only panels hidden', () => {
  const window = loadAs(false);
  for (const heading of DEV_ONLY_HEADINGS) {
    const panel = panelFor(window, heading);
    assert.ok(panel, `panel "${heading}" not found`);
    assert.equal(panel.style.display, 'none', `"${heading}" should be hidden without the full-technical permission`);
  }
});

test('an account still sees Client Registry and Account permissions without the full-technical permission -- the two panels requested directly to stay visible', () => {
  const window = loadAs(false);
  for (const heading of OWNER_VISIBLE_HEADINGS) {
    const panel = panelFor(window, heading);
    assert.ok(panel, `panel "${heading}" not found`);
    assert.notEqual(panel.style.display, 'none', `"${heading}" should stay visible`);
  }
});

test('an account with the full-technical permission keeps every panel visible -- full, completely unchanged access', () => {
  const window = loadAs(true);
  for (const heading of [...DEV_ONLY_HEADINGS, ...OWNER_VISIBLE_HEADINGS]) {
    const panel = panelFor(window, heading);
    assert.ok(panel, `panel "${heading}" not found`);
    assert.notEqual(panel.style.display, 'none', `"${heading}" should stay visible with the full-technical permission`);
  }
});

test('applyOwnerRestrictedView uses canAccessDevToolsFull(), not canManageRoles() -- decoupled 2026-09-02 so seeing the technical panels no longer requires also being able to manage everyone\'s permissions', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const fnMatch = src.match(/function applyOwnerRestrictedView\(\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'applyOwnerRestrictedView not found');
  assert.match(fnMatch[0], /if \(canAccessDevToolsFull\(\)\) return;/);
  assert.doesNotMatch(fnMatch[0], /canManageRoles\(\)/);
  assert.doesNotMatch(fnMatch[0], /effectiveCanManageRoles/);
});
