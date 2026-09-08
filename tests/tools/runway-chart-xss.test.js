// CodeQL #54 "DOM text reinterpreted as HTML" (2026-09-08): the
// Revenue-vs-Costs chart embedded a bar's month label straight into an
// inline onclick="highlightMonthRow('${p.month}')" attribute on markup
// assigned via innerHTML. HTML-escaping alone (aria-label already had
// it) doesn't make that safe -- the browser decodes HTML entities in an
// attribute value BEFORE handing it to the JS engine as the event
// handler's source, so an escaped quote still closes the string literal
// early once decoded, e.g. month = `x'); alert(1); //` breaks out and
// runs arbitrary JS. Fixed by dropping the inline handler entirely: the
// month lives in a plain data-attribute (never parsed as code) and a
// real addEventListener reads it back as an actual JS value.
//
// Verified here by actually executing the real drawRevCostChart/
// highlightMonthRow source (extracted from the page) against a
// deliberately hostile month string, in a real jsdom DOM -- not just
// asserting the source text looks right.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const RUNWAY = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');

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

test('drawRevCostChart no longer emits an inline onclick/onkeydown handler for the month label', () => {
  const src = extractFn(RUNWAY, 'drawRevCostChart');
  assert.doesNotMatch(src, /onclick=/);
  assert.doesNotMatch(src, /onkeydown=/);
  assert.match(src, /data-month="\$\{escapeAttr\(p\.month\)\}"/);
  assert.match(src, /addEventListener\('click'/);
  assert.match(src, /addEventListener\('keydown'/);
});

test('a hostile month string cannot break out of the generated markup and execute script', () => {
  const dom = new JSDOM('<!DOCTYPE html><svg id="revCostChart"></svg><div id="revCostChartNote"></div>', { runScripts: 'outside-only' });
  const { window } = dom;
  window.alert = () => { throw new Error('XSS EXECUTED: alert() was called'); };

  const src = [
    extractFn(RUNWAY, 'escapeHtml'),
    extractFn(RUNWAY, 'escapeAttr'),
    extractFn(RUNWAY, 'roundedBarPath'),
    extractFn(RUNWAY, 'fmt'),
    'const REVCOST_CHART_COLUMN_WIDTH = 64, REVCOST_CHART_BAR_WIDTH = 22, REVCOST_CHART_HEIGHT = 170, REVCOST_CHART_BAR_GAP = 3;',
    extractFn(RUNWAY, 'drawRevCostChart'),
    extractFn(RUNWAY, 'highlightMonthRow'),
    'window.drawRevCostChart = drawRevCostChart; window.highlightMonthRow = highlightMonthRow;',
  ].join('\n');
  window.eval(src);

  const hostileMonth = "x'); alert(1); //";
  window.drawRevCostChart([{ month: hostileMonth, revenue: 1000, expenses: 200, fuel: 0, other: 0 }]);

  const svgHtml = window.document.getElementById('revCostChart').innerHTML;
  assert.doesNotMatch(svgHtml, /onclick=/);
  assert.doesNotMatch(svgHtml, /onkeydown=/);

  // The click handler should still fire correctly with the raw string,
  // proving the fix didn't just remove the feature.
  const group = window.document.querySelector('.chart-bar-group');
  assert.ok(group, 'expected a chart-bar-group element');
  assert.equal(group.dataset.month, hostileMonth);
  // Should not throw despite the hostile characters, and should not
  // trigger the window.alert trap above.
  group.dispatchEvent(new window.Event('click', { bubbles: true }));
});
