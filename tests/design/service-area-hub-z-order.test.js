// Real visual bug (2026-09-07), caught directly from a live screenshot:
// the St. George hub circle was drawn FIRST in the SVG's source order,
// before all 5 spoke lines that converge on it. SVG has no z-index --
// later elements in document order always paint over earlier ones in
// the same stacking context -- so every spoke line painted over the
// hub, making lines look like they pierced straight through the hub
// dot instead of visibly terminating at it. Fixed by moving the hub
// group to the end of the SVG, after every spoke, so it paints last
// and caps the convergence point cleanly. Same markup on all 6 pages
// that carry this diagram.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const PAGES = [
  'index.html',
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-washington-city-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html',
];

for (const page of PAGES) {
  test(`${page}: the St. George hub group is the LAST group in the SVG, after every spoke, so it paints on top of them`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    const svgStart = html.indexOf('<svg viewBox="0 0 760 480"');
    const svgEnd = html.indexOf('</svg>', svgStart);
    assert.ok(svgStart >= 0 && svgEnd > svgStart, 'expected to find the service-area SVG');
    const svg = html.slice(svgStart, svgEnd);

    const groupOrder = [...svg.matchAll(/<g data-city="([a-z-]+)"/g)].map((m) => m[1]);
    assert.equal(groupOrder.length, 8, 'expected 8 <g data-city> groups (hub + 7 spokes)');
    assert.equal(groupOrder[groupOrder.length - 1], 'st-george', 'the hub group must be last so it paints on top of every spoke line');
    assert.deepEqual(
      groupOrder.slice(0, 7).sort(),
      ['cedar-city', 'hurricane', 'la-verkin', 'leeds', 'mesquite', 'santa-clara-ivins', 'washington-city'],
      'the 7 spoke groups must all come before the hub'
    );
  });
}
