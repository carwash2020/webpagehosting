// Fix plan FP3.1 (2026-11-06, D2; approved "Field view everywhere"). Field
// view is a screen filter for someone who can also use Office view: their
// own jobs and today's work, and none of the office sections (Clients,
// Invoices, Money, Contracts, Reviews, Team) -- in the nav, or on the page
// itself, which says "X is in Office view" with one tap back. Office is
// the whole app. It never decides access: an account without Office view
// is untouched (a field tech with Clients keeps Clients). Runs the real
// data-layer.js and tools-nav-pwa.js on real tool pages in jsdom.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { installDataLayer } = require('../data-layer-harness');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const NAV = read('tools-nav-pwa.js');
const CSS = read('styles-tools.css');
const CHECKS = ['canManageInvoices', 'canViewFinance', 'canViewRunway', 'canManageContracts', 'canManageReviews', 'hasDevToolsAccess', 'canManageClients', 'canManageRoles', 'canManageSiteContent', 'canManageOthersJobs'];
const OWNER = Object.fromEntries(CHECKS.map((c) => [c, true]));
const TECH_WITH_CLIENTS = { canManageClients: true }; // D3 default, no Office view

function boot(page, { perms, view = null } = {}) {
  const dom = new JSDOM(read(page), {
    runScripts: 'dangerously', url: 'https://example.com/tools/' + page,
    beforeParse(w) {
      installDataLayer(w);
      w.requireAuth = () => {};
      w.initAppTour = () => {};
      // tools-effects.js helpers some pages call after load; not under test here.
      w.escapeHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      w.escapeAttr = w.escapeHtml;
      if (view) w.localStorage.setItem('th_view_mode', view);
      for (const fn of CHECKS) w[fn] = () => !!perms[fn];
      w.getCurrentUserRole = () => ({ roleName: 'x' });
      w.isRoleLoaded = () => true;
    },
  });
  const w = dom.window;
  const s = w.document.createElement('script');
  s.textContent = NAV;
  w.document.head.appendChild(s);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.dispatchEvent(new w.Event('th-role-loaded'));
  return w;
}
const shown = (el) => el && el.style.display !== 'none' && el.style.visibility !== 'hidden' && !el.hidden;
const sidebar = (w) => [...w.document.querySelectorAll('.th-desktop-sidebar a.th-sidebar-link')].filter(shown).map((a) => a.textContent.trim());
const bar = (w) => [...w.document.querySelectorAll('.th-bottom-nav > *')].filter(shown).map((el) => (el.tagName === 'BUTTON' ? '+' : el.textContent.trim()));

test('FP3.1: Field view on an owner\'s device -- the nav is Dashboard, Jobs, Settings and the bar Home / Jobs / +', () => {
  const w = boot('workspace.html', { perms: OWNER, view: 'field' });
  assert.ok(w.document.body.classList.contains('th-field-view'));
  assert.deepEqual(sidebar(w), ['Dashboard', 'Jobs', 'Settings']);
  assert.deepEqual(bar(w), ['Home', 'Jobs', '+']);
  assert.ok(shown(w.document.querySelector('.th-sidebar-view-note')), 'the sidebar says Field view, with the way back');
});

test('FP3.1: Office view is the whole app, as before', () => {
  const w = boot('workspace.html', { perms: OWNER, view: 'office' });
  assert.ok(!w.document.body.classList.contains('th-field-view'));
  assert.deepEqual(sidebar(w), ['Dashboard', 'Jobs', 'Clients', 'Invoices', 'Money', 'Contracts', 'Reviews', 'Team', 'Settings']);
  assert.deepEqual(bar(w), ['Home', 'Jobs', '+', 'Clients', 'Money']);
  assert.ok(!shown(w.document.querySelector('.th-sidebar-view-note')));
});

test('FP3.1: an office page opened in Field view says where it is, and Switch to Office brings everything back', () => {
  const w = boot('finance.html', { perms: OWNER, view: 'field' });
  const gate = w.document.getElementById('thFieldGate');
  assert.ok(shown(gate));
  assert.equal(gate.querySelector('h1').textContent, 'Money is in Office view');
  assert.equal(gate.querySelector('a').getAttribute('href'), '/tools/workspace.html');
  gate.querySelector('.th-field-gate-switch').click();
  assert.equal(w.localStorage.getItem('th_view_mode'), 'office');
  assert.ok(!shown(w.document.getElementById('thFieldGate')));
  assert.ok(sidebar(w).includes('Money'));
  for (const [page, label] of [['clients.html', 'Clients'], ['team.html', 'Team'], ['invoice-generator.html', 'Invoices']]) {
    assert.equal(boot(page, { perms: OWNER, view: 'field' }).document.querySelector('#thFieldGate h1').textContent, label + ' is in Office view', page);
  }
});

test('FP3.1: Dashboard and Jobs are not office pages -- no gate there in Field view', () => {
  assert.equal(boot('workspace.html', { perms: OWNER, view: 'field' }).document.getElementById('thFieldGate'), null);
  assert.equal(boot('job-tracker.html', { perms: OWNER, view: 'field' }).document.getElementById('thFieldGate'), null);
});

test('FP3.1: a view, not a lock -- an account without Office view is untouched (a field tech keeps Clients)', () => {
  const w = boot('clients.html', { perms: TECH_WITH_CLIENTS, view: 'field' });
  assert.ok(!w.document.body.classList.contains('th-field-view'));
  assert.equal(w.document.getElementById('thFieldGate'), null);
  assert.deepEqual(sidebar(w), ['Dashboard', 'Jobs', 'Clients', 'Team', 'Settings']);
  assert.deepEqual(bar(w), ['Home', 'Jobs', '+', 'Clients']);
  assert.equal(w.document.getElementById('thViewSwitch'), null, 'no switch for an account that can\'t use Office view');
});

test('FP3.1: the switch shows on Clients, Invoices and Money too (Dashboard and Jobs mount their own)', () => {
  for (const page of ['clients.html', 'finance.html', 'invoice-generator.html']) {
    assert.ok(boot(page, { perms: OWNER, view: 'office' }).document.getElementById('thViewSwitch'), page);
  }
});

test('FP3.1: Field view styles -- Dashboard drops Money owed, Insights and Business; Jobs drops Board and the money column', () => {
  for (const sel of ['#todayMoney', '#dashViewSwitch', '.dash-group-label', '.today-business']) {
    assert.ok(CSS.includes('body.th-field-view ' + sel), sel);
  }
  assert.match(CSS, /body\.th-field-view \.sort-btn\[data-view="board"\],\s*body\.th-field-view \.jobs-table \.col-amount \{ display: none; \}/);
  assert.match(read('job-tracker.html'), /window\.thFieldViewActive\(\) && loadJobViewMode\(\) === 'board'\) setJobViewMode\('list'\)/);
  assert.match(read('workspace.html'), /window\.thFieldViewActive\(\) && currentDashView === 'insights'\) showDashView\('today'\)/);
});
