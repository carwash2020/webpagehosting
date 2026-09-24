// Booking-flow pass, round 1 (2026-09-22): fewer taps and no dead air
// from "I need this fixed" to a confirmed visit.
//
//  - js/booking-flow.js: ONE availability fetch for the whole two-week
//    strip (was one per tapped day), per-day open counts, the first
//    bookable day, and an add-to-calendar file / Google Calendar link.
//  - booking.html: every day labeled "N open"/"Full" before anyone taps
//    it, the picker opens on the first day with room (today is usually
//    empty after the 2-hour lead time), instant day switching, a triage
//    note handed over from the homepage, the optional fields one tap
//    away, and a choreographed "you're booked" moment with Add to
//    calendar.
//  - index.html: the triage tool's Book link carries the appliance +
//    symptom into booking.html.
//  - manage-booking.html: the same strip, a confirm step before a
//    reschedule moves anything, green-check success states, no alert().

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const BOOKING_HTML = fs.readFileSync(repo('booking.html'), 'utf8');
const MANAGE_HTML = fs.readFileSync(repo('manage-booking.html'), 'utf8');
const INDEX_HTML = fs.readFileSync(repo('index.html'), 'utf8');
const FLOW_SRC = fs.readFileSync(repo('js', 'booking-flow.js'), 'utf8');
const BUSINESS_HOURS_SRC = fs.readFileSync(repo('js', 'business-hours.js'), 'utf8')
  + '\nwindow.BUSINESS_TIMEZONE = BUSINESS_TIMEZONE; window.HOURS_BY_WEEKDAY = HOURS_BY_WEEKDAY; window.DAYS_AHEAD_SHOWN = DAYS_AHEAD_SHOWN; window.zonedTimeToUtc = zonedTimeToUtc; window.businessWeekday = businessWeekday; window.todayDateStrInBusinessTz = todayDateStrInBusinessTz; window.addDaysToDateStr = addDaysToDateStr; window.formatHoursLabel = formatHoursLabel; window.computeSlotsForDate = computeSlotsForDate;';

function loadHtml(html, url, mockFetch, { withFlow = true } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      if (mockFetch) w.fetch = mockFetch;
      w.eval(BUSINESS_HOURS_SRC);
      if (withFlow) w.eval(FLOW_SRC);
    },
  });
  return dom.window;
}

// A bare window with just the two shared scripts, for unit tests.
function helpersWindow(mockFetch) {
  return loadHtml('<!DOCTYPE html><html><body></body></html>', 'https://www.triplehenterprisesllc.biz/', mockFetch);
}

function waitFor(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitForCondition(fn, { timeout = 5000, interval = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await waitFor(interval);
  }
  throw new Error('waitForCondition: condition never became true within ' + timeout + 'ms');
}

// ---------- js/booking-flow.js ----------

test('fetchBookingsForRange makes ONE availability call covering the whole window, padded a day either side', async () => {
  const calls = [];
  const w = helpersWindow(async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ([{ start_at: '2030-01-02T21:00:00Z', end_at: '2030-01-02T22:00:00Z' }]) };
  });
  const rows = await w.fetchBookingsForRange('https://x.supabase.co', 'anon', '2030-01-01', 14);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/get_booking_availability$/);
  const start = new Date(calls[0].body.p_range_start);
  const end = new Date(calls[0].body.p_range_end);
  assert.ok(start < w.zonedTimeToUtc('2030-01-01', 0, 0), 'range starts before the first day (a booking can straddle midnight)');
  assert.ok(end > w.zonedTimeToUtc('2030-01-15', 0, 0), 'range ends after the last day of the 14');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].start instanceof w.Date);
});

test('fetchBookingsForRange throws on a non-OK response instead of pretending nothing is booked', async () => {
  const w = helpersWindow(async () => ({ ok: false, status: 500 }));
  await assert.rejects(() => w.fetchBookingsForRange('https://x.supabase.co', 'anon', '2030-01-01', 14));
});

test('fetchBookingsForRange excludes the booking being rescheduled from counting against itself', async () => {
  const w = helpersWindow(async () => ({ ok: true, json: async () => ([
    { start_at: '2030-01-02T21:00:00.000Z', end_at: '2030-01-02T22:00:00.000Z' },
    { start_at: '2030-01-03T21:00:00.000Z', end_at: '2030-01-03T22:00:00.000Z' },
  ]) }));
  const rows = await w.fetchBookingsForRange('https://x.supabase.co', 'anon', '2030-01-01', 14, '2030-01-02T21:00:00.000Z');
  assert.equal(rows.length, 1);
});

