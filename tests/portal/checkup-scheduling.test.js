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

test('the check-up scheduling flow reuses the exact same business hours and timezone as the quote scheduling flow', () => {
  const quotesHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'quotes.html'), 'utf8');
  const normalize = (s) => s.replace(/\s+/g, '').replace(/,\}/g, '}');

  const quotesTz = quotesHtml.match(/const BUSINESS_TIMEZONE = '([^']+)'/);
  const jobsTz = html.match(/const BUSINESS_TIMEZONE = '([^']+)'/);
  assert.ok(quotesTz && jobsTz);
  assert.equal(jobsTz[1], quotesTz[1]);

  const quotesHours = quotesHtml.match(/const HOURS_BY_WEEKDAY = (\{[\s\S]+?\});/);
  const jobsHours = html.match(/const HOURS_BY_WEEKDAY = (\{[\s\S]+?\});/);
  assert.ok(quotesHours && jobsHours);
  assert.equal(normalize(jobsHours[1]), normalize(quotesHours[1]));

  const quotesLead = quotesHtml.match(/const MIN_LEAD_HOURS = (\d+)/);
  const jobsLead = html.match(/const MIN_LEAD_HOURS = (\d+)/);
  assert.ok(quotesLead && jobsLead);
  assert.equal(jobsLead[1], quotesLead[1]);
});

test('a checked-up visit request requires a real session before submitting', () => {
  const fnMatch = html.match(/async function confirmCheckupSchedule\(checkupId\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate confirmCheckupSchedule()');
  assert.match(fnMatch[0], /if \(!session\) \{ window\.location\.replace\('\/portal\/login\.html'\); return; \}/);
});
