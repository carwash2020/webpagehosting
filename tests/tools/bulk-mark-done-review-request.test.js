// Real gap found in a growth/SEO audit (2026-09-15): setJobStatus()
// (the single-job "mark done" path) has always asked "send a review
// request?" the moment a job flips to done, but bulkMarkJobsDone() (the
// "select multiple -> Mark Done" path) silently skipped that prompt
// entirely -- any job completed in a batch got zero review-request
// nudge. Fixed to ask the same question, in order, for each
// newly-completed job that has a client on file, stopping at the first
// "yes" since navigating to review-request.html leaves this page.
//
// Plain regex assertions against the page source, matching the style of
// the other tools/job-tracker*.test.js files in this repo (no DOM/vm
// execution needed for this kind of structural/behavioral-shape check).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');

function extractFn(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = HTML.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}

test('bulkMarkJobsDone tracks which jobs were newly completed (not already done before)', () => {
  const fn = extractFn('bulkMarkJobsDone');
  assert.match(fn, /const newlyDone = \[\];/);
  assert.match(fn, /if \(selectedJobIds\.has\(j\.id\) && j\.status !== 'done'\) \{/);
  assert.match(fn, /newlyDone\.push\(j\);/);
});

test('bulkMarkJobsDone sets statusChangedAt on each newly-completed job, matching setJobStatus\'s own behavior', () => {
  const fn = extractFn('bulkMarkJobsDone');
  assert.match(fn, /j\.statusChangedAt = new Date\(\)\.toISOString\(\);/);
});

test('bulkMarkJobsDone asks to send a review request for each newly-done job that has a client, after the bulk toast', () => {
  const fn = extractFn('bulkMarkJobsDone');
  const toastIdx = fn.indexOf('showToast(count +');
  const loopIdx = fn.indexOf('for (const job of newlyDone)');
  assert.ok(toastIdx >= 0 && loopIdx > toastIdx, 'the review-request loop should run after the bulk-completion toast');
  assert.match(fn, /if \(!job\.client\) continue;/, 'a job with no client on file should never be asked about');
  assert.match(fn, /showConfirm\(`Send a review request to \$\{job\.client\} for "\$\{job\.title\}"\?`/);
});

test('bulkMarkJobsDone stops at the first confirmed review request instead of stacking navigations', () => {
  const fn = extractFn('bulkMarkJobsDone');
  const confirmIdx = fn.indexOf('if (goSend) {');
  const returnIdx = fn.indexOf('return;', confirmIdx);
  const hrefIdx = fn.indexOf("window.location.href = '/tools/review-request.html?'", confirmIdx);
  assert.ok(confirmIdx >= 0 && hrefIdx > confirmIdx && returnIdx > hrefIdx, 'expected navigate-then-return inside the confirmed branch');
});

test('bulkMarkJobsDone passes the same name/job/phone params to review-request.html as the single-job flow', () => {
  const singleFn = extractFn('setJobStatus');
  const bulkFn = extractFn('bulkMarkJobsDone');
  for (const fn of [singleFn, bulkFn]) {
    assert.match(fn, /params\.set\('job', job\.title\)/);
    assert.match(fn, /params\.set\('phone', job\.phone\)/);
  }
});
