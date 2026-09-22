// Workspace rework part 4 (2026-09-22): Money opens on the invoice list.
// Invoices leads with what is owed, what is overdue, and what was billed
// this month; every invoice is a row whose tap (or hold) is one sheet with
// Mark Paid first. The forms keep their tabs and deep links. And one Mark
// paid everywhere: the Invoices page now writes paidAmount like the
// Dashboard does, and the Dashboard now tells the client portal like the
// Invoices page did.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const INV = read('invoice-generator.html');
const WS = read('workspace.html');
const SYNC = read('sync.js');
const DL = read('data-layer.js');
const TOUR = read('tools-tour.js');
const DIALOGS = read('tools-dialogs.js');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'expected function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function iso(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

test('the page opens on the list: Invoices is the first tab and the active panel, and the swipe order follows the strip', () => {
  const strip = INV.match(/<div class="tabs tabs-sticky">([\s\S]*?)<\/div>/)[1];
  const tabs = [...strip.matchAll(/data-tab="(\w+)"[^>]*>([^<]+)</g)].map(m => [m[1], m[2]]);
  assert.deepEqual(tabs, [['recent', 'Invoices'], ['invoice', 'New invoice'], ['quote', 'New quote'], ['pos', 'Quick charge']]);
  assert.match(strip, /<button class="tab-btn is-active" data-tab="recent"/);
  assert.match(INV, /<div class="tab-panel is-active" id="tab-recent">/);
  assert.match(INV, /<div class="tab-panel" id="tab-invoice">/);
  assert.match(INV, /const GEN_TAB_ORDER = \['recent', 'invoice', 'quote', 'pos'\];/);
});

test('a link that brings something to invoice still lands on the form: ?jobRef= and ?client= are read before the helpers strip them; #hash wins after', () => {
  const fn = extractFn(INV, 'genTabFromQuery');
  const ctx = { URLSearchParams, window: { location: { search: '' } } };
  vm.createContext(ctx);
  vm.runInContext(fn + ';this.f = genTabFromQuery;', ctx);
  for (const [search, want] of [['?jobRef=107', 'invoice'], ['?client=Sarah', 'invoice'], ['?search=Bill', null], ['', null]]) {
    ctx.window.location.search = search;
    assert.equal(ctx.f(), want, search);
  }
  const init = INV.slice(INV.indexOf("document.addEventListener('DOMContentLoaded'"));
  const q = init.indexOf('const queryTab = genTabFromQuery();');
  assert.ok(q > 0 && q < init.indexOf('applyJobRefFromUrl();') && init.indexOf('applyJobRefFromUrl();') < init.indexOf('applyGenTabFromHash();'));
  assert.match(init, /if \(queryTab\) activateGenTab\(queryTab\);/);
  // The Dashboard's Create invoice means the form, not the list.
  assert.match(WS, /<a class="dash-primary-action" href="\/tools\/invoice-generator\.html#invoice" data-tile-perm="can_manage_invoices">Create invoice<\/a>/);
});

function stateFns() {
  const ctx = { Date, Math, Number, TH_TERM_DAYS: undefined };
  vm.createContext(ctx);
  vm.runInContext(DL.match(/const TH_TERM_DAYS = [^\n]+/)[0] + '\n' + extractFn(DL, 'thInvoiceDueDate') + '\n' + extractFn(INV, 'invoiceState') + '\n' + extractFn(INV, 'invoiceIsPaid') +
    '\n' + extractFn(WS, 'toCents') + '\n' + extractFn(WS, 'getPaidAmount') + '\n' + extractFn(WS, 'invoicePaymentStatus') + '\n' + extractFn(SYNC, 'deriveInvoicePaid') +
    ';this.f = { invoiceState, invoiceIsPaid, invoicePaymentStatus, deriveInvoicePaid };', ctx);
  return ctx.f;
}

test('invoiceState: paidAmount first, the old paid flag only without one, whole cents, and overdue only while something is still owed', () => {
  const { invoiceState } = stateFns();
  assert.equal(invoiceState({ total: 100, paid: true, paidAmount: 0, date: iso(-3), terms: 'Net 30' }).status, 'unpaid', 'a paid flag the Dashboard has since undone (paidAmount 0) is not paid');
  assert.equal(invoiceState({ total: 100, paid: false, paidAmount: 100, date: iso(-40), terms: 'Net 15' }).status, 'paid');
  assert.equal(invoiceState({ total: 100, paid: true, date: iso(-40) }).status, 'paid', 'legacy invoice: no paidAmount, only the flag');
  assert.equal(invoiceState({ total: 125.00000000000001, paidAmount: 125, date: iso(-40) }).status, 'paid', 'float noise in total');
  const part = invoiceState({ total: 160, paidAmount: 50, date: iso(-2), terms: 'Net 30' });
  assert.deepEqual([part.status, part.balance], ['partial', 110]);
  const late = invoiceState({ total: 285, paidAmount: 0, date: iso(-40), terms: 'Net 15' });
  assert.deepEqual([late.status, late.balance, late.daysToDue], ['overdue', 285, -25]);
  assert.equal(invoiceState({ total: 285, paidAmount: 100, date: iso(-40), terms: 'Net 15' }).status, 'overdue', 'part paid and past due is overdue');
  assert.equal(invoiceState({ total: 90, date: iso(0), terms: 'Due Upon Receipt' }).daysToDue, 0);
});

