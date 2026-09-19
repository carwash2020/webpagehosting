// Green success checkmark (2026-09-19), requested directly: the
// confirmation screen's badge used to be a solid orange hexagon with a
// plain unicode checkmark character, popping in with one flat
// animation. This replaces it with a green circular badge (reusing the
// site's existing --success-text color token, not a bespoke one) and an
// SVG checkmark that draws itself in via stroke-dashoffset after the
// circle pops in. The same green badge (plain HTML/CSS, not SVG or a
// GIF, since email client support for both is inconsistent) was added
// to the guest booking-confirmation email so the "you're booked" moment
// looks the same whether someone's looking at the page or the email.

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
  const section = BOOKING_HTML.match(/<section class="step-panel" id="stepConfirmed">[\s\S]*?<\/section>/)[0];
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
  const section = BOOKING_HTML.match(/<section class="step-panel" id="stepConfirmed">[\s\S]*?<\/section>/)[0];
  assert.match(section, /<h2>You're booked! Your slot is held\.<\/h2>/);
});

test('send-booking-email-index.ts: the guest confirmation email carries the same green checkmark badge', () => {
  const fn = BOOKING_EMAIL_TS.match(/function buildGuestEmailHtml[\s\S]*?\n}/)[0];
  assert.match(fn, /bgcolor="#3ad66b"/, 'same green as the page\'s --success-text value');
  assert.match(fn, /border-radius: 50%/);
  assert.match(fn, /&#10003;/);
  // Badge comes before the "You're booked!" heading, not after.
  const badgeIndex = fn.indexOf('bgcolor="#3ad66b"');
  const headingIndex = fn.indexOf("You're booked!");
  assert.ok(badgeIndex > 0 && headingIndex > 0 && badgeIndex < headingIndex);
});

test('send-booking-email-index.ts: the checkmark badge is plain HTML/CSS, not SVG or an animated GIF (email client support is too inconsistent for either)', () => {
  const fn = BOOKING_EMAIL_TS.match(/function buildGuestEmailHtml[\s\S]*?\n}/)[0];
  assert.doesNotMatch(fn, /<svg/i);
  assert.doesNotMatch(fn, /\.gif/i);
});
