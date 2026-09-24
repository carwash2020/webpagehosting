// Tests for the Dev Tools regroup (2026-09-24), requested directly: the
// page had grown to 32 panels under 6 tabs, several of which held panels
// that had nothing to do with each other (Known issues, Graveyard, and
// Flagged pages under Notifications; Storage browser under Deploy;
// Client registry under Access). Panels were regrouped by the question
// they answer and split into named sections, with the run-it-when-you-
// need-it tools shown as collapsed one-line rows. Every panel's own
// markup and logic moved as-is -- these tests pin the new grouping and
// check that nothing a panel renders into went missing on the way.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DEV_TOOLS_PATH = path.join(__dirname, '..', '..', 'tools', 'dev-tools.html');
const SRC = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');

function load(canAccessFull) {
  const dom = new JSDOM(SRC, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canAccessDevToolsFull = () => canAccessFull;
    },
  });
  return dom.window;
}

const panelTitles = el => Array.from(el.querySelectorAll('.dev-panel h2')).map(h => h.textContent.trim());

// The whole intended layout, tab by tab, section by section, in order.
const EXPECTED = {
  health: {
    'Live status': ['Uptime monitoring', 'Cron health', 'Client errors'],
    'Run a check': ['Live consistency check', 'Advisor health'],
  },
  data: {
    'Check the data': ['Data quality check', 'Data integrity check'],
    'Get it back': ['Graveyard', 'Backup & restore'],
    "What's stored": ['Client registry', 'Appliance Wiki health', 'Storage browser'],
  },
  sync: {
    'Sync': ['Session & sync', 'Sync conflicts'],
    'This device': ['Local data snapshot', 'Service worker & cache', 'Device info'],
  },
  notifications: {
    'Send a test': ['Push notification test', 'Booking notification test'],
    'What went out': ['Push notification history', 'Recent bookings'],
  },
  ops: {
    'Deploys': ['Deploy history', 'Regression checker', "What's new"],
    'To-do': ['Known issues', 'Flagged pages'],
    'Shortcuts': ['Trigger workflows', 'Quick links'],
  },
  reports: {
    'Last 8 weeks': ['Booking funnel health', 'Lead response time', 'Uptime trend'],
  },
};

test('every tab holds exactly its intended sections and panels, in order', () => {
  const window = load(true);
  for (const [tab, sections] of Object.entries(EXPECTED)) {
    const tabEl = window.document.querySelector('.dev-tab-panel[data-tab-panel="' + tab + '"]');
    assert.ok(tabEl, 'tab panel "' + tab + '" not found');
    const actual = {};
    tabEl.querySelectorAll('.dev-section').forEach(sec => {
      actual[sec.querySelector('.dev-section-title').textContent.trim()] = panelTitles(sec);
    });
    assert.deepEqual(actual, sections, 'tab "' + tab + '"');
  }
  const access = window.document.querySelector('.dev-tab-panel[data-tab-panel="access"]');
  assert.deepEqual(panelTitles(access), ['Account permissions']);
});

test('all 32 panels still exist, each exactly once, and each sits inside a tab', () => {
  const window = load(true);
  const all = panelTitles(window.document);
  assert.equal(all.length, 32);
  assert.equal(new Set(all).size, 32, 'a panel title appears twice');
  window.document.querySelectorAll('.dev-panel').forEach(p => {
    assert.ok(p.closest('.dev-tab-panel'), '"' + p.querySelector('h2').textContent + '" is outside every tab');
  });
});

test('every element a panel renders into, or a button reads, is still on the page', () => {
  const ids = [
    'consistencyResults', 'runCheckBtn', 'dataQualityResults', 'runDataQualityBtn', 'wikiHealth',
    'clientErrorLog', 'syncConflictLog', 'uptimeStatus', 'uptimeIncidentsList', 'advisorSetupNotice',
    'advisorHealthResults', 'cronHealthResults', 'dataIntegrityResults', 'clientRegistryResults',
    'clientRegistryBtn', 'accountRolesList', 'permCategoriesRow', 'permCategoryPanel',
    'permNonManagerNote', 'addAccountForm', 'newAccountEmail', 'newAccountPreset', 'sessionInfo',
    'localDataSnapshot', 'deviceInfo', 'swInfo', 'backup', 'pushTestResult', 'pushTestBtn',
    'pushHistoryList', 'bookingTestResult', 'bookingTestBtn', 'recentBookingsList', 'knownIssuesList',
    'graveyardList', 'flaggedItemsList', 'deployStatus', 'deployHistoryList', 'regressionFromCommit',
    'regressionCheckBtn', 'regressionCheckResult', 'changelogList', 'triggerWorkflowResult',
    'storageBrowserResults', 'bookingFunnelReport', 'leadResponseTimeReport', 'uptimeTrendReport',
    'fullHealthCheckBtn', 'fullHealthCheckResults',
  ];
  const window = load(true);
  for (const id of ids) {
    assert.equal(window.document.querySelectorAll('#' + id).length, 1, '#' + id + ' should exist exactly once');
  }
});

