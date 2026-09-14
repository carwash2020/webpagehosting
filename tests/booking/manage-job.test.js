// Tests for manage-job.html, the guest-facing cancel/reschedule-
// request flow for manually-scheduled jobs (2026-09-11), direct
// follow-up request: "do the reschedule/cancel link. i beleive we
// have already got that in some places" -- confirmed self-service
// bookings already had this (manage-booking.html); manually-scheduled
// jobs (public.jobs) had no equivalent at all.
//
// Reschedule here is REQUEST-ONLY, not the instant slot-picker
// manage-booking.html offers: job_date has no time-slot exclusion
// constraint the way th_bookings does, so an unattended instant move
// could silently double-book a day already committed to another job
// (explicit design decision, confirmed directly). The customer
// submits a preferred date; staff review and apply it by hand.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PAGE_PATH = path.join(__dirname, '..', '..', 'manage-job.html');

function loadPage(url, mockFetch) {
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      if (mockFetch) w.fetch = mockFetch;
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

test('a valid, not-yet-cancelled job shows its real details and both action buttons', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-job.html?token=abc-123',
    async (url) => {
      if (String(url).includes('get_job_by_cancel_token')) {
        return {
          ok: true,
          json: async () => ([{ title: 'Fix Fridge', job_date: '2026-09-20', address: '123 Main St', cancelled_at: null, reschedule_requested_date: null }]),
        };
      }
      return { ok: false };
    },
  );
  await waitFor(200);
  const content = window.document.getElementById('content').innerHTML;
  assert.match(content, /Fix Fridge/);
  assert.match(content, /Sunday, September 20/);
  assert.ok(window.document.getElementById('startCancelBtn'), 'cancel button should be present');
  assert.ok(window.document.getElementById('startRescheduleBtn'), 'reschedule-request button should be present');
});

test('clicking Cancel shows a confirmation step before actually cancelling anything', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-job.html?token=abc-123',
    async () => ({ ok: true, json: async () => ([{ title: 'AC Repair', job_date: '2026-09-20', address: null, cancelled_at: null, reschedule_requested_date: null }]) }),
  );
  await waitFor(200);
  window.document.getElementById('startCancelBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(window.document.getElementById('confirmStep').classList.contains('is-active'), 'confirmation step should appear before cancelling');
  assert.ok(window.document.getElementById('confirmCancelBtn'));
  assert.ok(window.document.getElementById('backOutBtn'));
});

test('confirming cancellation calls the real RPC with the token and shows a success message', async () => {
  let cancelCalled = false;
  let cancelArgs = null;
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-job.html?token=abc-123',
    async (url, opts) => {
      if (String(url).includes('cancel_job_by_token')) {
        cancelCalled = true;
        cancelArgs = JSON.parse(opts.body);
        return { ok: true, json: async () => ([{ ok: true, message: 'cancelled' }]) };
      }
      return { ok: true, json: async () => ([{ title: 'Drywall Patch', job_date: '2026-09-20', address: null, cancelled_at: null, reschedule_requested_date: null }]) };
    },
  );
  await waitFor(200);
  window.document.getElementById('startCancelBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  window.document.getElementById('confirmCancelBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(200);
  assert.ok(cancelCalled, 'the actual cancel RPC should have been called');
  assert.equal(cancelArgs.p_token, 'abc-123');
  assert.match(window.document.getElementById('content').innerHTML, /has been cancelled/);
});

test('a job that was already cancelled shows that clearly and offers no action buttons', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-job.html?token=abc-123',
    async () => ({ ok: true, json: async () => ([{ title: 'Water Heater', job_date: '2026-09-20', address: null, cancelled_at: '2026-09-15T12:00:00Z', reschedule_requested_date: null }]) }),
  );
  await waitFor(200);
  const content = window.document.getElementById('content').innerHTML;
  assert.match(content, /already been cancelled/);
  assert.equal(window.document.getElementById('startCancelBtn'), null);
  assert.equal(window.document.getElementById('startRescheduleBtn'), null);
});

test('an unknown token shows a clear, actionable message instead of a blank page', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-job.html?token=does-not-exist',
    async () => ({ ok: true, json: async () => ([]) }),
  );
  await waitFor(200);
  assert.match(window.document.getElementById('content').innerHTML, /couldn.t find an appointment/);
});

test('no token at all in the URL shows a helpful message rather than attempting any RPC call', async () => {
  let anyFetchCalled = false;
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-job.html',
    async () => { anyFetchCalled = true; return { ok: false }; },
  );
  await waitFor(200);
  assert.match(window.document.getElementById('content').innerHTML, /missing some information/);
  assert.equal(anyFetchCalled, false, 'should not attempt any network call without a token');
});

test('clicking "Request a different date" reveals a plain date field, not a live slot picker', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-job.html?token=abc-123',
    async () => ({ ok: true, json: async () => ([{ title: 'Dishwasher Install', job_date: '2026-09-20', address: null, cancelled_at: null, reschedule_requested_date: null }]) }),
  );
  await waitFor(200);
  window.document.getElementById('startRescheduleBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.ok(window.document.getElementById('rescheduleStep').classList.contains('is-active'));
  assert.ok(window.document.getElementById('newDateInput'), 'a plain date input should be offered');
  assert.equal(window.document.querySelector('.slot-btn'), null, 'no live time-slot picker should be offered -- this is a request, not an instant booking-style reschedule');
});

test('submitting a reschedule request calls request_job_reschedule_by_token with the token and chosen date, and never touches job_date directly', async () => {
  let requestCalled = false;
  let requestArgs = null;
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-job.html?token=abc-123',
    async (url, opts) => {
      if (String(url).includes('request_job_reschedule_by_token')) {
        requestCalled = true;
        requestArgs = JSON.parse(opts.body);
        return { ok: true, json: async () => ([{ ok: true, message: 'requested' }]) };
      }
      return { ok: true, json: async () => ([{ title: 'Water Heater', job_date: '2026-09-20', address: null, cancelled_at: null, reschedule_requested_date: null }]) };
    },
  );
  await waitFor(200);
  window.document.getElementById('startRescheduleBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  const input = window.document.getElementById('newDateInput');
  input.value = '2026-09-25';
  window.document.getElementById('submitRescheduleBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(200);
  assert.ok(requestCalled, 'the real request RPC should have been called');
  assert.equal(requestArgs.p_token, 'abc-123');
  assert.equal(requestArgs.p_new_date, '2026-09-25');
  assert.match(window.document.getElementById('content').innerHTML, /we'll reach out to confirm/);
});

test('a job with an existing pending reschedule request shows that request back to the customer', async () => {
  const window = loadPage(
    'https://www.triplehenterprisesllc.biz/manage-job.html?token=abc-123',
    async () => ({ ok: true, json: async () => ([{ title: 'Fence Repair', job_date: '2026-09-20', address: null, cancelled_at: null, reschedule_requested_date: '2026-09-27' }]) }),
  );
  await waitFor(200);
  assert.match(window.document.getElementById('content').innerHTML, /already requested/);
  assert.match(window.document.getElementById('content').innerHTML, /Sunday, September 27/);
});
