// Booking-flow pass, round 4 (2026-09-22): the client portal's three
// self-scheduling spots get the same whole-window picker booking.html
// got in round 1, written once in js/booking-flow.js
// (createBookingPicker()) instead of three more copies:
//
//  - quotes.html: scheduling an approved quote's job
//  - jobs.html: booking a due check-up visit
//  - work-orders.html: a preferred time on a request (a preference only)
//
// Each used to open on a bare strip and fetch one day per tap. Now: one
// fetch, every day labeled, full days not pickable, opens on the first
// day with room. Each page keeps its original picker untouched as the
// fallback if booking-flow.js fails to load. quotes/jobs also get the
// "you're booked" moment once the confirmed visit re-renders.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const FLOW_SRC = fs.readFileSync(repo('js', 'booking-flow.js'), 'utf8');
// A browser's classic <script> tags share one global lexical scope, so
// booking-flow.js sees business-hours.js's top-level consts; jsdom's
// window.eval() keeps each eval's consts to itself, so the ones the
// picker reads are handed to window explicitly (same as the round 1
// booking tests do).
const BUSINESS_HOURS_SRC = fs.readFileSync(repo('js', 'business-hours.js'), 'utf8')
  + '\nwindow.BUSINESS_TIMEZONE = BUSINESS_TIMEZONE; window.HOURS_BY_WEEKDAY = HOURS_BY_WEEKDAY; window.DAYS_AHEAD_SHOWN = DAYS_AHEAD_SHOWN;';
const QUOTES = fs.readFileSync(repo('portal', 'quotes.html'), 'utf8');
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const WO = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const PAGES = { 'quotes.html': QUOTES, 'jobs.html': JOBS, 'work-orders.html': WO };

const PICKER_DOM = '<!DOCTYPE html><html><body>' +
  '<div class="date-row" id="row"></div><div class="slots-grid" id="grid"></div>' +
  '<div class="slots-empty" id="empty" style="display:none;">No open times that day.</div>' +
  '</body></html>';

// The picker reads the wall clock: the 2-hour lead time decides how many
// of today's slots are left, and whether it opens on today at all. So
// every picker window runs at one fixed moment, a Wednesday at 9:00 AM
// Mountain, when today still has all its afternoon slots.
// Fixed 2026-09-23: on the real clock the second-slot test below failed
// every weekday and Saturday from 5:30 to 6 PM Mountain (Sunday 3:30 to
// 4), when today has exactly one slot left, so CI went red only when a
// push landed in that half hour.
const PINNED_NOW = '2026-09-23T15:00:00Z';
const PIN_CLOCK_SRC = `(function () {
  const RealDate = Date;
  const now = RealDate.parse(${JSON.stringify(PINNED_NOW)});
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  }
  window.Date = PinnedDate;
})();`;

function pickerWindow(mockFetch, html) {
  const dom = new JSDOM(html || PICKER_DOM, {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/portal/quotes.html',
    beforeParse(w) {
      w.fetch = mockFetch;
      w.eval(PIN_CLOCK_SRC);
      w.eval(BUSINESS_HOURS_SRC);
      w.eval(FLOW_SRC);
    },
  });
  return dom.window;
}

