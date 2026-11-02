// Cost Analyzer restored in Route Planner (corrections pack, 2026-11-01),
// after being removed in the 2026-10-31 redundancy pass (#550). The
// removal's stated reason was real -- the old suggested charge was
// fuelCost + fuelCost * its own sales-tax rate, unrelated to the business's
// actual $25/free policy -- so this is a fixed restoration, not a revert:
// "Suggested trip charge" is now always the policy fee itself (free within
// 15 miles of St. George, $25 flat beyond), with fuel cost kept as a
// reference-only row. Source-inspection style, matching
// tests/tools/route-planner-embedded-map.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'route-planner.html'), 'utf8');

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

test('the Cost Analyzer card is back, with the distance and cost-per-mile fields', () => {
  assert.match(HTML, /<h3>Cost Analyzer \(To &amp; From\)/);
  assert.match(HTML, /<input type="number" id="tripDistance"/);
  assert.match(HTML, /<input type="number" id="tripFuelRate" value="0\.76"/);
  // The old, separate "sales tax rate" field is gone -- that was the
  // actual bug the removal called out, not restored here.
  assert.doesNotMatch(HTML, /id="tripTaxRate"/);
});

test('calculateTripCost(): the suggested trip charge is exactly the posted policy fee ($0 within 15 miles, $25 beyond), not a tax-inflated fuel cost', () => {
  const fn = extractFn('calculateTripCost');
  assert.match(fn, /const TRIP_FREE_MILES = 15;|TRIP_FREE_MILES/);
  assert.match(fn, /oneWay <= TRIP_FREE_MILES \? 0 : TRIP_FLAT_FEE/);
  assert.doesNotMatch(fn, /taxRate|tripTaxResult|tripPolicyResult/);
});
test('the $15-free / $25-flat constants match the real posted policy', () => {
  assert.match(HTML, /const TRIP_FREE_MILES = 15;/);
  assert.match(HTML, /const TRIP_FLAT_FEE = 25;/);
});

test('the info modal states the real policy and that fuel cost is reference-only, not added into the charge', () => {
  assert.match(HTML, /free within 15 miles of St\. George, \$25 flat beyond that/);
  assert.match(HTML, /Estimated fuel cost is shown underneath for reference only/);
});

test('the per-mile rate is still shared with Finance\'s Expenses tab via th_mileage_rate', () => {
  assert.match(HTML, /const RATE_STORAGE_KEY = 'th_mileage_rate';/);
  assert.match(HTML, /function saveMileageRate\(\) \{\s*localStorage\.setItem\(RATE_STORAGE_KEY/);
});

test('the Cost Analyzer is initialized on load and after sync resolves (money() needs the deferred script, same DOMContentLoaded fix as before)', () => {
  const idx = HTML.indexOf("document.addEventListener('DOMContentLoaded'");
  assert.ok(idx >= 0);
  const body = HTML.slice(idx, idx + 2000);
  assert.match(body, /loadSharedMileageRate\(\);\s*calculateTripCost\(\);/);
});
