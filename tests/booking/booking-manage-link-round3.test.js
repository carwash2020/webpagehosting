// Booking flow, round 3 (2026-09-22): a manage link for EVERY booker.
//
// booking.html now creates the booking through create_booking() -- the same
// row, triggers and double-booking constraint as the old direct insert, but
// it returns the server-generated manage token. So:
//  - the confirmation screen links straight to reschedule/cancel (a
//    phone-only booker used to have no online way to do either);
//  - the calendar file / Google link carry that manage link;
//  - the device remembers the visit (token + service + time only), and a
//    later visit to booking.html shows "You're already booked" -- after
//    re-checking it with the server -- instead of a blank form;
//  - manage-booking.html keeps that memory in sync on reschedule/cancel.
// A 404 from create_booking (not deployed / rolled back) falls back to the
// original direct insert; nothing else ever falls back (no double insert).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const BOOKING_HTML = fs.readFileSync(repo('booking.html'), 'utf8');
const MANAGE_HTML = fs.readFileSync(repo('manage-booking.html'), 'utf8');
const SQL = fs.readFileSync(repo('sql', 'booking', 'add_create_booking_rpc.sql'), 'utf8');
const FLOW_SRC = fs.readFileSync(repo('js', 'booking-flow.js'), 'utf8');
const BUSINESS_HOURS_SRC = fs.readFileSync(repo('js', 'business-hours.js'), 'utf8')
  + '\nwindow.BUSINESS_TIMEZONE = BUSINESS_TIMEZONE; window.HOURS_BY_WEEKDAY = HOURS_BY_WEEKDAY; window.DAYS_AHEAD_SHOWN = DAYS_AHEAD_SHOWN;';

const TOKEN = '11111111-2222-3333-4444-555555555555';
const KEY = 'th_upcoming_booking';

function load(html, url, mockFetch, storage) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(w) {
      w.fetch = mockFetch;
      if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
      w.eval(BUSINESS_HOURS_SRC);
      w.eval(FLOW_SRC);
    },
  });
  return dom.window;
}
const waitFor = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 5000) {
  const t = Date.now();
  while (Date.now() - t < timeout) { if (fn()) return; await waitFor(20); }
  throw new Error('condition never became true');
}

