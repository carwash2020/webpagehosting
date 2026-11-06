// Fix plan Group 4, RP1 (2026-11-06): money the app shows must be money that
// actually arrived, counted once. Runs the real code from the pages (made-up
// invoices only).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const fnSrc = (src, name, indent = '') => {
  const start = src.indexOf(indent + 'function ' + name + '(');
  assert.ok(start >= 0, name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
};

const DL = read('tools', 'data-layer.js');
const RUNWAY = read('tools', 'runway-dashboard.html');

// The same cases, run through Finance's rule (data-layer.js) and Runway's copy.
const INVOICES = [
  { id: 1, total: 300, paid: true, paidAmount: 300, date: '2026-11-02' },
  { id: 2, total: 300, paid: false, date: '2026-11-03' },
  { id: 3, total: 400, paid: false, paidAmount: 150, date: '2026-11-04' },
  { id: 4, total: 125, paid: true, date: '2026-11-05' },
];
const INCOME = [
  { id: 'a', origin: 'invoice', invoiceId: 1, amount: 300, date: '2026-11-02' },
  { id: 'b', origin: 'pos', amount: 300, appliedToInvoiceId: 1, date: '2026-11-02' },
  { id: 'c', origin: 'invoice', invoiceId: 2, amount: 300, date: '2026-11-03' },
  { id: 'd', origin: 'invoice', invoiceId: 3, amount: 400, date: '2026-11-04' },
  { id: 'e', origin: 'manual', amount: 80, date: '2026-11-05' },
  { id: 'f', origin: 'invoice', invoiceId: 999, amount: 50, date: '2026-11-05' },
];

test('RP1.4: Runway uses the exact paid-only rule Finance uses (data-layer.js), case by case', () => {
  const dl = {};
  vm.createContext(dl);
  vm.runInContext(fnSrc(DL, 'thInvoicePaidAmount') + fnSrc(DL, 'thIncomeReceived') + ';this.r = thIncomeReceived; this.p = thInvoicePaidAmount;', dl);
  const rw = {};
  vm.createContext(rw);
  vm.runInContext(fnSrc(RUNWAY, 'runwayInvoicePaid') + fnSrc(RUNWAY, 'runwayIncomeReceived') + ';this.r = runwayIncomeReceived; this.p = runwayInvoicePaid;', rw);
  for (const e of INCOME) assert.equal(rw.r(e, INVOICES), dl.r(e, INVOICES), 'income ' + e.id);
  for (const i of INVOICES) assert.equal(rw.p(i), dl.p(i), 'invoice ' + i.id);
});

test('RP1.4: a card-paid $300 invoice counts $300 once, an unpaid one $0, a part-paid one what was paid', () => {
  const ctx = {
    loadJobTrackerExpenses: () => [],
    loadJobTrackerInvoices: () => INVOICES,
    loadJobTrackerIncome: () => INCOME,
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc(RUNWAY, 'runwayInvoicePaid') + fnSrc(RUNWAY, 'runwayIncomeReceived') + fnSrc(RUNWAY, 'pullMonthFromJobTracker') + ';this.pull = pullMonthFromJobTracker;', ctx);
  const m = ctx.pull('2026-11');
  // 300 (inv 1, the POS charge not again) + 0 (inv 2 unpaid) + 150 (inv 3 part-paid)
  // + 80 (manual) + 0 (row for a missing invoice) + 125 (inv 4, never mirrored, paid)
  assert.equal(m.revenue, 655);
  assert.doesNotMatch(fnSrc(RUNWAY, 'pullMonthFromJobTracker'), /Number\(i\.total\)\|\|0\), 0\)/, 'orphaned invoices no longer count at face value');
});

test('RP1.5: an invoice\'s income row is not deletable from the log (it would only come back); the user is sent to the invoice', () => {
  const fin = read('tools', 'finance.html');
  const del = fin.slice(fin.indexOf('async function deleteIncomeEntry(id)'), fin.indexOf('const confirmed = await showConfirm(\'Delete this income entry?\''));
  assert.match(del, /if \(entry && entry\.origin === 'invoice'\) \{[\s\S]*confirmText: 'Open Invoices'[\s\S]*window\.location\.href = '\/tools\/invoice-generator\.html';\s*return;\s*\}/);
  assert.doesNotMatch(fin, /Deleting it only removes it from this log/);
});

