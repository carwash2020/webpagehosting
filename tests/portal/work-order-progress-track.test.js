// A real progress track for portal work orders (2026-09-07): the status
// pill already told a client where a request stood, but as a single word
// with no sense of how much further there was to go. Reuses the exact
// real pipeline already encoded in STATUS_LABELS rather than inventing a
// new one -- "quoted" fills the same step as "reviewing" since the
// status pill itself already colors them identically.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

function loadProgressTrackHtml() {
  const stepsLine = WORK_ORDERS.match(/const PROGRESS_STEPS = \{[^}]*\};/)[0];
  const labelsLine = WORK_ORDERS.match(/const PROGRESS_STEP_LABELS = \[[^\]]*\];/)[0];
  const fnSrc = extractFn(WORK_ORDERS, 'progressTrackHtml');
  const ctx = { console, escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;') };
  vm.createContext(ctx);
  vm.runInContext(`${stepsLine}\n${labelsLine}\n${fnSrc}\nthis.progressTrackHtml = progressTrackHtml;`, ctx);
  return ctx.progressTrackHtml;
}

test('each real status fills the correct number of segments out of 4', () => {
  const progressTrackHtml = loadProgressTrackHtml();
  const casesInOrder = [
    ['submitted', 1],
    ['reviewing', 2],
    ['quoted', 2],
    ['scheduled', 3],
    ['completed', 4],
  ];
  for (const [status, expectedFilled] of casesInOrder) {
    const html = progressTrackHtml(status);
    const filledCount = (html.match(/is-filled/g) || []).length;
    const totalSegs = (html.match(/wo-progress-seg/g) || []).length;
    assert.equal(totalSegs, 4, `expected 4 total segments for status "${status}"`);
    assert.equal(filledCount, expectedFilled, `expected ${expectedFilled} filled segments for status "${status}", got ${filledCount}`);
  }
});

test('"quoted" fills the same step as "reviewing" -- they already share one status-pill color, so the track agrees', () => {
  const progressTrackHtml = loadProgressTrackHtml();
  const reviewingFilled = (progressTrackHtml('reviewing').match(/is-filled/g) || []).length;
  const quotedFilled = (progressTrackHtml('quoted').match(/is-filled/g) || []).length;
  assert.equal(reviewingFilled, quotedFilled);
});

test('a declined (closed) request gets no progress track at all -- it is not partway through anything', () => {
  const progressTrackHtml = loadProgressTrackHtml();
  assert.equal(progressTrackHtml('declined'), '');
});

test('an unrecognized status fails safe to no track, rather than throwing or showing a wrong fraction', () => {
  const progressTrackHtml = loadProgressTrackHtml();
  assert.equal(progressTrackHtml('something-unexpected'), '');
});

test('the track carries an accessible label naming the real stage and step number', () => {
  const progressTrackHtml = loadProgressTrackHtml();
  const html = progressTrackHtml('scheduled');
  assert.match(html, /aria-label="Progress: Scheduled, step 3 of 4"/);
});

test('the track is wired into the request card, right after the status pill', () => {
  const cardFn = extractFn(WORK_ORDERS, 'renderRequestCard');
  const statusAt = cardFn.indexOf('wo-status is-');
  const progressAt = cardFn.indexOf('progressTrackHtml(statusKey)');
  const descAt = cardFn.indexOf('wo-card-desc');
  assert.ok(statusAt >= 0 && progressAt >= 0 && descAt >= 0);
  assert.ok(statusAt < progressAt && progressAt < descAt, 'expected the track between the status pill and the description');
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 23, `expected v23 or later, got v${versionMatch[1]}`);
});