test('computeSlotsByDate gives each day exactly what the old one-day computation gave', () => {
  const w = helpersWindow();
  const start = w.addDaysToDateStr(w.todayDateStrInBusinessTz(), 2);
  const busyDay = w.addDaysToDateStr(start, 1);
  const bookings = [{ start: w.zonedTimeToUtc(busyDay, 15, 0), end: w.zonedTimeToUtc(busyDay, 17, 0) }];
  const byDate = w.computeSlotsByDate(start, 5, 60, bookings);
  assert.equal(Object.keys(byDate).length, 5);
  for (const d of Object.keys(byDate)) {
    assert.deepEqual(byDate[d].slots.map((s) => s.label), w.computeSlotsForDate(d, 60, bookings).map((s) => s.label), d);
  }
  // Compare each day with ITSELF unbooked, not with a neighbouring day.
  // Opening hours differ by weekday (Saturday runs 7am-10pm), so the old
  // "busy day has fewer slots than start" check failed every Wednesday
  // (Mountain time), when start is a Friday and the busy day a Saturday.
  assert.ok(byDate[busyDay].slots.length < w.computeSlotsForDate(busyDay, 60, []).length, 'the booked afternoon removes slots on the busy day');
  for (const d of Object.keys(byDate)) {
    if (d === busyDay) continue;
    assert.deepEqual(byDate[d].slots.map((s) => s.label), w.computeSlotsForDate(d, 60, []).map((s) => s.label), `${d} is untouched by a booking on another day`);
  }
});

test('firstBookableDate prefers the requested day when it has room, otherwise the earliest day that does', () => {
  const w = helpersWindow();
  const byDate = {
    '2030-01-01': { slots: [], closed: false },
    '2030-01-02': { slots: [{}], closed: false },
    '2030-01-03': { slots: [{}], closed: false },
  };
  assert.equal(w.firstBookableDate(byDate, '2030-01-03'), '2030-01-03');
  assert.equal(w.firstBookableDate(byDate, '2030-01-01'), '2030-01-02', 'a full preferred day falls through to the next open one');
  assert.equal(w.firstBookableDate(byDate, null), '2030-01-02');
  const gap = {
    '2030-01-01': { slots: [{}], closed: false },
    '2030-01-02': { slots: [], closed: false },
    '2030-01-03': { slots: [{}], closed: false },
  };
  assert.equal(w.firstBookableDate(gap, '2030-01-02'), '2030-01-03', 'asked for the 2nd, which is full -- the 3rd, not the 1st');
  assert.equal(w.firstBookableDate({ '2030-01-01': { slots: [{}], closed: false }, '2030-01-02': { slots: [], closed: false } }, '2030-01-02'), '2030-01-01', 'nothing later: fall back to the earliest open day');
  assert.equal(w.firstBookableDate({ '2030-01-01': { slots: [], closed: false } }, null), null);
});

test('bookingDayLabel says "N open", "Full", or "Closed"', () => {
  const w = helpersWindow();
  assert.equal(w.bookingDayLabel({ slots: [{}, {}, {}], closed: false }), '3 open');
  assert.equal(w.bookingDayLabel({ slots: [], closed: false }), 'Full');
  assert.equal(w.bookingDayLabel({ slots: [], closed: true }), 'Closed');
});

