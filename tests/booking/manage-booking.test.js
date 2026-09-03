// Tests for manage-booking.html, the guest-facing cancel flow
// (2026-08-25), requested directly: "the way to cancel being the
// first" piece to build on top of the booking system. Mocked fetch
// responses match the real shape confirmed directly against the live
// database when the underlying get_booking_by_cancel_token/
// cancel_booking_by_token RPC functions were first built and tested.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PAGE_PATH = path.join(__dirname, '..', '..', 'manage-booking.html');
const BUSINESS_HOURS_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'business-hours.js'), 'utf8')
  // See booking.test.js's identical comment for why this explicit
  // window.X = X exposure is needed -- const declarations via
  // indirect eval() don't become window properties on their own.
  + '\nwindow.BUSINESS_TIMEZONE = BUSINESS_TIMEZONE; window.HOURS_BY_WEEKDAY = HOURS_BY_WEEKDAY; window.DAYS_AHEAD_SHOWN = DAYS_AHEAD_SHOWN; window.zonedTimeToUtc = zonedTimeToUtc; window.businessWeekday = businessWeekday; window.todayDateStrInBusinessTz = todayDateStrInBusinessTz; window.addDaysToDateStr = addDaysToDateStr; window.formatHoursLabel = formatHoursLabel;';

function loadPage(url, mockFetch) {
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      if (mockFetch) w.fetch = mockFetch;
      // jsdom never fetches external <script src> files --
      // manage-booking.html now loads /business-hours.js (2026-09-03).
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

test('a valid, confirmed booking shows its real details and a working cancel button', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async (url) => {
      if (String(url).includes('get_booking_by_cancel_token')) {
        return {
          ok: true,
          json: async () => ([{
            service_label: 'Appliance Repair',
            start_at: '2026-09-16T21:00:00+00:00',
            end_at: '2026-09-16T23:00:00+00:00',
            name: 'Jane Smith',
            status: 'confirmed',
          }]),
        };
      }
      return { ok: false };
    },
  );
  await waitFor(200);
  const content = window.document.getElementById('content').innerHTML;
  assert.match(content, /Appliance Repair/);
  assert.match(content, /Wednesday, September 16/);
  assert.ok(window.document.getElementById('startCancelBtn'), 'cancel button should be present for a confirmed booking');
});

test('clicking Cancel shows a confirmation step before actually cancelling anything', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async () => ({
      ok: true,
      json: async () => ([{
        service_label: 'Inspection',
        start_at: '2026-09-16T21:00:00+00:00',
        end_at: '2026-09-16T21:45:00+00:00',
        name: 'Test',
        status: 'confirmed',
      }]),
    }),
  );
  await waitFor(200);
  window.document.getElementById('startCancelBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(window.document.getElementById('confirmStep').classList.contains('is-active'), 'confirmation step should appear before cancelling');
  assert.ok(window.document.getElementById('confirmCancelBtn'), 'a real confirm button should exist');
  assert.ok(window.document.getElementById('backOutBtn'), 'a way to back out without cancelling should exist');
});

test('confirming the cancellation calls the real RPC and shows a success message', async () => {
  let cancelCalled = false;
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async (url) => {
      if (String(url).includes('cancel_booking_by_token')) {
        cancelCalled = true;
        return { ok: true, json: async () => ([{ ok: true, message: 'cancelled' }]) };
      }
      return {
        ok: true,
        json: async () => ([{
          service_label: 'Inspection', start_at: '2026-09-16T21:00:00+00:00', end_at: '2026-09-16T21:45:00+00:00', name: 'Test', status: 'confirmed',
        }]),
      };
    },
  );
  await waitFor(200);
  window.document.getElementById('startCancelBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  window.document.getElementById('confirmCancelBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(200);
  assert.ok(cancelCalled, 'the actual cancel RPC should have been called');
  assert.match(window.document.getElementById('content').innerHTML, /has been cancelled/);
});

