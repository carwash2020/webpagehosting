// Workspace rework part 9 (2026-09-23): On the clock. Start a job's clock
// (job detail, the Jobs list's sheet, the Dashboard's Next job) and a bar
// with the time ticking follows you to every page. Stop saves the time onto
// the job -- hoursWorked, plus the visit in timeLog -- which is exactly what
// part 6's From this job panel turns into the invoice's Labor line.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const NAV = read('tools-nav-pwa.js');
const DIALOGS = read('tools-dialogs.js');
const SYNC = read('sync.js');
const JD = read('job-detail.html');
const JT = read('job-tracker.html');
const WS = read('workspace.html');
const INV = read('invoice-generator.html');
const CSS = read('styles-tools.css');
const RUNWAY = read('runway-dashboard.html');

function extractFn(src, name) {
  const start = src.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, 'expected function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const CLOCK_SECTION = NAV.slice(NAV.indexOf('// ON THE CLOCK'), NAV.indexOf('// DISPLAY DENSITY TOGGLE'));
const MIN = 60 * 1000;
const T0 = new Date('2026-09-23T09:00:00').getTime();

// The data layer in a vm with an in-memory localStorage; events and the
// relational mirror are recorded.
function dataLayer(store) {
  const mem = {};
  Object.keys(store || {}).forEach(k => { mem[k] = JSON.stringify(store[k]); });
  const events = [], mirrored = [];
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN,
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    window: { dispatchEvent: (e) => events.push(e) },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    mirrorJobsToRelational: (jobs) => mirrored.push(jobs.length),
  };
  vm.createContext(ctx);
  vm.runInContext(DL.replace(/^const /gm, 'var ') + '\n;this.api = { thJobClockSince, thJobClockElapsedMs, thRunningJobClock, thClockHours, thStartJobClock, thStopJobClock, thUndoStopJobClock, thFinishJob, TH_KEYS };', ctx);
  const jobs = () => JSON.parse(mem.th_tracker_jobs || '[]');
  return { api: ctx.api, mem, jobs, events, mirrored };
}
function shellFormat() {
  const ctx = { Math, Number, String };
  vm.createContext(ctx);
  vm.runInContext(['thFormatClock', 'thClockDuration', 'thClockHoursLabel'].map(n => extractFn(CLOCK_SECTION, n)).join('\n') + ';this.api = { thFormatClock, thClockDuration, thClockHoursLabel };', ctx);
  return ctx.api;
}

test('the clock reads the job: running since, elapsed, the latest running one, and hours rounded to 0.1 h (under a minute is a mis-tap)', () => {
  const { thJobClockSince, thJobClockElapsedMs, thRunningJobClock, thClockHours } = dataLayer().api;
  const since = new Date(T0).toISOString();
  assert.equal(thJobClockSince({ clockSince: since }), T0);
  assert.equal(thJobClockSince({ clockSince: null }), null);
  assert.equal(thJobClockSince({ clockSince: 'not a date' }), null);
  assert.equal(thJobClockElapsedMs({ clockSince: since }, T0 + 5 * MIN), 5 * MIN);
  assert.equal(thJobClockElapsedMs({}, T0), 0);
  const a = { id: 1, clockSince: since }, b = { id: 2, clockSince: new Date(T0 + MIN).toISOString() }, c = { id: 3 };
  assert.equal(thRunningJobClock([a, c, b]).id, 2, 'two running (a second device): the latest started is the one on screen');
  assert.equal(thRunningJobClock([c]), null);
  assert.deepEqual([59e3, 61e3, 3 * MIN, 84 * MIN, 90 * MIN].map(thClockHours), [0, 0.1, 0.1, 1.4, 1.5]);
});

test('the bar and the sheet say it like a stopwatch and like a person', () => {
  const { thFormatClock, thClockDuration, thClockHoursLabel } = shellFormat();
  assert.deepEqual([7e3, 760e3, 3909e3].map(thFormatClock), ['0:07', '12:40', '1:05:09']);
  assert.deepEqual([45 * MIN, 60 * MIN, 85 * MIN].map(thClockDuration), ['45 min', '1 h', '1 h 25 min']);
  assert.deepEqual([1.4, 2, 0.25].map(thClockHoursLabel), ['1.4 h', '2 h', '0.25 h']);
});

