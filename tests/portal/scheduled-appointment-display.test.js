// Tests for the client-facing display of an approved, scheduled
// appointment (2026-09-03) -- item 3's portal side, and item 5's Home
// page attention row, requested directly as following from it: "5
// would fall in hand with that as well."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const HOME = fs.readFileSync(repo('portal', 'home.html'), 'utf8');

test('a scheduled request shows its real date/time prominently on the client\'s own card', () => {
  const fnMatch = WORK_ORDERS.match(/function renderRequestCard\(wo\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderRequestCard()');
  const body = fnMatch[0];
  assert.match(body, /statusKey === 'scheduled' && wo\.scheduled_at/);
  assert.match(body, /wo-scheduled-tag/, 'should have its own distinct visual style, not just reuse the plain urgency tag');
});

test('scheduled_at is actually fetched -- selecting it is what makes the card able to show it', () => {
  const fnMatch = WORK_ORDERS.match(/async function renderMyRequests\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderMyRequests()');
  assert.match(fnMatch[0], /\.select\('id,title,description,urgency,status,scheduled_at,created_at'\)/);
});

test('Home shows an upcoming appointment in the next-appointment hero, not duplicated in the action inbox', () => {
  const fnMatch = HOME.match(/function renderAttention\(s\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderAttention()');
  const body = fnMatch[0];
  assert.doesNotMatch(body, /r\.status === 'scheduled' && r\.scheduled_at/);
  assert.match(body, /s\.invoices\.filter\(i => !i\.paid\)/);
  const bannerFn = HOME.match(/function renderNextAppointmentBanner\(s\)[\s\S]*?\n  \}\n/);
  assert.ok(bannerFn, 'expected to isolate renderNextAppointmentBanner()');
  // 2026-09-22: the scheduled-request filter moved into
  // buildUpcomingVisits(), which merges work-order visits with booked
  // (th_bookings) ones -- the hero renders from that merged list.
  assert.match(bannerFn[0], /buildUpcomingVisits\(s\)/);
  const buildFn = HOME.match(/function buildUpcomingVisits\(s\)[\s\S]*?\n  \}\n/);
  assert.ok(buildFn, 'expected to isolate buildUpcomingVisits()');
  assert.match(buildFn[0], /r\.status === 'scheduled' && r\.scheduled_at/);
});

test('Home fetches scheduled_at and address for the next-appointment hero', () => {
  assert.match(HOME, /client\.from\('client_portal_work_orders'\)\.select\('id,title,status,scheduled_at,address'\)/);
});

test('two literal em-dash characters left over from the earlier guest-facing cleanup are gone from renderAttention', () => {
  // Found and fixed in passing while already editing this exact
  // function -- \\u2014 is a real em dash, the same class of thing an
  // earlier pass across this codebase specifically removed from
  // guest-facing text.
  const fnMatch = HOME.match(/function renderAttention\(s\)[\s\S]*?\n  \}\n/);
  assert.doesNotMatch(fnMatch[0], /\\u2014/);
});
