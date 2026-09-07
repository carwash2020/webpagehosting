// Real overlap bug, reported directly with a screenshot (2026-09-07):
// scrolling Finance's Income/Expenses log showed a previous or
// upcoming row's text bleeding through, overlapping the sticky
// DATE/SOURCE/JOB/... header row.
//
// Root cause, found by reproducing the exact bug in isolation and
// checking the real computed geometry: the header (a single line,
// ~28px tall) is shorter than a real data row once a long
// description/job name wraps to multiple lines, so at most scroll
// positions the header only partially overlapped whatever row was
// passing behind it. The header itself was already fully opaque and
// correctly stacked; it simply didn't occupy enough vertical space to
// hide a taller row's excess height.
//
// First attempt: keep the header sticky against the whole page (as it
// was) and extend its own opaque background upward with a
// ::before covering the excess. This was rejected after finding a
// worse regression: with the header sticking to the PAGE, arbitrary
// page content sits directly above it at any scroll position -- the
// "Log" heading is only ~15px above the table -- so any ::before big
// enough to cover a real wrapped row (measured up to 117px tall, using
// this business's own actual longest logged Job entry) was also big
// enough to paint over that heading on ordinary page load, before any
// scrolling had even happened.
//
// Final fix: give #incomeTable/#entriesTable their own bounded,
// scrollable container (max-height + overflow-y) and stick the header
// to THAT instead of the page. Nothing but the container's own clipped
// edge is ever directly above the header, so the ::before extension
// can be sized generously with no risk of covering real content.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('tools', 'styles-tools.css'), 'utf8');

function extractRule(selectorRegexSource) {
  const re = new RegExp(selectorRegexSource + '\\s*\\{([^}]*)\\}');
  const m = STYLES.match(re);
  assert.ok(m, `expected to find a rule matching ${selectorRegexSource}`);
  return m[1];
}

test('#incomeTable and #entriesTable are their own bounded, scrollable containers, not relying on page scroll', () => {
  const rule = extractRule('#incomeTable, #entriesTable');
  assert.match(rule, /max-height:\s*60vh/);
  assert.match(rule, /overflow-y:\s*auto/);
});

test('the sticky header now sticks to that bounded container (top: 0), not the page (no fixed-app-bar offset math)', () => {
  const rule = extractRule('#incomeTable thead th, #entriesTable thead th');
  assert.match(rule, /position:\s*sticky;\s*top:\s*0;/);
  assert.doesNotMatch(rule, /calc\(61px/, 'the old page-relative offset should be gone entirely');
  assert.match(rule, /background:\s*var\(--bg-panel-2\)/);
});

test('there is no leftover desktop media-query override of the old page-relative top offset', () => {
  assert.doesNotMatch(STYLES, /#incomeTable thead th\s*\{\s*top:\s*61px/);
});

test('the header extends its own opaque background upward via ::before, generously sized now that it is safe to', () => {
  const rule = extractRule('#incomeTable thead th::before, #entriesTable thead th::before');
  assert.match(rule, /position:\s*absolute/);
  assert.match(rule, /bottom:\s*100%/, 'must sit entirely above the header\'s own box, never over its own labels');
  assert.match(rule, /background:\s*var\(--bg-panel-2\)/, 'must match the header\'s own background exactly, not a different color');
  const heightMatch = rule.match(/height:\s*(\d+)px/);
  assert.ok(heightMatch, 'expected a fixed pixel height for the cover');
  const height = Number(heightMatch[1]);
  assert.ok(height >= 150, `expected the cover to comfortably exceed the real 117px-tall worst-case row's ~89px excess over the header, got ${height}px`);
});

test('the tools service worker cache was bumped for this change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 82, `expected v82 or later, got v${version}`);
});
