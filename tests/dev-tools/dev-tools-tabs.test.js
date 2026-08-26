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

test('a Developer account sees all 6 tab buttons, with "health" active by default', () => {
  const window = loadAs(true);
  const tabBtns = Array.from(window.document.querySelectorAll('.dev-tab-btn'));
  assert.equal(tabBtns.length, 6, 'expected exactly 6 tab buttons');
  tabBtns.forEach(btn => {
    assert.notEqual(btn.style.display, 'none', 'tab "' + btn.getAttribute('data-tab') + '" should be visible for a Developer');
  });

  const healthBtn = tabBtns.find(b => b.getAttribute('data-tab') === 'health');
  assert.ok(healthBtn.classList.contains('is-active'), 'health tab button should start active');
  const healthGrid = window.document.querySelector('.dev-panels-grid[data-tab-panel="health"]');
  assert.ok(healthGrid.classList.contains('is-active-tab-panel'), 'health panel group should start active');

  const otherGrids = window.document.querySelectorAll('.dev-panels-grid[data-tab-panel]:not([data-tab-panel="health"])');
  assert.equal(otherGrids.length, 5, 'expected 5 other tab-panel groups');
  otherGrids.forEach(grid => {
    assert.ok(!grid.classList.contains('is-active-tab-panel'), 'tab-panel "' + grid.getAttribute('data-tab-panel') + '" should not be active initially');
  });
});

test('switching tabs actually shows the target panel group and hides the rest, for a Developer account', () => {
  const window = loadAs(true);
  window.switchDevToolsTab('deploy');

  const deployGrid = window.document.querySelector('.dev-panels-grid[data-tab-panel="deploy"]');
  assert.ok(deployGrid.classList.contains('is-active-tab-panel'), 'deploy panel group should be active after switching to it');

  const deployBtn = window.document.querySelector('.dev-tab-btn[data-tab="deploy"]');
  assert.ok(deployBtn.classList.contains('is-active'), 'deploy tab button should be marked active after switching to it');

  const healthGrid = window.document.querySelector('.dev-panels-grid[data-tab-panel="health"]');
  assert.ok(!healthGrid.classList.contains('is-active-tab-panel'), 'health panel group should no longer be active after switching away from it');
  const healthBtn = window.document.querySelector('.dev-tab-btn[data-tab="health"]');
  assert.ok(!healthBtn.classList.contains('is-active'), 'health tab button should no longer be marked active after switching away from it');
});

test('an Owner account (canManageRoles false) sees only the Access tab button, and it is selected automatically since every other tab has zero visible panels', () => {
  const window = loadAs(false);
  const tabBtns = Array.from(window.document.querySelectorAll('.dev-tab-btn'));

  const accessBtn = tabBtns.find(b => b.getAttribute('data-tab') === 'access');
  assert.notEqual(accessBtn.style.display, 'none', 'Access tab button should stay visible for an Owner');

  const nonAccessBtns = tabBtns.filter(b => b.getAttribute('data-tab') !== 'access');
  assert.equal(nonAccessBtns.length, 5, 'expected 5 non-Access tab buttons');
  nonAccessBtns.forEach(btn => {
    assert.equal(btn.style.display, 'none', 'tab "' + btn.getAttribute('data-tab') + '" should be hidden for an Owner, since every one of its panels is dev-owner-hidden');
  });

  const accessGrid = window.document.querySelector('.dev-panels-grid[data-tab-panel="access"]');
  assert.ok(accessGrid.classList.contains('is-active-tab-panel'), 'Access should be the automatically-selected tab for an Owner, since it is the only one with real content');
});
