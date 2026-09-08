// W10 (Master Audit, Flagship 02, 2026-09-08): "The dashboard currently
// opens on a greeting, a zero, and eight collapsed drawers... It is a
// filing cabinet." Replaces the old flat "Today" drawer with a real
// Today hero -- next job with navigation, money owed split current/
// overdue, and the rest of the day -- plus a single row of chips for
// everything else (Snapshot, Action Items, Gallery, Compliance,
// Analytics, Backup, Tools), each carrying the same live count its own
// section already computes. No schema change.
//
// Verified by rendering: seeded real jobs/invoices via Playwright at
// 1440x900 and 390x844, confirmed the Next Job / Money Owed / Rest of
// Today cards render the right data, and along the way found (and
// fixed, for this page) a genuine pre-existing CSS-specificity bug --
// the desktop `body { padding-top: 205px }` override was silently
// losing to styles-tools.css's own same-specificity `body.th-tool-page`
// base rule regardless of source order, overlapping ~96px of content
// under the fixed header. This test locks in the structural pieces.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

test('the old 8-drawer Today section is gone -- replaced by a real hero with next job, money owed, and rest of day', () => {
  assert.doesNotMatch(WORKSPACE, /id="section-today"|id="todayJobsList"|id="body-today"/);
  assert.match(WORKSPACE, /<div class="today-hero" id="todayHero">/);
  assert.match(WORKSPACE, /id="todayNextJob"/);
  assert.match(WORKSPACE, /id="todayMoney"/);
  assert.match(WORKSPACE, /id="todayRestOfDay"/);
});

test('renderDashboard renders the Today hero (not the old renderTodayJobs) as part of every render', () => {
  const dashboardFn = extractFn(WORKSPACE, 'renderDashboard');
  assert.match(dashboardFn, /renderTodayHero\(\)/);
  assert.doesNotMatch(dashboardFn, /renderTodayJobs\(\)/);
});

test('the Next Job card only ever shows the single highest-priority job, and Rest of Today shows the remainder in the same order', () => {
  const fn = extractFn(WORKSPACE, 'renderTodayHero');
  assert.match(fn, /const job = todaysJobs\[0\];/);
  assert.match(fn, /const rest = todaysJobs\.slice\(1\);/);
});

test('money owed is computed once (computeMoneyOwed) and shared between Business Snapshot\'s cards and the Today hero, so they can never disagree', () => {
  const metricsFn = extractFn(WORKSPACE, 'renderMetrics');
  assert.match(metricsFn, /const owed = computeMoneyOwed\(\);/);
  assert.match(metricsFn, /renderTodayMoney\(owed\);/);
  const computeFn = extractFn(WORKSPACE, 'computeMoneyOwed');
  assert.match(computeFn, /currentTotal: outstandingTotal - overdueTotal/);
});

test('the money-owed card states an actual Current/Overdue split, not a single lumped total', () => {
  const fn = extractFn(WORKSPACE, 'renderTodayMoney');
  assert.match(fn, /Current<\/span>/);
  assert.match(fn, /Overdue<\/span>/);
  assert.match(fn, /owed\.currentTotal/);
  assert.match(fn, /owed\.overdueTotal/);
});

test('"everything else" is one row of chips linking to the 7 remaining sections, each an anchor jump (no schema/behavior change to those sections)', () => {
  const chipsBlock = WORKSPACE.match(/<nav class="jump-nav" id="everythingElseChips">[\s\S]*?<\/nav>/);
  assert.ok(chipsBlock, 'expected the everythingElseChips nav');
  for (const anchor of ['#section-snapshot', '#section-actionitems', '#section-gallery', '#section-compliance', '#section-analytics', '#section-backup', '#section-tools']) {
    assert.match(chipsBlock[0], new RegExp('href="' + anchor + '"'), `expected a chip linking to ${anchor}`);
  }
});

test('the Action Items, Gallery, and Compliance chips mirror the exact counts their own sections already compute -- no second calculation of the same number', () => {
  const actionItemsFn = extractFn(WORKSPACE, 'updateActionItemsBadge');
  assert.match(actionItemsFn, /chipActionItems/);
  assert.match(actionItemsFn, /\$\{total\}/);
  assert.match(WORKSPACE, /function updateGalleryChip\(n\) \{[\s\S]{0,200}chipGallery/);
  assert.match(WORKSPACE, /chipCompliance/);
});

test('Action Items now defaults to collapsed like the rest of "everything else", since the chip row is the answer-first entry point now', () => {
  const match = WORKSPACE.match(/const DEFAULT_COLLAPSE = \{([^}]*)\}/);
  assert.ok(match);
  assert.doesNotMatch(match[1], /\btoday:/);
  assert.match(match[1], /actionitems:\s*true/);
});

test('the #today hash-jump handler scrolls to the new hero, not the removed drawer', () => {
  assert.match(WORKSPACE, /window\.location\.hash === '#today'[\s\S]{0,80}getElementById\('todayHero'\)/);
});

test('the tools service worker cache was bumped for this change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 98, `expected v98 or later, got v${version}`);
});