test('invoiceState agrees with the Dashboard (invoicePaymentStatus) and the relational mirror (deriveInvoicePaid) on what is paid', () => {
  const { invoiceIsPaid, invoicePaymentStatus, deriveInvoicePaid } = stateFns();
  const cases = [
    { total: 100, paid: true }, { total: 100, paid: false }, { total: 100, paid: true, paidAmount: 0 }, { total: 100, paid: false, paidAmount: 100 },
    { total: 100, paidAmount: 99.99 }, { total: 125.00000000000001, paidAmount: 125 }, { total: 100, paidAmount: 150 }, { total: '80', paidAmount: '80' },
  ];
  for (const c of cases) {
    assert.equal(invoiceIsPaid(c), invoicePaymentStatus(c) === 'paid', JSON.stringify(c));
    assert.equal(invoiceIsPaid(c), deriveInvoicePaid(c), JSON.stringify(c));
  }
});

function loadPage(invoices, extra) {
  const dom = new JSDOM(INV, {
    runScripts: 'dangerously', url: 'https://example.com/tools/invoice-generator.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canManageInvoices = () => true;
      w.localStorage.setItem('th_invoices', JSON.stringify(invoices));
      w.localStorage.setItem('th_quotes', JSON.stringify((extra && extra.quotes) || []));
      if (extra && extra.clients) w.localStorage.setItem('th_clients', JSON.stringify(extra.clients));
    },
  });
  const w = dom.window;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  Object.assign(w, {
    escapeHtml: esc, escapeAttr: (s) => esc(s).replace(/"/g, '&quot;'), money: (n) => '$' + (Number(n) || 0).toFixed(2), personDot: () => '',
    showToast: () => {}, haptic: () => {}, scheduleSync: () => {},
    thInvoiceDueDate: vm.runInNewContext('(' + extractFn(DL, 'thInvoiceDueDate').replace('function thInvoiceDueDate', 'function') + ')', { TH_TERM_DAYS: { 'Due Upon Receipt': 0, 'Net 15': 15, 'Net 30': 30 }, Date }),
  });
  return w;
}

test('toggleInvoicePaid writes paidAmount with the flag, mirrors to the relational table, earns the referral, and tells the portal -- the Dashboard and this page now agree', () => {
  const w = loadPage([{ id: 7, invoiceNumber: 'INV-7', clientName: 'Sarah', clientEmail: 's@x.com', total: 150, paid: true, paidAmount: 150, date: iso(-3), terms: 'Net 30', jobRefId: '101' }]);
  const mirrored = [], referrals = [], pushed = [];
  w.mirrorInvoiceToRelational = (e) => mirrored.push([e.paid, e.paidAmount]);
  w.mirrorReferralEarnedForJob = (id) => referrals.push(id);
  w.pushInvoicePaidToPortal = (e) => pushed.push([e.id, e.paid]);
  w.toggleInvoicePaid(7);
  let saved = JSON.parse(w.localStorage.getItem('th_invoices'))[0];
  assert.deepEqual([saved.paid, saved.paidAmount], [false, 0], 'Mark Unpaid on an invoice the Dashboard marked paid clears paidAmount too');
  w.toggleInvoicePaid(7);
  saved = JSON.parse(w.localStorage.getItem('th_invoices'))[0];
  assert.deepEqual([saved.paid, saved.paidAmount], [true, 150]);
  assert.deepEqual(mirrored, [[false, 0], [true, 150]]);
  assert.deepEqual(referrals, [101], 'only on becoming paid');
  assert.deepEqual(pushed, [[7, false], [7, true]]);
  w.close();
});

test('the Dashboard Mark paid now tells the portal too (it never did), after the save and the mirror', () => {
  const fn = extractFn(WS, 'togglePaid');
  const save = fn.indexOf('saveInvoices(invoices);');
  const push = fn.indexOf('if (typeof pushInvoicePaidToPortal === \'function\') pushInvoicePaidToPortal(inv);');
  assert.ok(save > 0 && push > save);
});

