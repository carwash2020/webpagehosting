// Shift clock (2026-09-23): Start my day / End my day. A whole-shift punch
// for each person, beside the job clock rather than instead of it -- the
// job clock says how long a job took (costing, the invoice's Labor line);
// this says how long someone worked today. One record per shift in
// th_shift_log, synced like jobs; a punch left running overnight needs an
// end time instead of counting 24 hours.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const SYNC = read('sync.js');
const DEV = read('dev-tools.html');

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

const STEVE = 'steve@triplehenterprisesllc.biz';
const CONNOR = 'connor@triplehenterprisesllc.biz';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h || 0, min || 0).getTime();
const iso = (ms) => new Date(ms).toISOString();
const WED_740 = at(2026, 9, 23, 7, 40); // Wednesday, 7:40 AM

// The data layer in a vm with an in-memory localStorage. `who` is the
// signed-in account, read from the stored session the way thShiftEmail()
// does; getCurrentUserEmail() returns null, as it does once the access
// token has expired.
function dataLayer(store, who) {
  const mem = {};
  Object.keys(store || {}).forEach(k => { mem[k] = JSON.stringify(store[k]); });
  const events = [];
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN, Infinity,
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
    window: { dispatchEvent: (e) => events.push(e) },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    getStoredSession: () => (ctx.who ? { email: ctx.who, access_token: 'expired' } : null),
    getCurrentUserEmail: () => null,
    who: who === undefined ? STEVE : who,
  };
  vm.createContext(ctx);
  vm.runInContext(DL.replace(/^const /gm, 'var '), ctx);
  const get = (k, fallback) => (k in mem ? JSON.parse(mem[k]) : fallback);
  return { ctx, mem, events, shifts: () => get('th_shift_log', []), jobs: () => get('th_tracker_jobs', []), get };
}

test('Start my day: one lean record for the signed-in person, read from the stored session even with an expired token', () => {
  const dl = dataLayer();
  const r = dl.ctx.thStartShift({ now: WED_740 });
  assert.equal(r.already, undefined);
  const [s] = dl.shifts();
  assert.deepEqual(Object.keys(s).sort(), ['email', 'end', 'hours', 'id', 'start'], 'nothing else stored for a plain punch: the whole blob is pushed on every edit');
  assert.match(s.id, /^s_[a-z0-9]+_[a-z0-9]+$/);
  assert.equal(s.email, STEVE);
  assert.equal(s.start, iso(WED_740));
  assert.equal(s.end, null, 'on shift is end === null -- null, not missing, so the per-field merge can see it close');
  assert.equal(s.hours, null);
  assert.equal(dl.events[0].type, 'th-shift-change');
  assert.equal(dl.events[0].detail.email, STEVE);

  const again = dl.ctx.thStartShift({ now: WED_740 + 5 * MIN });
  assert.equal(again.already, true, 'already on shift: a second tap changes nothing');
  assert.equal(dl.shifts().length, 1);

  const signedOut = dataLayer({}, null);
  assert.match(signedOut.ctx.thStartShift({ now: WED_740 }).error, /Sign in again/);
  assert.equal(signedOut.shifts().length, 0);
});

test('End my day: hours round like the job clock (0.1 h), Undo reopens it, and under a minute counts nothing', () => {
  const dl = dataLayer();
  dl.ctx.thStartShift({ now: WED_740 });
  const r = dl.ctx.thEndShift({ now: WED_740 + 9 * HOUR + 26 * MIN });
  assert.equal(r.hours, 9.4);
  assert.equal(r.ms, 9 * HOUR + 26 * MIN);
  let [s] = dl.shifts();
  assert.equal(s.end, iso(WED_740 + 9 * HOUR + 26 * MIN));
  assert.equal(s.hours, 9.4);
  assert.equal(s.endSource, undefined, 'a plain punch-out stores no source');
  assert.equal(dl.ctx.thEndShift({ now: WED_740 + 10 * HOUR }), null, 'nothing open, nothing to end');

  assert.equal(dl.ctx.thUndoEndShift(s.id, r.undo), true);
  [s] = dl.shifts();
  assert.equal(s.end, null, 'running again from when it really started');
  assert.equal(s.hours, null);
  assert.equal(s.start, iso(WED_740));

  const quick = dataLayer();
  quick.ctx.thStartShift({ now: WED_740 });
  assert.equal(quick.ctx.thEndShift({ now: WED_740 + 40e3 }).hours, 0, 'a mis-tap: closed, but 0 h');
  assert.equal(quick.ctx.thShiftWeekSummary(STEVE, WED_740 + MIN).hours, 0);
});

