// Tests for a real gap found proactively (2026-09-03) while reviewing
// the portal for other issues: three list pages (quotes, jobs, work
// requests) had no loading placeholder at all -- the container stayed
// completely empty from page load until the fetch resolved, which on
// a slow connection is visually indistinguishable from "you have
// nothing here." work-orders.html additionally went silently blank
// on a genuine database error, unlike every other list on the portal.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

test('quotes.html shows a loading placeholder before its fetch, not an empty container', () => {
  const src = fs.readFileSync(repo('portal', 'quotes.html'), 'utf8');
  const fnMatch = src.match(/async function renderQuotes\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderQuotes()');
  const body = fnMatch[0];
  const loadingIdx = body.indexOf("listEl.innerHTML = '<div class=\"empty-state\">Loading...</div>'");
  const fetchIdx = body.indexOf('.from(\'client_portal_quotes\')');
  assert.ok(loadingIdx !== -1, 'expected a Loading placeholder to be set');
  assert.ok(loadingIdx < fetchIdx, 'the loading placeholder must be set BEFORE the fetch, not after');
});

test('jobs.html shows a loading placeholder before its fetch, not an empty container', () => {
  const src = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
  const fnMatch = src.match(/async function renderJobs\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderJobs()');
  const body = fnMatch[0];
  const loadingIdx = body.indexOf("listEl.innerHTML = '<div class=\"empty-state\">Loading...</div>'");
  const fetchIdx = body.indexOf(".from('client_portal_jobs')");
  assert.ok(loadingIdx !== -1, 'expected a Loading placeholder to be set');
  assert.ok(loadingIdx < fetchIdx, 'the loading placeholder must be set BEFORE the fetch, not after');
});

test('work-orders.html shows a loading placeholder before its fetch, not an empty container', () => {
  const src = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
  const fnMatch = src.match(/async function renderMyRequests\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderMyRequests()');
  const body = fnMatch[0];
  const loadingIdx = body.indexOf('Loading...');
  const fetchIdx = body.indexOf(".from('client_portal_work_orders')");
  assert.ok(loadingIdx !== -1, 'expected a Loading placeholder to be set');
  assert.ok(loadingIdx < fetchIdx, 'the loading placeholder must be set BEFORE the fetch, not after');
});

test('work-orders.html shows a real error message on a genuine database error, not a silent blank container', () => {
  // The actual bug: `if (error) { listEl.innerHTML = ''; return; }`
  // cleared straight to nothing, with no way to tell "there's nothing
  // here" from "something broke" -- unlike quotes.html and jobs.html,
  // which both already had a real message for this case.
  const src = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
  const fnMatch = src.match(/async function renderMyRequests\(\) \{[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.doesNotMatch(body, /if \(error\) \{ listEl\.innerHTML = ''; return; \}/,
    'the old silent-blank-on-error path should be gone');
  assert.match(body, /Couldn\\'t load your requests right now/);
});

test('no portal page has a truly un-awaited fetch call that could silently drop its result', () => {
  // Confirms the exact bug class fixed on the invoice/quote generator
  // does not exist anywhere in the client-facing portal itself --
  // checked directly, not assumed, while investigating other portal
  // improvements.
  for (const page of ['dashboard.html', 'home.html', 'jobs.html', 'login.html', 'quotes.html', 'set-password.html', 'settings.html', 'work-orders.html']) {
    const src = fs.readFileSync(repo('portal', page), 'utf8');
    const fetchCalls = src.match(/[^t]fetch\(/g) || [];
    const awaitedFetchCalls = src.match(/await fetch(WithTimeout)?\(/g) || [];
    assert.equal(fetchCalls.length, awaitedFetchCalls.length,
      `${page}: every fetch() call should be awaited`);
  }
});