test('bookingBuildIcs writes a valid timed event with a day-before and a 2-hour alarm, escaped text, CRLF lines, and the manage link', () => {
  const w = helpersWindow();
  const ics = w.bookingBuildIcs({
    uid: 'th-booking-1',
    title: 'Appliance Repair',
    start: '2030-01-02T21:00:00.000Z',
    end: '2030-01-02T23:00:00.000Z',
    address: '123 Main St, Apt 4; Back door',
    manageUrl: '/manage-booking.html?token=abc',
  }, new Date('2030-01-01T00:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /\n/, 'every line ends in CRLF');
  assert.match(ics, /DTSTART:20300102T210000Z/);
  assert.match(ics, /DTEND:20300102T230000Z/);
  assert.match(ics, /SUMMARY:Triple H Enterprises: Appliance Repair/);
  assert.match(ics, /LOCATION:123 Main St\\, Apt 4\\; Back door/, 'commas and semicolons are escaped per RFC 5545');
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /TRIGGER:-PT2H/);
  assert.match(ics.replace(/\r\n /g, ''), /manage-booking\.html\?token=abc/);
  for (const line of ics.split('\r\n')) assert.ok(line.length <= 75, 'folded: ' + line);
});

test('bookingGoogleCalendarUrl builds Google Calendar\'s TEMPLATE link with the real start/end', () => {
  const w = helpersWindow();
  const url = w.bookingGoogleCalendarUrl({ title: 'Inspection', start: '2030-01-02T21:00:00.000Z', end: '2030-01-02T21:45:00.000Z', address: '1 A St' });
  assert.match(url, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&/);
  assert.match(url, /dates=20300102T210000Z\/20300102T214500Z/);
  assert.match(url, /location=1%20A%20St/);
});

test('bookingCelebrate does nothing for reduced-motion visitors and never throws', () => {
  const w = helpersWindow();
  w.matchMedia = () => ({ matches: true });
  const el = w.document.createElement('div');
  w.document.body.appendChild(el);
  el.animate = () => { throw new Error('should not animate'); };
  assert.doesNotThrow(() => w.bookingCelebrate(el));
  assert.doesNotThrow(() => w.bookingCelebrate(null));
});

// ---------- booking.html: the date strip ----------

const BOOKING_URL = 'https://www.triplehenterprisesllc.biz/booking.html';

test('booking.html loads booking-flow.js right after business-hours.js, cache-busted', () => {
  const bh = BOOKING_HTML.indexOf('/js/business-hours.js?v=');
  const flow = BOOKING_HTML.indexOf('/js/booking-flow.js?v=');
  assert.ok(bh > 0 && flow > bh, 'booking-flow.js must load after business-hours.js');
  assert.match(BOOKING_HTML, /\/js\/booking-flow\.js\?v=[a-f0-9]{10}"/);
});

test('picking a service makes exactly one availability request for the whole strip, and tapping days fetches nothing more', async () => {
  let calls = 0;
  const w = loadHtml(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_availability')) { calls++; return { ok: true, json: async () => ([]) }; }
    return { ok: false };
  });
  await waitForCondition(() => w.document.querySelector('.service-option'));
  w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 0);
  const dates = w.document.querySelectorAll('.date-btn');
  for (const i of [2, 4, 6]) {
    dates[i].dispatchEvent(new w.Event('click', { bubbles: true }));
    assert.ok(w.document.querySelectorAll('.slot-btn').length > 0, 'the day switch renders instantly from the loaded window');
  }
  await waitFor(30);
  assert.equal(calls, 1);
});

test('every day in the strip is labeled with its real open count, and a fully booked day cannot be picked', async () => {
  const probe = helpersWindow();
  const today = probe.todayDateStrInBusinessTz();
  const fullDay = probe.addDaysToDateStr(today, 2);
  const w = loadHtml(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_availability')) {
      // One booking spanning the whole of that day's hours.
      return { ok: true, json: async () => ([{ start_at: probe.zonedTimeToUtc(fullDay, 6, 0).toISOString(), end_at: probe.zonedTimeToUtc(fullDay, 23, 0).toISOString() }]) };
    }
    return { ok: false };
  });
  await waitForCondition(() => w.document.querySelector('.service-option'));
  w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 0);

  const fullBtn = w.document.querySelector('.date-btn[data-date="' + fullDay + '"]');
  assert.equal(fullBtn.querySelector('.avail').textContent, 'Full');
  assert.equal(fullBtn.getAttribute('aria-disabled'), 'true');
  assert.ok(fullBtn.classList.contains('is-unavailable'));
  assert.match(fullBtn.getAttribute('aria-label'), /Full/);

  const openBtn = w.document.querySelector('.date-btn[data-date="' + probe.addDaysToDateStr(today, 3) + '"]');
  assert.match(openBtn.querySelector('.avail').textContent, /^\d+ open$/);

  const before = w.document.querySelector('.date-btn.is-selected').dataset.date;
  fullBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
  assert.equal(w.document.querySelector('.date-btn.is-selected').dataset.date, before, 'tapping a full day changes nothing');
});

test('the picker opens on the first day with openings, not on a today that has none left', async () => {
  const probe = helpersWindow();
  const today = probe.todayDateStrInBusinessTz();
  const w = loadHtml(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_availability')) {
      return { ok: true, json: async () => ([{ start_at: probe.zonedTimeToUtc(today, 0, 0).toISOString(), end_at: probe.zonedTimeToUtc(today, 23, 59).toISOString() }]) };
    }
    return { ok: false };
  });
  await waitForCondition(() => w.document.querySelector('.service-option'));
  w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 0);
  assert.equal(w.document.querySelector('.date-btn.is-selected').dataset.date, probe.addDaysToDateStr(today, 1));
  assert.equal(w.document.getElementById('dateJumpNote').hidden, true, 'no "was full" note when the visitor never asked for a day');
  assert.equal(w.document.getElementById('slotsEmpty').style.display, 'none', 'no "No open times this day" dead end on arrival');
});

