// Calendar folded into Job Tracker (2026-09-21). calendar.html was a
// second page over the same th_tracker_jobs data, reachable only from
// the nav, and it filtered on a per-job "Show on Calendar" flag that
// hid work by default and disagreed with the Dashboard's own Today
// hero (which never applied the flag). It is now the third view next
// to List and Board -- same page, same job list, one persisted
// preference -- and calendar.html is a redirect stub like
// job-cost-lookup.html. These tests lock in the merge and the nav
// changes that came with it (Calendar left the bottom bar; Clients
// took the slot).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');
const JT = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
const STUB = fs.readFileSync(path.join(TOOLS_DIR, 'calendar.html'), 'utf8');
const NAV = fs.readFileSync(path.join(TOOLS_DIR, 'tools-nav-pwa.js'), 'utf8');
const TOUR = fs.readFileSync(path.join(TOOLS_DIR, 'tools-tour.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, 'manifest.json'), 'utf8'));
const CHECK = fs.readFileSync(repo('scripts', 'check-consistency.js'), 'utf8');

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

const SAMPLE_JOBS = [
  { id: 1, title: 'Fix Fridge', client: 'Alice', status: 'not-started', priority: 'high', date: '2026-09-10', showOnCalendar: false },
  { id: 2, title: 'AC Repair', client: 'Bob', status: 'in-progress', priority: 'medium', date: '2026-09-10', showOnCalendar: true },
  { id: 3, title: 'Old Done Job', client: 'Carla', status: 'done', priority: 'low', date: '2026-09-03', showOnCalendar: true },
  { id: 4, title: 'No Date Yet', client: 'Dan', status: 'not-started', priority: 'low', date: '' },
];

// Loads the real page with its real shared scripts and drives the same
// functions the page's own init calls, minus the network-bound parts.
function loadJobTracker(jobs, url) {
  const dom = new JSDOM(JT, {
    runScripts: 'dangerously', url: url || 'https://example.com/tools/job-tracker.html',
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
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(TOOLS_DIR, name), 'utf8');
    window.document.head.appendChild(s);
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.applyJobViewMode();
  window.renderJobs();
  return window;
}

// The page's init kicks off refreshBookingsCache().then(renderCalendarView)
// (a stubbed, immediately-rejecting fetch here); awaiting a macrotask lets
// that settle inside the test instead of firing after it ends.
const settle = () => new Promise(r => setTimeout(r, 20));

test('Job Tracker has a three-way view switch (List / Board / Calendar) and a calendar wrapper inside the Jobs tab, with the old page\'s ids intact', () => {
  assert.match(JT, /id="jobViewSwitch"/);
  for (const v of ['list', 'board', 'calendar']) assert.match(JT, new RegExp(`data-view="${v}" onclick="setJobViewMode\\('${v}'\\)"`));
  const jobsTab = JT.slice(JT.indexOf('id="tab-jobs"'), JT.indexOf('id="tab-contacts"'));
  for (const id of ['jobsCalendarWrap', 'calMonthLabel', 'calDowRow', 'calGrid', 'calDetailHeading', 'calDayJobs', 'calDowDensity']) {
    assert.match(jobsTab, new RegExp('id="' + id + '"'), `${id} should live inside the Jobs tab`);
  }
  assert.match(JT, /const JOB_VIEW_MODES = \['list', 'board', 'calendar'\];/);
});

test('the view preference persists per device under the existing key, and only known modes are accepted', async () => {
  const w = loadJobTracker(SAMPLE_JOBS);
  assert.equal(w.loadJobViewMode(), 'list');
  w.setJobViewMode('calendar');
  assert.equal(w.localStorage.getItem('th_tracker_view'), 'calendar');
  assert.equal(w.document.getElementById('jobsCalendarWrap').style.display, '');
  assert.equal(w.document.getElementById('jobsList').style.display, 'none');
  assert.equal(w.document.getElementById('jobsBoardWrap').style.display, 'none');
  assert.equal(w.document.getElementById('statusFilterGroup').style.display, 'none');
  assert.equal(w.document.querySelector('#jobViewSwitch .is-active').dataset.view, 'calendar');
  assert.equal(w.location.hash, '#calendar');
  w.localStorage.setItem('th_tracker_view', 'nonsense');
  assert.equal(w.loadJobViewMode(), 'list');
  w.setJobViewMode('board');
  assert.equal(w.document.getElementById('jobsBoardWrap').style.display, '');
  assert.equal(w.location.hash, '#jobs');
  await settle();
});

test('the calendar shows every dated job regardless of the old Show on Calendar flag, skips undated ones, and grays out done jobs', async () => {
  const w = loadJobTracker(SAMPLE_JOBS);
  w.viewYear = 2026; w.viewMonth = 8; // September 2026
  w.setJobViewMode('calendar');
  const dots = [...w.document.querySelectorAll('#calGrid .cal-day-dot')];
  assert.equal(dots.length, 3, 'three dated jobs -> three dots; the undated job gets none');
  assert.ok(dots.some(d => d.classList.contains('is-done')), 'done job renders as a gray dot');
  w.selectDay('2026-09-10');
  const titles = [...w.document.querySelectorAll('#calDayJobs .cal-job-title')].map(e => e.textContent.trim());
  assert.deepEqual(titles.sort(), ['AC Repair', 'Fix Fridge'], 'the flag=false job is on the calendar too');
  assert.equal(w.document.querySelectorAll('#calDayJobs button[onclick^="downloadJobIcs"]').length, 2);
  assert.match(w.document.getElementById('calDetailHeading').textContent, /September 10, 2026/);
  await settle();
});

test('the calendar honors the same search box as the list (one page, one filter)', async () => {
  const w = loadJobTracker(SAMPLE_JOBS);
  w.viewYear = 2026; w.viewMonth = 8;
  w.document.getElementById('jobSearch').value = 'alice';
  w.renderJobs();
  assert.equal(w.document.querySelectorAll('#calGrid .cal-day-dot').length, 1);
  await settle();
});

test('the Show on Calendar checkbox, card toggle, and toggle function are gone; new jobs still write showOnCalendar: true so the relational mirror stays consistent', () => {
  assert.doesNotMatch(JT, /jobShowOnCalendar|toggleShowOnCalendar|Show this job on the Calendar tool|On Calendar' : 'Show/);
  const addFn = extractFn(JT, 'addJob');
  assert.match(addFn, /jobs\.push\(\{ id: newId, \.\.\.fields, showOnCalendar: true,/);
  assert.doesNotMatch(addFn, /showOnCalendar: document/);
  // sync.js still mirrors the field -- nothing about storage changed.
  const sync = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
  assert.match(sync, /show_on_calendar: !!j\.showOnCalendar/);
});

test('#calendar deep link opens the calendar view on the Jobs tab; the redirect stub and the PWA shortcut both use it', () => {
  const init = JT.slice(JT.indexOf("if (initialHash === 'calendar')"));
  assert.match(init, /setJobViewMode\('calendar'\)/);
  assert.match(STUB, /<meta http-equiv="refresh" content="0; url=\/tools\/job-tracker\.html#calendar">/);
  assert.match(STUB, /location\.replace\('\/tools\/job-tracker\.html#calendar'\)/);
  assert.match(STUB, /requireAuth\(\)/, 'the stub keeps the login gate like the other stubs');
  assert.doesNotMatch(STUB, /<link[^>]*rel="stylesheet"/, 'a redirect stub loads no stylesheet');
  const shortcut = MANIFEST.shortcuts.find(sc => sc.name === 'Calendar');
  assert.equal(shortcut.url, '/tools/job-tracker.html#calendar');
  assert.match(CHECK, /'calendar\.html': 'retired 2026-09-21/);
});

test('bookings still merge into the calendar as purple dots, with live updates, and the month swipe gesture rides inside the tab swipe handler', () => {
  assert.match(JT, /async function refreshBookingsCache\(\)/);
  assert.match(JT, /startBookingsRealtime\(\(\) => \{ refreshBookingsCache\(\)/);
  assert.match(JT, /startedOnCalGrid = !!\(e\.target\.closest && e\.target\.closest\('#calGrid'\)\)/);
  assert.match(JT, /if \(startedOnCalGrid\) \{\s*changeMonth\(dx < 0 \? 1 : -1\);/);
  assert.match(JT, /\.cal-day-dot\.is-booking \{ background: #b083f0; \}/);
});

test('the .ics export survives the move: RFC 5545 all-day event with escaped text', async () => {
  assert.match(JT, /function downloadJobIcs\(jobId\)/);
  assert.match(JT, /'DTSTART;VALUE=DATE:' \+ icsDateNoDash\(job\.date\)/);
  assert.match(JT, /'DTEND;VALUE=DATE:' \+ icsDatePlusOneDay\(job\.date\)/);
  const w = loadJobTracker(SAMPLE_JOBS);
  assert.equal(w.icsEscape('a,b;c\\d\nline'), 'a\\,b\\;c\\\\d\\nline');
  assert.equal(w.icsDatePlusOneDay('2026-09-30'), '20261001');
  await settle();
});

test('the nav lost Calendar and the phone bar gained Clients (13 sidebar destinations, 5 in the bar)', () => {
  const dests = NAV.match(/var DESTS = \[([\s\S]*?)\];/)[1];
  const labels = [...dests.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(labels, ['Home', 'Jobs', 'Clients', 'Invoices', 'Finance']);
  const sidebar = NAV.match(/var SIDEBAR_DESTS = \[([\s\S]*?)\];/)[1];
  assert.equal((sidebar.match(/href: '/g) || []).length, 13);
  assert.doesNotMatch(NAV, /\/tools\/calendar\.html/);
  assert.doesNotMatch(TOUR, /\/tools\/calendar\.html/, 'the tour no longer visits a redirect stub');
  assert.match(TOUR, /Switch between List, Board, and Calendar/);
});
