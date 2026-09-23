// Shift clock, part 2 (2026-09-23): Start my day / End my day in the app
// shell. A header button on a phone (a green pill with the start time while
// on shift, an amber dot when a shift needs an end time), a row under New in
// the desktop sidebar, and one sheet that opens in whichever mode the day is
// in. The data rules are part 1's (tests/tools/shift-clock.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const NAV = read('tools-nav-pwa.js');
const CSS = read('styles-tools.css');
const RUNWAY = read('runway-dashboard.html');

const STEVE = 'steve@triplehenterprisesllc.biz';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();
const timeLabel = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// A tools page with the shell (and, unless withDL is false, the data layer),
// signed in as Steve. Toasts, undo toasts and confirms are recorded.
function page(url, { shifts, jobs, withDL = true, signedIn = true, setup } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hub-header"><div class="hub-header-right"></div></div></body></html>', {
    runScripts: 'dangerously', url,
    beforeParse(w) {
      if (signedIn) w.localStorage.setItem('th_auth_session', JSON.stringify({ email: STEVE, access_token: 'x', expires_at: 1 }));
      w.localStorage.setItem('th_shift_log', JSON.stringify(shifts || []));
      w.localStorage.setItem('th_tracker_jobs', JSON.stringify(jobs || []));
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.requestAnimationFrame = (f) => f();
      w.toasts = [];
      w.showToast = (m) => w.toasts.push(m);
      w.undos = [];
      w.showUndoToast = (m, onUndo) => w.undos.push({ m, onUndo });
      w.showConfirm = () => Promise.resolve(true);
      // auth.js isn't loaded here; the data layer reads the stored session through this.
      w.getStoredSession = () => JSON.parse(w.localStorage.getItem('th_auth_session') || 'null');
      if (setup) setup(w);
    },
  });
  const w = dom.window;
  for (const src of (withDL ? [DL, NAV] : [NAV])) { const s = w.document.createElement('script'); s.textContent = src; w.document.body.appendChild(s); }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return w;
}
const stored = (w) => JSON.parse(w.localStorage.getItem('th_shift_log'));
const sheet = (w) => w.document.querySelector('.th-shift');
const act = (w, name) => w.document.querySelector('.th-shift [data-shift-act="' + name + '"]');