test('a deep link to a full day lands on the next open day and says so', async () => {
  const probe = helpersWindow();
  const today = probe.todayDateStrInBusinessTz();
  const wanted = probe.addDaysToDateStr(today, 3);
  const w = loadHtml(BOOKING_HTML, BOOKING_URL + '?service=inspection&date=' + wanted, async (url) => {
    if (String(url).includes('get_booking_availability')) {
      return { ok: true, json: async () => ([{ start_at: probe.zonedTimeToUtc(wanted, 6, 0).toISOString(), end_at: probe.zonedTimeToUtc(wanted, 23, 0).toISOString() }]) };
    }
    return { ok: false };
  });
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 0);
  assert.equal(w.document.querySelector('.date-btn.is-selected').dataset.date, probe.addDaysToDateStr(wanted, 1));
  const note = w.document.getElementById('dateJumpNote');
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /is full, so here's the next open day/);
});

test('nothing open in two weeks shows a call/text path, not an empty grid', async () => {
  const probe = helpersWindow();
  const today = probe.todayDateStrInBusinessTz();
  const w = loadHtml(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_availability')) {
      return { ok: true, json: async () => ([{ start_at: probe.zonedTimeToUtc(today, 0, 0).toISOString(), end_at: probe.zonedTimeToUtc(probe.addDaysToDateStr(today, 15), 0, 0).toISOString() }]) };
    }
    return { ok: false };
  });
  await waitForCondition(() => w.document.querySelector('.service-option'));
  w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
  await waitForCondition(() => w.document.querySelector('.no-availability'));
  const msg = w.document.querySelector('.no-availability');
  assert.match(msg.innerHTML, /tel:\+14354141667/);
  assert.match(msg.innerHTML, /sms:\+14354141667/);
});

test('while the strip loads, the grid shows a skeleton (announced to screen readers), not bare "Loading times..." text', async () => {
  const w = loadHtml(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_availability')) return new Promise(() => {}); // never resolves
    return { ok: false };
  });
  await waitForCondition(() => w.document.querySelector('.service-option'));
  w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
  await waitForCondition(() => w.document.querySelector('.slot-skel'));
  assert.match(w.document.getElementById('slotsGrid').innerHTML, /class="sr-only">Loading available times/);
  assert.ok(w.document.querySelector('.date-btn .avail.is-loading'), 'each day shows a loading bar where its count will go');
});

test('if booking-flow.js ever fails to load, booking.html falls back to the old one-day-at-a-time picker and still books', async () => {
  const bodies = [];
  const w = loadHtml(BOOKING_HTML, BOOKING_URL, async (url, opts) => {
    if (String(url).includes('get_booking_availability')) { bodies.push(JSON.parse(opts.body)); return { ok: true, json: async () => ([]) }; }
    return { ok: false };
  }, { withFlow: false });
  await waitForCondition(() => w.document.querySelector('.service-option'));
  w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
  await waitForCondition(() => w.document.querySelectorAll('.date-btn').length > 1);
  w.document.querySelectorAll('.date-btn')[1].dispatchEvent(new w.Event('click', { bubbles: true }));
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 0);
  assert.doesNotMatch(w.document.getElementById('slotsGrid').innerHTML, /Couldn.t load/);
  assert.equal(w.document.querySelector('.date-btn .avail'), null, 'no count labels without the helper');
});

// ---------- booking.html: triage note + step 3 ----------

test('a triage handoff (?service=appliance&note=...) skips step 1 and fills the notes, with a visible "we filled this in" hint', async () => {
  const w = loadHtml(BOOKING_HTML, BOOKING_URL + '?service=appliance&note=' + encodeURIComponent("Dryer: Runs but won't heat"), async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    return { ok: false };
  });
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 0);
  assert.ok(w.document.getElementById('stepDateTime').classList.contains('is-active'));
  assert.match(w.document.getElementById('selectedServiceSummary').innerHTML, /Appliance Repair/);
  assert.equal(w.document.getElementById('bNotes').value, "Dryer: Runs but won't heat");
  assert.equal(w.document.getElementById('notesPrefillNote').hidden, false);
});