test('pushInvoicePaidToPortal posts the real new state to set-invoice-paid, only for an invoice on the portal', async () => {
  const calls = [];
  const ctx = {
    SUPABASE_URL: 'https://p.supabase.co', SUPABASE_ANON_KEY: 'anon', getAuthToken: () => 'tok', JSON, console,
    fetch: (url, opts) => { calls.push([url, opts.method, JSON.parse(opts.body), opts.headers.Authorization]); return Promise.resolve({}); },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(SYNC, 'pushInvoicePaidToPortal') + ';this.f = pushInvoicePaidToPortal;', ctx);
  ctx.f({ id: 1, paid: true });
  ctx.f(null);
  ctx.f({ id: 2, clientEmail: 'a@b.c', paid: false });
  ctx.f({ id: 3, clientEmail: 'a@b.c', paid: true });
  assert.deepEqual(calls, [
    ['https://p.supabase.co/functions/v1/set-invoice-paid', 'POST', { source_invoice_id: 2, paid: false }, 'Bearer tok'],
    ['https://p.supabase.co/functions/v1/set-invoice-paid', 'POST', { source_invoice_id: 3, paid: true }, 'Bearer tok'],
  ]);
});

test('the list: owed / overdue / billed-this-month tiles over every invoice, chip counts, a due line per row, filters that stick, and an empty state per filter', () => {
  const w = loadPage([
    { id: 1, invoiceNumber: 'A', clientName: 'Paid Pat', total: 95, paidAmount: 95, date: iso(-12), terms: 'Net 15' },
    { id: 2, invoiceNumber: 'B', clientName: 'Soon Sam', total: 160, paidAmount: 0, date: iso(0), terms: 'Net 30' },
    { id: 3, invoiceNumber: 'C', clientName: 'Late <Lu>', total: 285, paidAmount: 85, date: iso(-40), terms: 'Net 15' },
  ]);
  const $ = (sel) => w.document.querySelector(sel);
  w.setInvoiceFilter('all');
  const tiles = [...w.document.querySelectorAll('#invoiceSummary .inv-stat')].map(t => [...t.children].map(c => c.textContent).join(' | '));
  assert.equal(tiles[0], 'Owed to you | $360.00 | 2 invoices');
  assert.equal(tiles[1], 'Overdue | $200.00 | 1 invoice');
  assert.match(tiles[2], /^[A-Z][a-z]+ \| \$(160|255|445|540)\.00 \| \d invoices? billed$/, 'this month, by invoice date');
  assert.equal($('#invoiceUnpaidCount').textContent, '2');
  assert.equal($('#invoiceOverdueCount').textContent, '1');
  const rows = [...w.document.querySelectorAll('#invoiceLogList .inv-item')];
  assert.deepEqual(rows.map(r => r.dataset.invoiceId), ['3', '2', '1'], 'newest first');
  const lines = [...rows[0].querySelectorAll('.th-row-sub')].map(l => l.textContent);
  assert.deepEqual([lines[0].startsWith('#C · '), lines[1]], [true, '25 days overdue'], 'overdue gets its own line, so a phone never cuts it off');
  assert.match(rows[0].querySelector('.th-row-title').innerHTML, /Late &lt;Lu&gt;/);
  assert.match(rows[0].querySelector('.inv-row-amt').textContent, /\$200\.00/, 'an open invoice shows what is still owed');
  assert.match(rows[1].textContent, /Due in|Due /);
  assert.match(rows[2].textContent, /Paid/);
  assert.equal(rows[0].querySelector('.th-row-link').getAttribute('onclick'), 'openInvoiceActions(3)');

  w.document.querySelector('#invoiceSummary .inv-stat.is-owed').click();
  assert.deepEqual([...w.document.querySelectorAll('#invoiceLogList .inv-item')].map(r => r.dataset.invoiceId), ['3', '2']);
  assert.equal(w.localStorage.getItem('th_invoice_filter'), 'unpaid');
  assert.equal($('#invoiceFilters .th-chip.is-active').dataset.filter, 'unpaid');
  w.setInvoiceFilter('unpaid');
  assert.equal(w.localStorage.getItem('th_invoice_filter'), 'all', 'tapping the filter that is on turns it off');
  w.setInvoiceFilter('overdue');
  assert.deepEqual([...w.document.querySelectorAll('#invoiceLogList .inv-item')].map(r => r.dataset.invoiceId), ['3']);
  $('#invoiceLogSearch').value = 'soon';
  w.renderInvoiceLog();
  assert.match($('#invoiceLogList').textContent, /No overdue invoices match "soon"/);
  $('#invoiceLogSearch').value = '';
  w.close();
});

test('with no invoices at all the list says so and offers New invoice; the tiles hide', () => {
  const w = loadPage([]);
  w.setInvoiceFilter('all');
  assert.equal(w.document.getElementById('invoiceSummary').innerHTML, '');
  assert.match(w.document.getElementById('invoiceLogList').innerHTML, /No invoices generated yet\.<button type="button" class="primary-btn" onclick="activateGenTab\('invoice'\)">New invoice<\/button>/);
  w.close();
});

