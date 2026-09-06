// Tests for saving line_items to the internal invoice/quote logs
// (2026-09-06), requested directly. Previously only
// client_portal_invoices (created just when "Send to Client" was
// pressed) had this detail -- a "Download PDF" only invoice, never
// sent to anyone, had its line-item detail permanently lost the
// moment the form closed. Found while investigating a real reported
// issue about a receipt missing line items (traced to an invoice
// that genuinely predated line items being saved anywhere at all).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');

test('the internal invoice log entry now includes line_items, sourced from the live form via getLineItems()', () => {
  const entries = [...HTML.matchAll(/const newEntry = \{[\s\S]*?\n    \};/g)];
  assert.equal(entries.length, 2, 'expected exactly the invoice and quote newEntry blocks');
  const invoiceEntry = entries.find((m) => m[0].includes('invoiceNumber:'));
  assert.ok(invoiceEntry, 'expected to find the invoice newEntry block');
  assert.match(invoiceEntry[0], /line_items: getLineItems\(\),/);
});

test('the internal quote log entry now includes line_items, sourced from the live form via getQuoteLineItems()', () => {
  const entries = [...HTML.matchAll(/const newEntry = \{[\s\S]*?\n    \};/g)];
  const quoteEntry = entries.find((m) => m[0].includes('quoteNumber:'));
  assert.ok(quoteEntry, 'expected to find the quote newEntry block');
  assert.match(quoteEntry[0], /line_items: getQuoteLineItems\(\),/);
});

test('resendInvoiceToClient now genuinely sends line_items from the log entry, not omitting the field entirely as before', () => {
  const fnMatch = HTML.match(/async function resendInvoiceToClient\(invoiceId\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate resendInvoiceToClient()');
  assert.match(fnMatch[0], /line_items: inv\.line_items,/);
});

test('an older invoice created before this fix (inv.line_items is undefined) is still handled safely -- JSON.stringify drops an undefined value rather than sending something malformed', () => {
  // A direct, real check of the actual JS behavior this comment
  // relies on, not just an assumption about how JSON.stringify works.
  const obj = { line_items: undefined, total: 5 };
  const serialized = JSON.stringify(obj);
  assert.ok(!serialized.includes('line_items'), 'expected JSON.stringify to drop an undefined property entirely');
});
