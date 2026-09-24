// Tests for a real reported bug (2026-09-05): "On the invoice
// receipt, it puts the paid stamp right over the total amount." The
// PAID stamp sits at a fixed position (y=195, radius 46, spanning
// y=149-241) chosen when this PDF's layout was simpler; the total's
// own y is dynamic, based on how much content (description, line
// items) comes before it. With little or no content above it, the
// total landed inside the stamp's fixed range and got painted over.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'dashboard.html'), 'utf8');

// 2026-09-24: the fixed-position circle (and its y >= 255 floor) is
// gone. The stamp is now drawn by js/pdf-layout.js's pdfDrawSummary(),
// in the space left of the totals column, which that block reserves --
// so it can't land on the total however short the receipt is. These
// check that by actually drawing, not by matching source.
const vm = require('vm');
const LAYOUT = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'pdf-layout.js'), 'utf8');

function recordingDoc() {
  const ops = [];
  const doc = {
    ops,
    internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 }, getNumberOfPages: () => 1 },
    addPage() { ops.push(['addPage']); }, setPage() {},
    splitTextToSize: (t) => [String(t)], getTextWidth: (t) => String(t).length * 6,
    text: (t, x, y) => ops.push(['text', String(t), x, y]),
    line: (x1, y1, x2, y2) => ops.push(['line', x1, y1, x2, y2]),
    rect: (x, y, w, h) => ops.push(['rect', x, y, w, h]), addImage() {},
    setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {}, setLineWidth() {},
    setDrawColor: (...c) => ops.push(['color', c.join(',')]),
  };
  return doc;
}
function drawShortReceipt() {
  const c = { Math, Number, String, Array, Object };
  vm.createContext(c);
  vm.runInContext(LAYOUT + '\nthis.summary = pdfDrawSummary; this.GREEN = PDF_COLORS.GREEN.join(",");', c);
  const doc = recordingDoc();
  // A receipt with almost nothing above the total: the case that broke.
  c.summary(doc, { y: 150, rows: [], total: { label: 'Total paid', value: '$85.00', tone: 'green' }, stamp: { text: 'PAID', sub: 'SEP 24, 2026', tone: 'green' } });
  return { doc, GREEN: c.GREEN };
}

test('the PAID stamp is drawn entirely left of the totals column, so it can never cover the total', () => {
  const { doc, GREEN } = drawShortReceipt();
  const totalsLeft = 612 - 48 - 236;
  let drawColor = '', stampXs = [];
  doc.ops.forEach(op => {
    if (op[0] === 'color') drawColor = op[1];
    if (op[0] === 'line' && drawColor === GREEN) stampXs.push(op[1], op[3]);
  });
  assert.ok(stampXs.length >= 8, 'expected the stamp outline to be drawn');
  assert.ok(Math.max(...stampXs) < totalsLeft, `stamp reaches x=${Math.max(...stampXs)}, totals column starts at ${totalsLeft}`);
  const total = doc.ops.find(op => op[0] === 'text' && op[1] === '$85.00');
  assert.ok(total && total[2] > totalsLeft, 'the total is drawn inside the totals column');
});

test('the receipt asks for the stamp only when the invoice is paid', () => {
  assert.match(HTML, /stamp: inv\.paid \? \{ text: 'PAID'/);
});

test('the old fixed-position stamp workaround is gone from downloadInvoicePDF()', () => {
  // Confirms this is a floor, not a forced reset: a longer, more
  // typical invoice's own natural y (well past 255 by the time it
  // reaches the total) should never be pulled backward by this fix.
  const fnBody = HTML.match(/async function downloadInvoicePDF\(invoiceId\)[\s\S]*?\n  \}\n/)[0];
  assert.doesNotMatch(fnBody, /y = 255;|Math\.max\(y, 255\)/, 'the old fixed-position stamp workaround should be gone');
});