function waitFor(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitForCondition(fn, { timeout = 5000, interval = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await waitFor(interval);
  }
  throw new Error('waitForCondition: condition never became true within ' + timeout + 'ms');
}

function okJson(rows) { return { ok: true, status: 200, json: async () => rows }; }

function isRangeCall(opts) {
  // fetchBookingsForRange() asks for the whole window (16 days incl. padding);
  // business-hours.js's per-day fetchBookingsForDate() asks for ~3 days.
  const body = JSON.parse(opts.body);
  return new Date(body.p_range_end) - new Date(body.p_range_start) > 5 * 24 * 60 * 60 * 1000;
}

function makePicker(w, extra) {
  const picked = [];
  let clears = 0;
  const api = w.eval('createBookingPicker')(Object.assign({
    dateRowEl: w.document.getElementById('row'),
    gridEl: w.document.getElementById('grid'),
    emptyEl: w.document.getElementById('empty'),
    durationMinutes: 120,
    supabaseUrl: 'https://x.supabase.co',
    anonKey: 'anon',
    onSelect: (slot) => picked.push(slot),
    onClear: () => { clears++; },
  }, extra || {}));
  return { api, picked, clears: () => clears };
}

// ---------- createBookingPicker() behavior ----------

test('the picker renders the whole strip with loading placeholders and makes ONE availability fetch', async () => {
  const calls = [];
  let release;
  const w = pickerWindow((url, opts) => {
    calls.push({ url: String(url), range: isRangeCall(opts) });
    return new Promise((r) => { release = () => r(okJson([])); });
  });
  makePicker(w);
  const days = w.document.querySelectorAll('#row .date-btn');
  assert.equal(days.length, w.eval('DAYS_AHEAD_SHOWN'));
  assert.equal(w.document.querySelectorAll('#row .avail.is-loading').length, days.length, 'every day shows a loading bar until the fetch lands');
  assert.equal(w.document.querySelectorAll('#grid .slot-skel').length, 4, 'the slot grid shows skeleton tiles, not "Loading times..."');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].range, 'the one call covers the whole window');
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/get_booking_availability$/);
  release();
  await waitForCondition(() => w.document.querySelector('#grid .slot-btn'));
  assert.equal(calls.length, 1, 'still one call after it lands');
});

test('once loaded, every day is labeled, it opens on the first day with room, and switching days never refetches', async () => {
  let calls = 0;
  const w = pickerWindow(async () => { calls++; return okJson([]); });
  makePicker(w);
  await waitForCondition(() => w.document.querySelector('#grid .slot-btn'));
  const byDate = w.eval('computeSlotsByDate')(w.eval('todayDateStrInBusinessTz()'), w.eval('DAYS_AHEAD_SHOWN'), 120, []);
  const expectedFirst = w.eval('firstBookableDate')(byDate, null);
  const selected = w.document.querySelector('#row .date-btn.is-selected');
  assert.equal(selected.dataset.date, expectedFirst);
  assert.equal(selected.getAttribute('aria-pressed'), 'true');
  w.document.querySelectorAll('#row .date-btn').forEach((btn) => {
    const entry = byDate[btn.dataset.date];
    assert.equal(btn.querySelector('.avail').textContent, w.eval('bookingDayLabel')(entry));
    assert.equal(btn.getAttribute('aria-disabled'), entry.slots.length ? 'false' : 'true');
    assert.equal(btn.classList.contains('is-unavailable'), !entry.slots.length);
  });
  const other = Array.from(w.document.querySelectorAll('#row .date-btn')).find((b) => b.getAttribute('aria-disabled') === 'false' && b.dataset.date !== expectedFirst);
  other.click();
  await waitFor(20);
  assert.equal(w.document.querySelector('#row .date-btn.is-selected').dataset.date, other.dataset.date);
  assert.equal(w.document.querySelectorAll('#grid .slot-btn').length, byDate[other.dataset.date].slots.length);
  assert.equal(calls, 1, 'switching days is instant -- no second fetch');
});

test('a full day stays in the strip but cannot be picked, and the picker opens on the next day with room', async () => {
  const probe = pickerWindow(async () => okJson([]));
  const byDate = probe.eval('computeSlotsByDate')(probe.eval('todayDateStrInBusinessTz()'), probe.eval('DAYS_AHEAD_SHOWN'), 120, []);
  const firstOpen = probe.eval('firstBookableDate')(byDate, null);
  const fullDay = [{ start_at: probe.zonedTimeToUtc(firstOpen, 0, 0).toISOString(), end_at: probe.zonedTimeToUtc(firstOpen, 23, 59).toISOString() }];
  const w = pickerWindow(async () => okJson(fullDay));
  makePicker(w);
  await waitForCondition(() => w.document.querySelector('#grid .slot-btn'));
  const fullBtn = w.document.querySelector('#row .date-btn[data-date="' + firstOpen + '"]');
  assert.equal(fullBtn.querySelector('.avail').textContent, 'Full');
  assert.equal(fullBtn.getAttribute('aria-disabled'), 'true');
  assert.notEqual(w.document.querySelector('#row .date-btn.is-selected').dataset.date, firstOpen);
  assert.ok(w.document.querySelector('#row .date-btn.is-selected').dataset.date > firstOpen, 'the next open day AFTER the full one');
  const before = w.document.querySelector('#row .date-btn.is-selected').dataset.date;
  fullBtn.click();
  await waitFor(20);
  assert.equal(w.document.querySelector('#row .date-btn.is-selected').dataset.date, before, 'tapping a full day does nothing');
});