test('Start: the job goes In progress, the clock runs, and starting another job stops the first with its time kept', () => {
  const dl = dataLayer({ th_tracker_jobs: [{ id: 1, title: 'Sink leak', status: 'not-started' }, { id: 2, title: 'Fence', status: 'in-progress', hoursWorked: 1 }] });
  const r = dl.api.thStartJobClock(1, T0);
  assert.equal(r.stopped, null);
  let [j1] = dl.jobs();
  assert.equal(j1.clockSince, new Date(T0).toISOString());
  assert.equal(j1.status, 'in-progress', 'starting the clock is starting the job');
  assert.equal(j1.statusChangedAt, j1.clockSince);
  assert.equal(dl.events[0].type, 'th-clock-change');
  assert.equal(dl.mirrored.length, 1, 'status is a relational column, so the mirror runs');
  assert.equal(dl.api.thStartJobClock(1, T0 + MIN).stopped, null, 'already running: a second Start changes nothing');
  assert.equal(dl.jobs()[0].clockSince, new Date(T0).toISOString());

  const r2 = dl.api.thStartJobClock(2, T0 + 84 * MIN);
  assert.equal(r2.stopped.job.id, 1);
  assert.equal(r2.stopped.hours, 1.4);
  const [a, b] = dl.jobs();
  assert.equal(a.clockSince, null, 'null, not deleted: the sync merge is per field');
  assert.equal(a.hoursWorked, 1.4);
  assert.deepEqual(a.timeLog, [{ start: new Date(T0).toISOString(), end: new Date(T0 + 84 * MIN).toISOString(), hours: 1.4 }]);
  assert.equal(b.clockSince, new Date(T0 + 84 * MIN).toISOString());
  assert.equal(b.status, 'in-progress', 'an in-progress job stays as it was');
});

test('Stop: the time lands on hoursWorked and timeLog; Undo puts it all back; under a minute adds nothing', () => {
  const dl = dataLayer({ th_tracker_jobs: [{ id: 7, title: 'Deck', status: 'in-progress', hoursWorked: 2, timeLog: [{ start: 'a', end: 'b', hours: 2 }], clockSince: new Date(T0).toISOString() }] });
  const r = dl.api.thStopJobClock(7, T0 + 45 * MIN);
  assert.equal(r.hours, 0.8);
  assert.equal(r.totalHours, 2.8);
  assert.equal(r.ms, 45 * MIN);
  let [j] = dl.jobs();
  assert.equal(j.hoursWorked, 2.8);
  assert.equal(j.timeLog.length, 2);
  assert.equal(j.clockSince, null);
  assert.equal(dl.api.thStopJobClock(7, T0 + 50 * MIN), null, 'nothing running, nothing to stop');

  assert.equal(dl.api.thUndoStopJobClock(7, r.undo), true);
  [j] = dl.jobs();
  assert.equal(j.clockSince, new Date(T0).toISOString(), 'still running from when it really started');
  assert.equal(j.hoursWorked, 2);
  assert.equal(j.timeLog.length, 1);

  const quick = dl.api.thStopJobClock(7, T0 + 40e3);
  assert.equal(quick.hours, 0);
  [j] = dl.jobs();
  assert.equal(j.hoursWorked, 2);
  assert.equal(j.timeLog.length, 1);
  assert.equal(j.clockSince, null);
});

test('Done from the clock\'s sheet stops a running clock first, so no time is lost', () => {
  const dl = dataLayer({ th_tracker_jobs: [{ id: 3, title: 'Tile', status: 'in-progress', clockSince: new Date(T0).toISOString() }] });
  dl.api.thFinishJob(3, T0 + 90 * MIN);
  const [j] = dl.jobs();
  assert.equal(j.status, 'done');
  assert.equal(j.statusChangedAt, new Date(T0 + 90 * MIN).toISOString());
  assert.equal(j.hoursWorked, 1.5);
  assert.equal(j.clockSince, null);
});

