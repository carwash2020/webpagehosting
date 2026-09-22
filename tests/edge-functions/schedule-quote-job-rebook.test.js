// schedule-quote-job: rebooking after a cancellation (2026-09-22).
//
// client_portal_quotes.scheduled_at is a one-way "has been scheduled"
// marker -- manage-booking.html's cancel_booking_by_token only touches
// th_bookings, never the quote -- so a client who cancelled their
// quote-scheduled visit used to be permanently stuck at "already
// scheduled". The portal now shows a cancelled visit and offers a new
// time (tests/portal/portal-visits.test.js); this is the server half.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'schedule-quote-job-index.ts'), 'utf8');

test('an already-scheduled quote is only reopened when it has NO confirmed booking left', () => {
  assert.match(SRC, /const priorScheduledAt: string \| null = quote\.scheduled_at \|\| null;/);
  assert.match(SRC, /th_bookings\?quote_id=eq\.\$\{quote\.id\}&status=eq\.confirmed&select=id&limit=1/);
  assert.match(SRC, /if \(!active \|\| active\.length\) \{\s*return json\(\{ ok: false, error: "This job is already scheduled\./);
});

test('the lookup fails closed: an unreadable booking list counts as "still scheduled"', () => {
  assert.match(SRC, /const active = activeRes\.ok \? await activeRes\.json\(\) : null;/);
});

test('ownership and approval are still checked before any of the rebooking logic', () => {
  const ownership = SRC.indexOf("That quote doesn't belong to this account.");
  const approved = SRC.indexOf('This quote must be approved before scheduling.');
  const rebook = SRC.indexOf('const priorScheduledAt');
  assert.ok(ownership > 0 && approved > ownership && rebook > approved);
});

test('the scheduled_at write is an optimistic check against the exact value read (is.null first time, eq.<prior> on a rebook)', () => {
  assert.match(SRC, /priorScheduledAt\s*\?\s*`scheduled_at=eq\.\$\{encodeURIComponent\(priorScheduledAt\)\}`\s*:\s*"scheduled_at=is\.null"/);
  assert.match(SRC, /client_portal_quotes\?id=eq\.\$\{quote_id\}&\$\{scheduledAtFilter\}/);
});

test('losing the race undoes exactly the booking this request created, by id', () => {
  assert.match(SRC, /Prefer: "return=representation",\s*\},\s*body: JSON\.stringify\(\[\{\s*service_key: "quote-job"/);
  assert.match(SRC, /const createdBookingId = /);
  assert.match(SRC, /createdBookingId\s*\?\s*`id=eq\.\$\{createdBookingId\}`/);
  // The fallback filter can never sweep up a previously cancelled row.
  assert.match(SRC, /start_at=eq\.\$\{encodeURIComponent\(start_at\)\}&status=eq\.confirmed/);
});

test('slot conflicts are still left to th_bookings\' own exclusion constraint', () => {
  assert.match(SRC, /errText\.includes\("23P01"\) \|\| errText\.includes\("exclusion"\)/);
});
