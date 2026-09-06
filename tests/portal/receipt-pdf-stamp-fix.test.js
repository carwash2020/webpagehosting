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

test('a minimum y is enforced before the total, whenever the PAID stamp exists, genuinely below the stamp\u2019s own bottom edge (195 + 46 = 241)', () => {
  assert.match(HTML, /if \(inv\.paid\) y = Math\.max\(y, 255\);/);
  // 255 is a real number here, not just present -- confirm it's
  // actually past the stamp's bottom edge with the true, current
  // stamp geometry (a regression in either number should fail this).
  const cyMatch = HTML.match(/stampCX = pageW - 95, stampCY = (\d+), stampR = (\d+)/);
  assert.ok(cyMatch, 'expected to find the stamp\u2019s real geometry');
  const bottomEdge = parseInt(cyMatch[1], 10) + parseInt(cyMatch[2], 10);
  assert.ok(255 > bottomEdge, `expected the enforced minimum (255) to be past the stamp's actual bottom edge (${bottomEdge})`);
});

test('the fix sits directly before the total is drawn, not somewhere disconnected from it', () => {
  const idx = HTML.indexOf('if (inv.paid) y = Math.max(y, 255);');
  const totalIdx = HTML.indexOf("doc.text(inv.paid ? 'TOTAL PAID'");
  assert.ok(idx !== -1 && totalIdx !== -1);
  assert.ok(idx < totalIdx && totalIdx - idx < 200, 'expected the fix immediately before the total is drawn');
});

test('the fix only applies when the stamp actually exists (paid invoices) -- an unpaid invoice never has this problem since it has no stamp at all', () => {
  const fnMatch = HTML.match(/async function downloadInvoicePDF\(invoiceId\)[\s\S]*$/);
  const fixLine = fnMatch[0].match(/if \(inv\.paid\) y = Math\.max\(y, 255\);/);
  assert.ok(fixLine, 'expected the fix gated behind inv.paid');
});

test('the normal case (a real job description and line items) is unaffected -- Math.max is a no-op once content already pushes y past 255', () => {
  // Confirms this is a floor, not a forced reset: a longer, more
  // typical invoice's own natural y (well past 255 by the time it
  // reaches the total) should never be pulled backward by this fix.
  const fnBody = HTML.match(/async function downloadInvoicePDF\(invoiceId\)[\s\S]*?\n  \}\n/)[0];
  assert.doesNotMatch(fnBody, /y = 255;/, 'the fix should use Math.max (a floor), never a hard assignment that could pull a longer document\u2019s total backward');
});