test('a booking that was already cancelled shows that clearly and offers no cancel button', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async () => ({
      ok: true,
      json: async () => ([{
        service_label: 'Plumbing Fixes & Leaks',
        start_at: '2026-09-16T21:00:00+00:00',
        end_at: '2026-09-16T22:00:00+00:00',
        name: 'Test',
        status: 'cancelled',
      }]),
    }),
  );
  await waitFor(200);
  const content = window.document.getElementById('content').innerHTML;
  assert.match(content, /already been cancelled/);
  assert.equal(window.document.getElementById('startCancelBtn'), null, 'no cancel button should be offered for an already-cancelled booking');
});

test('an unknown token shows a clear, actionable message instead of a blank page', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=does-not-exist',
    async () => ({ ok: true, json: async () => ([]) }),
  );
  await waitFor(200);
  assert.match(window.document.getElementById('content').innerHTML, /couldn.t find a booking/);
});

test('no token at all in the URL shows a helpful message rather than attempting any RPC call', async () => {
  let anyFetchCalled = false;
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html',
    async () => { anyFetchCalled = true; return { ok: false }; },
  );
  await waitFor(200);
  assert.match(window.document.getElementById('content').innerHTML, /missing some information/);
  assert.equal(anyFetchCalled, false, 'should not attempt any network call without a token');
});

test('a Reschedule button exists alongside Cancel for a confirmed booking', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async () => ({
      ok: true,
      json: async () => ([{
        service_label: 'Inspection', start_at: '2026-09-20T21:00:00+00:00', end_at: '2026-09-20T21:45:00+00:00', name: 'Test', status: 'confirmed',
      }]),
    }),
  );
  await waitFor(200);
  assert.ok(window.document.getElementById('startRescheduleBtn'), 'reschedule button should be present for a confirmed booking');
});

test('clicking Reschedule shows a real date/time picker with actual open slots', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async (url) => {
      if (String(url).includes('get_booking_by_cancel_token')) {
        return {
          ok: true,
          json: async () => ([{ service_label: 'Inspection', start_at: '2026-09-20T21:00:00+00:00', end_at: '2026-09-20T21:45:00+00:00', name: 'Test', status: 'confirmed' }]),
        };
      }
      if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
      return { ok: false };
    },
  );
  await waitForCondition(() => window.document.getElementById('startRescheduleBtn'));
  window.document.getElementById('startRescheduleBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  assert.ok(window.document.querySelectorAll('.date-btn').length > 0, 'real date options should render');
  assert.ok(window.document.querySelectorAll('.slot-btn').length > 0, 'real, open time slots should render for the selected date');
});

test('the booking\'s own current slot does not block itself when picking a new time', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async (url) => {
      if (String(url).includes('get_booking_by_cancel_token')) {
        return {
          ok: true,
          json: async () => ([{ service_label: 'Inspection', start_at: '2026-09-20T21:00:00+00:00', end_at: '2026-09-20T21:45:00+00:00', name: 'Test', status: 'confirmed' }]),
        };
      }
      if (String(url).includes('get_booking_availability')) {
        return { ok: true, json: async () => ([{ start_at: '2026-09-20T21:00:00+00:00', end_at: '2026-09-20T21:45:00+00:00' }]) };
      }
      return { ok: false };
    },
  );
  await waitForCondition(() => window.document.getElementById('startRescheduleBtn'));
  window.document.getElementById('startRescheduleBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  assert.ok(window.document.querySelectorAll('.slot-btn').length > 0, 'slots should still be offered -- the booking\'s own current time should not block itself');
});

