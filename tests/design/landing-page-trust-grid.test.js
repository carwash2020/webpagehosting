// Real bug, found from a screenshot (2026-09-08): .trust-grid became a
// 4-column grid on 2026-09-07 when index.html got its 4th "Licensed &
// Insured" item, but the 5 landing pages were never updated to match --
// each still only carried 3 trust-items, leaving an empty 4th grid cell
// that rendered as a blank gray box (the grid container's own
// background/border showing through). Fixed by adding the same real
// "Licensed & Insured" fact (already stated on index.html) to all 5.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const LANDING_PAGES = [
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-washington-city-ut.html',
];

for (const page of LANDING_PAGES) {
  test(`${page}: .trust-grid has 4 items, matching the CSS's 4-column layout`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    const trustSection = html.match(/<section class="trust-strip-section">[\s\S]*?<\/section>/);
    assert.ok(trustSection, `expected a .trust-strip-section in ${page}`);
    const items = [...trustSection[0].matchAll(/<div class="trust-item"[^>]*>/g)];
    assert.equal(items.length, 4, `expected 4 trust items in ${page}, got ${items.length}`);
    const licensedItem = trustSection[0].match(/<h3>Licensed &amp; Insured<\/h3>\s*<p>([^<]*)<\/p>/);
    assert.ok(licensedItem, `expected a Licensed & Insured item in ${page}`);
    assert.match(licensedItem[1], /registered Utah LLC/);
    assert.match(licensedItem[1], /general liability policy/);
  });
}