test('Undo is refused once a newer shift has started', () => {
  const dl = dataLayer();
  dl.ctx.thStartShift({ now: WED_740 });
  const r = dl.ctx.thEndShift({ now: WED_740 + 4 * HOUR });
  dl.ctx.thStartShift({ now: WED_740 + 5 * HOUR });
  assert.equal(dl.ctx.thUndoEndShift(r.shift.id, r.undo), false);
  assert.equal(dl.shifts()[0].hours, 4);
});

test('each person has their own shift: Steve and Connor punch in and out independently', () => {
  const dl = dataLayer();
  dl.ctx.thStartShift({ now: WED_740 });
  dl.ctx.who = CONNOR;
  dl.ctx.thStartShift({ now: WED_740 + 20 * MIN });
  assert.equal(dl.shifts().length, 2);
  dl.ctx.who = STEVE;
  dl.ctx.thEndShift({ now: WED_740 + 8 * HOUR });
  const byEmail = Object.fromEntries(dl.shifts().map(s => [s.email, s]));
  assert.equal(byEmail[STEVE].hours, 8);
  assert.equal(byEmail[CONNOR].end, null, 'ending Steve\'s day leaves Connor on shift');
  assert.equal(dl.ctx.thActiveShift(CONNOR, undefined, WED_740 + 8 * HOUR).email, CONNOR);
  assert.equal(dl.ctx.thActiveShift(STEVE, undefined, WED_740 + 8 * HOUR), null);
  assert.equal(dl.ctx.thActiveShift('STEVE@TripleHEnterprisesLLC.biz ', dl.shifts(), WED_740), null, 'emails compare case- and space-insensitively');
});

test('a forgotten End my day: after 14 h it counts nothing until someone says when they finished', () => {
  const jobs = [{ id: 1, title: 'Sink leak', status: 'done', timeLog: [
    { start: iso(WED_740 + HOUR), end: iso(WED_740 + 3 * HOUR), hours: 2 },
    { start: iso(WED_740 + 6 * HOUR), end: iso(WED_740 + 9 * HOUR + 12 * MIN), hours: 3.2 },
  ] }];
  const dl = dataLayer({ th_tracker_jobs: jobs });
  dl.ctx.thStartShift({ now: WED_740 });
  const nextMorning = WED_740 + 24 * HOUR + 10 * MIN;
  assert.equal(dl.ctx.thShiftIsStale(dl.shifts()[0], WED_740 + 14 * HOUR), false, 'exactly 14 h is still a (long) day');
  assert.equal(dl.ctx.thShiftIsStale(dl.shifts()[0], WED_740 + 14 * HOUR + MIN), true);

  const end = dl.ctx.thEndShift({ now: nextMorning });
  assert.equal(end.needsEnd.id, dl.shifts()[0].id, 'End my day asks for the time instead of recording 24 h');
  assert.equal(dl.shifts()[0].end, null, 'and saves nothing');
  const start = dl.ctx.thStartShift({ now: nextMorning });
  assert.equal(start.needsEnd.id, dl.shifts()[0].id, 'Start my day asks to close yesterday first');
  assert.equal(dl.shifts().length, 1);

  const wk = dl.ctx.thShiftWeekSummary(STEVE, nextMorning);
  assert.equal(wk.hours, 0, 'not 24 h, not 14 h: nothing, until fixed');
  assert.equal(wk.onShift, false);
  assert.equal(wk.needsEnd.length, 1);

  const guess = dl.ctx.thShiftSuggestedEnd(dl.shifts()[0], nextMorning);
  assert.equal(guess.at, WED_740 + 9 * HOUR + 12 * MIN, 'the suggestion is when the last job clock of that day stopped');
  assert.equal(guess.job.title, 'Sink leak');

  const fixed = dl.ctx.thEndShift({ now: nextMorning, end: WED_740 + 9 * HOUR + 48 * MIN });
  assert.equal(fixed.hours, 9.8);
  assert.equal(dl.shifts()[0].endSource, 'entered', 'a typed-in end time says so');
  assert.equal(dl.ctx.thShiftWeekSummary(STEVE, nextMorning).hours, 9.8);
  assert.ok(dl.ctx.thStartShift({ now: nextMorning }).shift, 'and now the new day starts');
});

