// Charge a card (2026-11-04, handoff §2: "Quick Charge survives, tab does
// not"; approved "Charge a card" design). A sheet over the Invoices list
// (and reached from Money and + New via #charge), amount first, and a paid
// screen with optional links to one of today's jobs or an unpaid invoice.
// Runs the shipped sheet markup and functions from invoice-generator.html
// with the real data-layer.js in jsdom, on made-up sample data. No charge is
// ever made: nothing here calls Stripe or the network, and the server-side
// income row a charge writes is simulated by adding it to localStorage.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const INV = read('invoice-generator.html');
const FIN = read('finance.html');
const DL = read('data-layer.js');

const between = (src, a, b) => {
  const i = src.indexOf(a);
  assert.ok(i >= 0, 'missing: ' + a);
  const j = src.indexOf(b, i);
  assert.ok(j >= 0, 'missing end: ' + b);
  return src.slice(i, j + b.length);
};
const SHEET = between(INV, '<div class="cc-overlay" id="tab-pos"', '<div class="pos-error" id="posError" style="display:none;"></div>\n  </div>\n  </div>\n</div>');
const SHEET_JS = between(INV, '  // The paid screen (approved "Charge a card" design)', "    forgetPosRequestId('new_card');\n  }\n");

const TODAY = '2026-11-04';
const SAMPLE = {
  th_tracker_jobs: [
    { id: 101, title: 'Dryer vent', date: TODAY, status: 'in-progress' },
    { id: 102, title: 'Old job', date: '2026-10-01', status: 'done' },
  ],
  th_invoices: [
    { id: 1, invoiceNumber: 'INV-1', clientName: 'Client A', clientEmail: 'a@example.com', date: '2026-10-10', total: 185, paid: false },
    { id: 2, invoiceNumber: 'INV-2', clientName: 'Client B', date: '2026-10-20', total: 300, paidAmount: 300, paid: true },
  ],
  th_income_log: [
    { id: 11, date: '2026-10-10', desc: 'Invoice #INV-1', amount: 185, source: 'Client A', origin: 'invoice', invoiceId: 1 },
  ],
  th_clients: [{ id: 1, name: 'Client A', email: 'a@example.com' }],
};

