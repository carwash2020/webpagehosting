// Runway Dashboard chart redesign (2026-09-07, item #41): "same dataviz
// treatment as the portal invoice chart" -- both the Net Profit Trend
// and Revenue vs. Costs charts were rebuilt from hand-drawn <canvas>
// into real SVG, matching portal/dashboard.html's Invoice History
// chart: a horizontally-scrolling row of fixed-width columns (so a
// growing month count scrolls instead of squeezing bars illegibly
// thin), rounded 4px bar ends, and colors driven by CSS custom
// properties so both finally track the light/dark theme toggle -- the
// old canvas version hardcoded literal hex/rgba values that never
// adapted (including a baseline line that was nearly invisible on the
// light theme).
//
// Net Profit Trend (a single series, diverging pos/neg) keeps
// portal's own choice of always-visible per-bar value + month labels,
// since a business logs relatively few months and that stays legible.
// Revenue vs. Costs (two series per month) instead makes each bar
// group a click/Enter target that scrolls to and flashes the matching
// row in the Monthly History table below -- the same real numbers are
// already there, so this avoids crowding 4 labels into one 64px-wide
// column as more months accumulate, while still giving portal's same
// "click a bar to reach its source" interaction.
//
// These are plain regex/structural assertions against the page source,
// matching the style of other tools/*.test.js and workspace/*.test.js
// files in this repo.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');

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

test('both chart canvases were replaced with real SVG elements', () => {
  assert.doesNotMatch(HTML, /<canvas id="trendChart"/);
  assert.doesNotMatch(HTML, /<canvas id="revCostChart"/);
  assert.match(HTML, /<svg id="trendChart" class="rw-chart"/);
  assert.match(HTML, /<svg id="revCostChart" class="rw-chart"/);
});

test('each chart sits in its own horizontally-scrolling container, same idiom as the portal Invoice History chart', () => {
  assert.match(HTML, /<div class="chart-scroll"><svg id="trendChart"/);
  assert.match(HTML, /<div class="chart-scroll"><svg id="revCostChart"/);
  const rule = HTML.match(/\.chart-scroll\{([^}]*)\}/);
  assert.ok(rule, 'expected a .chart-scroll rule');
  assert.match(rule[1], /overflow-x:auto/);
});

test('chart width is computed purely from data (columns × a fixed column width), never from a container/canvas clientWidth', () => {
  const trendFn = extractFn('drawTrendChart');
  const revCostFn = extractFn('drawRevCostChart');
  assert.doesNotMatch(trendFn, /clientWidth/, 'the old canvas-sizing approach (and its hidden-tab-reads-0 failure mode) should be fully gone from this chart');
  assert.doesNotMatch(revCostFn, /clientWidth/, 'the old canvas-sizing approach (and its hidden-tab-reads-0 failure mode) should be fully gone from this chart');
  assert.match(trendFn, /const width = nets\.length \* TREND_CHART_COLUMN_WIDTH;/);
  assert.match(revCostFn, /const width = points\.length \* REVCOST_CHART_COLUMN_WIDTH;/);
});

