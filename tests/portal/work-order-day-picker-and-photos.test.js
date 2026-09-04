// Tests for the Request Work form's timing field and photo uploads
// (2026-09-03/04). The timing field went free-text -> a day-picker
// grid -> a plain link to the real booking page -> a real embedded
// availability picker, each step requested directly; the photo-
// upload feature (up to 3) has stayed as built throughout.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const html = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');

// ---- timing: day-picker removed, replaced by a plain booking-page link ----
//
// The day-picker built earlier the same day was removed a few hours
// later, requested directly: "We can remove the 'when would you like
// this service' because we added the bookings page... it just pops up
// with a bunch of dates and times." booking.html already does real
// date/time scheduling properly, tied to a known service duration; a
// smaller version of it living inside this form was redundant with
// the page built specifically for that.

test('the old free-text timing input and the short-lived day-picker grid are both gone', () => {
  assert.doesNotMatch(html, /id="woTiming"/);
  assert.doesNotMatch(html, /id="woDayGrid"/);
  assert.doesNotMatch(html, /function renderDayPicker/);
});

test('a real availability picker took its place (2026-09-04) -- the plain booking-page link is gone', () => {
  // Rewritten 2026-09-04, requested directly: "If guests just use the
  // book directly link then the work order will never actually get
  // filled out. We need to find a clever way for them to pick a date
  // we have available based on our booking system and link them into
  // the form." The link that bypassed this form entirely, in place
  // since the same-day history above, is gone -- a client now picks
  // from real availability without ever leaving the work order form,
  // so title/description/urgency/photos still get captured either way.
  assert.doesNotMatch(html, /wo-booking-nudge/);
  assert.doesNotMatch(html, /<a href="\/booking\.html">Book directly/);
  assert.match(html, /id="woSchedulePanel"/);
  assert.match(html, /id="woDateRow"/);
  assert.match(html, /id="woSlotsGrid"/);
});

test('the picked slot is a preference for Connor to review, not an instant booking', () => {
  assert.doesNotMatch(html, /from\(['"]th_bookings['"]\)/);
  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.match(submitMatch[0], /preferred_slot_at: selectedPreferredSlot \? selectedPreferredSlot\.startUtc\.toISOString\(\) : null,/);
});

test('preferred_timing (the old free-text field) still stays unsent -- preferred_slot_at is a distinct, new column, not a revival of it', () => {
  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.doesNotMatch(submitMatch[0], /preferred_timing:/);
});

test('work-orders.html loads the shared business-hours file again (2026-09-04) -- real availability data needs it', () => {
  // The opposite of true as of a few hours earlier the same original
  // day (see the test above this one, and the file's own top
  // comment) -- removed when the day-picker was removed, needed
  // again now that a real availability picker replaced the plain
  // booking-page link.
  assert.match(html, /<script src="\/business-hours\.js\?v=\d+"><\/script>/);
});

// ---- photo upload ----

test('the photo upload is capped at 3 photos client-side', () => {
  assert.match(html, /const MAX_WO_PHOTOS = 3;/);
  const changeMatch = html.match(/document\.getElementById\('woPhotoInput'\)\.addEventListener\('change', \(e\) => \{[\s\S]*?\n  \}\);\n/);
  assert.ok(changeMatch);
  assert.match(changeMatch[0], /selectedPhotos\.length >= MAX_WO_PHOTOS/);
});

test('the photo upload uses a plain file input with image/* and multiple, so the OS offers camera or gallery -- no separate picker needs building', () => {
  assert.match(html, /<input type="file" id="woPhotoInput" accept="image\/\*" multiple/);
});

test('each photo is size-checked against the same 8MB convention already used by the internal tools', () => {
  assert.match(html, /const MAX_WO_PHOTO_BYTES = 8 \* 1024 \* 1024;/);
});

test('photos upload to Storage only at submit time, never the moment a file is picked', () => {
  const changeMatch = html.match(/document\.getElementById\('woPhotoInput'\)\.addEventListener\('change', \(e\) => \{[\s\S]*?\n  \}\);\n/);
  assert.doesNotMatch(changeMatch[0], /fetch\(/, 'selecting a file should only stage it locally, not upload it yet');
  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  assert.match(submitMatch[0], /uploadSelectedPhotos\(\)/);
});

test('a failed photo upload shows a real error and does not silently submit the request without them', () => {
  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  const body = submitMatch[0];
  const tryMatch = body.match(/try \{\s*photoPaths = await uploadSelectedPhotos\(\);\s*\} catch \(e\) \{([\s\S]*?)\}/);
  assert.ok(tryMatch, 'expected the photo upload to be wrapped in its own try/catch');
  assert.match(tryMatch[1], /return;/, 'a failed upload should stop the submission, not proceed to insert without the photos silently');
});

test('a successful submission includes the real uploaded paths, and clears the staged photos afterward', () => {
  const submitMatch = html.match(/async function submitRequest\(\)[\s\S]*?\n  \}\n/);
  const body = submitMatch[0];
  assert.match(body, /photo_storage_paths: photoPaths\.length \? photoPaths : null,/);
  assert.match(body, /selectedPhotos = \[\];/);
  assert.match(body, /renderPhotoRow\(\);/);
});

test('photo uploads go to the dedicated work-order-photos bucket, not job-photos', () => {
  const fnMatch = html.match(/async function uploadSelectedPhotos\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /storage\/v1\/object\/work-order-photos\//);
});

// ---- desktop: Add to Home Screen hidden ----

test('the Add to Home Screen card is hidden on desktop, at the same breakpoint used everywhere else in the portal', () => {
  const settingsHtml = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
  assert.match(settingsHtml, /@media \(min-width: 860px\) \{\s*#addHomeScreenCard \{ display: none; \}/);
});
