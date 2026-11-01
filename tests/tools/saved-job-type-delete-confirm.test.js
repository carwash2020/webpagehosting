// Confirm before deleting a saved job type (corrections pack, 2026-11-01).
// The x on a "saved job type" chip (th_price_reference -- the same
// create/delete pair Finance's old Cost Lookup tab had, restored to
// invoice-generator.html in the 2026-10-31 redundancy pass's round 3) used
// to delete immediately with no confirmation, unlike Job Tracker's
// deleteTemplate(), which already confirms. Source-inspection style.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');

function extractFn(name) {
  const start = HTML.indexOf(`async function ${name}(`);
  const realStart = start >= 0 ? start : HTML.indexOf(`function ${name}(`);
  assert.ok(realStart >= 0, `expected to find function ${name}`);
  const braceStart = HTML.indexOf('{', realStart);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(realStart, i);
}

test('deletePriceReference() is async and asks showConfirm before deleting', () => {
  assert.match(HTML, /async function deletePriceReference\(id\) \{/);
  const fn = extractFn('deletePriceReference');
  assert.match(fn, /const confirmed = await showConfirm\(/);
  assert.match(fn, /if \(!confirmed\) return;/);
  assert.match(fn, /danger: true, confirmText: 'Delete'/);
  // The confirm happens before the list is mutated, not after.
  const confirmIdx = fn.indexOf('showConfirm(');
  const saveIdx = fn.indexOf('savePriceReferencesFromManager(');
  assert.ok(confirmIdx >= 0 && saveIdx >= 0 && confirmIdx < saveIdx,
    'expected the confirm to happen before the list is saved/mutated');
});

test('the delete still tombstones and adds to the graveyard (feature parity -- nothing about the actual deletion changed)', () => {
  const fn = extractFn('deletePriceReference');
  assert.match(fn, /thAddPriceRefTombstone/);
  assert.match(fn, /thAddToGraveyard\('priceReference', target\)/);
  assert.match(fn, /populatePriceRefPickers\(\);/);
});
