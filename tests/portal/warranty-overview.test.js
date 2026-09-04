// Tests for the warranty overview (2026-09-03), requested directly:
// "Warranty overview" -- previously warranty status only showed
// per-job on this page, requiring a client to scroll through their
// whole history to spot which ones were still covered.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');

test('warrantyDaysLeft is a single shared source of truth, used by both the per-job badge and the overview', () => {
  const daysLeftMatch = JOBS.match(/function warrantyDaysLeft\(jobDate\)[\s\S]*?\n  \}\n/);
  assert.ok(daysLeftMatch, 'expected to isolate warrantyDaysLeft()');

  const badgeMatch = JOBS.match(/function warrantyBadgeHtml\(jobDate\)[\s\S]*?\n  \}\n/);
  assert.match(badgeMatch[0], /const daysLeft = warrantyDaysLeft\(jobDate\);/,
    'the badge must call the shared helper, not recompute its own day math');

  const overviewMatch = JOBS.match(/function renderWarrantyOverview\(jobs\)[\s\S]*?\n  \}\n/);
  assert.match(overviewMatch[0], /warrantyDaysLeft\(j\.job_date\)/,
    'the overview must call the shared helper too, not a second copy of the math');
});

test('the overview is sourced from the already-fetched jobs array, with no separate query', () => {
  const overviewMatch = JOBS.match(/function renderWarrantyOverview\(jobs\)[\s\S]*?\n  \}\n/);
  assert.doesNotMatch(overviewMatch[0], /client\.from\(|await fetch\(/,
    'the overview must not issue its own query -- it receives the jobs array renderJobs() already fetched');
});

test('only jobs still within their warranty window are shown, sorted soonest-to-expire first', () => {
  const overviewMatch = JOBS.match(/function renderWarrantyOverview\(jobs\)[\s\S]*?\n  \}\n/);
  const body = overviewMatch[0];
  assert.match(body, /\.filter\(x => x\.daysLeft !== null && x\.daysLeft >= 0\)/);
  assert.match(body, /\.sort\(\(a, b\) => a\.daysLeft - b\.daysLeft\)/);
});

test('a client with nothing currently under warranty sees an empty overview, not an empty-state message taking up space', () => {
  const overviewMatch = JOBS.match(/function renderWarrantyOverview\(jobs\)[\s\S]*?\n  \}\n/);
  assert.match(overviewMatch[0], /if \(!covered\.length\) \{ el\.innerHTML = ''; return; \}/);
});

test('the overview is called with the real jobs array exactly once, before the job list itself renders', () => {
  const callSites = JOBS.match(/renderWarrantyOverview\(jobs\);/g);
  assert.ok(callSites);
  assert.equal(callSites.length, 1);
  const renderJobsMatch = JOBS.match(/async function renderJobs\(\)[\s\S]*?\n  \}\n/);
  assert.ok(renderJobsMatch);
  const overviewIdx = renderJobsMatch[0].indexOf('renderWarrantyOverview(jobs);');
  const listRenderIdx = renderJobsMatch[0].indexOf("listEl.innerHTML = jobs.map(renderJobCard)");
  assert.ok(overviewIdx !== -1 && listRenderIdx !== -1);
  assert.ok(overviewIdx < listRenderIdx);
});

test('job titles in the overview are escaped for safe display', () => {
  const overviewMatch = JOBS.match(/function renderWarrantyOverview\(jobs\)[\s\S]*?\n  \}\n/);
  assert.match(overviewMatch[0], /escapeHtml\(x\.job\.title\)/);
});

test('the warranty overview container sits above the job list in the markup', () => {
  const overviewIdx = JOBS.indexOf('id="warrantyOverview"');
  const listIdx = JOBS.indexOf('id="jobList"');
  assert.ok(overviewIdx !== -1 && listIdx !== -1);
  assert.ok(overviewIdx < listIdx);
});
