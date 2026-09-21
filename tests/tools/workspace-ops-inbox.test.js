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
  assert.match(fn, /setOpsLaneCount\('laneRespondCount', 'lane-respond', actionItemCounts\.workrequests \+ actionItemCounts\.leads \+ actionItemCounts\.applicants \+ actionItemCounts\.bookings\)/);
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

test('Needs attention (the ops inbox) sits directly under the hero and the action strip, open by default; the chip row that used to stand in for it is gone (2026-09-21)', () => {
  assert.doesNotMatch(WORKSPACE, /id="everythingElseChips"/);
  const stripAt = WORKSPACE.indexOf('id="dashPrimaryStrip"');
  const inboxAt = WORKSPACE.indexOf('id="section-actionitems"');
  const snapshotAt = WORKSPACE.indexOf('id="section-snapshot"');
  assert.ok(stripAt > 0 && inboxAt > stripAt && snapshotAt > inboxAt);
  const defaults = WORKSPACE.match(/const DEFAULT_COLLAPSE = \{([^}]*)\}/)[1];
  assert.match(defaults, /actionitems:\s*false/);
  assert.match(WORKSPACE, /Needs attention <span id="actionItemsHeadingBadge"><\/span>/);
});

test('respond-lane sub-groups hide themselves when empty (plain empty state only, never a warning), with one caught-up line when all four are empty', () => {
  for (const list of ['workRequestsList', 'leadsList', 'applicantsList', 'bookingsList']) {
    assert.match(WORKSPACE, new RegExp('<div class="ops-group" data-ops-list="' + list + '">'), `expected an ops-group wrapper for #${list}`);
  }
  assert.match(WORKSPACE, /id="laneRespondClear" hidden/);
  const fn = extractFn(WORKSPACE, 'refreshOpsGroupVisibility');
  assert.match(fn, /classList\.contains\('empty-state-small'\) && !only\.classList\.contains\('is-warning'\)/);
  assert.match(fn, /group\.classList\.toggle\('is-empty', isPlainEmpty\)/);
  const badgeFn = extractFn(WORKSPACE, 'updateActionItemsBadge');
  assert.match(badgeFn, /refreshOpsGroupVisibility\(\)/, 'visibility refreshes every time a lane count updates');
  assert.match(STYLES.length ? WORKSPACE : WORKSPACE, /\.ops-group\.is-empty \{ display: none; \}/);
});

test('bottom nav lists the five daily dests (Clients replaced Calendar on 2026-09-21, when Calendar became a Job Tracker view), plus a More button that opens a sheet of the remaining sidebar dests', () => {
  assert.match(NAV, /label: 'Home'/);
  assert.match(NAV, /label: 'Jobs'/);
  assert.match(NAV, /label: 'Clients'/);
  assert.match(NAV, /label: 'Invoices'/);
  assert.match(NAV, /label: 'Finance'/);
  assert.doesNotMatch(NAV, /\/tools\/calendar\.html/, 'the retired calendar page must not be a nav destination');
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
  assert.ok(!sheetHrefs.includes('/tools/clients.html'), 'Clients is a primary dest now, so it must not also sit in More');
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
