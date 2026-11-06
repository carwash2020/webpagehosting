// Fix plan FP2.1 + FP2.2 (2026-11-06): nothing an account can't open shows
// in the shell while its role is loading. Every gated destination in the
// sidebar, the More drawer and the bottom bar is injected hidden and shown
// only once its check passes; a group header (Work / Money / Office) shows
// only while a link under it does. Runs the real tools-nav-pwa.js on a real
// tool page in jsdom, with the auth checks stubbed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { installDataLayer } = require('../data-layer-harness');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const NAV = read('tools-nav-pwa.js');
const CHECKS = ['canManageInvoices', 'canViewFinance', 'canViewRunway', 'canManageContracts', 'canManageReviews', 'hasDevToolsAccess', 'canManageClients', 'canManageRoles', 'canManageSiteContent'];
const OWNER = Object.fromEntries(CHECKS.map((c) => [c, true]));
const FIELD_TECH = {}; // own jobs only

// The page before its role arrives: every check says no and there is no role.
function boot(page) {
  const dom = new JSDOM(read(page), {
    runScripts: 'dangerously', url: 'https://example.com/tools/' + page,
    beforeParse(w) {
      installDataLayer(w);
      w.requireAuth = () => {};
      w.initAppTour = () => {};
      w.__perms = {};
      w.__role = null;
      for (const fn of CHECKS) w[fn] = () => !!w.__perms[fn];
      w.getCurrentUserRole = () => w.__role;
    },
  });
  const w = dom.window;
  const s = w.document.createElement('script');
  s.textContent = NAV;
  w.document.head.appendChild(s);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const roleLoads = (perms) => { w.__perms = perms; w.__role = { roleName: 'x' }; w.dispatchEvent(new w.Event('th-role-loaded')); };
  return { w, roleLoads };
}

const shown = (el) => el.style.display !== 'none' && el.style.visibility !== 'hidden';
const sidebar = (w) => [...w.document.querySelectorAll('.th-desktop-sidebar a.th-sidebar-link')].filter(shown).map((a) => a.textContent.trim());
const groups = (w, scope) => [...w.document.querySelectorAll(scope + ' .th-sidebar-group')].filter(shown).map((g) => g.textContent.trim());
const more = (w) => [...w.document.querySelectorAll('a.th-more-sheet-link')].filter(shown).map((a) => a.textContent.trim());
const bar = (w) => [...w.document.querySelectorAll('.th-bottom-nav > *')].filter(shown).map((el) => (el.tagName === 'BUTTON' ? '+' : el.textContent.trim()));

test('FP2.1: before the role loads, the sidebar, More drawer and bottom bar show only what every account can open', () => {
  const { w } = boot('workspace.html');
  assert.deepEqual(sidebar(w), ['Dashboard', 'Jobs', 'Settings']);
  assert.deepEqual(more(w), ['Settings'].filter((x) => more(w).includes(x)), 'More: nothing gated');
  for (const label of ['Clients', 'Invoices', 'Money', 'Contracts', 'Reviews', 'Team']) assert.ok(!more(w).includes(label), label);
  assert.deepEqual(bar(w), ['Home', 'Jobs', '+']);
  // The gated tabs keep their slot (no shift for an account that has them)
  // and are out of reach meanwhile.
  const clients = w.document.querySelector('.th-bottom-nav a[href="/tools/clients.html"]');
  assert.equal(clients.style.visibility, 'hidden');
  assert.equal(clients.getAttribute('aria-hidden'), 'true');
  assert.equal(clients.getAttribute('tabindex'), '-1');
});

test('FP2.2: a group header shows only while a link under it does -- no MONEY header over nothing', () => {
  const { w, roleLoads } = boot('workspace.html');
  assert.deepEqual(groups(w, '.th-desktop-sidebar'), ['Work', 'Office'], 'before the role: Money has nothing to show');
  roleLoads(FIELD_TECH);
  assert.deepEqual(groups(w, '.th-desktop-sidebar'), ['Work', 'Office']);
  assert.deepEqual(sidebar(w), ['Dashboard', 'Jobs', 'Settings']);
});

test('once the role loads, an owner sees everything, and the bar tabs come back into reach', () => {
  const { w, roleLoads } = boot('workspace.html');
  roleLoads(OWNER);
  assert.deepEqual(sidebar(w), ['Dashboard', 'Jobs', 'Clients', 'Invoices', 'Money', 'Contracts', 'Reviews', 'Team', 'Settings']);
  assert.deepEqual(groups(w, '.th-desktop-sidebar'), ['Work', 'Money', 'Office']);
  assert.deepEqual(bar(w), ['Home', 'Jobs', '+', 'Clients', 'Money']);
  const clients = w.document.querySelector('.th-bottom-nav a[href="/tools/clients.html"]');
  assert.equal(clients.hasAttribute('aria-hidden'), false);
  assert.equal(clients.hasAttribute('tabindex'), false);
});

test('a field tech never sees Clients or Money in the bar: the slots drop out once the role says no', () => {
  const { w, roleLoads } = boot('job-tracker.html');
  roleLoads(FIELD_TECH);
  assert.deepEqual(bar(w), ['Home', 'Jobs', '+']);
  assert.equal(w.document.querySelector('.th-bottom-nav a[href="/tools/clients.html"]').style.display, 'none');
  assert.equal(w.document.querySelector('.th-bottom-nav .th-bn-money').style.display, 'none');
});

test('Money with only one of its two pages allowed: the tab shows and points at that page', () => {
  const { w, roleLoads } = boot('workspace.html');
  roleLoads({ canViewFinance: true });
  const tab = w.document.querySelector('.th-bottom-nav .th-bn-money');
  assert.ok(shown(tab));
  assert.equal(tab.getAttribute('href'), '/tools/finance.html');
  assert.deepEqual(groups(w, '.th-desktop-sidebar'), ['Work', 'Money', 'Office']);
  assert.deepEqual(sidebar(w), ['Dashboard', 'Jobs', 'Money', 'Settings']);
});

test('Settings keeps its Website and Dev Tools rows hidden until the role confirms them (FP2.1 Settings half)', () => {
  const html = read('settings.html');
  assert.match(html, /<div class="settings-row" id="settingsWebsiteRow" hidden>/);
  assert.match(html, /<div class="settings-section" id="settingsDevToolsSection" hidden>/);
});
