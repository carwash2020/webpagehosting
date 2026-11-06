// Money (2026-11-04, handoff §2 + §4F; approved "Money" design). One page
// instead of Finance's three tabs plus a separate Runway page: the Runway
// overview on top, one ledger below filtered by chips. Income counts only
// when paid (§4F: "unpaid invoices are NOT income"). Runs the shipped Money
// markup and functions from tools/finance.html with the real data-layer.js
// in jsdom, on made-up sample data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const FIN = read('finance.html');
const DL = read('data-layer.js');
const RUNWAY = read('runway-dashboard.html');

const between = (src, a, b) => {
  const i = src.indexOf(a);
  assert.ok(i >= 0, 'missing: ' + a);
  const j = src.indexOf(b, i);
  assert.ok(j >= 0, 'missing end: ' + b);
  return src.slice(i, j + b.length);
};
const MARKUP = between(FIN, '<section class="mny-top"', '<div id="mnyAllLedger"><div class="skeleton-line w-100"></div><div class="skeleton-line w-60"></div></div>\n</div>');
const MONEY_JS = between(FIN, '  // ---- Money (2026-11-04, approved "Money" design)', "window.addEventListener('th-role-loaded', () => renderMoneyOverview());");
const INCOME_JS = between(FIN, '  function renderIncomeEntries() {', "      <div>Combined total: <strong>$${(manualTotal + invoiceTotal).toFixed(2)}</strong></div>`;\n  }");

const SAMPLE = {
  th_invoices: [
    { id: 1, invoiceNumber: 'INV-1', clientName: 'Client A', date: '2026-10-10', terms: 'Net 15', total: 300, paid: false },
    { id: 2, invoiceNumber: 'INV-2', clientName: 'Client B', date: '2026-10-20', terms: 'Due Upon Receipt', total: 295.56, paid: false },
    { id: 3, invoiceNumber: 'INV-3', clientName: 'Client C', date: '2026-11-02', terms: 'Net 15', total: 185, paidAmount: 185 },
    { id: 4, invoiceNumber: 'INV-4', clientName: 'Client F', date: '2026-11-03', terms: 'Net 30', total: 200, paidAmount: 50 },
  ],
  th_income_log: [
    { id: 11, date: '2026-10-10', desc: 'Invoice #INV-1', amount: 300, source: 'Client A', origin: 'invoice', invoiceId: 1 },
    { id: 12, date: '2026-10-20', desc: 'Invoice #INV-2', amount: 295.56, source: 'Client B', origin: 'invoice', invoiceId: 2 },
    { id: 13, date: '2026-11-02', desc: 'Invoice #INV-3', amount: 185, source: 'Client C', origin: 'invoice', invoiceId: 3, jobRefTitle: 'Washer repair' },
    { id: 16, date: '2026-11-03', desc: 'Invoice #INV-4', amount: 200, source: 'Client F', origin: 'invoice', invoiceId: 4 },
    { id: 14, date: '2026-11-01', desc: 'Cash', amount: 120, source: 'Client D', payment: 'cash' },
  ],
  th_expense_log: [
    { id: 21, date: '2026-11-02', type: 'expense', desc: 'Drain pump', vendor: 'Home Depot', amount: 46.3, jobRefTitle: 'Washer repair' },
    { id: 22, date: '2026-11-01', type: 'mileage', desc: 'Mileage', miles: 14, amount: 12.18 },
  ],
  'rd_personal-expenses': [{ id: 1, name: 'Rent', min: 2000, frequency: 'monthly' }, { id: 2, name: 'Power', variable: true, min: 100, actuals: { '2026-08': 90, '2026-09': 120, '2026-10': 150, '2026-07': 999 } }],
  'rd_emergency-fund': { balance: 9000 },
};