function sheetPage({ data = SAMPLE } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body><button id="opener">Charge a card</button>' + SHEET + '</body>', {
    runScripts: 'outside-only', url: 'https://example.com/tools/invoice-generator.html',
  });
  const w = dom.window;
  for (const [k, v] of Object.entries(data)) w.localStorage.setItem(k, JSON.stringify(v));
  const calls = [];
  Object.assign(w, {
    escapeHtml: (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    escapeAttr: (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    money: (v) => '$' + (v || 0).toFixed(2),
    todayDateStrBusinessTz: () => TODAY,
    mirrorInvoiceToRelational: (e) => calls.push(['mirror', e.id]),
    pushInvoicePaidToPortal: (e) => calls.push(['portal', e.id]),
    setAppBadgeDelta: (d) => calls.push(['badge', d]),
    fetch: () => { throw new Error('no network in this test'); },
  });
  w.eval(DL + `
    var savedCardInfo = null, lastCheckedEmail = null;
    function forgetPosRequestId() {}
    function showError() {}
    function renderInvoiceLog() {}
    ${SHEET_JS}
    ;Object.assign(window, { showSuccess, openChargeCard, closeChargeCard, finishCharge, linkChargeToJob, linkChargeToInvoice, thInvoices, thIncome, thApplyPosLinks, thIncomeReceived });
  `);
  const $ = (id) => w.document.getElementById(id);
  return { w, $, calls };
}

test('the sheet: amount, keypad, then Client, "Email the receipt to", what for; hidden until opened, Escape and the backdrop close it, focus goes back', () => {
  const { w, $ } = sheetPage();
  const ids = [...$('tab-pos').querySelectorAll('#posAmount, #posKeypad, #posClientName, #posClientEmail, #posDescription, #posChargeArea')].map(e => e.id);
  assert.deepEqual(ids, ['posAmount', 'posKeypad', 'posClientName', 'posClientEmail', 'posDescription', 'posChargeArea']);
  assert.equal(w.document.querySelector('label[for="posClientEmail"]').textContent, 'Email the receipt to');
  assert.equal($('tab-pos').hidden, true);
  const opener = $('opener');
  opener.focus();
  w.openChargeCard(opener);
  assert.equal($('tab-pos').hidden, false);
  assert.ok(w.document.body.classList.contains('cc-open'));
  assert.equal(w.document.activeElement, $('ccTitle'), 'focus moves into the sheet, not onto a field (no phone keyboard over the keypad)');
  assert.deepEqual([...$('posClientList').options].map(o => o.value), ['Client A']);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal($('tab-pos').hidden, true);
  assert.equal(w.document.activeElement, opener);
  w.openChargeCard(opener);
  $('tab-pos').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal($('tab-pos').hidden, true, 'a tap on the dimmed backdrop closes it');
});

test('picking a client with an email on file fills "Email the receipt to" (only when it is still empty)', () => {
  const { w, $ } = sheetPage();
  $('posClientName').value = 'Client A';
  $('posClientName').dispatchEvent(new w.Event('change'));
  assert.equal($('posClientEmail').value, 'a@example.com');
  $('posClientEmail').value = 'other@example.com';
  $('posClientName').dispatchEvent(new w.Event('change'));
  assert.equal($('posClientEmail').value, 'other@example.com');
});

test('the paid screen: "$185.00 paid", where it went, today\'s jobs and unpaid invoices as optional links, and Done', () => {
  const { w, $ } = sheetPage();
  $('posClientEmail').value = 'a@example.com';
  w.showSuccess(185, 'pi_test_1');
  const area = $('posChargeArea');
  assert.equal(area.querySelector('.pos-success-amount').textContent, '$185.00 paid');
  assert.equal(area.querySelector('.pos-success-sub').textContent, 'Logged in Money as income. Receipt emailed.');
  assert.equal(area.querySelector('.cc-links-label').textContent, 'Link it (optional)');
  const links = [...area.querySelectorAll('.cc-link')].map(b => b.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(links, ['To a job: Today, Dryer vent ›', 'To INV-1 · Client A ($185.00 owed): marks it paid ›'],
    'only today\'s jobs and invoices with something owed; the paid INV-2 and last month\'s job are not offered');
  assert.equal(area.querySelector('[onclick="finishCharge()"]').textContent, 'Done');
  assert.ok(!area.innerHTML.includes('onclick="linkCharge'), 'link buttons carry ids in data attributes, not inline handlers');
});

test('linking to an invoice marks it paid by the charge (capped at its total), mirrors it like Mark paid, and the charge row then counts once', () => {
  const { w, $, calls } = sheetPage();
  $('posClientEmail').value = 'a@example.com';
  w.showSuccess(185, 'pi_test_2');
  $('posChargeArea').querySelector('[data-cc-invoice="1"]').click();
  const inv = w.thInvoices.all().find(i => i.id === 1);
  assert.equal(inv.paidAmount, 185);
  assert.equal(inv.paid, true);
  assert.deepEqual(calls, [['mirror', 1], ['badge', -1], ['portal', 1]]);
  assert.equal($('ccLinked').textContent, 'INV-1 is marked paid.');
  assert.equal($('ccLinks').hidden, true, 'one link per charge');
  // The server's income row for this charge arrives with the next sync.
  const income = w.thIncome.all();
  income.push({ id: 50, date: TODAY, desc: 'POS sale', amount: 185, source: 'a@example.com', origin: 'pos', stripePaymentIntentId: 'pi_test_2' });
  w.thIncome.replaceAll(income);
  assert.equal(w.thApplyPosLinks(), 1);
  const row = w.thIncome.all().find(e => e.id === 50);
  assert.equal(row.appliedToInvoiceId, 1);
  // The invoice's own row now counts $185; the charge row adds nothing.
  const invoices = w.thInvoices.all();
  const total = w.thIncome.all().reduce((s, e) => s + w.thIncomeReceived(e, invoices), 0);
  assert.equal(total, 185, 'the $185 is income once, not twice');
  assert.equal(JSON.parse(w.localStorage.getItem('th_pos_links')).length, 0, 'an applied link is not kept');
});

test('linking to a job fills the charge row\'s job once it arrives; a saved card (no PaymentIntent id on the page) matches on email + amount + day', () => {
  const { w, $ } = sheetPage();
  $('posClientEmail').value = 'A@Example.com';
  w.showSuccess(95, null);
  $('posChargeArea').querySelector('[data-cc-job="101"]').click();
  assert.equal($('ccLinked').textContent, 'Linked to Dryer vent.');
  assert.equal(w.thApplyPosLinks(), 0, 'nothing to apply until the row arrives');
  const income = w.thIncome.all();
  income.push({ id: 60, date: TODAY, amount: 95, source: 'a@example.com', origin: 'pos' });
  income.push({ id: 61, date: TODAY, amount: 95, source: 'a@example.com', origin: 'manual' });
  w.thIncome.replaceAll(income);
  assert.equal(w.thApplyPosLinks(), 1);
  const rows = w.thIncome.all();
  assert.equal(rows.find(e => e.id === 60).jobRefId, '101');
  assert.equal(rows.find(e => e.id === 60).jobRefTitle, 'Dryer vent');
  assert.equal(rows.find(e => e.id === 61).jobRefId, undefined, 'only a card charge (origin pos) is matched');
  assert.equal(w.thIncomeReceived(rows.find(e => e.id === 60), w.thInvoices.all()), 95, 'a job link changes nothing about the amount');
});

test('thApplyPosLinks never re-links a row already linked, and drops a link that has waited 14 days', () => {
  const { w } = sheetPage();
  const income = w.thIncome.all();
  income.push({ id: 70, date: TODAY, amount: 40, source: 'b@example.com', origin: 'pos', jobRefId: '5', jobRefTitle: 'Earlier' });
  w.thIncome.replaceAll(income);
  w.localStorage.setItem('th_pos_links', JSON.stringify([
    { email: 'b@example.com', amount: 40, date: TODAY, jobRefId: '101', queuedAt: Date.now() },
    { paymentIntentId: 'pi_gone', invoiceId: 1, queuedAt: Date.now() - 15 * 86400000 },
  ]));
  assert.equal(w.thApplyPosLinks(), 0);
  assert.equal(w.thIncome.all().find(e => e.id === 70).jobRefTitle, 'Earlier');
  const kept = JSON.parse(w.localStorage.getItem('th_pos_links'));
  assert.equal(kept.length, 1);
  assert.equal(kept[0].email, 'b@example.com');
});

test('Done resets the form and closes the sheet', () => {
  const { w, $ } = sheetPage();
  w.openChargeCard($('opener'));
  $('posAmount').value = '185';
  $('posClientName').value = 'Client A';
  w.showSuccess(185, 'pi_test_3');
  $('posChargeArea').querySelector('[onclick="finishCharge()"]').onclick = null;
  w.finishCharge();
  assert.equal($('tab-pos').hidden, true);
  assert.equal($('posAmount').value, '');
  assert.equal($('posClientName').value, '');
  assert.equal($('posChargeArea').innerHTML, '');
});

test('where Charge a card opens from: the Invoices list, Money (for accounts that can bill), + New and Search -- all the same sheet via #charge', () => {
  assert.match(INV, /<button type="button" class="mn-new-btn is-secondary" id="invChargeBtn" onclick="openChargeCard\(this\)">Charge a card<\/button>\s*<button type="button" class="mn-new-btn" onclick="openNewInvoice\(\)">\+ New invoice<\/button>/);
  assert.doesNotMatch(INV, /data-tab="pos"|data-money-seg="pos"/, 'the Quick charge tab and its switch segment are gone');
  assert.match(FIN, /<a href="\/tools\/invoice-generator\.html#charge" class="secondary-btn" id="mnyChargeBtn" hidden>Charge a card<\/a>/);
  assert.match(FIN, /chargeBtn\.hidden = !\(typeof canManageInvoices === 'function' && canManageInvoices\(\)\);/);
  const NAV = read('tools-nav-pwa.js');
  assert.match(NAV, /\{ label: 'Charge a card', hint: [^}]*href: '\/tools\/invoice-generator\.html#charge', perm: 'canManageInvoices' \}/);
  const PAL = read('tools-command-palette.js');
  assert.match(PAL, /\{ title: 'Charge a card', [^}]*href: '\/tools\/invoice-generator\.html#charge', [^}]*perm: 'canManageInvoices' \}/);
  assert.doesNotMatch(NAV + PAL, /Quick charge'/);
});

test('Money\'s Income list and totals count a charge linked to an invoice once, and say so on the row', () => {
  assert.match(DL, /if \(entry\.appliedToInvoiceId\) return 0;/);
  assert.match(FIN, /e\.appliedToInvoiceId \? `\$\$\{e\.amount\.toFixed\(2\)\} <span class="mny-of">\(counted on its invoice\)<\/span>`/);
  assert.match(FIN, /const manualTotal = entries\.filter\(e => e\.origin !== 'invoice'\)\.reduce\(\(sum, e\) => sum \+ receivedOf\(e\), 0\);/);
  assert.match(FIN, /function renderIncomeEntries\(\) \{\s*backfillLegacyInvoicesIntoIncomeLog\(\);\s*if \(typeof thApplyPosLinks === 'function'\) thApplyPosLinks\(\);/);
});
