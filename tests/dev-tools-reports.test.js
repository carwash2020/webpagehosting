// Tests for the Reports tab added to tools/dev-tools.html (2026-08-25),
// requested directly, plus the mobile swipe gesture for tab navigation
// added in the same pass.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DEV_TOOLS_PATH = path.join(__dirname, '..', 'tools', 'dev-tools.html');

function loadPage(mockFetchWithTimeout, canManage) {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canManageRoles = () => (canManage === undefined ? true : canManage);
      w.getAuthToken = () => 'fake-token';
      w.ensureFreshToken = async () => {};
      w.escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      w.SUPABASE_URL = 'https://example.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon-key';
      w.fetchWithTimeout = mockFetchWithTimeout;
    },
  });
  return dom.window;
}

const now = Date.now();
const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
const hoursAgo = (n) => new Date(now - n * 60 * 60 * 1000).toISOString();

test('Booking funnel health counts new/cancelled/rescheduled correctly, using the real tracked timestamps rather than created_at alone', async () => {
  const bookings = [
    { created_at: daysAgo(1), cancelled_at: null, last_rescheduled_at: null },
    { created_at: daysAgo(2), cancelled_at: null, last_rescheduled_at: null },
    { created_at: daysAgo(3), cancelled_at: null, last_rescheduled_at: null },
    { created_at: daysAgo(21), cancelled_at: daysAgo(2), last_rescheduled_at: null },
    { created_at: daysAgo(10), cancelled_at: null, last_rescheduled_at: daysAgo(1) },
  ];
  const window = loadPage(async (url) => (String(url).includes('th_bookings') ? { ok: true, json: async () => bookings } : { ok: false }));
  await window.renderBookingFunnelReport();
  const text = window.document.getElementById('bookingFunnelReport').textContent;
  assert.match(text, /New bookings \(5 total\)/);
  assert.match(text, /Cancelled \(1 total\)/);
  assert.match(text, /Rescheduled \(1 total\)/);
  assert.match(text, /20% of new bookings/);
});

test('Lead response time computes a correct median for an EVEN number of handled leads -- caught and fixed a real bug here (picking the upper-middle element instead of averaging the two middle values)', async () => {
  const leads = [
    { name: 'A', created_at: hoursAgo(50), handled: true, handled_at: hoursAgo(48) }, // 2h
    { name: 'B', created_at: hoursAgo(60), handled: true, handled_at: hoursAgo(50) }, // 10h
  ];
  const window = loadPage(async (url) => (String(url).includes('th_leads') ? { ok: true, json: async () => leads } : { ok: false }));
  await window.renderLeadResponseTimeReport();
  const text = window.document.getElementById('leadResponseTimeReport').textContent;
  assert.match(text, /Average time to mark a lead handled \(last 2 handled leads\)\s*6 hours/);
  assert.match(text, /Median time to handle\s*6 hours/, 'median of [2h, 10h] should be 6, the average of the two middle values -- not 10, the upper element');
});

test('Lead response time computes a correct median for an ODD number of handled leads', async () => {
  const leads = [
    { name: 'A', created_at: hoursAgo(50), handled: true, handled_at: hoursAgo(48) }, // 2h
    { name: 'B', created_at: hoursAgo(60), handled: true, handled_at: hoursAgo(50) }, // 10h
    { name: 'C', created_at: hoursAgo(80), handled: true, handled_at: hoursAgo(74) }, // 6h
  ];
  const window = loadPage(async (url) => (String(url).includes('th_leads') ? { ok: true, json: async () => leads } : { ok: false }));
  await window.renderLeadResponseTimeReport();
  const text = window.document.getElementById('leadResponseTimeReport').textContent;
  assert.match(text, /Median time to handle\s*6 hours/);
});

test('Lead response time separately reports currently-unhandled leads and how long the oldest has waited', async () => {
  const leads = [
    { name: 'Still Waiting', created_at: hoursAgo(30), handled: false, handled_at: null },
  ];
  const window = loadPage(async (url) => (String(url).includes('th_leads') ? { ok: true, json: async () => leads } : { ok: false }));
  await window.renderLeadResponseTimeReport();
  const text = window.document.getElementById('leadResponseTimeReport').textContent;
  assert.match(text, /Currently unhandled leads\s*1/);
  assert.match(text, /1\.3 days/);
});

test('Uptime trend computes the correct overall uptime percentage across the report window', async () => {
  const checks = [];
  for (let i = 0; i < 8; i++) checks.push({ checked_at: hoursAgo(i * 10), status: 'up' });
  for (let i = 0; i < 2; i++) checks.push({ checked_at: hoursAgo(80 + i * 10), status: 'down' });
  const window = loadPage(async (url) => (String(url).includes('th_uptime_checks') ? { ok: true, json: async () => checks } : { ok: false }));
  await window.renderUptimeTrendReport();
  const text = window.document.getElementById('uptimeTrendReport').textContent;
  assert.match(text, /80\.00%/);
});

