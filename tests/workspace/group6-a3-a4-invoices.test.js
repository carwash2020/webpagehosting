// Fix plan Group 6, A3 + A4 (2026-11-07).
// A3: INV-2026-1174 kept "Never sent to portal" after its first send, though
// its client_portal_invoices row existed (source_invoice_id 1793928621088 =
// the invoice's id, checked live). The first-send path never told the badge
// cache; only Resend did. A4: every open of Invoices (and every form reset)
// drew next_invoice_number() / next_quote_number(), so numbers were burned by
// forms nobody saved (1168-1173). The number is now drawn when the invoice or
// estimate is actually generated.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');
const between = (a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, 'missing ' + a); const j = src.indexOf(b, i + a.length); assert.ok(j > i, 'missing ' + b); return src.slice(i, j); };

test('A3: a successful first send marks the invoice as in the portal and redraws the log', () => {
  const ok = between("        const result = await syncRes.json().catch(() => ({}));", "await showAlert('Sent! Invoice '");
  assert.match(ok, /if \(result && result\.ok\) \{\s*markInvoiceInPortal\(newEntry\.id\);/);
  const fn = between('  function markInvoiceInPortal(id) {', '\n  }\n');
  assert.match(fn, /portalInvoiceInfoBySourceId\[id\] = true;/);
  assert.match(fn, /renderInvoiceLog\(\)/);
  // Resend already cleared it.
  assert.match(src, /if \(notInPortal\) \{\s*portalInvoiceInfoBySourceId\[inv\.id\] = true;/);
});

test('A4: opening Invoices draws no invoice or estimate number', () => {
  const load = between("  ['invoiceNumber', 'quoteNumber'].forEach((id) => {", '  const CARD_INFO = {');
  assert.doesNotMatch(load, /assignNextNumber\(/);
});

test('A4: clearing the invoice or estimate form draws no number; it empties the field', () => {
  assert.doesNotMatch(src, /if \(!\(opts && opts\.keepNumber\)\) assignNextNumber\(/);
  assert.match(src, /if \(!\(opts && opts\.keepNumber\)\) document\.getElementById\('invoiceNumber'\)\.value = '';/);
  const reset = between('  function resetQuoteForm(){', '    recalcQuote();');
  assert.doesNotMatch(reset, /assignNextNumber\(/);
  assert.match(reset, /document\.getElementById\('quoteNumber'\)\.value = '';/);
});

test('A4: the number is drawn at generate time, only when the field is empty', () => {
  const inv = between('  async function generatePDF(opts) {', "    const invoiceNumberVal = document.getElementById('invoiceNumber').value;");
  assert.match(inv, /if \(!document\.getElementById\('invoiceNumber'\)\.value\.trim\(\)\) await assignNextNumber\('invoiceNumber', 'next_invoice_number', 'INV-'\);/);
  const q = between('  async function generateQuotePDF() {', "    const quoteNumberVal = document.getElementById('quoteNumber').value;");
  assert.match(q, /if \(!document\.getElementById\('quoteNumber'\)\.value\.trim\(\)\) await assignNextNumber\('quoteNumber', 'next_quote_number', 'EST-'\);/);
});

test('A4: the empty number field says when it gets one', () => {
  assert.match(src, /<input type="text" id="invoiceNumber" value="" placeholder="Assigned when you save"/);
  assert.match(src, /<input type="text" id="quoteNumber" value="" placeholder="Assigned when you save"/);
});

test('A4: a resumed draft whose number was used meanwhile gets an empty field, not a new draw', () => {
  const block = between('    // The clean form may have used this number in the meantime.', '    recalc();');
  assert.doesNotMatch(block, /assignNextNumber\(/);
  assert.match(block, /document\.getElementById\('invoiceNumber'\)\.value = '';/);
});
