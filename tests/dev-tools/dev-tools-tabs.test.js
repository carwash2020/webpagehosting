// Tests for the Dev Tools tab system (2026-08-25), requested directly
// as part of a full navigation/spacing overhaul: the old scroll-to-
// anchor jump-nav wasn't cutting it with 23 panels crammed onto one
// page. Verifies the real, running behavior -- not just that the
// markup exists, but that switching actually shows/hides the right
// panel groups, and that an Owner account (who only ever sees 2 of
// the 23 panels) never lands on a tab with nothing in it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DEV_TOOLS_PATH = path.join(__dirname, '..', '..', 'tools', 'dev-tools.html');

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
  window.initDevToolsTabs();
  return window;
}

test('an "info bubble" click on any panel actually opens the shared help modal with that panel\'s real content -- previously silently did nothing since helpModalOverlay did not exist on this page at all', () => {
  const devToolsHtml = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const overlayMatch = devToolsHtml.match(/<div class="help-modal-overlay"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(overlayMatch, 'helpModalOverlay element should exist in dev-tools.html');

  const sharedJs = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools-shared.js'), 'utf8');
  const devInfoMatch = sharedJs.match(/const DEV_INFO = \{[\s\S]*?\n  \};/);
  const openDevInfoMatch = sharedJs.match(/function openDevInfo[\s\S]*?\n  \}/);
  assert.ok(devInfoMatch && openDevInfoMatch, 'DEV_INFO / openDevInfo should exist in dev-tools-shared.js');

  const effectsJs = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'tools-effects.js'), 'utf8');
  const openInfoModalMatch = effectsJs.match(/function openInfoModal[\s\S]*?\n\}/);
  assert.ok(openInfoModalMatch, 'openInfoModal should exist in tools-effects.js');

  const dom = new JSDOM('<!DOCTYPE html><html><body>' + overlayMatch[0] + '</body></html>', { runScripts: 'dangerously' });
  const { window } = dom;
  window.eval(devInfoMatch[0] + '\n' + openInfoModalMatch[0] + '\n' + openDevInfoMatch[0] + '\nwindow.openDevInfo = openDevInfo;');

  window.openDevInfo('consistency');
  const overlay = window.document.getElementById('helpModalOverlay');
  assert.ok(overlay.classList.contains('is-open'), 'modal should be open after calling openDevInfo');
  assert.equal(window.document.querySelector('#helpModalOverlay h3').innerHTML, 'Live consistency check');
});

test('a Developer account sees all 7 tab buttons, with "health" active by default', () => {
  const window = loadAs(true);
  const tabBtns = Array.from(window.document.querySelectorAll('.dev-tab-btn'));
  // 7 as of 2026-09-24: the regroup (Health, Data, Sync, Notifications,
  // Ops, Reports, Access) replaced the old 6 (Health, Access, Session,
  // Notifications, Deploy, Reports), whose tabs mixed panels that had
  // nothing to do with each other.
  assert.deepEqual(tabBtns.map(b => b.getAttribute('data-tab')),
    ['health', 'data', 'sync', 'notifications', 'ops', 'reports', 'access']);
  tabBtns.forEach(btn => {
    assert.notEqual(btn.style.display, 'none', 'tab "' + btn.getAttribute('data-tab') + '" should be visible for a Developer');
  });

  const healthBtn = tabBtns.find(b => b.getAttribute('data-tab') === 'health');
  assert.ok(healthBtn.classList.contains('is-active'), 'health tab button should start active');
  const healthGrid = window.document.querySelector('.dev-tab-panel[data-tab-panel="health"]');
  assert.ok(healthGrid.classList.contains('is-active-tab-panel'), 'health panel group should start active');

  const otherGrids = window.document.querySelectorAll('.dev-tab-panel[data-tab-panel]:not([data-tab-panel="health"])');
  assert.equal(otherGrids.length, 6, 'expected 6 other tab-panel groups');
  otherGrids.forEach(grid => {
    assert.ok(!grid.classList.contains('is-active-tab-panel'), 'tab-panel "' + grid.getAttribute('data-tab-panel') + '" should not be active initially');
  });
});

test('switching tabs actually shows the target panel group and hides the rest, for a Developer account', () => {
  const window = loadAs(true);
  window.switchDevToolsTab('ops');

  const opsGrid = window.document.querySelector('.dev-tab-panel[data-tab-panel="ops"]');
  assert.ok(opsGrid.classList.contains('is-active-tab-panel'), 'ops panel group should be active after switching to it');

  const opsBtn = window.document.querySelector('.dev-tab-btn[data-tab="ops"]');
  assert.ok(opsBtn.classList.contains('is-active'), 'ops tab button should be marked active after switching to it');

  const healthGrid = window.document.querySelector('.dev-tab-panel[data-tab-panel="health"]');
  assert.ok(!healthGrid.classList.contains('is-active-tab-panel'), 'health panel group should no longer be active after switching away from it');
  const healthBtn = window.document.querySelector('.dev-tab-btn[data-tab="health"]');
  assert.ok(!healthBtn.classList.contains('is-active'), 'health tab button should no longer be marked active after switching away from it');
});

test('an account without the full-technical permission sees only the Data and Access tab buttons, landing on Data with just Client registry showing', () => {
  // Rewritten 2026-09-24: Client registry moved from Access to Data
  // (What's stored) in the regroup -- it is a view of client records,
  // not an access setting. So an Owner now sees two tabs, Data (Client
  // registry only) and Access (Account permissions), and lands on Data,
  // the first of them. Health stays entirely technical and hidden.
  const window = loadAs(false);
  const tabBtns = Array.from(window.document.querySelectorAll('.dev-tab-btn'));
  const visible = tabBtns.filter(b => b.style.display !== 'none').map(b => b.getAttribute('data-tab'));
  assert.deepEqual(visible, ['data', 'access']);

  const dataBtn = tabBtns.find(b => b.getAttribute('data-tab') === 'data');
  assert.ok(dataBtn.classList.contains('is-active'), 'Data should be the landing tab for an Owner, since it is the first visible tab');

  tabBtns.filter(b => !['data', 'access'].includes(b.getAttribute('data-tab'))).forEach(btn => {
    assert.equal(btn.style.display, 'none', 'tab "' + btn.getAttribute('data-tab') + '" should be hidden for an Owner, since every one of its panels is dev-owner-hidden');
  });

  // No orphaned subheading: on Data, only the section holding Client
  // registry is shown; its two developer-only neighbours (Appliance Wiki
  // health, Storage browser) are hidden inside it.
  const dataTab = window.document.querySelector('.dev-tab-panel[data-tab-panel="data"]');
  const shownSections = Array.from(dataTab.querySelectorAll('.dev-section')).filter(s => s.style.display !== 'none');
  assert.equal(shownSections.length, 1);
  const shownPanels = Array.from(shownSections[0].querySelectorAll('.dev-panel')).filter(p => p.style.display !== 'none');
  assert.deepEqual(shownPanels.map(p => p.querySelector('h2').textContent), ['Client registry']);
});