// --- swipe gesture -------------------------------------------------------
// jsdom has no real Touch/TouchEvent constructor, so these dispatch a
// plain Event with touches/changedTouches manually attached -- the
// listener code itself only ever reads those two array-like properties
// off the event object, so this exercises the real logic exactly the
// same way a genuine touch event would.

function dispatchTouch(window, target, type, x, y) {
  const evt = new window.Event(type, { bubbles: true });
  const touch = { clientX: x, clientY: y };
  if (type === 'touchstart') evt.touches = [touch];
  else evt.changedTouches = [touch];
  target.dispatchEvent(evt);
}

test('a real horizontal swipe left advances to the next tab', () => {
  const window = loadPage(async () => ({ ok: false }));
  window.initDevToolsTabs();
  assert.equal(window.document.querySelector('.dev-tab-btn.is-active').getAttribute('data-tab'), 'health');

  const panel = window.document.querySelector('.dev-panels-grid[data-tab-panel].is-active-tab-panel');
  dispatchTouch(window, panel, 'touchstart', 200, 100);
  dispatchTouch(window, panel, 'touchend', 50, 100);

  assert.equal(window.document.querySelector('.dev-tab-btn.is-active').getAttribute('data-tab'), 'access');
});

test('a real horizontal swipe right goes back to the previous tab', () => {
  const window = loadPage(async () => ({ ok: false }));
  window.initDevToolsTabs();
  window.switchDevToolsTab('access');

  const panel = window.document.querySelector('.dev-panels-grid[data-tab-panel].is-active-tab-panel');
  dispatchTouch(window, panel, 'touchstart', 50, 100);
  dispatchTouch(window, panel, 'touchend', 200, 100);

  assert.equal(window.document.querySelector('.dev-tab-btn.is-active').getAttribute('data-tab'), 'health');
});

test('a swipe never wraps past the first or last tab', () => {
  const window = loadPage(async () => ({ ok: false }));
  window.initDevToolsTabs();
  assert.equal(window.document.querySelector('.dev-tab-btn.is-active').getAttribute('data-tab'), 'health');

  const panel = window.document.querySelector('.dev-panels-grid[data-tab-panel].is-active-tab-panel');
  dispatchTouch(window, panel, 'touchstart', 50, 100);
  dispatchTouch(window, panel, 'touchend', 200, 100); // swipe right on the very first tab

  assert.equal(window.document.querySelector('.dev-tab-btn.is-active').getAttribute('data-tab'), 'health', 'should stay on the first tab, never wrap to the last');
});

test('a mostly-vertical gesture is never treated as a tab-changing swipe', () => {
  const window = loadPage(async () => ({ ok: false }));
  window.initDevToolsTabs();

  const panel = window.document.querySelector('.dev-panels-grid[data-tab-panel].is-active-tab-panel');
  dispatchTouch(window, panel, 'touchstart', 200, 100);
  dispatchTouch(window, panel, 'touchend', 130, 300); // deltaX=70, deltaY=200 -- vertical-dominant

  assert.equal(window.document.querySelector('.dev-tab-btn.is-active').getAttribute('data-tab'), 'health', 'a vertical scroll should never be mistaken for a horizontal swipe');
});

test('a short horizontal drag below the minimum distance does not trigger a tab change', () => {
  const window = loadPage(async () => ({ ok: false }));
  window.initDevToolsTabs();

  const panel = window.document.querySelector('.dev-panels-grid[data-tab-panel].is-active-tab-panel');
  dispatchTouch(window, panel, 'touchstart', 200, 100);
  dispatchTouch(window, panel, 'touchend', 170, 100); // only 30px -- below the real minimum

  assert.equal(window.document.querySelector('.dev-tab-btn.is-active').getAttribute('data-tab'), 'health');
});

test('a swipe starting outside the panel content area (e.g. the tab bar itself) is ignored', () => {
  const window = loadPage(async () => ({ ok: false }));
  window.initDevToolsTabs();

  const tabBar = window.document.getElementById('devTabBar');
  dispatchTouch(window, tabBar, 'touchstart', 200, 30);
  dispatchTouch(window, tabBar, 'touchend', 50, 30);

  assert.equal(window.document.querySelector('.dev-tab-btn.is-active').getAttribute('data-tab'), 'health', 'the tab bar has its own horizontal scroll and should not also trigger a swipe-driven tab change');
});