test('off: a clock button leads the header actions and a Start my day row sits under New in the sidebar', () => {
  const w = page('https://example.com/tools/job-tracker.html');
  const btn = w.document.getElementById('thShiftBtn');
  assert.ok(btn && !btn.hidden);
  assert.equal(btn.parentNode.className, 'th-hdr-actions');
  assert.equal(btn.parentNode.firstElementChild, btn, 'before Search and More');
  assert.equal(btn.className, 'th-hdr-btn th-hdr-shift is-off');
  assert.equal(btn.getAttribute('aria-label'), 'Start my day');
  assert.equal(btn.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(btn.querySelector('.th-hdr-shift-time'), null, 'no time while off');
  const row = w.document.getElementById('thShiftSide');
  assert.equal(row.previousElementSibling.className.split(' ')[0], 'th-sidebar-new');
  assert.match(row.textContent, /^Start my day$/);
  w.close();
});

test('on shift: a pill with the start time -- and the sidebar says since when', () => {
  const start = Date.now() - 2 * HOUR;
  const w = page('https://example.com/tools/finance.html', { shifts: [{ id: 's1', email: STEVE, start: iso(start), end: null, hours: null }] });
  const btn = w.document.getElementById('thShiftBtn');
  assert.equal(btn.className, 'th-hdr-btn th-hdr-shift is-on');
  assert.equal(btn.querySelector('.th-hdr-shift-time').textContent, timeLabel(start));
  assert.equal(btn.getAttribute('aria-label'), 'On shift since ' + timeLabel(start) + '. End my day');
  const row = w.document.getElementById('thShiftSide');
  assert.match(row.className, /is-on/);
  assert.equal(row.querySelector('.th-sidebar-shift-sub').textContent, 'since ' + timeLabel(start));
  w.close();
});

test('a shift left open past 14 h: an amber "needs an end time", not a pill counting all night', () => {
  const w = page('https://example.com/tools/job-tracker.html', { shifts: [{ id: 's1', email: STEVE, start: iso(Date.now() - 20 * HOUR), end: null, hours: null }] });
  const btn = w.document.getElementById('thShiftBtn');
  assert.equal(btn.className, 'th-hdr-btn th-hdr-shift is-due');
  assert.equal(btn.getAttribute('aria-label'), 'A shift needs an end time');
  assert.match(w.document.getElementById('thShiftSide').textContent, /Shift needs an end time/);
  w.close();
});

test('someone else\'s shift is not yours; signed out, nothing shows', () => {
  const w = page('https://example.com/tools/job-tracker.html', { shifts: [{ id: 's1', email: 'connor@triplehenterprisesllc.biz', start: iso(Date.now() - HOUR), end: null, hours: null }] });
  assert.match(w.document.getElementById('thShiftBtn').className, /is-off/);
  w.close();
  const out = page('https://example.com/tools/job-tracker.html', { signedIn: false });
  assert.equal(out.document.getElementById('thShiftBtn'), null);
  out.close();
});

test('a page without data-layer.js reads the status straight from storage, and its button opens the sheet on the Dashboard', () => {
  const start = Date.now() - HOUR;
  const w = page('https://example.com/tools/route-planner.html', { withDL: false, shifts: [{ id: 's1', email: STEVE, start: iso(start), end: null, hours: null }] });
  assert.equal(w.document.getElementById('thShiftBtn').querySelector('.th-hdr-shift-time').textContent, timeLabel(start));
  assert.equal(w.thShiftStatus(Date.now() + 15 * HOUR).state, 'due', 'the 14-hour rule holds without the data layer too');
  assert.equal(w.thShiftStatus().state, 'on');
  w.close();
  const dup = page('https://example.com/tools/settings.html', { withDL: false, shifts: [
    { id: 'a', email: STEVE, start: iso(start), end: null }, { id: 'b', email: STEVE, start: iso(start + MIN), end: null },
  ] });
  assert.equal(dup.thShiftStatus().state, 'due', 'two open shifts: one of them needs an end time');
  dup.close();
  const fn = NAV.slice(NAV.indexOf('function thOpenShiftSheet('), NAV.indexOf('function thOpenShiftSheet(') + 400);
  assert.match(fn, /if \(typeof thStartShift !== 'function' \|\| typeof thShiftEmail !== 'function'\) \{\s*window\.location\.href = '\/tools\/workspace\.html#shift';/);
});

test('Start my day: now, from the day\'s first job clock, or from a typed time; the header turns into the pill', () => {
  const jobs = [{ id: 7, title: 'Fence', status: 'in-progress', timeLog: [{ start: iso(Date.now() - 50 * MIN), end: iso(Date.now() - 20 * MIN), hours: 0.5 }] }];
  const w = page('https://example.com/tools/job-tracker.html', { jobs });
  w.document.getElementById('thShiftBtn').click();
  w.document.getElementById('thShiftBtn').click();
  assert.equal(w.document.querySelectorAll('.th-shift').length, 1, 'a double tap opens one sheet');
  const s = sheet(w);
  assert.ok(s, 'the sheet opens');
  assert.equal(w.document.getElementById('thShiftTitle').textContent, 'Start my day');
  assert.equal(s.querySelector('.th-shift-sheet').getAttribute('role'), 'dialog');
  assert.match(act(w, 'start').textContent, /^Start now · /);
  assert.equal(w.document.activeElement, act(w, 'start'), 'focus on the main button, not a field (no keyboard over the sheet)');
  assert.match(act(w, 'start-suggested').textContent, /when you started the clock on Fence/);
  act(w, 'start-suggested').click();
  const [shift] = stored(w);
  assert.equal(shift.start, jobs[0].timeLog[0].start);
  assert.equal(shift.startSource, 'job-clock');
  assert.match(w.toasts[0], /^Day started at /);
  assert.match(w.document.getElementById('thShiftBtn').className, /is-on/, 'th-shift-change re-renders the header');
  w.close();

  const typed = page('https://example.com/tools/job-tracker.html');
  typed.document.getElementById('thShiftBtn').click();
  act(typed, 'start-time').click();
  assert.equal(typed.document.querySelector('.th-shift-error').textContent, 'Pick the time you started.');
  const at = new Date(Date.now() - 90 * MIN);
  typed.document.querySelector('[data-shift-input="start-time"]').value = String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0');
  act(typed, 'start-time').click();
  assert.equal(new Date(stored(typed)[0].start).getMinutes(), at.getMinutes());
  assert.equal(stored(typed)[0].startSource, 'entered');
  typed.close();
});

test('End my day: saved at once with an Undo; a running job clock is mentioned, never stopped', () => {
  const start = Date.now() - 3 * HOUR;
  const jobs = [{ id: 9, title: 'Sink leak', status: 'in-progress', clockSince: iso(Date.now() - 40 * MIN) }];
  const w = page('https://example.com/tools/job-tracker.html', { jobs, shifts: [{ id: 's1', email: STEVE, start: iso(start), end: null, hours: null }] });
  w.document.getElementById('thShiftBtn').click();
  assert.equal(w.document.getElementById('thShiftTitle').textContent, 'Since ' + timeLabel(start));
  assert.match(sheet(w).querySelector('.th-shift-note').textContent, /The clock on Sink leak keeps running: ending your day doesn.t stop it\./);
  assert.equal(sheet(w).querySelector('.quick-actions-cancel').textContent, 'Keep working');
  act(w, 'end').click();
  assert.equal(stored(w)[0].hours, 3);
  assert.equal(JSON.parse(w.localStorage.getItem('th_tracker_jobs'))[0].clockSince, jobs[0].clockSince, 'the job clock keeps running');
  assert.equal(w.undos[0].m, 'Day ended. 3 h worked today.');
  assert.match(w.document.getElementById('thShiftBtn').className, /is-off/);
  w.undos[0].onUndo();
  assert.equal(stored(w)[0].end, null, 'Undo: on shift again, from when it really started');
  assert.match(w.document.getElementById('thShiftBtn').className, /is-on/);
  w.close();
});

test('forgot to clock out: the sheet asks when you finished, suggests when the last job clock stopped, then goes on to today', () => {
  const start = Date.now() - 26 * HOUR;
  const stopped = start + 8 * HOUR + 42 * MIN;
  const jobs = [{ id: 1, title: 'Sink leak', status: 'done', timeLog: [{ start: iso(start + HOUR), end: iso(stopped), hours: 7.7 }] }];
  const w = page('https://example.com/tools/job-tracker.html', { jobs, shifts: [{ id: 's1', email: STEVE, start: iso(start), end: null, hours: null }] });
  w.document.getElementById('thShiftBtn').click();
  assert.equal(w.document.getElementById('thShiftTitle').textContent, 'When did you finish?');
  assert.match(sheet(w).querySelector('.th-remind-meta').textContent, /is still open, so it isn.t counting\./);
  assert.equal(act(w, 'end'), null, 'no "End now": that would record 26 hours');
  assert.match(act(w, 'end-suggested').textContent, /when the clock on Sink leak stopped/);
  const input = sheet(w).querySelector('[data-shift-input="end"]');
  assert.equal(input.type, 'datetime-local');
  assert.ok(input.value, 'the field starts at the suggestion');
  act(w, 'end-suggested').click();
  assert.equal(stored(w)[0].end, iso(stopped));
  assert.equal(stored(w)[0].endSource, 'entered');
  assert.match(w.toasts[0], /^Saved\. 8\.7 h worked on /);
  assert.equal(w.document.getElementById('thShiftTitle').textContent, 'Start my day', 'straight on to starting today');
  w.close();
});

test('a typed finish time that can\'t be right shows the data layer\'s reason and saves nothing', () => {
  const start = Date.now() - 2 * HOUR;
  const w = page('https://example.com/tools/job-tracker.html', { shifts: [{ id: 's1', email: STEVE, start: iso(start), end: null, hours: null }] });
  w.document.getElementById('thShiftBtn').click();
  const before = new Date(start - HOUR);
  w.document.querySelector('[data-shift-input="end-time"]').value = String(before.getHours()).padStart(2, '0') + ':' + String(before.getMinutes()).padStart(2, '0');
  const enter = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  w.document.querySelector('[data-shift-input="end-time"]').dispatchEvent(enter);
  assert.match(w.document.querySelector('.th-shift-error').textContent, /after the start|over 24 hours/, 'Enter in the field presses its button');
  assert.equal(stored(w)[0].end, null);
  assert.equal(w.document.querySelector('.th-shift-error').getAttribute('role'), 'alert');
  w.close();
});

test('a shift started by mistake can be deleted from the sheet, after a confirm', async () => {
  const w = page('https://example.com/tools/job-tracker.html', { shifts: [{ id: 's1', email: STEVE, start: iso(Date.now() - 30 * HOUR), end: null, hours: null }] });
  w.document.getElementById('thShiftBtn').click();
  act(w, 'delete').click();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(stored(w), []);
  assert.equal(JSON.parse(w.localStorage.getItem('th_shift_tombstones'))[0].id, 's1');
  assert.match(w.toasts[0], /Graveyard/);
  w.close();
});

test('a typed time of day is the latest time it was: 11:30 PM typed at 1 AM is last night', () => {
  const w = page('https://example.com/tools/job-tracker.html');
  const oneAm = new Date(2026, 8, 24, 1, 0).getTime();
  assert.equal(w.thShiftTimeInputMs('23:30', oneAm), new Date(2026, 8, 23, 23, 30).getTime());
  assert.equal(w.thShiftTimeInputMs('00:45', oneAm), new Date(2026, 8, 24, 0, 45).getTime());
  assert.ok(isNaN(w.thShiftTimeInputMs('', oneAm)));
  assert.equal(w.thShiftLocalInputValue(new Date(2026, 8, 22, 17, 5).getTime()), '2026-09-22T17:05');
  w.close();
});

test('#shift opens the sheet on arrival and is cleared from the address; Escape closes it', async () => {
  const w = page('https://example.com/tools/workspace.html#shift');
  await new Promise(r => setTimeout(r, 5));
  assert.ok(sheet(w), 'opened from the hash');
  assert.equal(w.location.hash, '');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  await new Promise(r => setTimeout(r, 250));
  assert.equal(sheet(w), null);
  w.close();
});

test('the look: a green pill and an amber dot in the header, a sidebar row like Search, 16px fields (no iOS zoom); mirrored on the Runway Dashboard', () => {
  for (const src of [CSS, RUNWAY]) {
    assert.match(src, /\.th-hdr-shift\.is-on \{[\s\S]*?border-radius: 999px;[\s\S]*?\}/);
    assert.match(src, /\.th-hdr-shift-time \{[^}]*font-variant-numeric: tabular-nums;/);
    assert.match(src, /\.th-hdr-shift\.is-due::after \{[\s\S]*?background: #e6a23c;/);
    assert.match(src, /\.th-sidebar-shift \{ width: 100%; background: none; border: none; font: inherit;/);
  }
  assert.match(CSS, /body \.th-shift-input \{[\s\S]*?font-size: 16px;/);
  assert.match(CSS, /\.th-shift-error:empty \{ display: none; \}/);
  assert.doesNotMatch(CSS.slice(CSS.indexOf('/* ---- Shift clock')), /animation/, 'nothing ticks or pulses: that is the job clock\'s bar');
});

test('the job clock\'s bar is untouched: a running job clock and a shift show side by side', () => {
  const w = page('https://example.com/tools/finance.html', {
    jobs: [{ id: 42, title: 'Sink leak', client: 'Sarah Miller', status: 'in-progress', clockSince: iso(Date.now() - 5 * MIN) }],
    shifts: [{ id: 's1', email: STEVE, start: iso(Date.now() - HOUR), end: null, hours: null }],
  });
  assert.ok(!w.document.getElementById('thClock').hidden);
  assert.equal(w.document.querySelector('.th-clock-label').textContent, 'On the clock');
  assert.match(w.document.getElementById('thShiftBtn').className, /is-on/);
  w.close();
});