test('the note param is cleaned before use -- control characters stripped, length capped', async () => {
  const w = loadHtml(BOOKING_HTML, BOOKING_URL + '?note=' + encodeURIComponent('Leak\n\u0007under sink ' + 'x'.repeat(600)), async () => ({ ok: true, json: async () => ([]) }));
  await waitFor(50);
  const v = w.document.getElementById('bNotes').value;
  assert.ok(v.startsWith('Leak under sink'), v.slice(0, 30));
  assert.ok(v.length <= 300);
  assert.ok(!Array.from(v).some((c) => c.charCodeAt(0) < 32), 'no control characters survive');
});

test('step 3 keeps what\'s needed to book in view, with referral + how-you-heard one tap away (same ids and names)', () => {
  const form = BOOKING_HTML.slice(BOOKING_HTML.indexOf('<form id="bookingForm">'), BOOKING_HTML.indexOf('</form>'));
  const detailsAt = form.indexOf('<details class="optional-details" id="optionalDetails">');
  assert.ok(detailsAt > 0);
  for (const id of ['bName', 'bPhone', 'bAddress', 'bEmail', 'bNotes']) {
    const at = form.indexOf('id="' + id + '"');
    assert.ok(at > 0 && at < detailsAt, id + ' should be visible, before the optional disclosure');
  }
  const details = form.slice(detailsAt, form.indexOf('</details>'));
  assert.match(details, /id="bReferredBy" name="referred_by"/);
  assert.match(details, /<select id="bSource" name="source">/);
  assert.ok(form.indexOf('id="bName"') < form.indexOf('id="bAddress"') && form.indexOf('id="bAddress"') < form.indexOf('id="bEmail"'), 'required fields first');
});

test('a referral link that fills in the referrer opens the disclosure so the credited name is visible', async () => {
  const w = loadHtml(BOOKING_HTML, BOOKING_URL + '?ref=JANE-7Q', async (url) => {
    if (String(url).includes('resolve-referral-code')) return { ok: true, json: async () => ({ ok: true, referrer_name: 'Jane Doe' }) };
    return { ok: true, json: async () => ([]) };
  });
  await waitForCondition(() => w.document.getElementById('bReferredBy').value === 'Jane Doe');
  assert.equal(w.document.getElementById('optionalDetails').open, true);
});

test('the "How did you hear" select finally has on-theme styling at 16px (no iOS zoom-on-focus)', () => {
  const rule = BOOKING_HTML.match(/\n  select\{([\s\S]*?)\n  \}/)[1];
  assert.match(rule, /font-size:16px/);
  assert.match(rule, /background:var\(--bg-panel-2\)/);
});

// ---------- booking.html: the confirmation moment ----------

async function bookThroughToConfirmation(w, address) {
  await fillAndSubmit(w, address);
  await waitForCondition(() => w.document.getElementById('stepConfirmed').classList.contains('is-active'));
}

async function fillAndSubmit(w, address) {
  await waitForCondition(() => w.document.querySelector('.service-option'));
  w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
  await waitForCondition(() => w.document.querySelector('.slot-btn'));
  w.document.querySelector('.slot-btn').dispatchEvent(new w.Event('click', { bubbles: true }));
  w.document.getElementById('bName').value = 'Jane Smith';
  w.document.getElementById('bPhone').value = '(555) 123-4567';
  w.document.getElementById('bAddress').value = address;
  w.document.getElementById('bookingForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}

test('confirming shows the booked time, address (escaped), Add to calendar, and a filled-in Google Calendar link, and starts the celebration', async () => {
  const w = loadHtml(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('/rpc/create_booking')) return { ok: true, json: async () => ([{ booking_id: 1, manage_token: '11111111-2222-3333-4444-555555555555' }]) };
    return { ok: false };
  });
  await bookThroughToConfirmation(w, '12 Elm <img src=x onerror=alert(1)>');
  const detail = w.document.getElementById('confirmationDetail');
  assert.match(detail.innerHTML, /class="conf-when"/);
  assert.doesNotMatch(detail.innerHTML, /<img/, 'the typed address must be escaped');
  assert.match(detail.textContent, /12 Elm <img src=x/);
  const g = w.document.getElementById('googleCalendarLink');
  assert.match(g.getAttribute('href'), /action=TEMPLATE/);
  assert.match(g.getAttribute('href'), /dates=\d{8}T\d{6}Z\/\d{8}T\d{6}Z/);
  assert.ok(w.document.querySelector('#stepConfirmed .confirmation').classList.contains('is-celebrating'));

  let downloaded = null;
  w.URL.createObjectURL = (blob) => { downloaded = blob; return 'blob:test'; };
  w.URL.revokeObjectURL = () => {};
  w.document.getElementById('addToCalendarBtn').click();
  assert.ok(downloaded, 'Add to calendar should hand the browser a calendar file');
  assert.match(downloaded.type, /text\/calendar/);
});

