// Portal -> Invoices shows a refund (2026-10-31): a fully refunded invoice
// gets a "Refunded" pill instead of "Paid"; a partial refund keeps "Paid"
// and adds "$X refunded". The two helpers are pulled out of
// portal/dashboard.html and run as-is.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'dashboard.html'), 'utf8');
const src = ['invoiceStatusPill', 'invoiceRefundLine', 'invoiceShownTotal'].map((name) => {
  const m = PAGE.match(new RegExp(`  function ${name}\\(inv\\) \\{[\\s\\S]*?\\n  \\}\\n`));
  assert.ok(m, `expected ${name}() in portal/dashboard.html`);
  return m[0];
}).join('\n');
const formatCurrency = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const { invoiceStatusPill, invoiceRefundLine, invoiceShownTotal } = new Function('formatCurrency', `${src}; return { invoiceStatusPill, invoiceRefundLine, invoiceShownTotal };`)(formatCurrency);

test('unpaid and paid invoices render exactly as before', () => {
  assert.equal(invoiceStatusPill({ paid: false, refund_status: 'none' }), '<span class="invoice-status is-unpaid">Unpaid</span>');
  assert.equal(invoiceStatusPill({ paid: true, refund_status: 'none' }), '<span class="invoice-status is-paid">Paid</span>');
  assert.equal(invoiceStatusPill({ paid: true }), '<span class="invoice-status is-paid">Paid</span>', 'a row from before the migration (no column) is unchanged');
  assert.equal(invoiceRefundLine({ paid: true, refund_status: 'none', refunded_amount: 0 }), '');
});

test('a full refund shows a Refunded pill and the amount', () => {
  const inv = { paid: true, refund_status: 'full', refunded_amount: '150.00' };
  assert.equal(invoiceStatusPill(inv), '<span class="invoice-status is-refunded">Refunded</span>');
  assert.equal(invoiceRefundLine(inv), '<div class="invoice-desc invoice-refunded">$150.00 refunded</div>');
});

test('a partial refund keeps Paid, shows the net as the amount, and names the original total (RP1.9)', () => {
  const inv = { paid: true, refund_status: 'partial', refunded_amount: 50, total: 212.66 };
  assert.equal(invoiceStatusPill(inv), '<span class="invoice-status is-paid">Paid</span>');
  assert.equal(invoiceRefundLine(inv), '<div class="invoice-desc invoice-refunded">$50.00 refunded of $212.66</div>');
  assert.equal(invoiceShownTotal(inv), 162.66);
  assert.equal(invoiceShownTotal({ paid: true, refund_status: 'full', refunded_amount: 150, total: 150 }), 150, 'a full refund keeps the total; its pill says Refunded');
  assert.equal(invoiceShownTotal({ paid: false, total: 99.5 }), 99.5);
});

test('the Refunded pill has its own style and the card uses both helpers', () => {
  assert.match(PAGE, /\.invoice-status\.is-refunded \{/);
  assert.match(PAGE, /\$\{invoiceStatusPill\(inv\)\}/);
  assert.match(PAGE, /\$\{invoiceRefundLine\(inv\)\}/);
  assert.match(PAGE, /<div class="invoice-total">\$\{formatCurrency\(invoiceShownTotal\(inv\)\)\}<\/div>/);
});
