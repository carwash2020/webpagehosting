// Tests for self-scheduling from a check-up reminder (2026-09-02) --
// the "natural next step" flagged in docs/CLIENT-PORTAL.md's own
// phase 5 entry. Source-inspection style, same reasoning as the other
// portal test files.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const JOBS_PAGE_PATH = path.join(__dirname, '..', '..', 'portal', 'jobs.html');
const html = fs.readFileSync(JOBS_PAGE_PATH, 'utf8');

test('scheduling is only offered on a due check-up reminder, not one that isn\'t due yet', () => {
  assert.match(html, /\$\{due\.isDue \? `/);
  assert.match(html, /toggleCheckupSchedule\(\$\{c\.id\}\)/);
});

test('booking creation only ever goes through schedule-checkup-visit, never a direct th_bookings write', () => {
  assert.match(html, /functions\/v1\/schedule-checkup-visit/);
  assert.doesNotMatch(html, /client\s*\.\s*from\(['"]th_bookings['"]\)/);
});

test('the check-up scheduling flow shares business hours and timezone from the same file every other scheduling flow uses', () => {
  // Rewritten 2026-09-03, same reasoning as the equivalent fix in
  // quotes.test.js: this used to compare jobs.html's own independent
  // copy against quotes.html's -- which is what needed catching in
  // the first place, since jobs.html's own comment said "kept in sync
  // manually if business hours or timezone ever change." Now there is
  // one shared /business-hours.js file, and what matters is that this
  // page hasn't grown its own local copy back.
  assert.match(html, /<script src="\/business-hours\.js\?v=\d+"><\/script>/);
  assert.doesNotMatch(html, /const HOURS_BY_WEEKDAY\s*=/);
  assert.doesNotMatch(html, /const BUSINESS_TIMEZONE\s*=/);

  // Updated 2026-09-04, found during a full portal audit: jobs.html
  // ALSO had its own independent copy of MIN_LEAD_HOURS (and
  // SLOT_INCREMENT_MINUTES, SCHEDULE_BUFFER_MINUTES, overlaps(),
  // fetchBookingsForDate(), computeSlotsForDate()) -- a real bug, not
  // just drift risk: this page loads business-hours.js, which already
  // declares these same const names, so redeclaring them a second
  // time in this page's own inline script was a genuine SyntaxError
  // waiting to happen on a real page load, not merely a risk of
  // future divergence. All of it now comes from the one shared file;
  // neither this page nor quotes.html should define any of it locally.
  const quotesHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'quotes.html'), 'utf8');
  const sharedSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'business-hours.js'), 'utf8');
  assert.doesNotMatch(quotesHtml, /const MIN_LEAD_HOURS\s*=/, 'quotes.html should not define its own local copy of MIN_LEAD_HOURS');
  assert.doesNotMatch(html, /const MIN_LEAD_HOURS\s*=/, 'jobs.html should not define its own local copy of MIN_LEAD_HOURS');
  assert.match(sharedSrc, /const MIN_LEAD_HOURS = \d+;/, 'the shared file should be the one real definition');
});

test('a checked-up visit request requires a real session before submitting', () => {
  const fnMatch = html.match(/async function confirmCheckupSchedule\(checkupId\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate confirmCheckupSchedule()');
  assert.match(fnMatch[0], /if \(!session\) \{ window\.location\.replace\('\/portal\/login\.html'\); return; \}/);
});