test('the confirmation keeps the existing order and copy, and the reduced-motion block removes the choreography\'s delays', () => {
  const section = BOOKING_HTML.match(/<section class="step-panel" id="stepConfirmed"[^>]*>[\s\S]*?<\/section>/)[0];
  const order = ['class="checkmark"', "You're booked! Your slot is held.", 'id="confirmationDetail"', 'id="addToCalendarBtn"', 'class="next-steps"', 'Back to site'];
  let last = -1;
  for (const marker of order) {
    const at = section.indexOf(marker);
    assert.ok(at > last, marker + ' out of order');
    last = at;
  }
  assert.match(BOOKING_HTML, /@media \(prefers-reduced-motion: reduce\)\{\n    \.confirmation \*, \.confirmation \*::after\{animation-delay:0s !important;\}/);
  assert.match(BOOKING_HTML, /\.confirmation\.is-celebrating \.conf-detail\{animation:stampIn/);
});

test('a slot taken at the last second sends the visitor back to fresh times WITH the reason, not a silent step 2', async () => {
  let availabilityCalls = 0;
  const w = loadHtml(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_availability')) { availabilityCalls++; return { ok: true, json: async () => ([]) }; }
    if (String(url).includes('/rpc/create_booking')) return { ok: false, status: 409, text: async () => '{"code":"23P01","message":"conflicting key value violates exclusion constraint"}' };
    return { ok: false };
  });
  await fillAndSubmit(w, '1 A St');
  await waitForCondition(() => w.document.getElementById('stepDateTime').classList.contains('is-active'));
  await waitForCondition(() => !w.document.getElementById('dateJumpNote').hidden);
  assert.match(w.document.getElementById('dateJumpNote').textContent, /just booked by someone else/);
  assert.equal(availabilityCalls, 2, 'the times were reloaded, not reused');
});

// ---------- index.html: triage -> booking ----------

// Changed 2026-09-23: the handoff moved from an inline homepage script
// into js/triage.js (still opt-in via data-triage-book-link), so the city
// and service pages that load triage.js get it too. These run the REAL
// triage.js on each real page, instead of evaluating the old inline block.

const TRIAGE_JS = fs.readFileSync(repo('js', 'triage.js'), 'utf8');
const TRIAGE_TAG = /<script src="\/js\/triage\.js\?v=[a-f0-9]+" defer><\/script>/;
// Every candidate page, read once and shared by all the tests below.
const PAGE_HTML = new Map(['index.html',
  ...fs.readdirSync(repo('locations')).filter((f) => f.endsWith('.html')).map((f) => `locations/${f}`),
  ...fs.readdirSync(repo('services')).filter((f) => f.endsWith('.html')).map((f) => `services/${f}`),
].map((f) => [f, fs.readFileSync(repo(f), 'utf8')]));
const TRIAGE_PAGES = [...PAGE_HTML].filter(([, html]) => TRIAGE_TAG.test(html)).map(([f]) => f);

// Runs a real page with the real triage.js inlined. `edit` lets a test
// change the page first (e.g. drop the opt-in marker).
function loadTriagePage(file, edit = (html) => html) {
  const html = edit(PAGE_HTML.get(file)).replace(TRIAGE_TAG, () => `<script>${TRIAGE_JS}</script>`);
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/' + file,
    beforeParse(window) {
      window.fetch = () => Promise.reject(new Error('no network in tests'));
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    },
  });
}

test('the homepage and every city/service page that loads triage.js are all covered (13)', () => {
  assert.equal(TRIAGE_PAGES.length, 13, TRIAGE_PAGES.join(', '));
  assert.ok(TRIAGE_PAGES.includes('index.html'));
});

