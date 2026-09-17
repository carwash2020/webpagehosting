// PR4 (2026-09-17): internal /tools/ usability — Action Items as an
// ops inbox, jump-nav chip collapse, compact hub header, Job Tracker
// tablet density, and a bottom-nav More sheet. Markup/CSS/JS only;
// same data each list already fetched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const JOB_TRACKER = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');
const NAV = fs.readFileSync(repo('tools', 'tools-nav-pwa.js'), 'utf8');
const STYLES = fs.readFileSync(repo('tools', 'styles-tools.css'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

test('Action Items is grouped into four priority lanes, and every existing list id still exists', () => {
  assert.match(WORKSPACE, /class="ops-inbox"/);
  for (const lane of ['lane-respond', 'lane-soon', 'lane-follow', 'lane-money']) {
    assert.match(WORKSPACE, new RegExp('id="' + lane + '"'), `expected ${lane}`);
  }
  for (const id of ['workRequestsList', 'leadsList', 'bookingsList', 'upcomingJobs', 'followupsList', 'invoicesList', 'invoiceSearch']) {
    assert.match(WORKSPACE, new RegExp('id="' + id + '"'), `expected #${id} to still exist — no backend change`);
  }
});

test('lane counts reuse actionItemCounts rather than a second calculation of the same numbers', () => {
  const fn = extractFn(WORKSPACE, 'updateActionItemsBadge');
  assert.match(fn, /setOpsLaneCount\('laneRespondCount', 'lane-respond', actionItemCounts\.workrequests \+ actionItemCounts\.leads \+ actionItemCounts\.bookings\)/);
  assert.match(fn, /setOpsLaneCount\('laneSoonCount', 'lane-soon', actionItemCounts\.duesoon\)/);
  assert.match(fn, /setOpsLaneCount\('laneFollowCount', 'lane-follow', actionItemCounts\.followups\)/);
  assert.match(fn, /setOpsLaneCount\('laneMoneyCount', 'lane-money', actionItemCounts\.unpaid\)/);
});

test('unread styling is driven by data that already exists (handled / submitted / overdue), not a new backend', () => {
  assert.match(WORKSPACE, /lead-card\$\{!l\.handled \? ' is-unread' : ''\}/);
  assert.match(WORKSPACE, /lead-card is-unread" data-booking-id=/);
  assert.match(WORKSPACE, /wo\.status === 'submitted' \? ' is-unread'/);
  assert.match(WORKSPACE, /overdue && status !== 'paid' \? ' is-unread'/);
});

test('phone jump-nav keeps Snapshot / Action Items / Tools in the row and puts Gallery/Compliance/Analytics/Backup behind More', () => {
  const chips = WORKSPACE.match(/<nav class="jump-nav" id="everythingElseChips">[\s\S]*?<\/nav>/)[0];
  assert.match(chips, /id="jumpNavMoreBtn"/);
  assert.match(chips, /class="jump-nav-secondary"/);
  assert.match(WORKSPACE, /@media \(min-width: 721px\) \{[\s\S]*?\.jump-nav-more-btn \{ display: none; \}/);
  // All seven anchors remain in the nav (secondary ones just nested).
  for (const anchor of ['#section-snapshot', '#section-actionitems', '#section-gallery', '#section-compliance', '#section-analytics', '#section-backup', '#section-tools']) {
    assert.match(chips, new RegExp('href="' + anchor + '"'), `expected ${anchor}`);
  }
});

test('bottom nav still lists the five daily dests, plus a More button that opens a sheet of the remaining sidebar dests', () => {
  assert.match(NAV, /label: 'Home'/);
  assert.match(NAV, /label: 'Jobs'/);
  assert.match(NAV, /label: 'Invoices'/);
  assert.match(NAV, /label: 'Calendar'/);
  assert.match(NAV, /label: 'Finance'/);
  assert.match(NAV, /class="th-bn-more/);
  assert.match(NAV, /id = 'thMoreSheet'/);
  assert.match(NAV, /MORE_DESTS = SIDEBAR_DESTS\.filter/);
  assert.match(NAV, /aria-controls="thMoreSheet"/);
  assert.match(STYLES, /\.th-more-sheet \{/);
  assert.match(STYLES, /@media \(min-width: 721px\) \{ \.th-more-sheet \{ display: none !important; \} \}/);
});

test('injecting the bottom nav on a real page produces 5 dest links plus More, and the sheet lists sidebar dests the bar does not', () => {
  const html = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/job-tracker.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.initAppTour = () => {};
    },
  });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = NAV;
  window.document.head.appendChild(s);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

  const bar = window.document.querySelector('.th-bottom-nav');
  assert.ok(bar);
  assert.equal(bar.querySelectorAll('a').length, 5);
  assert.ok(bar.querySelector('.th-bn-more'));
  const sheet = window.document.getElementById('thMoreSheet');
  assert.ok(sheet);
  const sheetHrefs = [...sheet.querySelectorAll('a')].map(a => a.getAttribute('href'));
  assert.ok(sheetHrefs.includes('/tools/contract-generator.html'));
  assert.ok(sheetHrefs.includes('/tools/route-planner.html'));
  assert.ok(sheetHrefs.includes('/tools/review-request.html'));
  assert.ok(sheetHrefs.includes('/tools/runway-dashboard.html'));
  assert.ok(sheetHrefs.includes('/tools/settings.html'));
  assert.ok(!sheetHrefs.includes('/tools/job-tracker.html'), 'primary dests must not be duplicated in More');
});

test('Job Tracker adds compact list density for 768–1023 without moving the table breakpoint off 1024', () => {
  assert.match(JOB_TRACKER, /@media \(min-width: 768px\) and \(max-width: 1023px\)/);
  assert.match(JOB_TRACKER, /@media \(min-width: 1024px\) \{ \.jobs-table-wrap \{ display: block/);
  assert.match(STYLES, /@media \(min-width: 1024px\) \{\s*#jobsList \{ display: none; \}/);
});

test('dashboard hub header no longer spends 140px on a second sync row', () => {
  assert.doesNotMatch(WORKSPACE, /min-height:\s*140px/);
  assert.match(WORKSPACE, /id="realtimeBadge"/);
  assert.match(WORKSPACE, /id="refreshSyncLink"/);
  const paddingMatch = WORKSPACE.match(/@media \(min-width: 1024px\) \{ body(?:\.th-tool-page)? \{[^}]*padding-top: (\d+)px;[^}]*\} \}/);
  assert.ok(paddingMatch);
  assert.ok(parseInt(paddingMatch[1], 10) < 140);
});