test('no job clock during the shift, no suggested end -- and suggestions never reach past the next shift', () => {
  const dl = dataLayer({ th_tracker_jobs: [{ id: 1, timeLog: [{ start: iso(WED_740 + 20 * HOUR), end: iso(WED_740 + 21 * HOUR) }] }] });
  const shift = { id: 'a', email: STEVE, start: iso(WED_740), end: null, hours: null };
  assert.equal(dl.ctx.thShiftSuggestedEnd(shift, WED_740 + 30 * HOUR, undefined, [shift]), null, 'a visit 20 h in is outside any shift');
  const next = { id: 'b', email: STEVE, start: iso(WED_740 + 2 * HOUR), end: null, hours: null };
  const jobs = [{ id: 2, timeLog: [{ start: iso(WED_740 + HOUR), end: iso(WED_740 + 3 * HOUR) }] }];
  assert.equal(dl.ctx.thShiftSuggestedEnd(shift, WED_740 + 30 * HOUR, jobs, [shift, next]), null, 'a visit ending after the next shift began');
});

test('two devices that each started a shift offline: the latest is the one you\'re on, the older one needs an end time', () => {
  const a = { id: 'a', email: STEVE, start: iso(WED_740), end: null, hours: null };
  const b = { id: 'b', email: STEVE, start: iso(WED_740 + 6 * MIN), end: null, hours: null };
  const dl = dataLayer({ th_shift_log: [a, b] });
  const now = WED_740 + 2 * HOUR;
  assert.equal(dl.ctx.thCurrentShift(STEVE).id, 'b');
  assert.equal(dl.ctx.thActiveShift(STEVE, undefined, now).id, 'b');
  assert.deepEqual(Array.from(dl.ctx.thShiftsNeedingEnd(STEVE, undefined, now), s => s.id), ['a']);
  assert.equal(dl.ctx.thEndShift({ now: now, id: 'a' }).needsEnd.id, 'a', 'the leftover can\'t be ended "now" -- it would overlap');
  assert.match(dl.ctx.thEndShift({ now: now, id: 'a', end: WED_740 + HOUR }).error, /overlaps the shift from 7:46\sAM/);
  assert.ok(dl.ctx.thDeleteShift('a'));
  assert.equal(dl.ctx.thShiftWeekSummary(STEVE, now).needsEnd.length, 0);
});

test('times that can\'t be right are refused in plain words', () => {
  const dl = dataLayer({ th_shift_log: [
    { id: 'mon', email: STEVE, start: iso(at(2026, 9, 21, 8)), end: iso(at(2026, 9, 21, 16)), hours: 8 },
    { id: 'open', email: STEVE, start: iso(WED_740 - 2 * HOUR), end: null, hours: null },
  ] });
  const now = WED_740;
  const p = (id, s, e) => dl.ctx.thShiftTimesProblem(STEVE, id, s, e, now);
  assert.equal(p('open', WED_740 - 2 * HOUR, WED_740 - HOUR), '');
  assert.match(p('open', WED_740 - 2 * HOUR, WED_740 - 3 * HOUR), /end has to be after the start/);
  assert.match(p('open', WED_740 - 2 * HOUR, WED_740 + HOUR), /end can.t be in the future/);
  assert.match(p('open', WED_740 + HOUR, null), /start can.t be in the future/);
  assert.match(p('open', WED_740 - 30 * HOUR, WED_740 - 2 * MIN), /over 24 hours/);
  assert.match(p(null, WED_740 - 15 * HOUR, null), /more than 14 hours ago/, 'a back-dated start that would already be stale');
  assert.match(p('x', WED_740 - 160 * MIN, WED_740 - 100 * MIN), /overlaps the shift from 5:40\sAM/, 'an open shift runs until whenever it ends');
  assert.match(p('x', at(2026, 9, 21, 15), at(2026, 9, 21, 18)), /overlaps the shift from Sep 21, 8:00\sAM/, 'another day\'s shift says which day');
  assert.equal(p('mon', at(2026, 9, 21, 7), at(2026, 9, 21, 16)), '', 'a shift never clashes with itself');
  assert.equal(p('x', at(2026, 9, 21, 16), at(2026, 9, 21, 18)), '', 'starting the moment another ended is fine');
  assert.match(p('x', NaN, null), /Pick a start time/);
});

