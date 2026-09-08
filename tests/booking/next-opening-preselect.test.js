// U04/W17 fix (High-Impact Upgrades, Master Audit, 2026-09-08): "A site
// that says 'next opening Thursday 9:00 AM' feels staffed and organised
// in a way almost no trade site does." The homepage's open/closed pill
// now shows the real next available slot (business-hours.js's new
// findNextAvailableSlot, tested separately below) with a link into
// booking.html?service=X&date=Y. This file locks in booking.html's own
// half: reading those params and landing the visitor on exactly that
// day, without racing its own default "today" selection.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PAGE_PATH = path.join(__dirname, '..', '..', 'booking.html');
const BUSINESS_HOURS_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'business-hours.js'), 'utf8')
  + '\nwindow.BUSINESS_TIMEZONE = BUSINESS_TIMEZONE; window.HOURS_BY_WEEKDAY = HOURS_BY_WEEKDAY; window.DAYS_AHEAD_SHOWN = DAYS_AHEAD_SHOWN; window.zonedTimeToUtc = zonedTimeToUtc; window.businessWeekday = businessWeekday; window.todayDateStrInBusinessTz = todayDateStrInBusinessTz; window.addDaysToDateStr = addDaysToDateStr; window.formatHoursLabel = formatHoursLabel; window.fetchBookingsForDate = fetchBookingsForDate; window.computeSlotsForDate = computeSlotsForDate; window.findNextAvailableSlot = findNextAvailableSlot;';

function loadPage(url, mockFetch) {
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      if (mockFetch) w.fetch = mockFetch;
      w.eval(BUSINESS_HOURS_SRC);
    },
  });
  return dom.window;
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(conditionFn, { timeout = 5000, interval = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (conditionFn()) return;
    await waitFor(interval);
  }
  throw new Error('waitForCondition: condition never became true within ' + timeout + 'ms');
}

const NO_BOOKINGS_FETCH = async (url) => {
  if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
  return { ok: false };
};

test('a ?service=X&date=Y link lands directly on that service and date, skipping back to step 1', async () => {
  const window = loadPage('https://www.triplehenterprisesllc.biz/booking.html?service=inspection&date=2026-09-14', NO_BOOKINGS_FETCH);
  await waitForCondition(() => window.document.querySelectorAll('.slot-btn').length > 0);

  assert.match(window.document.getElementById('selectedServiceSummary').innerHTML, /Inspection/);
  const selectedDateBtn = window.document.querySelector('.date-btn.is-selected');
  assert.ok(selectedDateBtn, 'expected a date button marked selected');
  assert.equal(selectedDateBtn.dataset.date, '2026-09-14');
});

test('the preselect never fires a second, racing availability fetch for "today" alongside the requested date', async () => {
  const fetchedDates = [];
  const window = loadPage('https://www.triplehenterprisesllc.biz/booking.html?service=inspection&date=2026-09-14', async (url, opts) => {
    if (String(url).includes('get_booking_availability')) {
      // Every real caller posts a JSON body naming the range it wants --
      // recording it here is how this test tells whether the visible
      // "today" default was ever actually queried, not just avoided visually.
      try { fetchedDates.push(JSON.parse(opts.body).p_range_start); } catch (e) { /* ignore */ }
      return { ok: true, json: async () => ([]) };
    }
    return { ok: false };
  });
  await waitForCondition(() => window.document.querySelectorAll('.slot-btn').length > 0);
  await waitFor(50); // let any stray second fetch this test is checking for actually land

  assert.equal(fetchedDates.length, 1, 'expected exactly one availability fetch -- a race would cause two');
});

test('an unrecognized service key is ignored, leaving the normal step-1 flow in place', async () => {
  const window = loadPage('https://www.triplehenterprisesllc.biz/booking.html?service=not-a-real-service&date=2026-09-14', NO_BOOKINGS_FETCH);
  await waitForCondition(() => window.document.querySelector('.service-option'));
  await waitFor(50);

  assert.doesNotMatch(window.document.getElementById('selectedServiceSummary').innerHTML, /Inspection/);
  assert.equal(window.document.querySelectorAll('.slot-btn').length, 0, 'should still be sitting on step 1, no slots rendered yet');
});

test('a malformed date param is ignored -- falls back to today rather than passing a bad string straight to selectDate', async () => {
  const window = loadPage('https://www.triplehenterprisesllc.biz/booking.html?service=inspection&date=not-a-date', NO_BOOKINGS_FETCH);
  await waitForCondition(() => window.document.querySelectorAll('.slot-btn').length > 0 || window.document.getElementById('slotsEmpty').style.display === 'block');

  const selectedDateBtn = window.document.querySelector('.date-btn.is-selected');
  assert.ok(selectedDateBtn, 'expected today to be selected as the fallback');
  assert.equal(selectedDateBtn.dataset.date, window.todayDateStrInBusinessTz());
});

test('no query params at all behaves exactly as before -- step 1, no service preselected', async () => {
  const window = loadPage('https://www.triplehenterprisesllc.biz/booking.html', NO_BOOKINGS_FETCH);
  await waitForCondition(() => window.document.querySelector('.service-option'));
  await waitFor(50);

  assert.equal(window.document.querySelectorAll('.slot-btn').length, 0);
  assert.doesNotMatch(window.document.getElementById('selectedServiceSummary').innerHTML, /Inspection|Plumbing|Appliance|Handyman|Assembly|Drywall/);
});
