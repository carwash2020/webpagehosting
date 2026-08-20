// Tests for the desktop board/table view on Job Tracker (2026-08-20),
// requested directly: board-style like Monday.com, but for the
// existing tools already built here. Reuses the exact same filtered
// data as the mobile card list -- both are always in sync, CSS just
// decides which one is visible.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');
const JOB_TRACKER_PATH = path.join(TOOLS_DIR, 'job-tracker.html');

const SAMPLE_JOBS = [
  { id: 1, title: 'Fix Fridge', client: 'Alice', status: 'not-started', priority: 'high', date: '2026-08-20', phone: '555-1111', address: '1 Main St' },
  { id: 2, title: 'AC Repair', client: 'Bob', status: 'in-progress', priority: 'medium', date: '2026-08-18', phone: '555-2222', address: '2 Oak Ave' },
  { id: 3, title: 'Dishwasher Install', client: 'Carla', status: 'done', priority: 'low', date: '2026-08-15', phone: '555-3333', address: '3 Elm Rd' },
];

// Loads the real page with every real shared script it actually uses,
// then manually drives init (renderJobs + initJobsTableSort) rather
// than relying on the page's own DOMContentLoaded handler completing
// end-to-end -- that handler depends on real Supabase connectivity
// this test environment doesn't have, unrelated to what's being tested
// here. renderJobs() and initJobsTableSort() are the exact same real
// functions the real page calls; this just calls them directly.
function loadJobTracker(jobs) {
  const html = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/job-tracker.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, scale(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, fillRect(){}, arc(){}, arcTo(){}, closePath(){}, createLinearGradient(){ return { addColorStop(){} }; }, setLineDash(){},
      });
      w.localStorage.setItem('th_tracker_jobs', JSON.stringify(jobs));
    },
  });
  const { window } = dom;
  window.getCurrentUserEmail = () => null;
  window.pullSync = () => Promise.resolve({ ok: false });
  for (const name of ['data-layer.js', 'sync.js', 'tools-dialogs.js', 'tools-effects.js', 'tools-media-sharing.js', 'tools-nav-pwa.js', 'tools-tour.js']) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, name), 'utf8');
    const s = window.document.createElement('script');
    s.textContent = src;
    window.document.head.appendChild(s);
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.renderJobs();
  window.initJobsTableSort();
  return window;
}

test('the table is hidden by default and only shown at min-width:1024px -- mobile\'s card list is completely unaffected', () => {
  const css = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const baseRule = css.match(/\.jobs-table-wrap \{([^}]*)\}/)[1];
  assert.match(baseRule, /display:\s*none/);
  assert.match(css, /@media \(min-width: 1024px\) \{ \.jobs-table-wrap \{ display: block/);
});

test('the table renders the same filtered jobs as the mobile card list, from the exact same data', () => {
  const window = loadJobTracker(SAMPLE_JOBS);
  const tableRows = window.document.querySelectorAll('#jobsTableBody tr');
  const cardCount = window.document.querySelectorAll('.job-card').length;
  // Default filter is "not-done" -- 2 of the 3 sample jobs, matching
  // the existing, unchanged mobile filter logic.
  assert.equal(tableRows.length, 2);
  assert.equal(cardCount, 2);
});

test('clicking a sortable column header sorts the table, and clicking it again reverses the sort', () => {
  const window = loadJobTracker(SAMPLE_JOBS);
  window.document.querySelector('th[data-sort-key="title"]').click();
  let titles = [...window.document.querySelectorAll('#jobsTableBody tr')].map(r => r.querySelector('.jt-title-link').textContent);
  assert.deepEqual(titles, ['AC Repair', 'Fix Fridge']);
  assert.equal(window.document.querySelector('th[data-sort-key="title"]').classList.contains('is-sorted'), true);

  window.document.querySelector('th[data-sort-key="title"]').click();
  titles = [...window.document.querySelectorAll('#jobsTableBody tr')].map(r => r.querySelector('.jt-title-link').textContent);
  assert.deepEqual(titles, ['Fix Fridge', 'AC Repair']);
  assert.equal(window.document.querySelector('th[data-sort-key="title"]').classList.contains('is-sorted-desc'), true);
});

test('sorting by priority orders by severity (high before medium before low), not alphabetically', () => {
  const window = loadJobTracker(SAMPLE_JOBS);
  window.document.querySelector('th[data-sort-key="priority"]').click();
  const priorities = [...window.document.querySelectorAll('#jobsTableBody tr')].map(r => r.querySelector('td:nth-child(4) .badge').textContent);
  assert.deepEqual(priorities, ['high', 'medium']);
});

test('each row shows the correct status badge class, matching the existing badge-status/status-X classes already used by the mobile card list', () => {
  const window = loadJobTracker(SAMPLE_JOBS);
  const row = [...window.document.querySelectorAll('#jobsTableBody tr')].find(r => r.querySelector('.jt-title-link').textContent === 'AC Repair');
  const statusBadge = row.querySelector('.badge-status');
  assert.match(statusBadge.className, /status-in-progress/);
  assert.equal(statusBadge.textContent, 'In Progress');
});

test('clicking "All" to include completed jobs shows the margin cell correctly for a done job with no invoice (an em-dash, not a crash)', () => {
  const window = loadJobTracker(SAMPLE_JOBS);
  window.setStatusFilter('all');
  const row = [...window.document.querySelectorAll('#jobsTableBody tr')].find(r => r.querySelector('.jt-title-link').textContent === 'Dishwasher Install');
  assert.ok(row, 'the done job should be visible under the All filter');
  const marginCell = row.querySelectorAll('td')[7];
  assert.match(marginCell.textContent, /—|&mdash;/);
});

test('the empty state (no jobs match the current filter/search) renders correctly in the table via a colspan row, not silently blank', () => {
  const window = loadJobTracker([]);
  const emptyRow = window.document.querySelector('#jobsTableBody tr td[colspan]');
  assert.ok(emptyRow, 'expected a colspan empty-state row in the table body');
  assert.match(emptyRow.textContent, /No jobs yet/);
});

test('the desktop sidebar and table both correctly coexist on this page without conflicting (the sidebar work from earlier this session)', () => {
  const window = loadJobTracker(SAMPLE_JOBS);
  assert.ok(window.document.querySelector('.th-desktop-sidebar'));
  assert.ok(window.document.querySelector('.jobs-table-wrap'));
});
