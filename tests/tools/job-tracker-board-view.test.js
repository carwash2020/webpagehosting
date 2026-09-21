// Item #39 (2026-09-07): a kanban-style status board for Job Tracker,
// authorized directly alongside two other visual/UX improvements
// ("do all the improvements you mentioned"). Not Started / In Progress
// / Done columns side by side, toggled per-device (like the existing
// density preference), reusing the exact same job-card markup/CSS and
// status vocabulary/colors the list and table views already use rather
// than inventing a new visual language.
//
// These are plain regex assertions against the page source, matching
// the style of the other tools/*.test.js files in this repo (no DOM/vm
// execution needed for markup and CSS structure checks).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');

function extractFn(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = HTML.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}

// 2026-09-21: the single Board/List toggle became a three-way switch
// (List / Board / Calendar) when calendar.html was folded into this
// page as a view -- one control, one persisted preference.
test('a List / Board / Calendar view switch sits next to the existing Select/Compact view controls', () => {
  assert.match(HTML, /id="jobViewSwitch"/);
  for (const view of ['list', 'board', 'calendar']) {
    assert.match(HTML, new RegExp('data-view="' + view + '" onclick="setJobViewMode\\(\'' + view + '\'\\)"'), `expected a ${view} button wired to setJobViewMode`);
  }
  assert.doesNotMatch(HTML, /toggleJobViewMode\(/, 'the old two-state toggle should be gone, not left beside the switch');
});

test('the board has exactly 3 columns -- Not Started, In Progress, Done -- matching the real STATUS_LABEL vocabulary', () => {
  assert.match(HTML, /id="jobsBoardWrap"\s+class="jobs-board-wrap"/);
  assert.match(HTML, /id="boardCol-not-started"/);
  assert.match(HTML, /id="boardCol-in-progress"/);
  assert.match(HTML, /id="boardCol-done"/);
  assert.match(HTML, />Not Started<span class="board-col-count"/);
  assert.match(HTML, />In Progress<span class="board-col-count"/);
  assert.match(HTML, />Done<span class="board-col-count"/);
});

test('column dots reuse the exact same status colors as the existing .badge-status classes, not new ones', () => {
  assert.match(HTML, /\.badge-status\.status-in-progress\s*\{[^}]*color:\s*var\(--blue-light\)/);
  assert.match(HTML, /\.badge-status\.status-done\s*\{[^}]*color:\s*#6fcf97/);
  assert.match(HTML, /\.board-col-dot\.status-not-started\s*\{\s*background:\s*var\(--text-dim\);\s*\}/);
  assert.match(HTML, /\.board-col-dot\.status-in-progress\s*\{\s*background:\s*var\(--blue-light\);\s*\}/);
  assert.match(HTML, /\.board-col-dot\.status-done\s*\{\s*background:\s*#6fcf97;\s*\}/);
});

test('each board column is its own bounded, independently-scrollable container (a lesson reused from the Finance sticky-header fix), not reliant on page scroll', () => {
  const rule = HTML.match(/\.board-column\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected a .board-column rule');
  assert.match(rule[1], /max-height:\s*65vh/);
  const bodyRule = HTML.match(/\.board-column-body\s*\{([^}]*)\}/);
  assert.ok(bodyRule, 'expected a .board-column-body rule');
  assert.match(bodyRule[1], /overflow-y:\s*auto/);
});

test('the board row is a fixed-width, horizontally-scrolling flex row -- works on phone via scroll, not just desktop', () => {
  const rule = HTML.match(/\.jobs-board-wrap\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected a .jobs-board-wrap rule');
  assert.match(rule[1], /display:\s*flex/);
  assert.match(rule[1], /overflow-x:\s*auto/);
  const colRule = HTML.match(/\.board-column\s*\{([^}]*)\}/);
  assert.match(colRule[1], /flex:\s*0 0 280px/, 'columns should be fixed-width, not shrinking to fit the viewport');
});

test('jobCardHtml() is shared between the list and board views, not duplicated', () => {
  const fnSrc = extractFn('jobCardHtml');
  assert.match(fnSrc, /opts\.enableSwipe/);
  assert.match(fnSrc, /opts\.includePhotoToggle/);
  assert.match(fnSrc, /opts\.showStatusBadge/);

  const boardCallSite = HTML.match(/jobCardHtml\(job, marginData, \{ enableSwipe: false, includePhotoToggle: false, showStatusBadge: false \}\)/);
  assert.ok(boardCallSite, 'expected renderJobsBoard to call jobCardHtml with swipe/photos disabled');
  const listCallSite = HTML.match(/jobCardHtml\(job, marginData, \{ enableSwipe: true, includePhotoToggle: true, showStatusBadge: true \}\)/);
  assert.ok(listCallSite, 'expected the list view to call jobCardHtml with swipe/photos enabled, same as before this refactor');
});

test('board cards never render a photos-${id} element -- would collide with the list card\'s element of the same id since both can be in the DOM at once', () => {
  const fnSrc = extractFn('jobCardHtml');
  const photosDivMatch = fnSrc.match(/\$\{opts\.includePhotoToggle \? `<div id="photos-\$\{job\.id\}"/);
  assert.ok(photosDivMatch, 'the photos container must be gated behind opts.includePhotoToggle');
});

test('the board ignores the status-filter row entirely -- it shows all 3 statuses grouped by column, always', () => {
  const fnSrc = extractFn('renderJobsBoard');
  assert.doesNotMatch(fnSrc, /currentStatusFilter/, 'the board should not apply the Active/Not Started/In Progress/Completed/All filter');
  const renderJobsSrc = extractFn('renderJobs');
  assert.match(renderJobsSrc, /renderJobsBoard\(allJobs, marginData\)/, 'the board should be rendered from the un-status-filtered job list');
});

test('the status-filter row is hidden while the board or calendar is active, since it only means something for the single list/table', () => {
  const fnSrc = extractFn('applyJobViewMode');
  assert.match(fnSrc, /if \(statusFilterGroup\) statusFilterGroup\.style\.display = mode === 'list' \? '' : 'none';/);
  assert.match(fnSrc, /if \(calendarWrap\) calendarWrap\.style\.display = isCalendar \? '' : 'none';/);
});

test('the view preference is a per-device localStorage choice (like density), not synced business data', () => {
  assert.match(HTML, /const JOB_VIEW_KEY = 'th_tracker_view';/);
  const loadFn = extractFn('loadJobViewMode');
  assert.match(loadFn, /localStorage\.getItem\(JOB_VIEW_KEY\)/);
});

test('the active switch button reflects the current mode via is-active and aria-pressed, and only known modes are accepted', () => {
  const fnSrc = extractFn('applyJobViewMode');
  assert.match(fnSrc, /btn\.dataset\.view === mode/);
  assert.match(fnSrc, /setAttribute\('aria-pressed', on \? 'true' : 'false'\)/);
  assert.match(HTML, /const JOB_VIEW_MODES = \['list', 'board', 'calendar'\];/);
  const loadFn = extractFn('loadJobViewMode');
  assert.match(loadFn, /JOB_VIEW_MODES\.includes\(v\) \? v : 'list'/);
});

test('the tools service worker cache was bumped for this change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 83, `expected v83 or later, got v${version}`);
});