test('RP1.6: Convert Quote -> Invoice carries the client email', () => {
  const ig = read('tools', 'invoice-generator.html');
  const fn = fnSrc(ig, 'convertQuoteToInvoice', 'async ');
  assert.match(fn, /const quoteEmailEl = document\.getElementById\('quoteClientEmail'\);\s*if \(quoteEmailEl\) document\.getElementById\('clientEmail'\)\.value = quoteEmailEl\.value;/);
});

test('RP1.7 (D21): Snapshot Net and the set-aside are on money received; Revenue Invoiced stays invoiced', () => {
  const ws = read('tools', 'workspace.html');
  const fn = fnSrc(ws, 'renderMetrics', '  ');
  assert.match(fn, /const received = thIncome\.all\(\)\.filter\(e => inRange\(e\.date, range\)\)\.reduce\(\(sum, e\) => sum \+ thIncomeReceived\(e, allInvoices\), 0\);/);
  assert.match(fn, /const net = received - expenseTotal;/);
  assert.match(fn, /setMoneyMetric\('metricRevenue', revenue\);/);
  assert.match(fn, /setMoneyMetric\('metricSetAside', Math\.max\(0, net\) \* \(loadSetAsideRate\(\) \/ 100\)\);/);
  assert.match(ws, /<div class="metric-label">Net Profit \(Money received &minus; Expenses\)<\/div>/);
});

test('RP1.11: one money format: cents above $1,000 on the Invoices summary and Finance\'s Spent', () => {
  const ig = read('tools', 'invoice-generator.html');
  assert.match(ig, /function moneyShort\(n\) \{ return money\(n\); \}/);
  assert.match(read('tools', 'finance.html'), /totalEl\.textContent = money\(total\);/);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fnSrc(read('tools', 'tools-dialogs.js'), 'money') + ';this.m = money;', ctx);
  assert.equal(ctx.m(1234), '$1,234.00');
});

test('RP1.12: a trip is priced at the IRS rate for its own date and keeps it; the totals name one rate only when all share it', () => {
  const fin = read('tools', 'finance.html');
  const ctx = { document: { getElementById: () => ({ value: '0.80' }) } };
  vm.createContext(ctx);
  const ratesSrc = fin.slice(fin.indexOf('  const IRS_MILEAGE_RATES = ['), fin.indexOf('  ];', fin.indexOf('  const IRS_MILEAGE_RATES = [')) + 4);
  vm.runInContext(fnSrc(fin, 'getMileageRate', '  ') + ratesSrc.replace('const ', 'var ') + fnSrc(fin, 'mileageRateForDate', '  ') + fnSrc(fin, 'mileageRateNote', '  ') +
    ';this.rate = mileageRateForDate; this.note = mileageRateNote;', ctx);
  assert.equal(ctx.rate('2026-01-15'), 0.725);
  assert.equal(ctx.rate('2026-06-30'), 0.725);
  assert.equal(ctx.rate('2026-07-01'), 0.76);
  assert.equal(ctx.rate('2025-05-01'), 0.70);
  assert.equal(ctx.rate('2027-02-01'), 0.80, 'outside the table: the rate set on the page');
  assert.equal(ctx.note([{ type: 'mileage', rate: 0.76, miles: 10, amount: 7.6 }, { type: 'mileage', rate: 0.76, miles: 5, amount: 3.8 }]), ' at $0.76/mi');
  assert.equal(ctx.note([{ type: 'mileage', rate: 0.725, miles: 10, amount: 7.25 }, { type: 'mileage', rate: 0.76, miles: 5, amount: 3.8 }]), ', each trip at the rate for its date');
  assert.equal(ctx.note([{ type: 'mileage', miles: 10, amount: 7.6 }]), ' at $0.76/mi', 'an older entry with no stored rate: worked out from its amount');
  assert.match(fin, /entry\.rate = mileageRateForDate\(entry\.date\);\s*entry\.amount = Math\.round\(entry\.miles \* entry\.rate \* 100\) \/ 100;/);
});
