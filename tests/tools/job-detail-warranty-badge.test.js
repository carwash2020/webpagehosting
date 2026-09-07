// Item #45 (2026-09-07): investigated before building anything, and
// found the premise behind this task was wrong. An earlier survey
// reported job-detail.html and client-detail.html as "plain form/list
// content" with no hero-stat header -- a search for generic patterns
// like "hero-stat"/"stat-card"/"big-number" that simply didn't match
// how these two pages actually name things (.job-stat-row/.job-stat
// and .client-stat-row/.client-stat). Both pages already had a real,
// working hero-stat row (Revenue/Cost/Margin on job-detail.html;
// Lifetime Revenue/Jobs/Last Job on client-detail.html) well before
// this session.
//
// The one genuine, small gap actually found: job-tracker.html's own
// job card already shows a 30-day labor warranty countdown once a job
// is Done, but this dedicated detail page for that exact same job
// never did -- despite being the single most complete, natural place
// to check a job's current status. This test locks in that fix
// (reusing job-tracker.html's exact rule, not a second copy of the
// business logic) rather than the originally-assumed, and incorrect,
// larger gap.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOB_DETAIL = fs.readFileSync(repo('tools', 'job-detail.html'), 'utf8');
const JOB_TRACKER = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');
const CLIENT_DETAIL = fs.readFileSync(repo('tools', 'client-detail.html'), 'utf8');

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

test('job-detail.html and client-detail.html both already have a real hero-stat row (confirming the original "no hero-stat header" premise was wrong)', () => {
  assert.match(JOB_DETAIL, /<div class="job-stat-row">/);
  assert.match(JOB_DETAIL, /Revenue<\/div>/);
  assert.match(JOB_DETAIL, /Margin<\/div>/);
  assert.match(CLIENT_DETAIL, /<div class="client-stat-row">/);
  assert.match(CLIENT_DETAIL, /Lifetime Revenue<\/div>/);
});

test('job-detail.html now shows the same 30-day warranty countdown job-tracker.html\'s own card shows for a Done job', () => {
  const jobDetailFn = extractFn(JOB_DETAIL, 'warrantyBadgeHtml');
  const jobTrackerFn = extractFn(JOB_TRACKER, 'warrantyBadgeHtml');
  // Same business rule, not a second, potentially-drifting copy of it.
  assert.match(jobDetailFn, /job\.status !== 'done' \|\| !job\.date/);
  assert.match(jobDetailFn, /const daysLeft = 30 - daysSince;/);
  assert.match(jobTrackerFn, /const daysLeft = 30 - daysSince;/);
  assert.match(JOB_DETAIL, /warrantyBadgeHtml\(j\)/, 'expected the badge to actually be inserted into the rendered hero');
});

test('the badge-warranty CSS classes exist on job-detail.html, matching job-tracker.html\'s own colors exactly', () => {
  const rule = JOB_DETAIL.match(/\.badge-warranty\.is-active\s*\{([^}]*)\}/);
  assert.ok(rule, 'expected a .badge-warranty.is-active rule');
  assert.match(rule[1], /background:\s*rgba\(76,175,80,0\.15\)/);
  assert.match(rule[1], /color:\s*#4caf50/);
  assert.match(JOB_DETAIL, /\.badge-warranty\.is-expired\s*\{[^}]*background:\s*var\(--bg-panel-2\)/);
});

test('the tools service worker cache was bumped since job-detail.html is precached', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 87, `expected v87 or later, got v${version}`);
});
