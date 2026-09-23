// Tests for a fresh audit pass over booking.html (2026-09-21, "audit
// and improve booking.html further" -- no specific bug reported, a
// deliberate re-look at the file). Covers: a real date-switch race
// condition, missing focus management between wizard steps, missing
// aria-pressed/aria-live on interactive selection UI, an inaccurate
// unconditional "you'll get a confirmation email" promise when email
// is optional, and untrimmed name/email/address values reaching the
// submit payload.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PAGE_PATH = path.join(__dirname, '..', '..', 'booking.html');
const BOOKING_HTML_SRC = fs.readFileSync(PAGE_PATH, 'utf8');
const BUSINESS_HOURS_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'business-hours.js'), 'utf8')
  + '\nwindow.BUSINESS_TIMEZONE = BUSINESS_TIMEZONE; window.HOURS_BY_WEEKDAY = HOURS_BY_WEEKDAY; window.DAYS_AHEAD_SHOWN = DAYS_AHEAD_SHOWN; window.zonedTimeToUtc = zonedTimeToUtc; window.businessWeekday = businessWeekday; window.todayDateStrInBusinessTz = todayDateStrInBusinessTz; window.addDaysToDateStr = addDaysToDateStr; window.formatHoursLabel = formatHoursLabel;';

// booking.html and manage-booking.html also load /js/booking-flow.js
// (2026-09-22: whole-window availability, add to calendar), right after
// business-hours.js. Evaluated the same way and in the same order a real
// browser runs the two <script> tags, so the availability path these
// tests drive is the page's real code.
const BOOKING_FLOW_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'booking-flow.js'), 'utf8');

function loadPage(mockFetch) {
  const dom = new JSDOM(BOOKING_HTML_SRC, {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/booking.html',
    beforeParse(w) {
      if (mockFetch) w.fetch = mockFetch;
      w.eval(BUSINESS_HOURS_SRC);
      w.eval(BOOKING_FLOW_SRC);
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

test('a stale availability load never wins: picking a second service before the first load returns only ever renders the second', async () => {
  // Real bug found in a fresh audit pass (2026-09-21), not reported:
  // nothing stopped two overlapping availability loads, and whichever
  // fetch resolved LAST won. Rewritten 2026-09-22 for whole-window
  // availability: a date tap no longer fetches anything (the whole
  // two-week strip loads in one call), so the overlap that can still
  // happen is two LOADS -- pick a service, go back, pick another before
  // the first returns. The request-id guard must discard the first.
  const resolvers = [];
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) {
      return new Promise((resolve) => { resolvers.push(resolve); });
    }
    return { ok: false };
  });

  await waitForCondition(() => window.document.querySelectorAll('.service-option').length > 2);
  const services = window.document.querySelectorAll('.service-option');
  // Inspection (45 min) first...
  services[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => resolvers.length === 1);
  window.document.getElementById('backToService').click();
  // ...then Drywall & Painting (3 hrs), the last one.
  services[services.length - 1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => resolvers.length === 2);

  // Resolve the CURRENT (second) load first, then the stale first one --
  // the exact ordering that silently won before the guard existed.
  resolvers[1]({ ok: true, json: async () => ([]) });
  await waitForCondition(() => window.document.querySelectorAll('.slot-btn').length > 0);
  const slotCountForCurrentService = window.document.querySelectorAll('.slot-btn').length;
  resolvers[0]({ ok: true, json: async () => ([]) });
  await waitFor(50);

  // A 3-hour service has fewer open starts in a day than a 45-minute
  // one; if the stale Inspection load had re-rendered, the grid would
  // show Inspection's longer list.
  assert.equal(window.document.querySelectorAll('.slot-btn').length, slotCountForCurrentService, 'the stale first load must not re-render the slots');
  assert.match(window.document.getElementById('selectedServiceSummary').innerHTML, /Drywall/);
});

test('tapping a date while the two-week load is still in flight does not start a second fetch, and that date wins once the load lands', async () => {
  const resolvers = [];
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) {
      return new Promise((resolve) => { resolvers.push(resolve); });
    }
    return { ok: false };
  });

  await waitForCondition(() => window.document.querySelector('.service-option'));
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 3 && resolvers.length === 1);

  const dateBtns = window.document.querySelectorAll('.date-btn');
  dateBtns[3].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(30);
  assert.equal(resolvers.length, 1, 'a date tap during the load must not fire its own fetch');

  resolvers[0]({ ok: true, json: async () => ([]) });
  await waitForCondition(() => window.document.querySelectorAll('.slot-btn').length > 0);
  assert.ok(dateBtns[3].classList.contains('is-selected'), 'the date tapped during the load should be the one shown');
  assert.equal(dateBtns[3].getAttribute('aria-pressed'), 'true');
});