test('the invoice sheet opens the client (from the registry) and the job; a quote gets the same shape', () => {
  const w = loadPage(
    [{ id: 9, invoiceNumber: 'INV-9', clientName: 'Sarah Miller', clientId: 'c1', total: 50, paidAmount: 0, date: iso(-1), terms: 'Net 30', jobRefId: '101' }],
    { clients: [{ id: 'c1', name: 'Sarah Miller' }], quotes: [{ id: 5, quoteNumber: 'Q-5', clientName: 'Sarah Miller', total: 420, jobRefId: '104', date: iso(-2) }] },
  );
  let shown = null;
  w.showQuickActionSheet = (title, actions) => { shown = { title, labels: Array.from(actions, a => a.label) }; };
  w.thFindClientById = (id) => (id === 'c1' ? { id: 'c1', name: 'Sarah Miller' } : null);
  w.thFindClientByName = (n) => (n === 'Sarah Miller' ? { id: 'c1', name: 'Sarah Miller' } : null);
  w.openInvoiceActions(9);
  assert.deepEqual(shown.labels, ['Mark Paid', 'Open client', 'Open job', 'Delete']);
  assert.equal(w.invoiceClientHref({ clientId: 'c1' }), '/tools/client-detail.html?id=c1');
  w.openQuoteActions(5);
  assert.deepEqual(shown.labels, ['Open client', 'Open job', 'Delete']);
  assert.equal(shown.title, 'Sarah Miller · #Q-5 · $420.00');
  w.close();
});

test('quote rows carry one pill -- Invoiced beats the portal answer, then Approved / Declined / Awaiting reply, else Pending -- and keep the decline reason and open questions under the row', () => {
  const fn = extractFn(INV, 'renderQuoteLog');
  assert.match(fn, /if \(status === 'converted'\) pill = '<span class="th-pill is-paid" title="Converted to invoice">Invoiced<\/span>';/);
  assert.match(fn, /else if \(portalInfo && portalInfo\.status === 'approved'\)/);
  assert.match(fn, /else if \(portalInfo && portalInfo\.status === 'declined'\)/);
  assert.match(fn, /<strong>Decline reason:<\/strong>/);
  assert.match(fn, /onclick="resolveQuoteQuestion\(\$\{qq\.id\}\)">Mark answered<\/button>/);
  assert.match(fn, /extraHtml \? '<div class="inv-row-extra">' \+ extraHtml \+ '<\/div>' : ''/, 'the question buttons sit outside the row button, never nested in it');
});

test('a row that is one button can opt in to the long-press too (attachLongPress), and the click after a fired hold is swallowed', async () => {
  const dom = new JSDOM('<!DOCTYPE html><div id="list"><div class="row"><button id="opt" data-long-press-target>Open</button><button id="plain">Plain</button></div></div>', { runScripts: 'dangerously', url: 'https://example.com/' });
  const w = dom.window;
  const s = w.document.createElement('script'); s.textContent = DIALOGS; w.document.head.appendChild(s);
  const fired = [];
  let clicks = 0;
  w.document.getElementById('opt').addEventListener('click', () => clicks++);
  w.attachLongPress(w.document.getElementById('list'), '.row', () => fired.push('hold'));
  const press = (id) => { const ev = new w.Event('pointerdown', { bubbles: true }); ev.clientX = 5; ev.clientY = 5; w.document.getElementById(id).dispatchEvent(ev); };
  press('plain');
  await new Promise(r => setTimeout(r, 600));
  assert.deepEqual(fired, [], 'a plain button is left alone');
  press('opt');
  await new Promise(r => setTimeout(r, 600));
  assert.deepEqual(fired, ['hold']);
  w.document.getElementById('opt').click();
  assert.equal(clicks, 0, 'the click that follows the hold does not also open the row');
  w.close();
});

test('the tour teaches the list first, then the three forms; help and search say the same', () => {
  const steps = [...TOUR.matchAll(/page: '\/tools\/invoice-generator\.html', highlightSelector: '([^']+)', title: '([^']+)'/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(steps.map(s => s[1]), ['Invoices: who owes you', 'New invoice', 'New quote', 'Quick charge']);
  assert.equal(steps[0][0], '#invoiceSummary, #invoiceFilters');
  assert.match(INV, /<h3>How to Use: Invoices<\/h3>/);
  assert.match(INV, /<li><strong>Invoices tab<\/strong> &mdash; every invoice, newest first/);
  assert.match(read('tools-command-palette.js'), /\{ title: 'Invoices', meta: 'Who owes you, what is overdue, every invoice and quote', href: '\/tools\/invoice-generator\.html#recent'/);
});