test('tapping a time hands the page the exact computed slot, marked pressed; changing day tells the page its pick no longer stands', async () => {
  const w = pickerWindow(async () => okJson([]));
  const p = makePicker(w);
  await waitForCondition(() => w.document.querySelector('#grid .slot-btn'));
  const clearsBeforeTap = p.clears();
  const slotBtns = w.document.querySelectorAll('#grid .slot-btn');
  assert.ok(slotBtns.length >= 2, 'the day it opens on needs a second time to tap');
  const slotBtn = slotBtns[1];
  slotBtn.click();
  assert.equal(p.picked.length, 1);
  assert.ok(p.picked[0].startUtc instanceof w.Date && p.picked[0].endUtc instanceof w.Date);
  assert.equal(p.picked[0].endUtc - p.picked[0].startUtc, 120 * 60 * 1000);
  assert.equal(p.picked[0].label, slotBtn.textContent);
  assert.equal(slotBtn.getAttribute('aria-pressed'), 'true');
  assert.ok(slotBtn.classList.contains('is-selected'));
  const other = Array.from(w.document.querySelectorAll('#row .date-btn')).find((b) => b.getAttribute('aria-disabled') === 'false' && !b.classList.contains('is-selected'));
  other.click();
  await waitFor(20);
  assert.ok(p.clears() > clearsBeforeTap, 'onClear fires so the page hides its summary/confirm for the old day');
});