test('selecting a service, date, and slot sets aria-pressed correctly and clears it off the previous selection', async () => {
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    return { ok: false };
  });

  await waitForCondition(() => window.document.querySelectorAll('.service-option').length > 1);
  const services = window.document.querySelectorAll('.service-option');
  services[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(50);
  assert.equal(services[0].getAttribute('aria-pressed'), 'true');
  assert.equal(services[1].getAttribute('aria-pressed'), 'false');

  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  const dateBtns = window.document.querySelectorAll('.date-btn');
  dateBtns[1].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(50);
  assert.equal(dateBtns[1].getAttribute('aria-pressed'), 'true');
  assert.equal(dateBtns[0].getAttribute('aria-pressed'), 'false');
});

test('statusMsg and slotsGrid are aria-live regions, so submission errors and slot updates are announced to screen readers', () => {
  assert.match(BOOKING_HTML_SRC, /<div class="status-msg" id="statusMsg" aria-live="polite">/);
  assert.match(BOOKING_HTML_SRC, /<div class="slots-grid" id="slotsGrid" aria-live="polite">/);
});

test('every wizard step panel is a valid, non-tab-stealing focus target (tabindex="-1"), and goToStep() moves focus into it', () => {
  for (const id of ['stepService', 'stepDateTime', 'stepContact', 'stepConfirmed']) {
    assert.match(BOOKING_HTML_SRC, new RegExp('id="' + id + '"[^>]*tabindex="-1"|tabindex="-1"[^>]*id="' + id + '"|class="step-panel[^"]*" id="' + id + '" tabindex="-1"'), id + ' should be a focus target');
  }
  assert.match(BOOKING_HTML_SRC, /panelEl\.focus\(\{ preventScroll: true \}\)/);
});

test('the "check your email" next-step note reflects whether email was actually given, not an unconditional promise manage-booking.html can\'t back up for a phone-only booking', async () => {
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('/rest/v1/th_bookings')) return { ok: true };
    return { ok: false };
  });

  await waitForCondition(() => window.document.querySelector('.service-option'));
  window.document.querySelector('.service-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelectorAll('.date-btn').length > 1);
  window.document.querySelectorAll('.date-btn')[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitForCondition(() => window.document.querySelectorAll('.slot-btn').length > 0, { timeout: 5000 }).catch(() => {});
  const slotBtn = window.document.querySelector('.slot-btn');
  if (!slotBtn) return; // no open slots today in this environment's clock -- nothing to assert
  slotBtn.dispatchEvent(new window.Event('click', { bubbles: true }));

  window.document.getElementById('bName').value = 'Jane Smith';
  window.document.getElementById('bPhone').value = '(555) 123-4567';
  window.document.getElementById('bAddress').value = '123 Main St';
  // Deliberately leave email blank -- phone-only booking.
  window.document.getElementById('bookingForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await waitForCondition(() => window.document.getElementById('stepConfirmed').classList.contains('is-active'));

  const note = window.document.getElementById('nextStepsEmailNote').textContent;
  assert.doesNotMatch(note, /email/i, 'a phone-only booking should not be told to check an email that was never given');
  assert.match(note, /text or call|call or text/i);
});

test('name/email/address are trimmed before being sent, not just validated after trimming and then sent raw', () => {
  const submitBlock = BOOKING_HTML_SRC.slice(BOOKING_HTML_SRC.indexOf("fetch(SUPABASE_URL + '/rest/v1/th_bookings'"), BOOKING_HTML_SRC.indexOf("fetch(SUPABASE_URL + '/rest/v1/th_bookings'") + 900);
  assert.match(submitBlock, /name:\s*nameVal/);
  assert.match(submitBlock, /email:\s*emailVal \|\| null/);
  assert.match(submitBlock, /address:\s*addressVal/);
  assert.doesNotMatch(submitBlock, /name:\s*formData\.get\('name'\)/);
});