test('picking a slot calls the real reschedule RPC with the correct token and a real new start time, and shows success', async () => {
  let rpcCalled = false;
  let rpcArgs = null;
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async (url, opts) => {
      if (String(url).includes('get_booking_by_cancel_token')) {
        return {
          ok: true,
          json: async () => ([{ service_label: 'Inspection', start_at: '2026-09-20T21:00:00+00:00', end_at: '2026-09-20T21:45:00+00:00', name: 'Test', status: 'confirmed' }]),
        };
      }
      if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
      if (String(url).includes('reschedule_booking_by_token')) {
        rpcCalled = true;
        rpcArgs = JSON.parse(opts.body);
        return { ok: true, json: async () => ([{ ok: true, message: 'rescheduled' }]) };
      }
      return { ok: false };
    },
  );
  await waitForCondition(() => window.document.getElementById('startRescheduleBtn'));
  window.document.getElementById('startRescheduleBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.getElementById('content').innerHTML.includes('has been rescheduled'));

  assert.ok(rpcCalled, 'the real reschedule RPC should have been called');
  assert.equal(rpcArgs.p_token, 'abc-123');
  assert.ok(rpcArgs.p_new_start, 'a new start time should have been sent');
  assert.match(window.document.getElementById('content').innerHTML, /has been rescheduled/);
});

test('a slot-taken response (a real collision caught by the database) is handled clearly, not as a generic error', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async (url) => {
      if (String(url).includes('get_booking_by_cancel_token')) {
        return {
          ok: true,
          json: async () => ([{ service_label: 'Inspection', start_at: '2026-09-20T21:00:00+00:00', end_at: '2026-09-20T21:45:00+00:00', name: 'Test', status: 'confirmed' }]),
        };
      }
      if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
      if (String(url).includes('reschedule_booking_by_token')) return { ok: true, json: async () => ([{ ok: false, message: 'slot-taken' }]) };
      return { ok: false };
    },
  );
  await waitForCondition(() => window.document.getElementById('startRescheduleBtn'));
  window.document.getElementById('startRescheduleBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.getElementById('content').innerHTML.includes('just taken'));
  assert.match(window.document.getElementById('content').innerHTML, /just taken/);
});

test('a confirmed booking whose time has already passed shows that clearly, with no Cancel or Reschedule buttons offered', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async () => ({
      ok: true,
      json: async () => ([{
        service_label: 'Inspection', start_at: '2020-01-01T15:00:00+00:00', end_at: '2020-01-01T15:45:00+00:00', name: 'Test', status: 'confirmed',
      }]),
    }),
  );
  await waitFor(200);
  const content = window.document.getElementById('content').innerHTML;
  assert.match(content, /already happened/);
  assert.equal(window.document.getElementById('startCancelBtn'), null, 'no cancel button should be offered for an appointment that already happened');
  assert.equal(window.document.getElementById('startRescheduleBtn'), null, 'no reschedule button should be offered for an appointment that already happened');
});

test('a genuinely failed availability check (not "no slots", an actual server/network failure) shows a clear error with a real retry, not an indefinite loading state', async () => {
  let attemptCount = 0;
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-booking.html?token=abc-123',
    async (url) => {
      if (String(url).includes('get_booking_by_cancel_token')) {
        return {
          ok: true,
          json: async () => ([{ service_label: 'Inspection', start_at: '2026-09-20T21:00:00+00:00', end_at: '2026-09-20T21:45:00+00:00', name: 'Test', status: 'confirmed' }]),
        };
      }
      if (String(url).includes('get_booking_availability')) {
        attemptCount++;
        if (attemptCount === 1) return { ok: false, status: 500 };
        return { ok: true, json: async () => ([]) };
      }
      return { ok: false };
    },
  );
  await waitFor(200);
  window.document.getElementById('startRescheduleBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(300);

  const grid = window.document.getElementById('slotsGrid');
  assert.match(grid.innerHTML, /Couldn.t load/);
  const retryBtn = window.document.getElementById('retryDateBtn');
  assert.ok(retryBtn, 'a real retry button should be offered, not just a stuck loading state');

  retryBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(300);
  assert.equal(attemptCount, 2, 'retry should have made a real second attempt');
  assert.doesNotMatch(window.document.getElementById('slotsGrid').innerHTML, /Couldn.t load/, 'the retry succeeding should clear the error state');
});