test('a failed window load shows an error with Try again, and a tapped day falls back to the old one-day fetch', async () => {
  const calls = [];
  let failRange = true;
  const w = pickerWindow(async (url, opts) => {
    const range = isRangeCall(opts);
    calls.push(range ? 'range' : 'day');
    if (range && failRange) return { ok: false, status: 503 };
    return okJson([]);
  });
  makePicker(w);
  await waitForCondition(() => w.document.querySelector('#grid .booking-picker-retry'));
  assert.match(w.document.querySelector('#grid .booking-picker-msg.is-error').textContent, /Couldn't load available times/);
  assert.equal(w.document.querySelectorAll('#row .avail').length, 0, 'the strip goes back to plain, all-tappable days');
  const day = w.document.querySelectorAll('#row .date-btn')[3];
  day.click();
  await waitForCondition(() => calls.includes('day'));
  assert.deepEqual(calls, ['range', 'day'], 'the tap fetched just that one day, the way these pickers always did');
  await waitForCondition(() => w.document.querySelector('#grid .slot-btn, #empty[style*="block"]'));
  assert.equal(w.document.querySelector('#row .date-btn.is-selected'), day);
  // Once the window-wide fetch works again, reload() brings the labels back.
  failRange = false;
  w.document.getElementById('row')._bookingPicker.reload();
  await waitForCondition(() => w.document.querySelector('#row .avail') && !w.document.querySelector('#row .avail.is-loading'));
  assert.equal(calls.filter((c) => c === 'range').length, 2);
});

test('the Try again button reloads the whole window', async () => {
  let rangeCalls = 0;
  const w = pickerWindow(async (url, opts) => {
    if (isRangeCall(opts)) {
      rangeCalls++;
      if (rangeCalls === 1) return { ok: false, status: 500 };
    }
    return okJson([]);
  });
  makePicker(w);
  await waitForCondition(() => w.document.querySelector('#grid .booking-picker-retry'));
  w.document.querySelector('#grid .booking-picker-retry').click();
  await waitForCondition(() => w.document.querySelector('#grid .slot-btn'));
  assert.equal(rangeCalls, 2);
  assert.ok(w.document.querySelector('#row .date-btn.is-selected'));
});

test('nothing open in the whole window says so, with call/text links, instead of an empty grid', async () => {
  const probe = pickerWindow(async () => okJson([]));
  const today = probe.eval('todayDateStrInBusinessTz()');
  const days = probe.eval('DAYS_AHEAD_SHOWN');
  const everything = [{ start_at: probe.zonedTimeToUtc(today, 0, 0).toISOString(), end_at: probe.zonedTimeToUtc(probe.addDaysToDateStr(today, days), 0, 0).toISOString() }];
  const w = pickerWindow(async () => okJson(everything));
  makePicker(w);
  await waitForCondition(() => w.document.querySelector('#grid .booking-picker-msg'));
  const msg = w.document.querySelector('#grid .booking-picker-msg');
  assert.match(msg.textContent, /Nothing open online in the next two weeks/);
  assert.ok(msg.querySelector('a[href="tel:+14354141667"]'));
  assert.ok(msg.querySelector('a[href="sms:+14354141667"]'));
  assert.equal(w.document.querySelector('#row .date-btn.is-selected'), null);
});

test('a second picker on the same strip (panel closed and reopened) retires the first, so a slow first load can never overwrite it', async () => {
  const releases = [];
  const w = pickerWindow((url, opts) => new Promise((r) => {
    const n = releases.length;
    releases.push(() => r(okJson(n === 0 ? [] : [])));
  }));
  const first = makePicker(w);
  const second = makePicker(w);
  assert.equal(releases.length, 2);
  // The second (current) load lands first; then the stale first one.
  releases[1]();
  await waitForCondition(() => w.document.querySelector('#grid .slot-btn'));
  const gridAfterSecond = w.document.getElementById('grid').innerHTML;
  const selectedAfterSecond = w.document.querySelector('#row .date-btn.is-selected').dataset.date;
  releases[0]();
  await waitFor(40);
  assert.equal(w.document.getElementById('grid').innerHTML, gridAfterSecond, 'the stale load rendered nothing');
  assert.equal(w.document.querySelector('#row .date-btn.is-selected').dataset.date, selectedAfterSecond);
  w.document.querySelector('#grid .slot-btn').click();
  assert.equal(second.picked.length, 1);
  assert.equal(first.picked.length, 0, 'only the live picker reports picks');
});

test('a day tapped while the window is still loading wins once it lands (if it has room)', async () => {
  let release;
  const w = pickerWindow(() => new Promise((r) => { release = () => r(okJson([])); }));
  makePicker(w);
  const byDate = w.eval('computeSlotsByDate')(w.eval('todayDateStrInBusinessTz()'), w.eval('DAYS_AHEAD_SHOWN'), 120, []);
  const openDays = Object.keys(byDate).sort().filter((k) => byDate[k].slots.length);
  const wanted = openDays[openDays.length - 1];
  w.document.querySelector('#row .date-btn[data-date="' + wanted + '"]').click();
  assert.equal(w.document.querySelectorAll('#grid .slot-skel').length, 4, 'still loading: skeleton, not an error');
  release();
  await waitForCondition(() => w.document.querySelector('#grid .slot-btn'));
  assert.equal(w.document.querySelector('#row .date-btn.is-selected').dataset.date, wanted);
});

test('a day with nothing left even with nothing booked says "No times", not "Full" (which read as booked solid)', () => {
  const w = pickerWindow(async () => okJson([]));
  const label = w.eval('bookingDayLabel');
  assert.equal(label({ slots: [], closed: false, noTimes: true }), 'No times');
  assert.equal(label({ slots: [], closed: false }), 'Full', 'an entry without the flag keeps its old label');
  assert.equal(label({ slots: [], closed: true, noTimes: false }), 'Closed');
  // A past open weekday has no slots at all (the lead time), booked or not.
  const hours = w.eval('HOURS_BY_WEEKDAY');
  let pastOpenDay = '2020-01-06';
  while (!hours[w.businessWeekday(pastOpenDay)]) pastOpenDay = w.addDaysToDateStr(pastOpenDay, 1);
  const past = w.eval('computeSlotsByDate')(pastOpenDay, 1, 120, [])[pastOpenDay];
  assert.equal(past.noTimes, true);
  assert.equal(label(past), 'No times');
  // A future open day that is booked solid is still "Full".
  let futureOpenDay = w.addDaysToDateStr(w.todayDateStrInBusinessTz(), 3);
  while (!hours[w.businessWeekday(futureOpenDay)]) futureOpenDay = w.addDaysToDateStr(futureOpenDay, 1);
  const solid = [{ start: w.zonedTimeToUtc(futureOpenDay, 0, 0), end: w.zonedTimeToUtc(futureOpenDay, 23, 59) }];
  const future = w.eval('computeSlotsByDate')(futureOpenDay, 1, 120, solid)[futureOpenDay];
  assert.equal(future.noTimes, false);
  assert.equal(label(future), 'Full');
});

// ---------- the three portal pages ----------

for (const [name, html] of Object.entries(PAGES)) {
  test(`${name} loads booking-flow.js after business-hours.js, cache-busted`, () => {
    const bh = html.indexOf('<script src="/js/business-hours.js?v=');
    const flow = html.indexOf('<script src="/js/booking-flow.js?v=');
    assert.ok(bh > -1 && flow > bh, 'booking-flow.js needs business-hours.js above it');
    assert.match(html, /<script src="\/js\/booking-flow\.js\?v=[a-f0-9]{10}"><\/script>/);
  });

  // (The shared copy's own content is pinned once, below the loop.)
  // Changed 2026-09-23: the picker's styles moved from an identical
  // page-local copy on each of the three pages into portal-polish.css
  // (section 25), so there's one copy to keep right.
  test(`${name} gets the picker's styles from portal-polish.css, with no page-local copy left to drift`, () => {
    assert.match(html, /<link rel="stylesheet" href="\/portal\/portal-polish\.css\?v=[a-f0-9]{10}">/);
    for (const sel of ['.date-btn .avail', '.slot-skel', '.booking-picker-msg', '.booking-picker-retry', '@keyframes bookingSkelPulse']) {
      assert.ok(!html.includes(sel + ' {'), `${name} still has its own ${sel}`);
    }
  });

  test(`${name} uses the shared picker only when it loaded, and keeps its original picker as the fallback`, () => {
    assert.match(html, /const HAS_BOOKING_PICKER = typeof createBookingPicker === 'function';/);
  });
}

test('portal-polish.css carries the picker styles once (labels, unavailable days, skeletons, messages, reduced motion)', () => {
  const css = fs.readFileSync(repo('portal', 'portal-polish.css'), 'utf8');
  const section = css.slice(css.indexOf('/* ---------- 25. booking picker: whole-window availability ---------- */'));
  assert.ok(section.length > 100, 'expected section 25');
  for (const sel of ['.date-btn .avail', '.date-btn.is-selected .avail', '.date-btn .avail.is-loading', '.date-btn.is-unavailable', '.date-btn.is-unavailable .avail', '.slot-skel', '.booking-picker-msg', '.booking-picker-msg.is-error', '.booking-picker-msg a', '.booking-picker-retry']) {
    assert.ok(section.includes('\n' + sel + ' {'), `missing ${sel}`);
    assert.equal(css.split('\n' + sel + ' {').length - 1, 1, `${sel} defined once`);
  }
  assert.match(section, /@keyframes bookingSkelPulse \{ 0%, 100% \{ opacity: \.45; \} 50% \{ opacity: 1; \} \}/);
  assert.match(section, /@media \(prefers-reduced-motion: reduce\) \{\n\s+\.date-btn \.avail\.is-loading, \.slot-skel \{ animation: none; \}/);
});

test('quotes.html: opening the schedule panel uses the shared picker, else the untouched original', () => {
  const fn = QUOTES.match(/function toggleScheduleForm\(quoteId\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(fn, /if \(HAS_BOOKING_PICKER\) openSchedulePicker\(quoteId\);\n\s+else renderScheduleDateRow\(quoteId\);/);
  // The fallback functions are still there, unchanged in shape.
  assert.match(QUOTES, /function renderScheduleDateRow\(quoteId\) \{/);
  assert.match(QUOTES, /async function selectScheduleDate\(quoteId, dateStr\) \{[\s\S]*?fetchBookingsForDate\(SUPABASE_URL, SUPABASE_ANON_KEY, dateStr\)/);
  const open = QUOTES.match(/function openSchedulePicker\(quoteId\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(open, /durationMinutes: DEFAULT_JOB_MINUTES,/);
  assert.match(open, /initDateRowFade\(dateRow\);/, 'keeps the date row\'s scroll-fade affordance');
});

test('jobs.html: opening a check-up panel uses the shared picker, else the untouched original', () => {
  const fn = JOBS.match(/function toggleCheckupSchedule\(checkupId\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(fn, /if \(HAS_BOOKING_PICKER\) openCheckupPicker\(checkupId\);\n\s+else renderCheckupDateRow\(checkupId\);/);
  assert.match(JOBS, /function renderCheckupDateRow\(checkupId\) \{/);
  assert.match(JOBS, /async function selectCheckupDate\(checkupId, dateStr\) \{[\s\S]*?fetchBookingsForDate\(SUPABASE_URL, SUPABASE_ANON_KEY, dateStr\)/);
  assert.match(JOBS.match(/function openCheckupPicker\(checkupId\) \{[\s\S]*?\n  \}\n/)[0], /durationMinutes: DEFAULT_VISIT_MINUTES,/);
});

test('work-orders.html: the preferred-time panel uses the shared picker, and a pick is still only a stored preference', () => {
  const fn = WO.match(/function toggleWoSchedule\(\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(fn, /if \(HAS_BOOKING_PICKER\) openWoPicker\(\);\n\s+else renderWoDateRow\(\);/);
  const open = WO.match(/function openWoPicker\(\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(open, /onSelect: selectWoSlot,/);
  assert.match(open, /durationMinutes: DEFAULT_REQUEST_MINUTES,/);
  assert.doesNotMatch(open, /th_bookings|create_booking/);
  // The original auto-select-today fallback is still intact.
  assert.match(WO.match(/function renderWoDateRow\(\)[\s\S]*?\n  \}\n/)[0], /selectWoDate\(today\);/);
});

// ---------- two open panels can't cross-book (quotes + jobs) ----------

function extract(src, signature) {
  const start = src.indexOf(signature);
  assert.ok(start > -1, 'expected to find ' + signature);
  const end = src.indexOf('\n  }\n', start);
  return src.slice(start, end + 4);
}

function lineOf(src, start) {
  const i = src.indexOf(start);
  assert.ok(i > -1, 'expected to find ' + start);
  return src.slice(i, src.indexOf('\n', i));
}

function panelsHarness(ids, prefix) {
  const panel = (id) => `<div id="${prefix.dateRow}${id}"></div><div id="${prefix.grid}${id}"></div><div id="${prefix.empty}${id}"></div>` +
    `<div id="${prefix.summary}${id}" style="display:none;"></div><div id="${prefix.error}${id}"></div><button id="${prefix.confirm}${id}" style="display:none;"></button>`;
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + ids.map(panel).join('') + '</body></html>', { runScripts: 'dangerously' });
  const w = dom.window;
  w.eval(BUSINESS_HOURS_SRC);
  w.__pickers = {};
  w.eval('function createBookingPicker(opts) { window.__pickers[opts.dateRowEl.id] = opts; return { reload() {}, destroy() {} }; }');
  return w;
}

test('quotes.html: picking a time in a second open panel withdraws the first panel\'s choice, and Confirm refuses a cross-panel slot', async () => {
  const w = panelsHarness([7, 9], { dateRow: 'dateRow-', grid: 'slotsGrid-', empty: 'slotsEmpty-', summary: 'scheduleSummary-', error: 'scheduleError-', confirm: 'scheduleConfirmBtn-' });
  const fetches = [];
  w.fetch = async (url, opts) => { fetches.push(JSON.parse(opts.body)); return { json: async () => ({ ok: true }) }; };
  // One eval, so the page's own consts and functions share a scope the way
  // they do inside the page's single inline <script>.
  w.eval(`
    const SUPABASE_URL = 'https://x.supabase.co'; const SUPABASE_ANON_KEY = 'anon';
    const DEFAULT_JOB_MINUTES = 120;
    let schedulingQuoteId = null; let selectedScheduleSlot = null;
    function initDateRowFade() {}
    function showToast() {}
    function renderQuotes() { return Promise.resolve(); }
    function celebrateQuoteScheduled() {}
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
  ` + [lineOf(QUOTES, 'const HAS_BOOKING_PICKER'), lineOf(QUOTES, 'let selectedScheduleSlotQuoteId'),
    extract(QUOTES, 'function hideScheduleChoice(quoteId)'), extract(QUOTES, 'function openSchedulePicker(quoteId)'),
    extract(QUOTES, 'async function confirmSchedule(quoteId)')].join('\n'));
  w.eval('openSchedulePicker(7); openSchedulePicker(9);');
  const slotA = { startUtc: new w.Date('2030-01-02T17:00:00Z'), endUtc: new w.Date('2030-01-02T19:00:00Z'), label: '10:00 AM' };
  const slotB = { startUtc: new w.Date('2030-01-03T20:00:00Z'), endUtc: new w.Date('2030-01-03T22:00:00Z'), label: '1:00 PM' };
  w.__pickers['dateRow-7'].onSelect(slotA);
  assert.equal(w.document.getElementById('scheduleConfirmBtn-7').style.display, 'block');
  w.__pickers['dateRow-9'].onSelect(slotB);
  assert.equal(w.document.getElementById('scheduleConfirmBtn-7').style.display, 'none', 'the first panel no longer offers to book the second panel\'s time');
  assert.equal(w.document.getElementById('scheduleSummary-7').style.display, 'none');
  assert.equal(w.document.getElementById('scheduleConfirmBtn-9').style.display, 'block');
  await w.eval('confirmSchedule(7)');
  assert.equal(fetches.length, 0, 'quote 7 is never booked at quote 9\'s time');
  await w.eval('confirmSchedule(9)');
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].quote_id, 9);
  assert.equal(fetches[0].start_at, slotB.startUtc.toISOString());
  // A day change in the OTHER panel doesn't wipe this panel's choice.
  w.__pickers['dateRow-7'].onSelect(slotA);
  w.__pickers['dateRow-9'].onClear();
  assert.equal(w.document.getElementById('scheduleConfirmBtn-7').style.display, 'block');
});

test('jobs.html: the same two-panel guard for check-ups', async () => {
  const w = panelsHarness([3, 4], { dateRow: 'checkupDateRow-', grid: 'checkupSlotsGrid-', empty: 'checkupSlotsEmpty-', summary: 'checkupScheduleSummary-', error: 'checkupScheduleError-', confirm: 'checkupScheduleConfirmBtn-' });
  const fetches = [];
  w.fetch = async (url, opts) => { fetches.push(JSON.parse(opts.body)); return { json: async () => ({ ok: true }) }; };
  w.eval(`
    const SUPABASE_URL = 'https://x.supabase.co'; const SUPABASE_ANON_KEY = 'anon';
    const DEFAULT_VISIT_MINUTES = 120;
    let selectedCheckupSlot = null;
    function showToast() {}
    async function renderCheckups() {}
    function celebrateCheckupBooked() {}
    const client = { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } };
  ` + [lineOf(JOBS, 'const HAS_BOOKING_PICKER'), lineOf(JOBS, 'let selectedCheckupSlotId'),
    extract(JOBS, 'function hideCheckupChoice(checkupId)'), extract(JOBS, 'function openCheckupPicker(checkupId)'),
    extract(JOBS, 'async function confirmCheckupSchedule(checkupId)')].join('\n'));
  w.eval('openCheckupPicker(3); openCheckupPicker(4);');
  const slotA = { startUtc: new w.Date('2030-01-02T17:00:00Z'), endUtc: new w.Date('2030-01-02T19:00:00Z'), label: '10:00 AM' };
  const slotB = { startUtc: new w.Date('2030-01-03T20:00:00Z'), endUtc: new w.Date('2030-01-03T22:00:00Z'), label: '1:00 PM' };
  w.__pickers['checkupDateRow-3'].onSelect(slotA);
  w.__pickers['checkupDateRow-4'].onSelect(slotB);
  assert.equal(w.document.getElementById('checkupScheduleConfirmBtn-3').style.display, 'none');
  await w.eval('confirmCheckupSchedule(3)');
  assert.equal(fetches.length, 0);
  await w.eval('confirmCheckupSchedule(4)');
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].checkup_id, 4);
  assert.equal(fetches[0].start_at, slotB.startUtc.toISOString());
});

// ---------- the "you're booked" moment ----------

test('quotes.html: after scheduling, the re-rendered visit card is brought into view and celebrated -- never awaited inside the try', () => {
  const fn = extract(QUOTES, 'async function confirmSchedule(quoteId)');
  assert.match(fn, /showToast\('Scheduled\. A confirmation email is on its way\.'\);\n\s+renderQuotes\(\)\.then\(\(\) => celebrateQuoteScheduled\(quoteId\), \(\) => \{\}\);/);
  assert.doesNotMatch(fn, /await renderQuotes\(\)/, 'a re-render hiccup must never read as "Couldn\'t reach the server" after the job IS scheduled');
  const cel = extract(QUOTES, 'function celebrateQuoteScheduled(quoteId)');
  assert.match(cel, /document\.getElementById\('quote-card-' \+ quoteId\)/);
  assert.match(cel, /card\.querySelector\('\.quote-visit'\)/);
  assert.match(cel, /card\.classList\.add\('is-highlighted'\)/);
  assert.match(cel, /if \(typeof bookingCelebrate === 'function'\)/);
});

test('jobs.html: after booking a check-up, the "Visit booked" banner is found by its check-up id and celebrated', () => {
  assert.match(JOBS, /<div class="checkup-banner is-booked" data-checkup-id="\$\{Number\(c\.id\)\}">/);
  const fn = extract(JOBS, 'async function confirmCheckupSchedule(checkupId)');
  assert.match(fn, /await renderCheckups\(\);\n\s+celebrateCheckupBooked\(checkupId\);/);
  const cel = extract(JOBS, 'function celebrateCheckupBooked(checkupId)');
  assert.match(cel, /\.checkup-banner\.is-booked\[data-checkup-id="' \+ Number\(checkupId\) \+ '"\]/);
  assert.match(cel, /try \{[\s\S]*\} catch \(e\)/, 'never throws -- the visit is already booked');
});

test('the celebration runs against the real re-rendered card in a DOM, and is a no-op when booking-flow.js is missing', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="quote-card" id="quote-card-5"><div class="quote-visit"><div class="quote-visit-date"></div></div></div></body></html>', { runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.scrollIntoView = function () { w.__scrolled = this.className; };
  w.eval(extract(QUOTES, 'function celebrateQuoteScheduled(quoteId)'));
  w.eval('celebrateQuoteScheduled(5)');
  assert.equal(w.__scrolled, 'quote-visit');
  assert.ok(w.document.getElementById('quote-card-5').classList.contains('is-highlighted'));
  // No bookingCelebrate defined in this window: nothing threw, nothing else happened.
  w.eval('window.__celebrated = null; function bookingCelebrate(el) { window.__celebrated = el.className; }');
  w.eval('celebrateQuoteScheduled(5)');
  await waitFor(200);
  assert.equal(w.__celebrated, 'quote-visit-date');
  assert.doesNotThrow(() => w.eval('celebrateQuoteScheduled(999)'));
});
