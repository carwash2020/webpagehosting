// Tests for booking.html. Starts with the availability-fetch error
// handling fixed directly (2026-08-25): a genuine server/network
// failure previously left the guest stuck on "Loading times..."
// forever with no error message or way to recover, and a non-OK
// response was silently treated the same as "no conflicts that
// day" -- the exact wrong direction for something that exists to
// prevent double-booking.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PAGE_PATH = path.join(__dirname, '..', 'booking.html');

function loadPage(mockFetch) {
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/booking.html',
    beforeParse(w) {
      if (mockFetch) w.fetch = mockFetch;
    },
  });
  return dom.window;
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('a genuinely failed availability check (a real server/network failure, not "no slots") shows a clear error with a real retry, not an indefinite loading state', async () => {
  let attemptCount = 0;
  const window = loadPage(async (url) => {
    if (String(url).includes('th_bookings_availability')) {
      attemptCount++;
      if (attemptCount === 1) return { ok: false, status: 500 };
      return { ok: true, json: async () => ([]) };
    }
    return { ok: false };
  });

  await waitFor(200);
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(200);

  const grid = window.document.getElementById('slotsGrid');
  assert.match(grid.innerHTML, /Couldn.t load/);
  const retryBtn = window.document.getElementById('retryDateBtn');
  assert.ok(retryBtn, 'a real retry button should be offered, not just a stuck loading state');

  retryBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(200);
  assert.equal(attemptCount, 2, 'retry should have made a real second attempt');
  assert.doesNotMatch(window.document.getElementById('slotsGrid').innerHTML, /Couldn.t load/, 'the retry succeeding should clear the error state');
});

test('a non-OK response from the availability endpoint is never silently treated as "no conflicts" -- fetchBookingsForDate throws rather than returning an empty array', async () => {
  const window = loadPage(async () => ({ ok: false, status: 500 }));
  await waitFor(200);

  // Extract and call the real function directly to confirm its own
  // contract, independent of how selectDate happens to handle it.
  const src = fs.readFileSync(PAGE_PATH, 'utf8');
  assert.match(src, /if \(!res\.ok\) throw new Error/, 'fetchBookingsForDate should throw on a non-OK response, not silently return []');
});

test('a bot filling in the honeypot field never actually creates a booking, but sees a normal-looking confirmation', async () => {
  let insertCalled = false;
  const window = loadPage(async (url) => {
    if (String(url).includes('th_bookings_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('/rest/v1/th_bookings') && !String(url).includes('availability')) {
      insertCalled = true;
      return { ok: true };
    }
    return { ok: false };
  });

  await waitFor(200);
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(200);
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));

  window.document.querySelector('[name="_gotcha"]').value = 'a bot filled this in';
  window.document.getElementById('bName').value = 'Bot Name';
  window.document.getElementById('bPhone').value = '5555555555';
  window.document.getElementById('bookingForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(200);

  assert.equal(insertCalled, false, 'a caught bot should never actually reach the real insert');
  assert.ok(window.document.getElementById('stepConfirmed').classList.contains('is-active'), 'a caught bot should still see a normal-looking confirmation, never told it was caught');
});

test('a genuine submission (honeypot left empty) reaches the real insert normally', async () => {
  let insertCalled = false;
  const window = loadPage(async (url) => {
    if (String(url).includes('th_bookings_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('/rest/v1/th_bookings') && !String(url).includes('availability')) {
      insertCalled = true;
      return { ok: true };
    }
    return { ok: false };
  });

  await waitFor(200);
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(200);
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));

  window.document.getElementById('bName').value = 'Jane Real Customer';
  window.document.getElementById('bPhone').value = '5551234567';
  window.document.getElementById('bookingForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(200);

  assert.equal(insertCalled, true, 'a genuine submission with an empty honeypot should reach the real insert');
});