function page({ runway = true, data = SAMPLE } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body><h2 id="x"></h2>' + MARKUP + '<div id="incomeTable"></div><div id="incomeTotalsRow"></div></body>', {
    runScripts: 'outside-only', url: 'https://example.com/tools/finance.html',
  });
  const w = dom.window;
  for (const [k, v] of Object.entries(data)) w.localStorage.setItem(k, JSON.stringify(v));
  Object.assign(w, {
    escapeHtml: (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    todayDateStrBusinessTz: () => '2026-11-04',
    canViewRunway: () => runway,
  });
  // One script, as on the page: data-layer.js's const collections and the
  // Money functions share a scope.
  w.eval(DL + `
    var PAYMENT_LABEL = { cash: 'Cash', check: 'Check', card: 'Card' };
    var pendingDeleteIncomeIds = new Set(), pendingDeleteExpenseIds = new Set();
    var justAddedIncomeEntryId = null;
    function personDot() { return ''; }
    function backfillLegacyInvoicesIntoIncomeLog() {}
    ${MONEY_JS}
    ${INCOME_JS}
    ;Object.assign(window, { moneyChipHead });
  `);
  const $ = (id) => w.document.getElementById(id);
  return { w, $ };
}

test('income counts only when paid: an unpaid invoice is worth nothing, a part-paid one what was paid, a manual entry its amount', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(DL.slice(DL.indexOf('function thInvoicePaidAmount('), DL.indexOf('function thInvoiceBalance(')) + DL.slice(DL.indexOf('// Income counts only when paid'), DL.indexOf('// Runway\'s own "months covered"')) + ';this.f = thIncomeReceived;', ctx);
  const inv = SAMPLE.th_invoices;
  const r = (id) => ctx.f(SAMPLE.th_income_log.find((e) => e.id === id), inv);
  assert.equal(r(11), 0, 'unpaid');
  assert.equal(r(13), 185, 'paid');
  assert.equal(r(16), 50, 'part-paid: only what came in');
  assert.equal(r(14), 120, 'cash is money received');
  assert.equal(ctx.f({ origin: 'invoice', invoiceId: 999, amount: 50 }, inv), 0, 'an invoice that no longer exists adds nothing');
});

test('the overview tiles: owed agrees with the invoice balances, paid-in is this month\'s received money only, spent is the expense log', () => {
  const { w, $ } = page();
  w.renderMoney();
  assert.equal($('mnyKicker').textContent, 'Money · November 2026');
  assert.equal($('mnyOwed').textContent, '$745.56', '300 + 295.56 + 150 still owed on INV-4');
  assert.equal($('mnyOwedSub').textContent, '3 invoices, 2 overdue');
  assert.equal($('mnyPaidIn').textContent, '$355.00', '185 paid + 50 part-paid + 120 cash; the unpaid invoices add nothing');
});

test('the Runway tile shows Runway\'s own number, and only to an account that can open Runway', () => {
  const yes = page();
  yes.w.renderMoneyOverview();
  assert.equal(yes.$('mnyRunwayTile').hidden, false);
  assert.equal(yes.$('mnyFullRunway').hidden, false);
  // Bills: 2000 rent + power averaging its last 3 logged months (150, 120, 90 -> 120) = 2120; 9000 / 2120.
  assert.equal(yes.$('mnyRunway').textContent, (9000 / 2120).toFixed(1) + ' months');
  const no = page({ runway: false });
  no.w.renderMoneyOverview();
  assert.equal(no.$('mnyRunwayTile').hidden, true);
  assert.equal(no.$('mnyFullRunway').hidden, true);
});

