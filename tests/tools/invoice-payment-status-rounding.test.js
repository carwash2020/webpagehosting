// Real bug, found from a live screenshot (2026-09-08): an invoice
// showed "Partial -- $0.00 left" on a fully-paid $125 job, and the
// Business Snapshot's Overdue card showed $0.00 with an invoice that
// was, in fact, overdue. Root cause: invoice.total is built from
// subtotal + (taxableSubtotal * rate/100) -- a percentage tax rate
// almost never lands on a whole number of cents (6.75% of $186.41 is
// $12.582675), so the stored total can carry a sub-cent fraction a
// customer literally cannot pay. Comparing paidAmount >= total with
// raw floats then fails by a fraction of a cent, landing on 'partial'
// with a remaining balance that rounds to $0.00 on display.
//
// Two-part fix: invoice-generator.html now rounds tax/total to the
// nearest cent when computing them (so new invoices don't carry the
// fraction at all), and workspace.html/runway-dashboard.html compare
// in whole cents (so an already-saved invoice with a drifted total
// still resolves correctly).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const RUNWAY = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');
const INVOICE_GEN = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');

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

// Builds a real callable function from the extracted source, wiring in
// whatever helper functions it depends on (same technique as calling
// the real page code, without needing a full DOM).
function loadFns(html, names) {
  const src = names.map(n => extractFn(html, n)).join('\n') + '\nreturn {' + names.join(',') + '};';
  return new Function(src)();
}

// A tax-driven total that genuinely lands on a sub-cent fraction:
// subtotal 186.41 * 6.75% tax = total 198.992675.
const DRIFTED_INVOICE = { total: 198.992675, paidAmount: 198.99 };

test('workspace.html: a customer who paid the exact displayed total reads as fully paid, not partial', () => {
  const { getPaidAmount, invoicePaymentStatus, getRemainingCents } = loadFns(
    WORKSPACE, ['getPaidAmount', 'invoicePaymentStatus', 'getRemainingCents', 'toCents']
  );
  assert.equal(invoicePaymentStatus(DRIFTED_INVOICE), 'paid');
  assert.equal(getRemainingCents(DRIFTED_INVOICE), 0);
});

test('workspace.html: a genuinely partial payment is still reported as partial with the real amount left', () => {
  const { invoicePaymentStatus, getRemainingCents } = loadFns(
    WORKSPACE, ['getPaidAmount', 'invoicePaymentStatus', 'getRemainingCents', 'toCents']
  );
  const invoice = { total: 200, paidAmount: 100 };
  assert.equal(invoicePaymentStatus(invoice), 'partial');
  assert.equal(getRemainingCents(invoice), 10000); // $100.00 in cents
});

test('workspace.html: computeMoneyOwed uses the cent-safe remaining balance, not raw float subtraction', () => {
  const fn = extractFn(WORKSPACE, 'computeMoneyOwed');
  assert.match(fn, /getRemainingCents\(i\)/);
  assert.doesNotMatch(fn, /Number\(i\.total\)[^)]*\)\s*-\s*getPaidAmount\(i\)/);
});

test('runway-dashboard.html: accounts-receivable balance is also cent-safe against the same drifted total', () => {
  const { invoiceRemainingBalance } = loadFns(RUNWAY, ['invoiceRemainingBalance']);
  assert.equal(invoiceRemainingBalance(DRIFTED_INVOICE), 0);
});

test('invoice-generator.html: both the on-screen and PDF totals round tax/total to the nearest cent, so future invoices never carry the fraction', () => {
  for (const fnName of ['recalc', 'recalcQuote']) {
    const src = extractFn(INVOICE_GEN, fnName);
    assert.match(src, /Math\.round\([^)]*rate[^)]*\/ 100\)[^)]*\* 100\) \/ 100/, `${fnName} should round tax to cents`);
    assert.match(src, /const total = Math\.round\(Math\.max\(0, subtotal \+ tax - discount\) \* 100\) \/ 100;/, `${fnName} should round total to cents`);
  }
});