for (const file of TRIAGE_PAGES) {
  test(`${file}: the triage Book link carries the tapped appliance + symptom into booking.html`, () => {
    const dom = loadTriagePage(file);
    const doc = dom.window.document;
    const link = doc.querySelector('[data-triage-book-link]');
    assert.ok(link && link.closest('.triage-actions'), 'the marked link is the triage result\'s own Book link');
    assert.equal(link.getAttribute('href'), '/booking.html');

    const dryer = [...doc.querySelectorAll('.triage-appliance-pill')].find((b) => /Dryer/.test(b.textContent));
    dryer.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const noHeat = [...doc.querySelectorAll('.triage-symptom-pill')].find((b) => /won't heat/.test(b.textContent));
    noHeat.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(link.getAttribute('href'), '/booking.html?service=appliance&note=' + encodeURIComponent("Dryer: Runs but won't heat"));

    // A different appliance clears the symptom -- back to the plain link.
    const washer = [...doc.querySelectorAll('.triage-appliance-pill')].find((b) => /Washer/.test(b.textContent));
    washer.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(link.getAttribute('href'), '/booking.html');
    dom.window.close();
  });
}

test('the handoff is opt-in: exactly one marked link per page, inside the triage result, and no inline copy left on the homepage', () => {
  for (const file of TRIAGE_PAGES) {
    const html = PAGE_HTML.get(file);
    assert.equal((html.match(/data-triage-book-link/g) || []).length, 1, file);
    assert.match(html, /<div class="triage-actions">[\s\S]*?<a href="\/booking\.html" class="cta-quiet-link" data-triage-book-link>[\s\S]*?<\/div>/, file);
  }
  assert.doesNotMatch(INDEX_HTML, /Triage -> booking handoff/, 'the inline script moved into js/triage.js');
  assert.match(TRIAGE_JS, /document\.querySelector\('\[data-triage-book-link\]'\)/);
  assert.match(TRIAGE_JS, /if \(!grid \|\| !link\) return;/, 'a page without the marked link is left alone');
});

test('a page with the triage tool but no marked link keeps its Book link untouched', () => {
  const dom = loadTriagePage('index.html', (html) => html.replace(' data-triage-book-link>', '>'));
  const doc = dom.window.document;
  doc.querySelector('.triage-appliance-pill').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  doc.querySelector('.triage-symptom-pill').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.deepEqual([...doc.querySelectorAll('.triage-actions a[href^="/booking.html"]')].map((a) => a.getAttribute('href')), ['/booking.html']);
  dom.window.close();
});

// ---------- manage-booking.html ----------

const MANAGE_URL = 'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123';
function futureBooking(minutesFromNow = 26 * 60, duration = 45) {
  const start = new Date(Date.now() + minutesFromNow * 60000);
  return { service_label: 'Inspection', start_at: start.toISOString(), end_at: new Date(start.getTime() + duration * 60000).toISOString(), name: 'Test', status: 'confirmed' };
}

test('manage-booking.html: an upcoming booking shows a "Tomorrow"/"In N days" chip and Add to calendar with the manage link in it', async () => {
  const b = futureBooking(3 * 24 * 60);
  const w = loadHtml(MANAGE_HTML, MANAGE_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([b]) };
    return { ok: false };
  });
  await waitForCondition(() => w.document.getElementById('addToCalendarBtn'));
  assert.match(w.document.querySelector('.when-chip').textContent, /^(In \d+ days|Tomorrow)$/);
  let blob = null;
  w.URL.createObjectURL = (x) => { blob = x; return 'blob:t'; };
  w.URL.revokeObjectURL = () => {};
  w.document.getElementById('addToCalendarBtn').click();
  assert.ok(blob);
  const text = await blob.text();
  assert.match(text.replace(/\r\n /g, ''), /manage-booking\.html\?token=abc-123/);
});

test('manage-booking.html: rescheduling loads the whole strip once, excluding this booking\'s own slot', async () => {
  const b = futureBooking();
  const bodies = [];
  const w = loadHtml(MANAGE_HTML, MANAGE_URL, async (url, opts) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([b]) };
    if (String(url).includes('get_booking_availability')) { bodies.push(opts.body); return { ok: true, json: async () => ([{ start_at: b.start_at, end_at: b.end_at }]) }; }
    return { ok: false };
  });
  await waitForCondition(() => w.document.getElementById('startRescheduleBtn'));
  w.document.getElementById('startRescheduleBtn').click();
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 0);
  w.document.querySelectorAll('.date-btn')[3].click();
  w.document.querySelectorAll('.date-btn')[5].click();
  await waitFor(30);
  assert.equal(bodies.length, 1, 'one fetch for the whole two weeks');
  assert.ok(w.document.querySelectorAll('.date-btn .avail')[1].textContent.length > 0);
});

