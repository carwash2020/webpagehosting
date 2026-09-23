// Dev Tools booking test copy (2026-09-23). Since the booking-flow pass
// round 2, rescheduling or cancelling a booking also emails the staff
// ("Booking moved" / "Booking cancelled"), and since the follow-up only a
// staff account may write a booking directly. The test's description and
// step labels said only "push" for those two steps and said nothing about
// either change, so a run that produced two extra staff emails read as
// unexpected. This pins the copy to what the test really triggers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SHARED = fs.readFileSync(repo('tools', 'dev-tools-shared.js'), 'utf8');
const PAGE = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');

test('the booking test\'s description names every notification each step sends', () => {
  const body = SHARED.match(/bookingtest: \{[\s\S]*?body: `([\s\S]*?)`,/)[1];
  assert.match(body, /new booking \(push \+ staff email\)/);
  assert.match(body, /rescheduled \(push \+ a "Booking moved" staff email\)/);
  assert.match(body, /cancelled \(push \+ a "Booking cancelled" staff email\)/);
  assert.match(body, /no email address, so no guest email goes out/);
  assert.match(body, /only staff accounts may write a booking directly/);
});

test('the step labels match the description', () => {
  assert.ok(PAGE.includes("'Created test booking (should trigger: new-booking push + staff email)'"));
  assert.ok(PAGE.includes("'Rescheduled test booking (should trigger: rescheduled push + \"Booking moved\" staff email)'"));
  assert.ok(PAGE.includes("'Cancelled test booking (should trigger: cancelled push + \"Booking cancelled\" staff email)'"));
});

test('the test still writes the booking with the signed-in staff session (the only direct-insert path the public policy change kept)', () => {
  const run = PAGE.slice(PAGE.indexOf("const insertRes = await fetchWithTimeout(SUPABASE_URL + '/rest/v1/th_bookings'"), PAGE.indexOf("if (!insertRes.ok) throw new Error('Insert failed"));
  assert.ok(run.length > 0);
  assert.match(run, /headers: authHeaders/);
  assert.match(PAGE, /const authHeaders = \{ 'Content-Type': 'application\/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' \+ getAuthToken\(\) \};/);
});
