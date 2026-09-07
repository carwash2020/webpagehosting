// UI audit findings F04, F05 (7 September 2026).
//
// F04: finance.html's page description was an internal changelog note
// ("moved out of Job Tracker into its own page (2026-08-20)..."), not a
// sentence describing what the tool does.
//
// F05: route-planner.html was the only page in the suite with horizontal
// overflow at 390px phone width -- confirmed with a real Playwright
// render (not just read): document.documentElement.scrollWidth measured
// 410px against a 390px viewport, and the per-stop Remove ("x") button
// was visibly clipped off the right edge of the screen. Root cause: each
// .stop-row is a flex row (num + input + 3 fixed-width buttons: move up,
// move down, remove) where the address <input> has flex:1 but no
// min-width:0 -- a flex item's default min-width is "auto", which for a
// text input resolves to its own intrinsic content width, not 0, so it
// refused to shrink to fit and pushed the Remove button off-screen.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const FINANCE = fs.readFileSync(repo('tools', 'finance.html'), 'utf8');
const ROUTE_PLANNER = fs.readFileSync(repo('tools', 'route-planner.html'), 'utf8');

test('F04: finance.html\'s page description is user-facing, not an internal dev changelog note', () => {
  const desc = FINANCE.match(/<p class="tool-sub">([^<]*)<\/p>/);
  assert.ok(desc, 'expected a .tool-sub description paragraph');
  assert.doesNotMatch(desc[1], /moved out of Job Tracker/);
  assert.doesNotMatch(desc[1], /2026-08-20/);
  assert.equal(desc[1], 'Quote a job, track what it actually cost, and log income and expenses.');
});

test('F05: .stop-row\'s address input has min-width:0 so it can actually shrink within its flex row', () => {
  const rule = ROUTE_PLANNER.match(/\.stop-row input \{([\s\S]*?)\}/);
  assert.ok(rule, 'expected a .stop-row input rule');
  assert.match(rule[1], /min-width:\s*0;/);
  assert.match(rule[1], /flex:\s*1;/, 'should still be a flexible item, just now able to shrink');
});