test('forgot to punch in: Start my day can back-date to when the first job clock of the day started', () => {
  const jobs = [
    { id: 1, title: 'Yesterday', timeLog: [{ start: iso(WED_740 - 20 * HOUR), end: iso(WED_740 - 18 * HOUR) }] },
    { id: 2, title: 'Fence', timeLog: [{ start: iso(WED_740 + 32 * MIN), end: iso(WED_740 + 90 * MIN) }] },
    { id: 3, title: 'Sink leak', status: 'in-progress', clockSince: iso(WED_740 + 2 * HOUR) },
  ];
  const dl = dataLayer({ th_tracker_jobs: jobs });
  const now = WED_740 + 3 * HOUR;
  const guess = dl.ctx.thShiftSuggestedStart(STEVE, now);
  assert.equal(guess.at, WED_740 + 32 * MIN);
  assert.equal(guess.job.title, 'Fence', 'today\'s first job clock, not yesterday\'s');
  const r = dl.ctx.thStartShift({ now: now, start: guess.at, source: 'job-clock' });
  assert.equal(r.shift.start, iso(WED_740 + 32 * MIN));
  assert.equal(dl.shifts()[0].startSource, 'job-clock');
  assert.equal(dl.jobs()[2].clockSince, iso(WED_740 + 2 * HOUR), 'the job clock is only read, never touched');

  const later = dataLayer({ th_tracker_jobs: jobs, th_shift_log: [{ id: 'm', email: STEVE, start: iso(WED_740), end: iso(WED_740 + HOUR), hours: 1 }] });
  assert.equal(later.ctx.thShiftSuggestedStart(STEVE, now).job.title, 'Sink leak', 'not before your last shift ended');
  assert.equal(later.ctx.thShiftSuggestedStart(CONNOR, now).job.title, 'Fence', 'someone else\'s shift doesn\'t move your suggestion');
  assert.equal(dataLayer({ th_tracker_jobs: [] }).ctx.thShiftSuggestedStart(STEVE, now), null);
  assert.equal(dataLayer().ctx.thStartShift({ now: now, start: WED_740 + 30 * MIN }).shift.startSource, 'entered');
});

test('the shift clock and the job clock are independent: neither needs, starts or stops the other', () => {
  const dl = dataLayer({ th_tracker_jobs: [{ id: 5, title: 'Deck', status: 'not-started' }] });
  assert.ok(dl.ctx.thStartJobClock(5, WED_740), 'a job clock runs with nobody clocked in');
  assert.equal(dl.shifts().length, 0, 'and doesn\'t punch anyone in');
  dl.ctx.thStartShift({ now: WED_740 + MIN });
  dl.ctx.thEndShift({ now: WED_740 + 2 * HOUR });
  assert.equal(dl.jobs()[0].clockSince, iso(WED_740), 'End my day leaves a running job clock alone');
  assert.equal(dl.jobs()[0].hoursWorked, undefined);
});

