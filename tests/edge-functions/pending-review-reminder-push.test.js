// Tests for the "Review Follow-Up Due" push notification (2026-09-16),
// closing a real gap in review-request.html's existing delayed-reminder
// feature: a reminder set there only ever surfaced the next time Steve
// happened to open that exact page on or after the target date (its
// own toast copy says so explicitly -- "this won't send a phone
// notification on its own"). This adds a real push the moment it's
// due, matching every other "due today" condition send-push already
// checks daily.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SRC = fs.readFileSync(repo('edge-functions', 'send-push-index.ts'), 'utf8');
const REVIEW_PAGE = fs.readFileSync(repo('tools', 'review-request.html'), 'utf8');

test('review-reminder-due is registered with an "effectively once" resend interval, matching job-no-photos/warranty-checkin', () => {
  assert.match(SRC, /"review-reminder-due": 3650,/);
});

test('checkPendingReviewReminders() compares remindAt against business-tz today as plain date strings, no Date parsing', () => {
  const fnMatch = SRC.match(/async function checkPendingReviewReminders\(reviewReminders: any\[\]\): Promise<void> \{[\s\S]*?\n\}\n/)
    || SRC.match(/async function checkPendingReviewReminders\(reviewReminders: any\[\]\) \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate checkPendingReviewReminders()');
  const body = fnMatch[0];
  assert.match(body, /const today = todayDateStrInBusinessTz\(\);/);
  assert.match(body, /if \(!reminder\.remindAt \|\| reminder\.remindAt > today\) continue;/);
});

test('dedupes per reminder id via the existing notification_log mechanism, never a new table', () => {
  const fnMatch = SRC.match(/async function checkPendingReviewReminders\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch);
  const body = fnMatch[0];
  assert.match(body, /const itemKey = String\(reminder\.id\);/);
  assert.match(body, /wasRecentlyNotified\("review-reminder-due", itemKey\)/);
  assert.match(body, /markNotified\("review-reminder-due", itemKey\)/);
});

test('the push links to review-request.html, where the reminder actually lives', () => {
  const fnMatch = SRC.match(/async function checkPendingReviewReminders\([\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /url: "\/tools\/review-request\.html",/);
});

test('reminder-check reads th_review_requests_pending from the synced blob and calls the new check', () => {
  const dispatch = SRC.match(/if \(payload\.type === "reminder-check"\) \{[\s\S]*?\n    \}\n/);
  assert.ok(dispatch, 'expected to isolate the reminder-check dispatch block');
  assert.match(dispatch[0], /const reviewReminders = synced \? safeParse\(synced\.data\.th_review_requests_pending, \[\]\) : \[\];/);
  assert.match(dispatch[0], /await checkPendingReviewReminders\(reviewReminders\);/);
});

test('review-request.html\'s own reminder toast still accurately describes this as page-local (unchanged by this addition -- the push is a new, separate channel, not a replacement)', () => {
  assert.match(REVIEW_PAGE, /this won't send a phone notification on its own/);
});

test('th_review_requests_pending items carry {id, name, phone, job, remindAt} -- matches what checkPendingReviewReminders expects', () => {
  const scheduleFn = REVIEW_PAGE.match(/function scheduleReminder\(daysFromNow\) \{[\s\S]*?\n  \}\n/);
  assert.ok(scheduleFn);
  assert.match(scheduleFn[0], /pending\.push\(\{ id: Date\.now\(\), name, phone, job, remindAt: remindAtStr \}\);/);
});
