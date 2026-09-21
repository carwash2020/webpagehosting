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
  assert.match(fn, /todayOverdueList/);
});

test('the "everything else" chip row is gone (2026-09-21): the remaining sections sit right below the inbox under one Business label, each still an anchor target', () => {
  assert.doesNotMatch(WORKSPACE, /id="everythingElseChips"/);
  assert.match(WORKSPACE, /<div class="dash-group-label">Business<\/div>/);
  for (const id of ['section-snapshot', 'section-analytics', 'section-compliance', 'section-gallery']) {
    assert.match(WORKSPACE, new RegExp('<div class="section-block" id="' + id + '">'), `expected ${id}`);
  }
  assert.doesNotMatch(WORKSPACE, /id="section-backup"|id="section-tools"/, 'Backup moved to Settings; the tile grid was retired');
});

test('the live counts now sit on the section headings themselves -- Needs attention badge, Gallery "waiting" badge, Compliance status -- no chip mirrors', () => {
  const actionItemsFn = extractFn(WORKSPACE, 'updateActionItemsBadge');
  assert.match(actionItemsFn, /actionItemsHeadingBadge/);
  assert.doesNotMatch(actionItemsFn, /chipActionItems/);
  assert.match(WORKSPACE, /function updateGalleryChip\(n\) \{[\s\S]{0,400}galleryHeadingBadge/);
  assert.doesNotMatch(WORKSPACE, /chipGallery|chipCompliance/);
  assert.match(WORKSPACE, /id="galleryHeadingBadge"/);
  assert.match(WORKSPACE, /id="complianceHeadingBadge"/);
});

test('Needs attention (Action Items) defaults to OPEN -- it is the second answer after the hero; only the occasional Business drawers start collapsed', () => {
  const match = WORKSPACE.match(/const DEFAULT_COLLAPSE = \{([^}]*)\}/);
  assert.ok(match);
  assert.doesNotMatch(match[1], /\btoday:/);
  assert.match(match[1], /actionitems:\s*false/);
  for (const key of ['snapshot', 'gallery', 'compliance', 'analytics']) assert.match(match[1], new RegExp(key + ':\\s*true'));
  assert.doesNotMatch(match[1], /backup/);
});

test('the #today hash-jump handler scrolls to the new hero, not the removed drawer', () => {
  assert.match(WORKSPACE, /window\.location\.hash === '#today'[\s\S]{0,80}getElementById\('todayHero'\)/);
});

test('the tools service worker cache was bumped for this change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 98, `expected v98 or later, got v${version}`);
});