test('a clock started on the phone survives the sync merge next to another device\'s edit of the same job', () => {
  const ctx = { Object, Map, Set, Array, Date, Math, JSON, String };
  vm.createContext(ctx);
  vm.runInContext(extractFn(SYNC, 'deepEqualValue') + extractFn(SYNC, 'mergeRecordArrays') + ';this.merge = mergeRecordArrays;', ctx);
  const base = [{ id: 1, title: 'Sink', status: 'not-started', notes: '', clockSince: null }];
  const local = [{ id: 1, title: 'Sink', status: 'in-progress', notes: '', clockSince: '2026-09-23T09:00:00.000Z' }];
  const remote = [{ id: 1, title: 'Sink', status: 'not-started', notes: 'Gate code 4411', clockSince: null }];
  const [merged] = ctx.merge(local, remote, 'id', base, []);
  assert.equal(merged.clockSince, '2026-09-23T09:00:00.000Z');
  assert.equal(merged.status, 'in-progress');
  assert.equal(merged.notes, 'Gate code 4411');
});

test('the hours it saved are the invoice\'s Labor line (part 6\'s From this job panel)', () => {
  const dl = dataLayer({ th_tracker_jobs: [{ id: 9, title: 'Disposal', status: 'in-progress', clockSince: new Date(T0).toISOString() }] });
  dl.api.thStopJobClock(9, T0 + 84 * MIN);
  const ctx = { Number, Math, String, Date, isNaN, money: (n) => '$' + n };
  vm.createContext(ctx);
  vm.runInContext(extractFn(INV, 'jobFillShortDate') + extractFn(INV, 'jobBillables') + ';this.jobBillables = jobBillables;', ctx);
  const out = ctx.jobBillables(dl.jobs()[0], [], [], { labor: 85, mileage: '' });
  const lines = out.lines || out;
  const labor = lines.find(l => l.key === 'labor');
  assert.equal(labor.qty, 1.4);
  assert.equal(labor.price, 85);
  assert.match(labor.note, /1\.4 h logged/);
});

// --- the bar on every page -------------------------------------------------

function page(url, { jobs, dataLayer: withDL = true, setup } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hub-header"><div class="hub-header-right"></div></div></body></html>', {
    runScripts: 'dangerously', url,
    beforeParse(w) {
      w.localStorage.setItem('th_tracker_jobs', JSON.stringify(jobs || []));
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.Element.prototype.scrollIntoView = function () {};
      w.sheets = [];
      w.showQuickActionSheet = (title, actions, options) => w.sheets.push({ title, actions, labels: Array.from(actions, a => a.label), options });
      if (setup) setup(w);
    },
  });
  const w = dom.window;
  for (const src of (withDL ? [DL, NAV] : [NAV])) { const s = w.document.createElement('script'); s.textContent = src; w.document.body.appendChild(s); }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
const running = (mins) => ({ id: 42, title: 'Sink leak', client: 'Sarah Miller', status: 'in-progress', hoursWorked: 1.5, clockSince: new Date(Date.now() - mins * MIN).toISOString() });

