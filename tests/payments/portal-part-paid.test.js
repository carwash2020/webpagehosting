// Fix plan RP1.3 (2026-11-07, approved PortalBalance board): a part-paid
// invoice in the client portal shows and asks for the balance. The real
// helpers and card are pulled out of portal/dashboard.html and run as-is,
// with made-up invoices.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const PAGE = read('portal', 'dashboard.html');
const HOME = read('portal', 'home.html');
const fn = (src, name) => {
  const m = src.match(new RegExp(`  function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n`)) || src.match(new RegExp(`  function ${name}\\([^)]*\\) \\{[^\\n]*\\}\\n`));
  assert.ok(m, name);
  return m[0];
};
const formatCurrency = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NAMES = ['invoicePaidSoFar', 'invoiceBalance', 'invoiceIsPartPaid', 'invoiceStatusPill', 'invoiceRefundLine', 'invoiceShownTotal', 'renderInvoiceCard'];
const h = new Function('formatCurrency', 'escapeHtml', 'formatDate', 'renderLineItemsTable',
  NAMES.map((n) => fn(PAGE, n)).join('\n') + '; return {' + NAMES.join(',') + '};')(formatCurrency, esc, (d) => d, () => '');

const PART = { id: 7, invoice_number: 'INV-2026-TEST', invoice_date: '2026-11-03', description: 'Dryer repair', total: 150, paid: false, paid_amount: 50 };

test('a part-paid invoice: the balance is the big number, a Part paid pill, "$50.00 paid of $150.00", and Pay $100.00', () => {
  assert.equal(h.invoiceBalance(PART), 100);
  assert.equal(h.invoiceShownTotal(PART), 100);
  assert.equal(h.invoiceStatusPill(PART), '<span class="invoice-status is-unpaid">Part paid</span>');
  const card = new JSDOM(h.renderInvoiceCard(PART)).window.document;
  assert.equal(card.querySelector('.invoice-total').textContent, '$100.00');
  assert.equal(card.querySelector('.invoice-part-paid').textContent, '$50.00 paid of $150.00');
  assert.equal(card.querySelector('.invoice-card-actions .btn.orange').textContent, 'Pay $100.00');
});

test('an invoice with nothing paid looks exactly as before', () => {
  const inv = { ...PART, paid_amount: 0 };
  assert.equal(h.invoiceStatusPill(inv), '<span class="invoice-status is-unpaid">Unpaid</span>');
  const card = new JSDOM(h.renderInvoiceCard(inv)).window.document;
  assert.equal(card.querySelector('.invoice-total').textContent, '$150.00');
  assert.equal(card.querySelector('.invoice-part-paid'), null);
  assert.equal(card.querySelector('.invoice-card-actions .btn.orange').textContent, 'Pay now');
  assert.equal(h.invoiceBalance({ ...PART, paid_amount: null }), 150, 'a row from before the column: the full total');
  assert.equal(h.invoiceBalance({ ...PART, paid: true }), 0);
  assert.equal(h.invoicePaidSoFar({ ...PART, paid_amount: 999 }), 150, 'never more than the total');
});

test('Pay All, the authorize steps, the summary ring and the home screen use the balance', () => {
  assert.match(PAGE, /const total = outstanding\.reduce\(\(sum, inv\) => sum \+ invoiceBalance\(inv\), 0\);/);
  assert.match(PAGE, /const totalPaid = invoices\.reduce\(\(sum, inv\) => sum \+ invoicePaidSoFar\(inv\), 0\);/);
  assert.match(PAGE, /const totalOutstanding = invoices\.reduce\(\(sum, inv\) => sum \+ invoiceBalance\(inv\), 0\);/);
  assert.match(PAGE, /const amountLabel = inv \? '\$' \+ invoiceBalance\(inv\)\.toFixed\(2\) : 'the amount due';/);
  assert.match(fn(PAGE, 'renderBulkPaymentSignatureStep'), /\.reduce\(\(sum, inv\) => sum \+ \(Number\(inv\.total\) \|\| 0\) - invoicePaidSoFar\(inv\), 0\);/, 'summed, then rounded once, as the function charges');
  assert.match(HOME, /select\('id,total,paid,paid_amount,paid_at,invoice_number,invoice_date,client_name'\)/);
  assert.match(HOME, /const owed = unpaid\.reduce\(\(sum, i\) => sum \+ homeInvoiceBalance\(i\), 0\);/);
  const home = new Function(fn(HOME, 'homeInvoiceBalance') + '; return homeInvoiceBalance;')();
  for (const inv of [PART, { ...PART, paid_amount: 0 }, { ...PART, paid: true }, { ...PART, paid_amount: 999 }, { ...PART, total: 40.25, paid_amount: null }]) {
    assert.equal(home(inv), h.invoiceBalance(inv), JSON.stringify(inv));
  }
});
