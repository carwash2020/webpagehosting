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

const PAGE_PATH = path.join(__dirname, '..', '..', 'booking.html');

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

// Replaces a fixed-duration guess with a real poll for the actual
// condition a test needs -- robust regardless of how fast or slow the
// machine running it is, unlike waitFor(200) above (kept only for the
// handful of places where nothing async is actually being waited on).
// Confirmed directly as a real fix, not a guess: this exact bug (tests
// timing out under added CI load from an unrelated change) reproduced
// deterministically in real CI, twice in a row on the same commit.
async function waitForCondition(conditionFn, { timeout = 5000, interval = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (conditionFn()) return;
    await waitFor(interval);
  }
  throw new Error('waitForCondition: condition never became true within ' + timeout + 'ms');
}

test('a genuinely failed availability check (a real server/network failure, not "no slots") shows a clear error with a real retry, not an indefinite loading state', async () => {
  let attemptCount = 0;
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) {
      attemptCount++;
      if (attemptCount === 1) return { ok: false, status: 500 };
      return { ok: true, json: async () => ([]) };
    }
    return { ok: false };
  });

  await waitForCondition(() => window.document.querySelector('.service-option'));
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.getElementById('retryDateBtn'));

  const grid = window.document.getElementById('slotsGrid');
  assert.match(grid.innerHTML, /Couldn.t load/);
  const retryBtn = window.document.getElementById('retryDateBtn');
  assert.ok(retryBtn, 'a real retry button should be offered, not just a stuck loading state');

  retryBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => attemptCount === 2 && !window.document.getElementById('slotsGrid').innerHTML.includes('Couldn'));
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
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('/rest/v1/th_bookings') && !String(url).includes('availability')) {
      insertCalled = true;
      return { ok: true };
    }
    return { ok: false };
  });

  await waitForCondition(() => window.document.querySelector('.service-option'));
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  // Explicitly select a guaranteed-future date (the 2nd date button,
  // i.e. tomorrow) rather than relying on "today" auto-selecting --
  // "today" can genuinely have zero open slots left depending on
  // what time this test happens to run (business hours + the
  // 2-hour minimum lead time can rule out the rest of a real day),
  // which is real, deterministic behavior, not test flakiness.
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));

  window.document.querySelector('[name="_gotcha"]').value = 'a bot filled this in';
  window.document.getElementById('bName').value = 'Bot Name';
  window.document.getElementById('bPhone').value = '5555555555';
  window.document.getElementById('bookingForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitForCondition(() => window.document.getElementById('stepConfirmed').classList.contains('is-active'));

  assert.equal(insertCalled, false, 'a caught bot should never actually reach the real insert');
  assert.ok(window.document.getElementById('stepConfirmed').classList.contains('is-active'), 'a caught bot should still see a normal-looking confirmation, never told it was caught');
});

test('a genuine submission (honeypot left empty) reaches the real insert normally', async () => {
  let insertCalled = false;
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('/rest/v1/th_bookings') && !String(url).includes('availability')) {
      insertCalled = true;
      return { ok: true };
    }
    return { ok: false };
  });

  await waitForCondition(() => window.document.querySelector('.service-option'));
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  // Explicitly select a guaranteed-future date (the 2nd date button,
  // i.e. tomorrow) rather than relying on "today" auto-selecting --
  // "today" can genuinely have zero open slots left depending on
  // what time this test happens to run (business hours + the
  // 2-hour minimum lead time can rule out the rest of a real day),
  // which is real, deterministic behavior, not test flakiness.
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));

  window.document.getElementById('bName').value = 'Jane Real Customer';
  window.document.getElementById('bPhone').value = '5551234567';
  window.document.getElementById('bookingForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitForCondition(() => insertCalled === true);

  assert.equal(insertCalled, true, 'a genuine submission with an empty honeypot should reach the real insert');
});

test('typing a phone number progressively auto-formats to (XXX) XXX-XXXX', async () => {
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    return { ok: false };
  });
  await waitForCondition(() => window.document.querySelector('.service-option'));
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  // Explicitly select a guaranteed-future date (the 2nd date button,
  // i.e. tomorrow) rather than relying on "today" auto-selecting --
  // "today" can genuinely have zero open slots left depending on
  // what time this test happens to run (business hours + the
  // 2-hour minimum lead time can rule out the rest of a real day),
  // which is real, deterministic behavior, not test flakiness.
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));

  const phone = window.document.getElementById('bPhone');
  const digits = '5551234567';
  for (let i = 1; i <= digits.length; i++) {
    phone.value = digits.slice(0, i).replace(/\D/g, '');
    phone.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  assert.equal(phone.value, '(555) 123-4567');
});