test('while a clock runs, every page shows the bar: the job, the client, the time ticking, Stop -- and a tap opens the job', () => {
  const w = page('https://example.com/tools/finance.html', { jobs: [running(65)] });
  const bar = w.document.getElementById('thClock');
  assert.ok(bar && !bar.hidden);
  assert.equal(bar.querySelector('.th-clock-title').textContent, 'Sink leak · Sarah Miller');
  assert.match(bar.querySelector('.th-clock-time').textContent, /^1:05:0\d$/);
  assert.equal(bar.querySelector('.th-clock-main').getAttribute('href'), '/tools/job-detail.html?id=42');
  assert.equal(bar.querySelector('.th-clock-stop').getAttribute('aria-label'), 'Stop the clock on Sink leak');
  assert.ok(w.document.body.classList.contains('th-has-clock'));
  w.close();
  const idle = page('https://example.com/tools/finance.html', { jobs: [{ id: 1, title: 'x', status: 'in-progress' }] });
  assert.equal(idle.document.getElementById('thClock'), null, 'no clock, no bar');
  idle.close();
  const own = page('https://example.com/tools/job-detail.html?id=42', { jobs: [running(5)] });
  const ownBar = own.document.getElementById('thClock');
  assert.ok(!ownBar || ownBar.hidden, 'the job\'s own page has its own, bigger clock');
  own.close();
  const bare = page('https://example.com/tools/route-planner.html', { jobs: [running(5)], dataLayer: false });
  assert.ok(!bare.document.getElementById('thClock').hidden, 'a page without data-layer.js still shows it, read from storage');
  bare.close();
});

test('Stop saves the time, then asks what\'s next: Done -- create the invoice, Mark it done, Keep the clock running, or Not done yet', () => {
  const w = page('https://example.com/tools/finance.html', { jobs: [running(84)] });
  w.document.querySelector('.th-clock-stop').click();
  let job = JSON.parse(w.localStorage.getItem('th_tracker_jobs'))[0];
  assert.equal(job.clockSince, null);
  assert.equal(job.hoursWorked, 2.9, '1.5 h already on it + 1.4 h');
  assert.equal(w.document.getElementById('thClock').hidden, true, 'the bar goes as soon as the clock stops');
  const sheet = w.sheets[0];
  assert.match(sheet.title, /^<span class="th-clock-sheet-head"><strong>1 h 2[34] min<\/strong>on Sink leak<\/span><span class="th-clock-sheet-sub">Added 1\.4 h &middot; 2\.9 h on this job so far<\/span>$/);
  assert.deepEqual(sheet.labels, ['Done &mdash; create the invoice', 'Mark it done', 'Keep the clock running']);
  assert.equal(sheet.options.cancelLabel, 'Not done yet');

  sheet.actions[2].onClick(); // Keep the clock running
  job = JSON.parse(w.localStorage.getItem('th_tracker_jobs'))[0];
  assert.ok(job.clockSince, 'running again, from when it first started');
  assert.equal(job.hoursWorked, 1.5);
  assert.equal(w.document.getElementById('thClock').hidden, false);

  w.document.querySelector('.th-clock-stop').click();
  w.sheets[1].actions.find(a => a.label === 'Mark it done').onClick();
  job = JSON.parse(w.localStorage.getItem('th_tracker_jobs'))[0];
  assert.equal(job.status, 'done');
  assert.equal(job.hoursWorked, 2.9);
  w.close();

  const noInvoice = page('https://example.com/tools/finance.html', { jobs: [running(30)], setup: (win) => { win.canManageInvoices = () => false; win.getCurrentUserRole = () => ({ role: 'tech' }); } });
  noInvoice.document.querySelector('.th-clock-stop').click();
  assert.deepEqual(noInvoice.sheets[0].labels, ['Mark it done', 'Keep the clock running'], 'no invoice permission, no invoice button');
  noInvoice.close();
});

test('the Stop sheet\'s Cancel says what it means (showQuickActionSheet cancelLabel), and defaults to Cancel everywhere else', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'dangerously' });
  const w = dom.window;
  w.requestAnimationFrame = (f) => f();
  const s = w.document.createElement('script'); s.textContent = DIALOGS; w.document.body.appendChild(s);
  w.showQuickActionSheet('T', [{ label: 'A', onClick() {} }]);
  assert.equal(w.document.querySelector('.quick-actions-cancel').textContent, 'Cancel');
  w.document.querySelector('.quick-actions-overlay').remove();
  w.showQuickActionSheet('T', [{ label: 'A', onClick() {} }], { cancelLabel: 'Not done yet' });
  assert.equal(w.document.querySelector('.quick-actions-cancel').textContent, 'Not done yet');
  w.close();
});

