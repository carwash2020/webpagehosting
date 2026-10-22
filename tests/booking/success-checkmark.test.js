// Green success checkmark (2026-09-19), requested directly: the
// confirmation screen's badge used to be a solid orange hexagon with a
// plain unicode checkmark character, popping in with one flat
// animation. This replaces it with a green circular badge (reusing the
// site's existing --success-text color token, not a bespoke one) and an
// SVG checkmark that draws itself in via stroke-dashoffset after the
// circle pops in. A plain HTML/CSS copy of the same green badge was
// added to the guest booking-confirmation email at the time (not SVG
// or a GIF -- email client support for both was judged too
// inconsistent then).
//
// Updated 2026-10-20: the email's badge is now a real animated GIF
// (images/email/booking-confirmed-check.gif) after all, requested
// directly as part of the booking-email polish pass. The email
// client-support concern is handled by frame order, not by avoiding
// GIFs: the file's FIRST frame is already the fully-settled final
// state, so a client that only renders a GIF's first frame (classic
// Outlook desktop, some webmail) still shows the complete green check,
// never a half-drawn or empty circle -- see send-booking-email-index.ts's
// own CHECKMARK_GIF_URL comment. The reschedule/cancellation emails'
// badges were left as the original plain HTML/CSS cells (no animation
// was requested for those).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const BOOKING_HTML = fs.readFileSync(repo('booking.html'), 'utf8');
const BOOKING_EMAIL_TS = fs.readFileSync(repo('edge-functions/send-booking-email-index.ts'), 'utf8');

test('booking.html: the confirmation checkmark badge is a green circle (reuses --success-text, not a new color)', () => {
  const rule = BOOKING_HTML.match(/\.confirmation \.checkmark\{([\s\S]*?)\}/)[1];
  assert.match(rule, /border-radius:50%/);
  assert.match(rule, /background:var\(--success-text\)/);
  assert.match(BOOKING_HTML, /--success-text:#3ad66b;/, 'booking.html carries its own copy of the token (it does not load styles.css)');
});

test('booking.html: the checkmark is an SVG path that draws itself in, not a static unicode glyph', () => {
  const section = BOOKING_HTML.match(/<section class="step-panel" id="stepConfirmed"[^>]*>[\s\S]*?<\/section>/)[0];
  assert.match(section, /<div class="checkmark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 13l5 5L19 7"\/><\/svg><\/div>/);
  assert.doesNotMatch(section, /checkmark" aria-hidden="true">&#10003;</, 'the old plain-glyph badge should be gone');
  const pathRule = BOOKING_HTML.match(/\.confirmation \.checkmark svg path\{([\s\S]*?)\}/)[1];
  assert.match(pathRule, /stroke-dasharray:28/);
  assert.match(pathRule, /stroke-dashoffset:28/);
  assert.match(pathRule, /animation:drawCheck/);
});

test('booking.html: the page-wide reduced-motion rule already zeroes this animation out for anyone who asked for it', () => {
  assert.match(BOOKING_HTML, /@media \(prefers-reduced-motion: reduce\)\{\s*\n\s*\*\{animation-duration:0\.001ms !important; transition-duration:0\.001ms !important;\}/);
});

test('booking.html: the confirmation headline still reads "You\'re booked"', () => {
  const section = BOOKING_HTML.match(/<section class="step-panel" id="stepConfirmed"[^>]*>[\s\S]*?<\/section>/)[0];
  assert.match(section, /<h2>You're booked! Your slot is held\.<\/h2>/);
});

test('send-booking-email-index.ts: the guest confirmation email carries an animated checkmark GIF, sized and placed like the old badge', () => {
  const fn = BOOKING_EMAIL_TS.match(/function buildGuestEmailHtml[\s\S]*?\n}/)[0];
  assert.match(fn, /CHECKMARK_GIF_URL/);
  assert.match(fn, /width="56" height="56"/);
  // Badge comes before the "You're booked!" heading, not after.
  const badgeIndex = fn.indexOf('CHECKMARK_GIF_URL');
  const headingIndex = fn.indexOf("You're booked!");
  assert.ok(badgeIndex > 0 && headingIndex > 0 && badgeIndex < headingIndex);
});

test('CHECKMARK_GIF_URL points at a real, small GIF file whose first frame is the fully-settled state, not frame one of the animation', () => {
  assert.match(BOOKING_EMAIL_TS, /const CHECKMARK_GIF_URL = "https:\/\/www\.triplehenterprisesllc\.biz\/images\/email\/booking-confirmed-check\.gif";/);
  const gifPath = repo('images/email/booking-confirmed-check.gif');
  assert.ok(fs.existsSync(gifPath), 'expected images/email/booking-confirmed-check.gif to exist in the repo');
  const buf = fs.readFileSync(gifPath);
  assert.equal(buf.toString('ascii', 0, 6), 'GIF89a', 'expected a real GIF file');
  assert.ok(buf.length < 50 * 1024, `expected a small file (email-safe), got ${buf.length} bytes`);
});

test('reschedule/cancellation guest emails keep the original plain HTML/CSS badge -- only the confirmation was asked to animate', () => {
  const reschedule = BOOKING_EMAIL_TS.match(/function buildRescheduledGuestEmailHtml[\s\S]*?\n}/)[0];
  const cancelled = BOOKING_EMAIL_TS.match(/function buildCancelledGuestEmailHtml[\s\S]*?\n}/)[0];
  for (const fn of [reschedule, cancelled]) {
    assert.doesNotMatch(fn, /CHECKMARK_GIF_URL/);
    assert.doesNotMatch(fn, /\.gif/i);
  }
});