test('the week: Monday to Sunday, hours on the day the shift started, the one you\'re on counting so far, last week beside it', () => {
  const shifts = [
    { id: 1, email: STEVE, start: iso(at(2026, 9, 21, 8)), end: iso(at(2026, 9, 21, 17)), hours: 9 },
    { id: 2, email: STEVE, start: iso(at(2026, 9, 22, 21)), end: iso(at(2026, 9, 23, 1, 30)), hours: 4.5 },
    { id: 3, email: STEVE, start: iso(WED_740), end: null, hours: null },
    { id: 4, email: STEVE, start: iso(at(2026, 9, 15, 8)), end: iso(at(2026, 9, 15, 18)), hours: 10 },
    { id: 5, email: STEVE, start: iso(at(2026, 9, 7, 8)), end: iso(at(2026, 9, 7, 18)), hours: 10 },
    { id: 6, email: CONNOR, start: iso(at(2026, 9, 21, 9)), end: iso(at(2026, 9, 21, 12)), hours: 3 },
  ];
  const dl = dataLayer({ th_shift_log: shifts });
  const now = WED_740 + 2 * HOUR + 30 * MIN;
  const w = dl.ctx.thShiftWeekSummary(STEVE, now);
  assert.deepEqual(Array.from(w.days, d => d.hours), [9, 4.5, 2.5, 0, 0, 0, 0], 'the overnight call counts on Tuesday, when it started');
  assert.deepEqual(Array.from(w.days, d => d.name), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(Array.from(w.days, d => d.isToday), [false, false, true, false, false, false, false]);
  assert.equal(w.days[0].date, '2026-09-21');
  assert.equal(w.hours, 16);
  assert.equal(w.prevHours, 10, 'last week only -- the week before doesn\'t count');
  assert.equal(w.today, 2.5);
  assert.equal(w.onShift, true);
  assert.equal(w.since, iso(WED_740));
  assert.equal(w.needsEnd.length, 0);
  assert.equal(dl.ctx.thShiftWeekSummary(CONNOR, now).hours, 3, 'Connor\'s week is his own');
});

test('the team view: everyone with hours, on shift first, then most hours; nobody who\'s been idle for two weeks', () => {
  const shifts = [
    { id: 1, email: STEVE, start: iso(at(2026, 9, 21, 8)), end: iso(at(2026, 9, 21, 17)), hours: 9 },
    { id: 2, email: CONNOR, start: iso(at(2026, 9, 22, 8)), end: iso(at(2026, 9, 22, 12)), hours: 4 },
    { id: 3, email: CONNOR, start: iso(WED_740), end: null, hours: null },
    { id: 4, email: 'helper@example.com', start: iso(at(2026, 9, 1, 8)), end: iso(at(2026, 9, 1, 12)), hours: 4 },
  ];
  const dl = dataLayer({ th_shift_log: shifts });
  const team = dl.ctx.thShiftTeamSummary(WED_740 + HOUR);
  assert.deepEqual(Array.from(team, r => r.email), [CONNOR, STEVE]);
  assert.equal(team[0].onShift, true);
  assert.equal(team[0].hours, 5);
  assert.equal(team[1].hours, 9);
});

test('Edit fixes the times and recomputes hours, noting who changed someone else\'s shift; Delete leaves a tombstone and a Graveyard copy', () => {
  const dl = dataLayer({ th_shift_log: [{ id: 's1', email: CONNOR, start: iso(at(2026, 9, 22, 8)), end: iso(at(2026, 9, 22, 12)), hours: 4 }] });
  const r = dl.ctx.thEditShift('s1', { end: at(2026, 9, 22, 16, 30) }, WED_740);
  assert.equal(r.shift.hours, 8.5);
  let [s] = dl.shifts();
  assert.equal(s.endSource, 'entered');
  assert.equal(s.editedBy, STEVE, 'Steve fixed Connor\'s shift');
  assert.match(dl.ctx.thEditShift('s1', { start: at(2026, 9, 22, 17) }, WED_740).error, /end has to be after the start/);
  assert.equal(dl.shifts()[0].hours, 8.5, 'a refused edit saves nothing');
  assert.equal(dl.ctx.thEditShift('nope', {}, WED_740), null);

  const own = dataLayer({ th_shift_log: [{ id: 's2', email: STEVE, start: iso(WED_740), end: null, hours: null }] });
  own.ctx.thEditShift('s2', { start: WED_740 - 20 * MIN }, WED_740 + HOUR);
  [s] = own.shifts();
  assert.equal(s.start, iso(WED_740 - 20 * MIN));
  assert.equal(s.startSource, 'entered');
  assert.equal(s.editedBy, undefined, 'your own fix needs no editedBy');
  assert.equal(s.hours, null, 'still open, still no hours');

  assert.equal(dl.ctx.thDeleteShift('s1'), true);
  assert.equal(dl.shifts().length, 0);
  assert.equal(dl.get('th_shift_tombstones')[0].id, 's1');
  const [grave] = dl.get('th_graveyard');
  assert.equal(grave.recordType, 'shift');
  assert.equal(grave.record.hours, 8.5);
  assert.equal(dl.ctx.thDeleteShift('s1'), false);
});

test('Dev Tools\' Graveyard can label and restore a deleted shift', () => {
  assert.match(DEV, /shift: \{ dataKey: 'th_shift_log', tombstoneKey: 'th_shift_tombstones', label: r =>/);
  assert.match(DEV, /GRAVEYARD_TYPE_TITLES = \{[\s\S]*?shift: 'Shift',[\s\S]*?\};/);
});

// --- sync ------------------------------------------------------------------

function syncApply(mem) {
  const src = (re) => { const m = SYNC.match(re); assert.ok(m, 'expected ' + re); return m[0]; };
  const code = [
    src(/const SYNC_DATA_KEYS = \[[\s\S]*?\n\];/),
    src(/const MERGE_KEY_FIELD = \{[\s\S]*?\n\};/),
    src(/const SYNC_BASE_KEY = '[^']+';/),
    src(/const CLIENT_ERROR_LOG_MAX_AFTER_MERGE = \d+;/),
    src(/const GRAVEYARD_MAX_AFTER_MERGE = \d+;/),
    src(/const SYNC_CONFLICT_LOG_MAX = \d+;/),
    ...['loadSyncBase', 'saveSyncBaseForKey', 'deepEqualValue', 'mergeRecordArrays', 'mergePartsReferenceUnits', 'mergeClientErrorLog',
      'mergeGraveyard', 'mergeSyncConflicts', 'deriveInvoicePaid', 'applySyncData'].map(n => extractFn(SYNC, n)),
  ].join('\n').replace(/^const /gm, 'var ');
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN,
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } },
  };
  vm.createContext(ctx);
  vm.runInContext(code + ';this.api = { applySyncData, mergeRecordArrays, SYNC_DATA_KEYS, MERGE_KEY_FIELD };', ctx);
  return ctx.api;
}