test('manage-booking.html: tapping a time never moves the booking by itself -- it asks first, and "confirm" makes the move', async () => {
  const b = futureBooking();
  let rescheduled = 0;
  const w = loadHtml(MANAGE_HTML, MANAGE_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([b]) };
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('reschedule_booking_by_token')) { rescheduled++; return { ok: true, json: async () => ([{ ok: true, message: 'rescheduled' }]) }; }
    return { ok: false };
  });
  await waitForCondition(() => w.document.getElementById('startRescheduleBtn'));
  w.document.getElementById('startRescheduleBtn').click();
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 0);
  // The picker opens on the first day with room, on the real clock. From
  // 6:30 to 7 PM Mountain (4:30 to 5 on Sundays) that's today with one of
  // this 45-minute visit's times left, so move on to the next open day.
  if (w.document.querySelectorAll('.slot-btn').length < 2) {
    Array.from(w.document.querySelectorAll('.date-btn')).find((b) => b.getAttribute('aria-disabled') === 'false' && !b.classList.contains('is-selected')).click();
  }
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 1);
  w.document.querySelectorAll('.slot-btn')[1].click();
  await waitFor(30);
  assert.equal(rescheduled, 0);
  assert.equal(w.document.getElementById('rescheduleConfirm').hidden, false);
  assert.match(w.document.getElementById('rescheduleConfirmText').textContent, /^Move your visit to .+ at .+\?$/);
  w.document.getElementById('confirmRescheduleBtn').click();
  await waitForCondition(() => w.document.getElementById('content').innerHTML.includes('has been rescheduled'));
  assert.equal(rescheduled, 1);
  assert.ok(w.document.querySelector('.checkmark.is-success svg path'), 'the green drawn check, not the old glyph');
  assert.ok(w.document.getElementById('addToCalendarBtn'), 'Add to calendar for the NEW time');
});

test('manage-booking.html: a failed reschedule shows an inline error and keeps the confirm button usable -- no alert()', async () => {
  assert.doesNotMatch(MANAGE_HTML, /\balert\(/);
  const b = futureBooking();
  const w = loadHtml(MANAGE_HTML, MANAGE_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([b]) };
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('reschedule_booking_by_token')) return { ok: false };
    return { ok: false };
  });
  await waitForCondition(() => w.document.getElementById('startRescheduleBtn'));
  w.document.getElementById('startRescheduleBtn').click();
  await waitForCondition(() => w.document.querySelector('.slot-btn'));
  w.document.querySelector('.slot-btn').click();
  w.document.getElementById('confirmRescheduleBtn').click();
  await waitForCondition(() => !w.document.getElementById('rescheduleError').hidden);
  assert.match(w.document.getElementById('rescheduleError').textContent, /\(435\) 414-1667/);
  assert.equal(w.document.getElementById('confirmRescheduleBtn').disabled, false);
});

test('manage-booking.html: a cancellation ends on the green check with a way to book again', async () => {
  const b = futureBooking();
  const w = loadHtml(MANAGE_HTML, MANAGE_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([b]) };
    if (String(url).includes('cancel_booking_by_token')) return { ok: true, json: async () => ([{ ok: true, message: 'cancelled' }]) };
    return { ok: false };
  });
  await waitForCondition(() => w.document.getElementById('startCancelBtn'));
  w.document.getElementById('startCancelBtn').click();
  w.document.getElementById('confirmCancelBtn').click();
  await waitForCondition(() => w.document.getElementById('content').innerHTML.includes('has been cancelled'));
  assert.ok(w.document.querySelector('.checkmark.is-success'));
  assert.match(w.document.getElementById('content').innerHTML, /href="\/booking\.html"/);
});

test('manage-booking.html: without booking-flow.js it still offers the old one-day picker', async () => {
  const b = futureBooking();
  const w = loadHtml(MANAGE_HTML, MANAGE_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([b]) };
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    return { ok: false };
  }, { withFlow: false });
  await waitForCondition(() => w.document.getElementById('startRescheduleBtn'));
  assert.equal(w.document.getElementById('addToCalendarBtn'), null, 'no calendar buttons without the helper');
  w.document.getElementById('startRescheduleBtn').click();
  await waitForCondition(() => w.document.querySelectorAll('.date-btn').length > 1);
  w.document.querySelectorAll('.date-btn')[1].click();
  await waitForCondition(() => w.document.querySelectorAll('.slot-btn').length > 0);
});