async function book(w, { email = '' } = {}) {
  await until(() => w.document.querySelector('.service-option'));
  w.document.querySelector('.service-option').dispatchEvent(new w.Event('click', { bubbles: true }));
  await until(() => w.document.querySelector('.slot-btn'));
  w.document.querySelector('.slot-btn').dispatchEvent(new w.Event('click', { bubbles: true }));
  w.document.getElementById('bName').value = 'Jane Smith';
  w.document.getElementById('bPhone').value = '(555) 123-4567';
  w.document.getElementById('bAddress').value = '12 Elm St';
  w.document.getElementById('bEmail').value = email;
  w.document.getElementById('bookingForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}

const BOOKING_URL = 'https://www.triplehenterprisesllc.biz/booking.html';

test('booking.html creates the booking through create_booking() and shows everyone a manage link -- even without an email', async () => {
  const calls = [];
  const w = load(BOOKING_HTML, BOOKING_URL, async (url, opts) => {
    url = String(url);
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (url.includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (url.includes('/rpc/create_booking')) return { ok: true, status: 200, json: async () => ([{ booking_id: 9, manage_token: TOKEN }]) };
    return { ok: false, status: 500 };
  });
  await book(w);
  await until(() => w.document.getElementById('stepConfirmed').classList.contains('is-active'));
  const rpc = calls.find((c) => c.url.includes('/rpc/create_booking'));
  assert.ok(rpc.body.p_booking, 'the payload is wrapped as p_booking');
  assert.equal(rpc.body.p_booking.name, 'Jane Smith');
  assert.equal(rpc.body.p_booking.email, null);
  assert.ok(!calls.some((c) => c.url.endsWith('/rest/v1/th_bookings')), 'no second, direct insert');
  assert.equal(w.document.getElementById('confManage').hidden, false);
  assert.equal(w.document.getElementById('confManageLink').getAttribute('href'), '/manage-booking.html?token=' + TOKEN);
  assert.match(w.document.getElementById('googleCalendarLink').getAttribute('href'), /manage-booking\.html%3Ftoken%3D11111111/);
  assert.doesNotMatch(w.document.getElementById('nextStepsEmailNote').textContent, /email/i);
  assert.match(w.document.getElementById('nextStepsEmailNote').textContent, /link on this page/);
  const saved = JSON.parse(w.localStorage.getItem(KEY));
  assert.equal(saved.token, TOKEN);
  assert.deepEqual(Object.keys(saved).sort(), ['end', 'savedAt', 'start', 'title', 'token'], 'no name, phone or address on the device');
});

test('a 404 from create_booking (not deployed) falls back to the original direct insert -- and shows no manage link it doesn\'t have', async () => {
  const calls = [];
  const w = load(BOOKING_HTML, BOOKING_URL, async (url, opts) => {
    url = String(url);
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    if (url.includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (url.includes('/rpc/create_booking')) return { ok: false, status: 404, text: async () => '{"code":"PGRST202"}' };
    if (url.endsWith('/rest/v1/th_bookings')) return { ok: true, status: 201 };
    return { ok: false, status: 500 };
  });
  await book(w, { email: 'jane@example.com' });
  await until(() => w.document.getElementById('stepConfirmed').classList.contains('is-active'));
  const direct = calls.find((c) => c.url.endsWith('/rest/v1/th_bookings'));
  assert.ok(direct, 'fell back to the direct insert');
  assert.equal(direct.body.name, 'Jane Smith', 'same payload, unwrapped');
  assert.equal(w.document.getElementById('confManage').hidden, true);
  assert.equal(w.localStorage.getItem(KEY), null);
});

test('any other create_booking failure never falls back (it could double-book) -- the guest sees the error instead', async () => {
  const calls = [];
  const w = load(BOOKING_HTML, BOOKING_URL, async (url) => {
    url = String(url);
    calls.push(url);
    if (url.includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (url.includes('/rpc/create_booking')) return { ok: false, status: 500, text: async () => 'boom' };
    return { ok: true, status: 201 };
  });
  await book(w);
  await until(() => w.document.getElementById('statusMsg').classList.contains('is-visible'));
  assert.ok(!calls.some((u) => u.endsWith('/rest/v1/th_bookings')));
  assert.match(w.document.getElementById('statusMsg').textContent, /\(435\) 414-1667/);
});

test('a slot whose time passed while the form sat open is treated like a taken slot: back to fresh times', async () => {
  const w = load(BOOKING_HTML, BOOKING_URL, async (url) => {
    url = String(url);
    if (url.includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (url.includes('/rpc/create_booking')) return { ok: false, status: 400, text: async () => '{"code":"22023","message":"in-the-past"}' };
    return { ok: false, status: 500 };
  });
  await book(w);
  await until(() => w.document.getElementById('stepDateTime').classList.contains('is-active'));
});

test('the honeypot path remembers nothing and calls nothing', async () => {
  const calls = [];
  const w = load(BOOKING_HTML, BOOKING_URL, async (url) => {
    calls.push(String(url));
    return String(url).includes('availability') ? { ok: true, json: async () => ([]) } : { ok: true, json: async () => ([{ booking_id: 1, manage_token: TOKEN }]) };
  });
  await until(() => w.document.querySelector('.service-option'));
  w.document.querySelector('[name="_gotcha"]').value = 'bot';
  await book(w);
  await until(() => w.document.getElementById('stepConfirmed').classList.contains('is-active'));
  assert.ok(!calls.some((u) => u.includes('create_booking') || u.endsWith('/rest/v1/th_bookings')));
  assert.equal(w.localStorage.getItem(KEY), null);
  assert.equal(w.document.getElementById('confManage').hidden, true);
});

// ---------- the "you're already booked" banner ----------

function futureIso(hours) { return new Date(Date.now() + hours * 3600000).toISOString(); }
const saved = (over = {}) => JSON.stringify(Object.assign({ token: TOKEN, title: 'Inspection', start: futureIso(48), end: futureIso(49), savedAt: Date.now() }, over));

test('coming back to booking.html shows "You\'re already booked" once the server confirms the visit is still on', async () => {
  const w = load(BOOKING_HTML, BOOKING_URL, async (url, opts) => {
    if (String(url).includes('get_booking_by_cancel_token')) {
      assert.equal(JSON.parse(opts.body).p_token, TOKEN);
      return { ok: true, json: async () => ([{ service_label: 'Appliance Repair', start_at: futureIso(50), end_at: futureIso(52), name: 'x', status: 'confirmed' }]) };
    }
    return { ok: true, json: async () => ([]) };
  }, { [KEY]: saved() });
  await until(() => !w.document.getElementById('bookedBanner').hidden);
  assert.equal(w.document.getElementById('bookedBannerWhat').textContent, 'Appliance Repair', 'the server\'s current details, not the stored copy');
  assert.equal(w.document.getElementById('bookedBannerManage').getAttribute('href'), '/manage-booking.html?token=' + TOKEN);
  w.document.getElementById('bookedBannerForget').click();
  assert.equal(w.document.getElementById('bookedBanner').hidden, true);
  assert.equal(w.localStorage.getItem(KEY), null);
});

test('a visit cancelled some other way (a call, another device) clears the memory instead of showing a stale banner', async () => {
  const w = load(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([{ service_label: 'Inspection', start_at: futureIso(48), end_at: futureIso(49), status: 'cancelled' }]) };
    return { ok: true, json: async () => ([]) };
  }, { [KEY]: saved() });
  await until(() => w.localStorage.getItem(KEY) === null);
  assert.equal(w.document.getElementById('bookedBanner').hidden, true);
});

test('a past visit is forgotten without even asking the server; a failed lookup keeps it for next time and shows nothing', async () => {
  let lookups = 0;
  const w1 = load(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) lookups++;
    return { ok: true, json: async () => ([]) };
  }, { [KEY]: saved({ start: futureIso(-5), end: futureIso(-4) }) });
  await waitFor(80);
  assert.equal(lookups, 0);
  assert.equal(w1.localStorage.getItem(KEY), null);

  const w2 = load(BOOKING_HTML, BOOKING_URL, async (url) => (String(url).includes('get_booking_by_cancel_token') ? { ok: false, status: 503 } : { ok: true, json: async () => ([]) }), { [KEY]: saved() });
  await waitFor(80);
  assert.equal(w2.document.getElementById('bookedBanner').hidden, true);
  assert.ok(w2.localStorage.getItem(KEY));
});

test('a malformed remembered token is ignored (never sent anywhere)', async () => {
  let lookups = 0;
  load(BOOKING_HTML, BOOKING_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) lookups++;
    return { ok: true, json: async () => ([]) };
  }, { [KEY]: saved({ token: '<script>' }) });
  await waitFor(80);
  assert.equal(lookups, 0);
});

