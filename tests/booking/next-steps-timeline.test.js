// "What happens next" mini-timeline on the confirmation screen
// (2026-09-09), requested directly: reduces the "did this actually go
// through" anxiety of booking online, right at the moment it matters
// most -- immediately after confirming, not before.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BOOKING_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'booking.html'), 'utf8');

test('the confirmation screen has a 4-step "what happens next" timeline', () => {
  const section = BOOKING_HTML.match(/<section class="step-panel" id="stepConfirmed">[\s\S]*?<\/section>/)[0];
  const timeline = section.match(/<div class="next-steps"[\s\S]*?<\/ol>\s*<\/div>/)[0];
  const steps = [...timeline.matchAll(/<span class="next-steps-dot">(\d)<\/span><span>([^<]*)<\/span>/g)];
  assert.equal(steps.length, 4, 'expected exactly 4 timeline steps');
  assert.deepEqual(steps.map(s => s[1]), ['1', '2', '3', '4'], 'steps should be numbered in order');
});

test('the timeline only makes claims already true elsewhere on the site -- no invented turnaround times or guarantees', () => {
  const section = BOOKING_HTML.match(/<section class="step-panel" id="stepConfirmed">[\s\S]*?<\/section>/)[0];
  const timeline = section.match(/<div class="next-steps"[\s\S]*?<\/ol>/)[0];
  // No specific number of minutes/hours promised for the callback step,
  // and payment methods match what the rest of the site already states
  // (cash, check, Venmo, Cash App, card) -- not inventing a new policy.
  assert.doesNotMatch(timeline, /\d+\s*(minute|hour|min|hr)/i, 'should not promise a specific callback turnaround time');
  assert.match(timeline, /cash, check, Venmo, Cash App, or card/, 'payment methods should match the site\'s existing stated policy');
});

test('the timeline sits between the confirmation detail and the "Back to site" link, not before the confirmation itself', () => {
  const section = BOOKING_HTML.match(/<section class="step-panel" id="stepConfirmed">[\s\S]*?<\/section>/)[0];
  const detailIndex = section.indexOf('id="confirmationDetail"');
  const timelineIndex = section.indexOf('class="next-steps"');
  const backLinkIndex = section.indexOf('Back to site');
  assert.ok(detailIndex < timelineIndex, 'the timeline should come after the confirmation detail');
  assert.ok(timelineIndex < backLinkIndex, 'the timeline should come before the back-to-site link');
});
