// Portal -> Invoices shows a refund (2026-10-31): a fully refunded invoice
// gets a "Refunded" pill instead of "Paid"; a partial refund keeps "Paid"
// and adds "$X refunded". The two helpers are pulled out of
// portal/dashboard.html and run as-is.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'dashboard.html'), 'utf8');
const src = ['invoiceStatusPill', 'invoiceRefundLine'].map((name) => {
  const m = PAGE.match(new RegExp(`  function ${name}\\(inv\\) \\{[\\s\\S]*?\\n  \\}\\n`));
  assert.ok(m, `expected ${name}() in portal/dashboard.html`);
  return m[0];
}).join('\n');
const formatCurrency = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const { invoiceStatusPill, invoiceRefundLine } = new Function('formatCurrency', `${src}; return { invoiceStatusPill, invoiceRefundLine };`)(formatCurrency);

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

test('a partial refund keeps Paid and adds the refunded amount', () => {
  const inv = { paid: true, refund_status: 'partial', refunded_amount: 50 };
  assert.equal(invoiceStatusPill(inv), '<span class="invoice-status is-paid">Paid</span>');
  assert.equal(invoiceRefundLine(inv), '<div class="invoice-desc invoice-refunded">$50.00 refunded</div>');
});

test('the Refunded pill has its own style and the card uses both helpers', () => {
  assert.match(PAGE, /\.invoice-status\.is-refunded \{/);
  assert.match(PAGE, /\$\{invoiceStatusPill\(inv\)\}/);
  assert.match(PAGE, /\$\{invoiceRefundLine\(inv\)\}/);
});