test('Run full health check sits at the top of the Health tab, not above every tab', () => {
  const window = load(true);
  const btn = window.document.getElementById('fullHealthCheckBtn');
  assert.equal(btn.closest('.dev-tab-panel').getAttribute('data-tab-panel'), 'health');
  assert.ok(window.document.getElementById('fullHealthCheckResults').closest('.dev-tab-panel[data-tab-panel="health"]'));
});

test('a #backup link lands on the Data tab, where Backup & restore lives now', () => {
  const handler = SRC.match(/if \(window\.location\.hash === '#backup'\) \{[\s\S]*?\n      \}/);
  assert.ok(handler, '#backup handler not found');
  assert.match(handler[0], /switchDevToolsTab\('data'\);/);
  assert.match(handler[0], /getElementById\('backup'\)\?\.scrollIntoView/);

  const window = load(true);
  window.switchDevToolsTab('data');
  const backupTab = window.document.getElementById('backup').closest('.dev-tab-panel');
  assert.ok(backupTab.classList.contains('is-active-tab-panel'), 'Backup & restore should be on the tab #backup switches to');
});

test('every collapsible row is wired the same way: toggling heading, a "?" that does not toggle, a caret, a body, a one-line hint, and its own collapse key', () => {
  const window = load(true);
  const rows = Array.from(window.document.querySelectorAll('.dev-panel.is-collapsible'));
  assert.equal(rows.length, 17);
  const keys = new Set();
  for (const row of rows) {
    const title = row.querySelector('h2').textContent;
    const heading = row.querySelector(':scope > .dev-panel-heading');
    assert.equal(heading.getAttribute('onclick'), 'toggleDevPanel(this)', title);
    assert.match(heading.querySelector('.dev-info-bubble').getAttribute('onclick'), /^event\.stopPropagation\(\); openDevInfo\('\w+'\)$/, title);
    assert.ok(heading.querySelector('.dev-collapse-caret'), title + ' caret');
    assert.ok(heading.querySelector('.dev-panel-hint').textContent.trim(), title + ' hint');
    assert.ok(row.querySelector(':scope > .dev-panel-body'), title + ' body');
    const key = row.getAttribute('data-collapse-key');
    assert.ok(key && !keys.has(key), title + ' needs its own data-collapse-key');
    keys.add(key);
  }
});

test('no section is left as an empty subheading: a section with no visible panel is hidden, one with any visible panel is shown', () => {
  const owner = load(false);
  owner.applyOwnerRestrictedView();
  owner.initDevToolsTabs();
  const shown = Array.from(owner.document.querySelectorAll('.dev-section')).filter(s => s.style.display !== 'none');
  assert.deepEqual(shown.map(s => s.querySelector('.dev-section-title').textContent), ["What's stored"]);

  const dev = load(true);
  dev.applyOwnerRestrictedView();
  dev.initDevToolsTabs();
  dev.document.querySelectorAll('.dev-section').forEach(s => {
    assert.notEqual(s.style.display, 'none', 'section "' + s.querySelector('.dev-section-title').textContent + '" should show for a Developer');
  });
});

test('sections are plain divs, not <section> -- styles.css gives every <section> the public site\'s 88px padding and a top border', () => {
  assert.doesNotMatch(SRC, /<section[\s>]/);
  assert.equal((SRC.match(/<div class="dev-section" role="group" aria-labelledby="devSec\w+">/g) || []).length, 13);
});

test('the phone tab bar pulls out by the real 12px gutter, not 14px -- 14px pushed it 2px past each screen edge and let the page scroll sideways', () => {
  const mobile = SRC.match(/@media \(max-width: 720px\) \{\s*body \{ padding: 44px 14px 60px; \}[\s\S]*?\n  \}/);
  assert.ok(mobile, 'the page\'s phone block was not found');
  assert.match(mobile[0], /\.dev-tab-bar \{ padding: 8px 10px; margin: 0 -12px 16px; gap: 2px; \}/);
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'styles-tools.css'), 'utf8');
  assert.match(css, /body\.th-tool-page \{ padding-left: 12px; padding-right: 12px;/, 'the shared phone gutter this matches');
});