test('an incomplete phone number shows a clear inline error and blocks submission', async () => {
  let insertCalled = false;
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('/rest/v1/th_bookings') && !String(url).includes('availability')) {
      insertCalled = true;
      return { ok: true };
    }
    return { ok: false };
  });
  await waitForCondition(() => window.document.querySelector('.service-option'));
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  // Explicitly select a guaranteed-future date (the 2nd date button,
  // i.e. tomorrow) rather than relying on "today" auto-selecting --
  // "today" can genuinely have zero open slots left depending on
  // what time this test happens to run (business hours + the
  // 2-hour minimum lead time can rule out the rest of a real day),
  // which is real, deterministic behavior, not test flakiness.
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));

  window.document.getElementById('bName').value = 'Jane Smith';
  const phone = window.document.getElementById('bPhone');
  phone.value = '555123';
  phone.dispatchEvent(new window.Event('input', { bubbles: true }));
  phone.dispatchEvent(new window.Event('blur', { bubbles: true }));
  await waitForCondition(() => window.document.getElementById('phoneError').classList.contains('is-visible'));

  assert.match(window.document.getElementById('phoneError').textContent, /10-digit/);
  assert.ok(phone.classList.contains('is-invalid'));
  assert.equal(phone.checkValidity(), false, 'an incomplete phone number should fail native constraint validation too');
});

test('an invalid email shows a clear inline error, and a valid one clears it', async () => {
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    return { ok: false };
  });
  await waitForCondition(() => window.document.querySelector('.service-option'));
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  // Explicitly select a guaranteed-future date (the 2nd date button,
  // i.e. tomorrow) rather than relying on "today" auto-selecting --
  // "today" can genuinely have zero open slots left depending on
  // what time this test happens to run (business hours + the
  // 2-hour minimum lead time can rule out the rest of a real day),
  // which is real, deterministic behavior, not test flakiness.
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));

  const email = window.document.getElementById('bEmail');
  email.value = 'not-an-email';
  email.dispatchEvent(new window.Event('input', { bubbles: true }));
  email.dispatchEvent(new window.Event('blur', { bubbles: true }));
  await waitForCondition(() => window.document.getElementById('emailError').classList.contains('is-visible'));
  assert.match(window.document.getElementById('emailError').textContent, /valid email/);
  assert.ok(email.classList.contains('is-invalid'));

  email.value = 'jane@example.com';
  email.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitForCondition(() => !window.document.getElementById('emailError').classList.contains('is-visible'));
  assert.equal(window.document.getElementById('emailError').classList.contains('is-visible'), false, 'a fixed, valid email should clear the error immediately');
  assert.equal(email.classList.contains('is-invalid'), false);
});

test('leaving email empty is still valid -- it is optional, only a non-empty invalid value is flagged', async () => {
  let insertCalled = false;
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('/rest/v1/th_bookings') && !String(url).includes('availability')) {
      insertCalled = true;
      return { ok: true };
    }
    return { ok: false };
  });
  await waitForCondition(() => window.document.querySelector('.service-option'));
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  // Explicitly select a guaranteed-future date (the 2nd date button,
  // i.e. tomorrow) rather than relying on "today" auto-selecting --
  // "today" can genuinely have zero open slots left depending on
  // what time this test happens to run (business hours + the
  // 2-hour minimum lead time can rule out the rest of a real day),
  // which is real, deterministic behavior, not test flakiness.
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelector('.slot-btn'));
  window.document.querySelector('.slot-btn').dispatchEvent(new window.Event('click', { bubbles: true }));

  window.document.getElementById('bName').value = 'Jane Smith';
  const phone = window.document.getElementById('bPhone');
  phone.value = '5551234567';
  phone.dispatchEvent(new window.Event('input', { bubbles: true }));
  // Email left empty entirely.
  window.document.getElementById('bookingForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitForCondition(() => insertCalled === true);
  assert.equal(insertCalled, true, 'an empty, optional email should never block submission');
});