// ---------- manage-booking.html keeps the memory in sync ----------

const MANAGE_URL = 'https://www.triplehenterprisesllc.biz/manage-booking.html?token=' + TOKEN;
const upcoming = { service_label: 'Inspection', start_at: futureIso(30), end_at: futureIso(30.75), name: 'Jane', status: 'confirmed' };

test('manage-booking.html: cancelling forgets the remembered visit for THIS token only', async () => {
  const w = load(MANAGE_HTML, MANAGE_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([upcoming]) };
    if (String(url).includes('cancel_booking_by_token')) return { ok: true, json: async () => ([{ ok: true, message: 'cancelled' }]) };
    return { ok: false };
  }, { [KEY]: saved() });
  await until(() => w.document.getElementById('startCancelBtn'));
  w.document.getElementById('startCancelBtn').click();
  w.document.getElementById('confirmCancelBtn').click();
  await until(() => w.document.getElementById('content').innerHTML.includes('has been cancelled'));
  assert.equal(w.localStorage.getItem(KEY), null);

  const other = load(MANAGE_HTML, MANAGE_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([upcoming]) };
    if (String(url).includes('cancel_booking_by_token')) return { ok: true, json: async () => ([{ ok: true, message: 'cancelled' }]) };
    return { ok: false };
  }, { [KEY]: saved({ token: '99999999-2222-3333-4444-555555555555' }) });
  await until(() => other.document.getElementById('startCancelBtn'));
  other.document.getElementById('startCancelBtn').click();
  other.document.getElementById('confirmCancelBtn').click();
  await until(() => other.document.getElementById('content').innerHTML.includes('has been cancelled'));
  assert.ok(other.localStorage.getItem(KEY), 'a different booking\'s memory is left alone');
});

test('manage-booking.html: rescheduling updates the remembered visit\'s time', async () => {
  const w = load(MANAGE_HTML, MANAGE_URL, async (url) => {
    if (String(url).includes('get_booking_by_cancel_token')) return { ok: true, json: async () => ([upcoming]) };
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => ([]) };
    if (String(url).includes('reschedule_booking_by_token')) return { ok: true, json: async () => ([{ ok: true, message: 'rescheduled' }]) };
    return { ok: false };
  }, { [KEY]: saved() });
  await until(() => w.document.getElementById('startRescheduleBtn'));
  const before = JSON.parse(w.localStorage.getItem(KEY)).start;
  w.document.getElementById('startRescheduleBtn').click();
  // The picker opens on the first day with room, on the real clock: late in
  // the day that's today with one slot left (2026-09-23, 6:40 PM Denver: a
  // single 9:00 PM slot), so waiting for a third slot never ended. Any slot
  // moves the visit -- the saved one is two days out -- so tap the last.
  await until(() => w.document.querySelector('.slot-btn'));
  const slots = w.document.querySelectorAll('.slot-btn');
  slots[slots.length - 1].click();
  w.document.getElementById('confirmRescheduleBtn').click();
  await until(() => w.document.getElementById('content').innerHTML.includes('has been rescheduled'));
  const after = JSON.parse(w.localStorage.getItem(KEY));
  assert.notEqual(after.start, before);
  assert.equal(after.token, TOKEN);
});

// ---------- the SQL ----------

test('create_booking(): only allowlisted columns, status left to its default, the double-booking error propagates, anon may call it', () => {
  const insertCols = SQL.match(/insert into public\.th_bookings \(([\s\S]*?)\) values/)[1];
  for (const forbidden of ['status', 'quote_id', 'checkup_id', 'job_id', 'reminder_sent_at', 'cancel_token', 'reschedule_count']) {
    assert.doesNotMatch(insertCols, new RegExp('\\b' + forbidden + '\\b'), forbidden + ' must not be caller-settable');
  }
  assert.match(SQL, /returning id, cancel_token into v_id, v_token;/);
  assert.match(SQL, /security definer/);
  assert.doesNotMatch(SQL, /exclusion_violation/, 'a 23P01 must propagate so the page says "just taken"');
  assert.match(SQL, /raise exception 'in-the-past' using errcode = '22023';/);
  assert.match(SQL, /raise exception 'name-required' using errcode = '22023';/);
  assert.match(SQL, /grant execute on function public\.create_booking\(jsonb\) to anon, authenticated;/);
});