test('th_shift_log syncs like jobs: listed after its tombstones, merged per record by id', () => {
  const { SYNC_DATA_KEYS, MERGE_KEY_FIELD } = syncApply({});
  const keys = Array.from(SYNC_DATA_KEYS);
  assert.ok(keys.indexOf('th_shift_tombstones') > -1 && keys.indexOf('th_shift_tombstones') < keys.indexOf('th_shift_log'));
  assert.equal(MERGE_KEY_FIELD.th_shift_log, 'id');
  assert.equal(MERGE_KEY_FIELD.th_shift_tombstones, 'id');
});

test('two people punching in on two devices before either syncs: both shifts survive the merge', () => {
  const steveShift = { id: 's_a', email: STEVE, start: iso(WED_740), end: null, hours: null };
  const connorShift = { id: 's_b', email: CONNOR, start: iso(WED_740 + 3 * MIN), end: null, hours: null };
  const mem = { th_shift_log: JSON.stringify([steveShift]) };
  const { applySyncData } = syncApply(mem);
  applySyncData({ th_shift_log: JSON.stringify([connorShift]) });
  assert.deepEqual(JSON.parse(mem.th_shift_log).map(s => s.email).sort(), [CONNOR, STEVE]);
});

test('End my day on the phone and a fixed start time on the laptop, same shift: both survive (per-field merge)', () => {
  const { mergeRecordArrays } = syncApply({});
  const base = [{ id: 's_a', email: STEVE, start: iso(WED_740), end: null, hours: null }];
  const phone = [{ id: 's_a', email: STEVE, start: iso(WED_740), end: iso(WED_740 + 8 * HOUR), hours: 8 }];
  const laptop = [{ id: 's_a', email: STEVE, start: iso(WED_740 - 10 * MIN), end: null, hours: null, startSource: 'entered' }];
  const [merged] = mergeRecordArrays(phone, laptop, 'id', base, []);
  assert.equal(merged.end, iso(WED_740 + 8 * HOUR));
  assert.equal(merged.start, iso(WED_740 - 10 * MIN));
  assert.equal(merged.startSource, 'entered');
});

test('a deleted shift stays deleted when a stale device pushes it back', () => {
  const s = { id: 's_gone', email: STEVE, start: iso(WED_740), end: iso(WED_740 + HOUR), hours: 1 };
  const mem = { th_shift_log: '[]', th_shift_tombstones: JSON.stringify([{ id: 's_gone', deletedAt: iso(WED_740) }]) };
  const { applySyncData } = syncApply(mem);
  applySyncData({ th_shift_tombstones: JSON.stringify([]), th_shift_log: JSON.stringify([s]) });
  assert.deepEqual(JSON.parse(mem.th_shift_log), []);
});
