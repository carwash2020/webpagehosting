// Tests for the line-item Type dropdown (2026-09-05), requested
// directly (chosen from a set of options offered): "Add a Type
// dropdown per line (Labor/Mileage/Part/Other) -- Qty label changes
// automatically." Follow-up to a mobile-usability complaint: "labor
// is still under 'units' instead of 'hours'. Mileage is still under
// 'units' instead of 'miles'." Confirmed directly (not assumed) that
// the literal word "units" never appeared anywhere on this page --
// the actual shared column is labeled "Qty" everywhere, and there
// was previously no line-item type concept in the data model at all.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');

test('the type -> unit label mapping is exactly labor=hrs, mileage=mi, part=ea, other=blank', () => {
  assert.match(HTML, /const LINE_ITEM_UNIT_LABELS = \{ labor: 'hrs', mileage: 'mi', part: 'ea', other: '' \};/);
});

test('both table headers gained a real Type column, and the widths still sum to a sane total (not over 100%, not leaving the old columns untouched)', () => {
  const headers = [...HTML.matchAll(/<tr><th style="width:26%">Description<\/th>[\s\S]*?<\/tr>/g)];
  assert.equal(headers.length, 2, 'expected exactly the invoice and quote table headers, both updated identically');
  for (const h of headers) {
    const widths = [...h[0].matchAll(/width:(\d+)%/g)].map((m) => parseInt(m[1], 10));
    const total = widths.reduce((a, b) => a + b, 0);
    assert.ok(total <= 100, `column widths summed to ${total}%, over 100%`);
    assert.match(h[0], /<th style="width:13%">Type<\/th>/);
  }
});

for (const [fnName, prefix] of [['addLineItem', 'li'], ['addQuoteLineItem', 'qli']]) {
  test(`${fnName} accepts and renders type, with the unit label matching what was passed in`, () => {
    const re = new RegExp(`function ${fnName}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}\\n`);
    const fnMatch = HTML.match(re);
    assert.ok(fnMatch, `expected to isolate ${fnName}()`);
    assert.match(fnMatch[0], /type = ''/, 'type should default to the empty/blank option');
    assert.match(fnMatch[0], new RegExp(`class="${prefix}-type" onchange="updateLineItemUnitLabel\\(this\\)"`));
    assert.match(fnMatch[0], new RegExp(`class="${prefix}-qty-unit">\\\$\\{lineItemUnitLabel\\(type\\)\\}`));
  });
}

test('updateLineItemUnitLabel only touches the ONE row it was called from, not the whole table -- a real invoice frequently mixes labor and mileage lines', () => {
  const fnMatch = HTML.match(/function updateLineItemUnitLabel\(selectEl\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate updateLineItemUnitLabel()');
  assert.match(fnMatch[0], /selectEl\.closest\('tr'\)/);
  assert.doesNotMatch(fnMatch[0], /querySelectorAll/, 'should update one row\u2019s own unit label, not iterate every row in the table');
});

for (const [fnName, prefix] of [['getLineItems', 'li'], ['getQuoteLineItems', 'qli']]) {
  test(`${fnName} collects type from each row`, () => {
    const re = new RegExp(`function ${fnName}\\(\\)\\s*\\{[\\s\\S]*?\\n  \\}\\n`);
    const fnMatch = HTML.match(re);
    assert.ok(fnMatch, `expected to isolate ${fnName}()`);
    assert.match(fnMatch[0], new RegExp(`row\\.querySelector\\('\\.${prefix}-type'\\)\\.value`));
    assert.match(fnMatch[0], /items\.push\(\{ desc, part, qty, price, amount: qty \* price, taxable, type \}\);/);
  });
}

test('adding from Saved Job Types sets type to labor -- this template is inherently an hourly labor entry', () => {
  const fnMatch = HTML.match(/function addLineItemFromPriceRef\(selectId, addFnName\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate addLineItemFromPriceRef()');
  assert.match(fnMatch[0], /window\[addFnName\]\(ref\.label, '', ref\.hours \|\| 1, ref\.rate \|\| '', true, 'labor', true\);/);
});

test('converting a quote to an invoice preserves each line item\u2019s own type, not resetting every row to blank', () => {
  assert.match(HTML, /items\.forEach\(item => addLineItem\(item\.desc, item\.part, item\.qty, item\.price, item\.taxable, item\.type\)\);/);
});

test('both PDF renderings append the unit abbreviation to the Qty text, so the actual document a client sees shows "2 hrs" or "15 mi", not just a bare number', () => {
  const matches = [...HTML.matchAll(/doc\.text\(String\(item\.qty\) \+ \(lineItemUnitLabel\(item\.type\) \? ' ' \+ lineItemUnitLabel\(item\.type\) : ''\), 40 \+ tableW \* 0\.68, y \+ 14, \{ align: 'center' \}\);/g)];
  assert.equal(matches.length, 2, 'expected both the invoice and quote PDF sections updated identically');
});

test('the Type select gets real styling matching the rest of the table, not left as an unstyled default browser select', () => {
  assert.match(HTML, /\.line-items-table input, \.line-items-table select \{/);
});