// --- where you start it ---------------------------------------------------

test('Job detail: a big clock with Stop while it runs, Start the clock while it doesn\'t, nothing on a done job, and a Time section for each visit', () => {
  const ctx = {
    Date, Math, Number, String, Array,
    escapeHtml: (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    thStartClock() {}, thJobClockSince: (j) => (j.clockSince ? new Date(j.clockSince).getTime() : null),
    thJobClockElapsedMs: (j) => Date.now() - new Date(j.clockSince).getTime(),
  };
  vm.createContext(ctx);
  vm.runInContext(['thFormatClock', 'thClockHoursLabel'].map(n => extractFn(CLOCK_SECTION, n)).join('\n') + extractFn(JD, 'jobClockHtml') + extractFn(JD, 'jobTimeSectionHtml') + ';this.api = { jobClockHtml, jobTimeSectionHtml };', ctx);
  const { jobClockHtml, jobTimeSectionHtml } = ctx.api;
  const on = jobClockHtml({ status: 'in-progress', hoursWorked: 1.5, clockSince: new Date(Date.now() - 10 * MIN).toISOString() });
  assert.match(on, /class="job-clock is-running"/);
  assert.match(on, /<span class="job-clock-time">10:0\d<\/span>/);
  assert.match(on, /On the clock since .+ &middot; 1\.5 h before this/);
  assert.match(on, /onclick="stopJobClockHere\(\)">.*Stop<\/button>/);
  const off = jobClockHtml({ status: 'not-started' });
  assert.match(off, /onclick="startJobClockHere\(\)">.*Start the clock<\/button>/);
  assert.match(off, /the invoice&rsquo;s labor line fills itself in/);
  assert.match(jobClockHtml({ status: 'in-progress', hoursWorked: 2 }), /<strong>2 h<\/strong> logged so far\./);
  assert.equal(jobClockHtml({ status: 'done' }), '');
  const time = jobTimeSectionHtml({ timeLog: [
    { start: '2026-09-22T15:02:00Z', end: '2026-09-22T16:26:00Z', hours: 1.4 },
    { start: '2026-09-23T15:00:00Z', end: '2026-09-23T15:30:00Z', hours: 0.5 },
  ] });
  assert.match(time, /Time \(2 visits &middot; 1\.9 h\)/);
  assert.ok(time.indexOf('0.5 h') < time.indexOf('1.4 h'), 'newest visit first');
  assert.equal(jobTimeSectionHtml({}), '');
  assert.match(JD, /jobTrackHtml\(bundle, allowed\) \+\n\s*jobClockHtml\(j\) \+/);
  assert.match(JD, /window\.addEventListener\('th-clock-change', onJobRealtimeChange\);/);
});

test('Job detail keeps its loaded photos across a re-render (live sync, and now Start / Stop) instead of going back to Loading...', () => {
  const fn = extractFn(JD, 'renderJobDetail');
  assert.match(fn, /const loadedPhotos = oldGrid && oldGrid\.dataset\.loaded \? oldGrid\.innerHTML : null;/);
  assert.match(fn, /grid\.innerHTML = loadedPhotos;/);
  assert.match(extractFn(JD, 'loadPhotosReadOnly'), /await fillPhotosReadOnly\(jobId\);[\s\S]*grid\.dataset\.loaded = '1';/);
});

test('Jobs list: the sheet leads with Start / Stop the clock, the row says On the clock, and Mark Done stops a running clock first', () => {
  let shown = null;
  const stub = {
    loadJobs: () => jobs, escapeHtml: (v) => v, showQuickActionSheet: (t, a) => { shown = a.map(x => x.label); },
    thJobClockSince: (j) => (j.clockSince ? 1 : null), thJobClockElapsedMs: () => 65 * MIN, thStartClock() {}, thStopClock() {},
    setJobStatus() {}, document: { getElementById: () => null }, location: {},
  };
  const jobs = [{ id: 1, title: 'A', status: 'not-started' }, { id: 2, title: 'B', status: 'in-progress', clockSince: 'x' }, { id: 3, title: 'C', status: 'done' }];
  const ctx = Object.assign({ Math, String, Number }, stub);
  vm.createContext(ctx);
  vm.runInContext(extractFn(CLOCK_SECTION, 'thFormatClock') + extractFn(JT, 'openJobActions') + extractFn(JT, 'jobClockBadgeHtml') + ';this.api = { openJobActions, jobClockBadgeHtml };', ctx);
  ctx.api.openJobActions(1); assert.equal(shown[0], 'Start the clock');
  ctx.api.openJobActions(2); assert.equal(shown[0], 'Stop the clock (1:05:00)');
  ctx.api.openJobActions(3); assert.ok(!shown.some(l => /clock/.test(l)), 'a done job: no clock');
  assert.match(ctx.api.jobClockBadgeHtml(jobs[1]), /class="badge badge-clock"[\s\S]*On the clock/);
  assert.equal(ctx.api.jobClockBadgeHtml(jobs[0]), '');
  assert.match(JT, /const moneyPillHtml = jobClockBadgeHtml\(job\) \+ jobMoneyPillHtml\(job, marginData\);/);

  const calls = [];
  const store = [{ id: 5, title: 'E', status: 'in-progress', clockSince: 'x' }];
  const sctx = {
    loadJobs: () => JSON.parse(JSON.stringify(store)), saveJobs: (j) => calls.push(['save', j[0].status]), renderJobs() {},
    thJobClockSince: (j) => (j.clockSince ? 1 : null), thStopJobClock: (id) => { calls.push(['stop', id]); store[0].clockSince = null; },
    openJobDoneSheet: async () => calls.push(['sheet']), Date,
  };
  vm.createContext(sctx);
  vm.runInContext(extractFn(JT, 'setJobStatus') + ';this.setJobStatus = setJobStatus;', sctx);
  return sctx.setJobStatus(5, 'done').then(() => {
    assert.deepEqual(calls, [['stop', 5], ['save', 'done'], ['sheet']]);
  });
});

test('Dashboard: the Next job card has Start the clock (Stop while it runs), and re-renders when a clock changes', () => {
  const fn = extractFn(WS, 'renderTodayHero');
  assert.match(fn, /data-clock-action="stop"><svg[\s\S]*Stop the clock<\/button>/);
  assert.match(fn, /data-clock-action="start"><svg[\s\S]*Start the clock<\/button>/);
  assert.match(fn, /if \(btn\.dataset\.clockAction === 'stop'\) thStopClock\(btn\.dataset\.clockJob\);\s*else thStartClock\(btn\.dataset\.clockJob\);/);
  assert.match(fn, /\$\{clockOn \? 'On the clock' : 'Next Job'\}/);
  assert.match(WS, /window\.addEventListener\('th-clock-change', (?:renderTodayHero\)|\(\) => \{ renderTodayHero\(\);)/, 'the Next job card re-renders (part 11 re-renders Your week alongside)');
});

test('the bar\'s look: clear of the bottom bar on a phone, bottom-right on a computer, pulsing dot off under reduced motion; mirrored on the Runway Dashboard; icons in the sprite', () => {
  for (const src of [CSS, RUNWAY]) {
    assert.match(src, /\.th-clock \{[\s\S]*?bottom: calc\(94px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    assert.match(src, /\.th-clock-time \{[^}]*font-variant-numeric: tabular-nums;/);
    assert.match(src, /@media \(prefers-reduced-motion: reduce\) \{ \.th-clock-dot \{ animation: none; \} \}/);
    assert.match(src, /\.th-clock \{ left: auto; right: 24px; bottom: 20px; width: 360px; \}/);
    assert.match(src, /body\.th-has-bottomnav\.th-has-clock \{ padding-bottom: calc\(158px/);
  }
  for (const id of ['clock', 'play', 'stop']) assert.match(NAV, new RegExp('<symbol id="icon-' + id + '"'));
});
