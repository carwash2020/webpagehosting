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

const PAGE_PATH = path.join(__dirname, '..', 'manage-booking.html');

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