test('bars use the shared roundedBarPath() helper (one definition, not duplicated per chart like the old canvas roundedTopRect)', () => {
  const matches = [...HTML.matchAll(/function roundedBarPath\(/g)];
  assert.equal(matches.length, 1, 'expected exactly one roundedBarPath definition, reused by both charts');
  const fn = extractFn('roundedBarPath');
  assert.match(fn, /Math\.max\(0, Math\.min\(radius, height \/ 2, width \/ 2\)\)/, 'radius should still clamp to never exceed half the bar\'s own height/width');
  assert.match(HTML, /roundedBarPath\(x, y, TREND_CHART_BAR_WIDTH, barH, 4, isPos \? 'top' : 'bottom'\)/);
  assert.match(HTML, /roundedBarPath\(revX, baselineY - revH, REVCOST_CHART_BAR_WIDTH, revH, 3, 'top'\)/);
});

test('chart colors are driven by CSS custom properties, not hardcoded literals, so both finally track the light/dark theme toggle', () => {
  const trendFn = extractFn('drawTrendChart');
  assert.match(trendFn, /stroke="var\(--orange\)"/, 'the bills line should use the theme variable');
  assert.match(trendFn, /stroke="var\(--border\)"/, 'the baseline should use the theme variable, not a hardcoded rgba that was invisible in light mode');
  const revCostFn = extractFn('drawRevCostChart');
  assert.match(revCostFn, /stroke="var\(--border\)"/);
});

test('Net Profit Trend keeps portal\'s own choice of always-visible per-bar value + month labels', () => {
  const fn = extractFn('drawTrendChart');
  assert.match(fn, /class="chart-value"/);
  assert.match(fn, /class="chart-date"/);
  assert.match(fn, /\$\{fmt\(n\.y\)\}/, 'the bar\'s exact dollar value should be printed directly on the chart');
});

test('the bills-line legend only appears when there actually is a bills minimum, matching the dashed line\'s own conditional', () => {
  const fn = extractFn('drawTrendChart');
  assert.match(fn, /legend\.innerHTML = min > 0/);
  assert.match(fn, /chart-legend-line/);
});

test('Revenue vs. Costs has a real 2-color legend (revenue vs. costs), required for a 2-series chart', () => {
  assert.match(HTML, /<span class="chart-legend-dot" style="background:var\(--orange\);"><\/span>Revenue/);
  assert.match(HTML, /<span class="chart-legend-dot" style="background:#8d97a3;"><\/span>Costs/);
});

test('Revenue vs. Costs bars are click/Enter targets that jump to their source row in Monthly History, instead of crowding 4 always-on labels per month', () => {
  const fn = extractFn('drawRevCostChart');
  assert.doesNotMatch(fn, /class="chart-value"/, 'no permanent per-bar dollar labels on the 2-series chart -- the real numbers already live in the Monthly History table');
  assert.match(fn, /role="button"/);
  assert.match(fn, /tabindex="0"/);
  assert.match(fn, /onclick="highlightMonthRow\('\$\{p\.month\}'\)"/);
  assert.match(fn, /onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)/, 'should be keyboard-activatable too, not mouse-only');

  const highlightFn = extractFn('highlightMonthRow');
  assert.match(highlightFn, /querySelector\('\[data-month-row="' \+ monthKey \+ '"\]'\)/, 'should target the exact same [data-month-row] attribute the Monthly History table and its own delete handler already use');
  assert.match(highlightFn, /scrollIntoView/);
  assert.match(highlightFn, /classList\.add\('is-highlighted'\)/);
});

test('the highlight-flash animation exists and is scoped to a real month row, reusing the portal\'s own highlight idiom', () => {
  assert.match(HTML, /tr\[data-month-row\]\.is-highlighted\{animation:monthRowHighlight 1\.6s ease;\}/);
  assert.match(HTML, /@keyframes monthRowHighlight\{/);
});

test('both draw functions handle the empty-data case by clearing the SVG rather than leaving stale content or a canvas-era leftover width/height', () => {
  const trendFn = extractFn('drawTrendChart');
  assert.match(trendFn, /if\(nets\.length === 0\)\{[\s\S]*?svg\.innerHTML = '';[\s\S]*?removeAttribute\('viewBox'\)/);
  const revCostFn = extractFn('drawRevCostChart');
  assert.match(revCostFn, /if \(sortedMonths\.length === 0\) \{[\s\S]*?svg\.innerHTML = '';[\s\S]*?removeAttribute\('viewBox'\)/);
});

test('the nets array retains a real month field for the chart labels to read, sourced the same way the Monthly History table sources it', () => {
  assert.match(HTML, /const nets = sorted\.map\(\(m,i\) => \(\{x:i, y:computeNetProfit\(m\), month:m\.month\}\)\);/);
});

test('the tools service worker cache was bumped for this change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 84, `expected v84 or later, got v${version}`);
});