test('Runway parity: the Money tile and the Runway page compute the same months from the same data', () => {
  const pick = (name) => {
    const i = RUNWAY.indexOf('function ' + name + '(');
    let d = 0, k = RUNWAY.indexOf('{', i);
    for (; k < RUNWAY.length; k++) { if (RUNWAY[k] === '{') d++; else if (RUNWAY[k] === '}' && --d === 0) break; }
    return RUNWAY.slice(i, k + 1);
  };
  const ctx = { expenses: SAMPLE['rd_personal-expenses'] };
  vm.createContext(ctx);
  vm.runInContext(['monthlyEquiv', 'variableCurrentAmount', 'itemMonthlyAmount', 'grandTotal'].map(pick).join('\n') + ';this.g = grandTotal;', ctx);
  const runwayMonths = SAMPLE['rd_emergency-fund'].balance / ctx.g();
  const { w } = page();
  assert.equal(w.thRunwayMonthsCovered().toFixed(6), runwayMonths.toFixed(6));
  assert.match(RUNWAY, /const monthsCovered = min > 0 \? efBalance \/ min : null;/, 'Runway\'s hero is still savings / monthly bills');
});

test('the All ledger is this month\'s money in and out: paid income and expenses, newest first, unpaid invoices left out', () => {
  const { w, $ } = page();
  w.renderMoneyLedger();
  const rows = [...$('mnyAllLedger').querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
  assert.deepEqual(rows, [
    ['Nov 3', 'Invoice paid · Client F', '—', 'Income', '+$50.00'],
    ['Nov 2', 'Invoice paid · Client C', 'Washer repair', 'Income', '+$185.00'],
    ['Nov 2', 'Drain pump · Home Depot', 'Washer repair', 'Expense', '−$46.30'],
    ['Nov 1', 'Cash · Client D', '—', 'Income', '+$120.00'],
    ['Nov 1', 'Mileage · 14 mi', '—', 'Expense', '−$12.18'],
  ]);
});

test('the heading follows the chip (§4F: it read "SPENT THIS MONTH" while Income was selected)', () => {
  const { w } = page();
  assert.equal(w.moneyChipHead('all'), 'All activity · November');
  assert.equal(w.moneyChipHead('income'), 'Income · every entry');
  assert.equal(w.moneyChipHead('expenses'), 'Expenses · every entry');
  assert.equal(w.moneyChipHead('profitability'), 'Profitability · by job');
  assert.match(FIN, /if \(head\) head\.textContent = moneyChipHead\(tabName\);/);
});

test('the Income list: an unpaid invoice says "Not paid yet" and adds nothing; totals count paid invoices only', () => {
  const { w, $ } = page();
  w.renderIncomeEntries();
  const row = (id) => $('incomeTable').querySelector('tr[data-income-id="' + id + '"]');
  assert.match(row(11).querySelector('.col-amount').textContent, /Not paid yet \(\$300\.00 invoiced\)/);
  assert.ok(row(11).classList.contains('is-unpaid'));
  assert.match(row(16).querySelector('.col-amount').textContent, /\$50\.00 of \$200\.00/);
  assert.equal(row(13).querySelector('.col-amount').textContent.trim(), '$185.00');
  const totals = $('incomeTotalsRow').textContent.replace(/\s+/g, ' ');
  assert.match(totals, /Manual entries: \$120\.00/);
  assert.match(totals, /From paid invoices: \$235\.00/, '185 + 50, not 980.56');
  assert.match(totals, /Combined total: \$355\.00/);
});

test('one page: chips, not tabs; All by default; Log expense / Log income keep their forms; Runway link', () => {
  assert.match(FIN, /<div class="mny-chips" role="group" aria-label="Show">\s*<button class="tab-btn mny-chip is-active" data-tab="all">All<\/button>\s*<button class="tab-btn mny-chip" data-tab="income">Income<\/button>\s*<button class="tab-btn mny-chip" data-tab="expenses">Expenses<\/button>\s*<button class="tab-btn mny-chip" data-tab="profitability">Profitability<\/button>/);
  assert.doesNotMatch(FIN, /<div class="tabs tabs-sticky">/);
  assert.match(FIN, /TAB_HASHES\[rememberedTab\] \? rememberedTab : 'all'\)/);
  assert.match(FIN, /onclick="openFinanceLog\('expenses'\)">Log expense<\/button>/);
  assert.match(FIN, /onclick="openFinanceLog\('income'\)">Log income<\/button>/);
  assert.match(FIN, /<a href="\/tools\/runway-dashboard\.html" class="mny-link" id="mnyFullRunway" hidden>Full Runway: budget, net worth, reports &rsaquo;<\/a>/);
  assert.match(FIN, /<span class="hub-title">Money<\/span>/);
  assert.match(FIN, /<title>Money \| Triple H Enterprises \(Internal Tool\)<\/title>/);
});

