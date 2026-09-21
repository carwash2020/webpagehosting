// Originally (2026-08-21) tests for the dashboard's Tools tile grid
// gaining Finance and Settings tiles. The tile grid was removed on
// 2026-09-21 in the Today-first dashboard rebuild: the desktop sidebar
// and the phone bottom bar + More sheet (both injected by
// tools-nav-pwa.js) already listed every destination, so the grid was a
// third copy of the same navigation taking up the home screen. These
// tests now guard the property that actually mattered: nothing the
// grid used to reach became unreachable.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
const WORKSPACE = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
const NAV = fs.readFileSync(path.join(TOOLS_DIR, 'tools-nav-pwa.js'), 'utf8');

const FORMER_TILE_DESTS = [
  '/tools/job-tracker.html', '/tools/route-planner.html', '/tools/contract-generator.html',
  '/tools/invoice-generator.html', '/tools/clients.html', '/tools/pos.html', '/tools/finance.html',
  '/tools/runway-dashboard.html', '/tools/review-request.html', '/tools/parts-reference.html',
  '/tools/settings.html', '/tools/dev-tools.html',
];

test('the dashboard no longer carries a Tools tile grid or per-tile info bubbles', () => {
  assert.doesNotMatch(WORKSPACE, /class="tools-grid"/);
  assert.doesNotMatch(WORKSPACE, /class="tool-tile/);
  assert.doesNotMatch(WORKSPACE, /openCardInfo\('tool-/);
  assert.doesNotMatch(WORKSPACE, /id="section-tools"/);
});

test('every destination the tile grid used to link is still a sidebar / More-sheet destination in tools-nav-pwa.js (Calendar became a Job Tracker view, so it is reached via the strip instead)', () => {
  const sidebarBlock = NAV.match(/var SIDEBAR_DESTS = \[([\s\S]*?)\];/)[1];
  for (const href of FORMER_TILE_DESTS) {
    assert.ok(sidebarBlock.includes("'" + href + "'"), `expected ${href} in SIDEBAR_DESTS`);
  }
  assert.match(WORKSPACE, /href="\/tools\/job-tracker\.html#calendar"/, 'Calendar is reached from the daily-action strip');
});

test('the gated destinations keep their permission checks in the nav (the tile grid used to carry data-tile-perm for these)', () => {
  const checks = NAV.match(/var NAV_PERMISSION_CHECKS = \{([\s\S]*?)\};/)[1];
  for (const [href, fn] of [
    ['/tools/finance.html', 'canViewFinance'], ['/tools/runway-dashboard.html', 'canViewRunway'],
    ['/tools/invoice-generator.html', 'canManageInvoices'], ['/tools/pos.html', 'canManageInvoices'],
    ['/tools/clients.html', 'canManageInvoices'], ['/tools/contract-generator.html', 'canManageContracts'],
    ['/tools/review-request.html', 'canManageReviews'], ['/tools/dev-tools.html', 'hasDevToolsAccess'],
  ]) {
    const escaped = href.replace(/[./]/g, (m) => '\\' + m);
    assert.match(checks, new RegExp("'" + escaped + "'[^\\n]*" + fn), `${href} should be gated by ${fn}`);
  }
});

test('the Business Snapshot section is still hidden for an account with no finance-domain permission at all', () => {
  const html = WORKSPACE;
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canManageContracts = () => false; w.canManageInvoices = () => false;
      w.canViewFinance = () => false; w.canViewRunway = () => false; w.canManageReviews = () => false;
    },
  });
  const { window } = dom;
  window.renderBusinessFinanceTileVisibility();
  assert.equal(window.document.getElementById('section-snapshot').style.display, 'none');
  assert.equal(window.document.querySelector('[data-tile-perm="can_manage_invoices"]').style.display, 'none', 'Create invoice on the strip is gated too');
});

test('the one remaining info bubble (Secure Documents) still opens with real content', () => {
  const dom = new JSDOM(WORKSPACE, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) { w.requireAuth = () => {}; w.openInfoModal = (title, body) => { w.__modal = { title, body }; }; },
  });
  const { window } = dom;
  window.openCardInfo('secureDocuments');
  assert.equal(window.__modal.title, 'Secure Documents');
  assert.match(window.__modal.body, /private/);
});