test('the chip heading never picks a function by name: a hash or stored tab like "constructor" or "__proto__" gets an empty heading (CodeQL, PR #579)', () => {
  const fn = FIN.slice(FIN.indexOf('  function activateTab(tabName) {'), FIN.indexOf('\n  }\n', FIN.indexOf('  function activateTab(tabName) {')) + 4);
  const head = FIN.slice(FIN.indexOf('  function moneyChipHead(tabName) {'), FIN.indexOf('\n  }\n', FIN.indexOf('  function moneyChipHead(tabName) {')) + 4);
  assert.match(head, /switch \(tabName\) \{/);
  assert.doesNotMatch(FIN, /MONEY_CHIP_HEADS/, 'no name-to-function table left');
  // Run the real activateTab and moneyChipHead with every panel present,
  // so activateTab's early return can't be what protects it.
  for (const [tab, want] of [['income', 'Income \u00b7 every entry'], ['constructor', ''], ['__proto__', ''], ['toString', ''], ['hasOwnProperty', '']]) {
    const el = { textContent: 'x' };
    const ctx = {
      FINANCE_TAB_KEY: 'k', localStorage: { setItem() {} }, moneyMonthName: () => 'November', moneyMonthKey: () => '2026-11',
      populateJobRefOptions() {}, populateIncomeJobRefOptions() {}, renderJobProfitability() {}, renderMoneyLedger() {},
      document: { getElementById: (id) => (id === 'mnyLedgerHead' ? el : {}), querySelectorAll: () => [] },
    };
    vm.createContext(ctx);
    vm.runInContext(head + fn + ';activateTab(' + JSON.stringify(tab) + ');', ctx);
    assert.equal(el.textContent, want, tab);
  }
});

// Fix plan FP2.8 (2026-11-06): an invoice that hasn't been paid at all isn't
// income, so it sits in its own "Not paid yet" group under the log instead
// of among the income rows. Part-paid invoices and manual entries stay in
// the log; the totals are exactly what they were.
test('FP2.8: unpaid invoices move out of the income log into a "Not paid yet (not income)" group; totals unchanged', () => {
  const { w, $ } = page();
  w.renderIncomeEntries();
  const log = $('incomeTable').querySelector(':scope > table');
  const group = $('incomeTable').querySelector('[data-fin-unpaid-group]');
  const ids = (el) => [...el.querySelectorAll('tr[data-income-id]')].map((r) => Number(r.getAttribute('data-income-id')));
  assert.deepEqual(ids(log).sort(), [13, 14, 16], 'paid, cash and part-paid stay in the log');
  assert.deepEqual(ids(group).sort(), [11, 12], 'the two unpaid invoices');
  assert.match(group.querySelector('.fin-unpaid-head').textContent.replace(/\s+/g, ' '), /Not paid yet \(not income: 2 invoices\)/);
  const totals = $('incomeTotalsRow').textContent.replace(/\s+/g, ' ');
  assert.match(totals, /From paid invoices: \$235\.00/);
  assert.match(totals, /Combined total: \$355\.00/);
});

test('FP2.8: with nothing received yet, the log says so and the unpaid invoices still show, apart', () => {
  const data = { ...SAMPLE, th_income_log: SAMPLE.th_income_log.filter((e) => e.id === 11) };
  const { w, $ } = page({ data });
  w.renderIncomeEntries();
  assert.match($('incomeTable').textContent, /No income received yet\./);
  assert.equal($('incomeTable').querySelectorAll('[data-fin-unpaid-group] tr[data-income-id]').length, 1);
});
