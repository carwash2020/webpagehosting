// Workspace rework part 6 (2026-09-22): an invoice started from a job
// writes itself. "From this job" offers the job's logged hours (Labor at
// the remembered rate), every receipt logged against it (parts at cost),
// and its mileage (at the remembered billing rate) -- or, when the client
// has an unbilled quote for the job, the quote's own lines. Nothing goes
// in until Add, and Undo puts the form back exactly as it was.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const INV = fs.readFileSync(path.join(TOOLS, 'invoice-generator.html'), 'utf8');
const DL = fs.readFileSync(path.join(TOOLS, 'data-layer.js'), 'utf8');
const TOUR = fs.readFileSync(path.join(TOOLS, 'tools-tour.js'), 'utf8');

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
const money = (n) => '$' + (Number(n) || 0).toFixed(2);

function billables(job, expenses, quotes, rates) {
  const ctx = { Date, Math, Number, String, Array, money };
  vm.createContext(ctx);
  vm.runInContext(extractFn(INV, 'jobFillShortDate') + '\n' + extractFn(INV, 'jobBillables') + ';this.f = jobBillables;', ctx);
  return ctx.f(job, expenses, quotes, rates);
}

test('jobBillables: Labor from the hours logged, one part line per receipt at cost, one Mileage line for all the miles; other jobs and $0 receipts are left out', () => {
  const b = billables({ id: 107, hoursWorked: 2.5 }, [
    { id: 1, jobRefId: '107', type: 'expense', desc: 'Drain pump', vendor: 'Home Depot', amount: 48.123, partNumber: 'WH23', date: '2026-09-20' },
    { id: 2, jobRefId: '107', type: 'mileage', miles: 14 },
    { id: 3, jobRefId: '107', type: 'mileage', miles: 6.04 },
    { id: 4, jobRefId: '999', type: 'expense', desc: 'Someone else', amount: 10 },
    { id: 5, jobRefId: '107', type: 'expense', desc: 'Free sample', amount: 0 },
    { id: 6, jobRefId: '107', type: 'expense', vendor: 'Ace', amount: 6.49, date: '2026-09-19' },
  ], [], { labor: 75, mileage: 0.67 });
  assert.deepEqual(Array.from(b.lines, l => [l.key, l.desc, l.type, l.part, l.qty, l.price, l.taxable]), [
    ['labor', 'Labor', 'labor', '', 2.5, 75, true],
    ['exp-6', 'Ace', 'part', '', 1, 6.49, true],
    ['exp-1', 'Drain pump', 'part', 'WH23', 1, 48.12, true],
    ['miles', 'Mileage', 'mileage', '', 20, 0.67, false],
  ], 'receipts oldest first; amounts to the cent; mileage untaxed like + Add Mileage');
  assert.equal(b.lines[0].note, '2.5 h logged × $75.00/h');
  assert.match(b.lines[2].note, /^Receipt, Home Depot · Sep 20 · at cost$/);
  assert.equal(b.quote, null);
});

test('jobBillables: no remembered rate means an empty price and a nudge; no hours logged means a Labor line that asks for them', () => {
  const b = billables({ id: 1 }, [{ id: 2, jobRefId: '1', type: 'mileage', miles: 3 }], [], { labor: 0, mileage: 0 });
  assert.deepEqual(Array.from(b.lines, l => [l.key, l.qty, l.price, !!l.needsHours, l.note]), [
    ['labor', '', '', true, 'How long did it take?'],
    ['miles', 3, '', false, '3 mi logged · add your rate'],
  ]);
  assert.equal(billables({ id: 1 }, [], [], { labor: 80 }).lines[0].note, 'How long did it take? × $80.00/h');
});

test('jobBillables: offers the newest unbilled quote for the job that has line items -- not a converted one, not another job\'s', () => {
  const quotes = [
    { id: 10, jobRefId: '5', status: 'converted', line_items: [{ desc: 'a' }] },
    { id: 11, jobRefId: '5', line_items: [{ desc: 'b' }] },
    { id: 12, jobRefId: '5', status: 'pending', line_items: [{ desc: 'c' }] },
    { id: 13, jobRefId: '5', status: 'pending', line_items: [] },
    { id: 14, jobRefId: '6', status: 'pending', line_items: [{ desc: 'd' }] },
  ];
  assert.equal(billables({ id: 5 }, [], quotes, {}).quote.id, 12);
  assert.equal(billables({ id: 7 }, [], quotes, {}).quote, null);
});

// jsdom fires DOMContentLoaded (the page's init, which applies ?jobRef=)
// asynchronously, so a page is ready only after that has run.
async function loadPage(search, data, rates) {
  const dom = new JSDOM(INV, {
    runScripts: 'dangerously', url: 'https://example.com/tools/invoice-generator.html' + search,
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canManageInvoices = () => true;
      w.money = money;
      w.escapeHtml = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      w.escapeAttr = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      w.showToast = () => {}; w.haptic = () => {}; w.animateRowExit = (row, cb) => cb && cb();
      w.todayDateStrBusinessTz = () => '2026-09-22';
      for (const [k, v] of Object.entries(data)) w.localStorage.setItem(k, JSON.stringify(v));
      if (rates) { w.localStorage.setItem('th_invoice_labor_rate', String(rates.labor)); w.localStorage.setItem('th_invoice_mileage_rate', String(rates.mileage)); }
      // data-layer.js is a <script src> on the real page, where its top-level
      // consts (TH_KEYS...) are globals; an eval would keep them block-scoped.
      w.eval(DL.replace(/^const /gm, 'var '));
    },
  });
  await new Promise(resolve => dom.window.document.readyState === 'complete' ? resolve() : dom.window.addEventListener('load', resolve));
  await new Promise(resolve => setTimeout(resolve, 0));
  return dom.window;
}
const rows = (w) => Array.from(w.document.querySelectorAll('#lineItemsBody tr'), r => [r.querySelector('.li-desc').value, r.querySelector('.li-type').value, r.querySelector('.li-qty').value, r.querySelector('.li-price').value].join('|'));
const DATA = {
  th_tracker_jobs: [
    { id: 107, title: 'Washer leaking', client: 'Bill Adams', status: 'done', hoursWorked: 2.5 },
    { id: 104, title: 'Drywall patch', client: 'Dave Carter', status: 'not-started' },
    { id: 200, title: 'Nothing logged', client: 'Nobody', status: 'done' },
  ],
  th_expense_log: [
    { id: 1, jobRefId: '107', type: 'expense', desc: 'Drain pump "OEM"', vendor: 'Home Depot', amount: 48.12, date: '2026-09-20' },
    { id: 2, jobRefId: '107', type: 'mileage', miles: 14 },
  ],
  th_quotes: [{ id: 601, quoteNumber: 'Q-2031', clientName: 'Dave Carter', total: 420, discount: 20, status: 'pending', jobRefId: '104', line_items: [{ desc: 'Drywall patch', qty: 1, price: 380, taxable: true, type: 'labor' }, { desc: 'Mud, tape, paint', qty: 1, price: 60, taxable: true, type: 'part' }] }],
  th_invoices: [],
};

test('a job\'s Create invoice (?jobRef=) opens the form with the panel ticked; Add replaces the untouched starter row with the job\'s lines, and Undo puts the starter row back', async () => {
  const w = await loadPage('?jobRef=107', DATA, { labor: 75, mileage: 0.67 });
  const panel = w.document.getElementById('jobFillPanel');
  assert.equal(panel.hidden, false);
  assert.equal(w.document.getElementById('invoiceJobRef').value, '107');
  const boxes = Array.from(panel.querySelectorAll('[data-fill-key]'));
  assert.deepEqual(boxes.map(b => [b.getAttribute('data-fill-key'), b.checked]), [['labor', true], ['exp-1', true], ['miles', true]]);
  assert.equal(w.document.getElementById('jobFillAddBtn').textContent, 'Add 3 lines');
  assert.match(panel.innerHTML, /Drain pump "OEM"|Drain pump &quot;OEM&quot;/);
  assert.deepEqual(rows(w), ['Washer leaking||1|'], 'the starter row the ?jobRef= prefill already makes');

  boxes[2].checked = false;
  w.updateJobFillButton();
  assert.equal(w.document.getElementById('jobFillAddBtn').textContent, 'Add 2 lines');
  w.addJobFillLines();
  assert.deepEqual(rows(w), ['Labor|labor|2.5|75', 'Drain pump "OEM"|part|1|48.12'], 'the quote mark survives the round trip through value=""');
  assert.match(panel.textContent, /Added 2 lines from the job · \$235\.62\./);

  w.undoJobFill();
  assert.deepEqual(rows(w), ['Washer leaking||1|']);
  assert.equal(w.document.getElementById('jobFillAddBtn').textContent, 'Add 3 lines', 'back to the offer');
  w.close();
});

test('a job with an unbilled quote offers Bill the quote first (its lines, its discount, and the same quote link Convert to Invoice sets); the logged lines start unticked; Undo clears all of it', async () => {
  const w = await loadPage('', DATA, { labor: 75, mileage: 0.67 });
  const select = w.document.getElementById('invoiceJobRef');
  select.value = '104';
  select.dispatchEvent(new w.Event('change'));
  const panel = w.document.getElementById('jobFillPanel');
  assert.equal(panel.hidden, false);
  assert.match(panel.textContent, /Quote #Q-2031 · \$420\.00/);
  w.billJobQuote(601);
  assert.deepEqual(rows(w), ['Drywall patch|labor|1|380', 'Mud, tape, paint|part|1|60']);
  assert.equal(w.document.getElementById('discountAmount').value, '20');
  assert.equal(w.document.getElementById('discountLabel').value, 'Discount (as quoted)');
  assert.equal(w.eval('pendingSourceQuoteId'), 601, 'logInvoice() will mark the quote converted');
  assert.match(panel.textContent, /Billing quote #Q-2031 · \$420\.00/);
  w.undoJobFill();
  assert.equal(w.eval('pendingSourceQuoteId'), null);
  assert.equal(w.document.getElementById('discountAmount').value, '0');
  assert.equal(w.document.getElementById('discountLabel').value, '');
  assert.equal(rows(w).length, 1);

  // A job with a quote AND logged work: the logged lines are the alternative.
  const data2 = JSON.parse(JSON.stringify(DATA));
  data2.th_quotes[0].jobRefId = '107';
  const w2 = await loadPage('?jobRef=107', data2, { labor: 75, mileage: 0.67 });
  const p2 = w2.document.getElementById('jobFillPanel');
  assert.match(p2.textContent, /or build it from what was logged/);
  assert.ok(Array.from(p2.querySelectorAll('[data-fill-key]')).every(b => !b.checked));
  assert.equal(w2.document.getElementById('jobFillAddBtn').disabled, true);
  w.close(); w2.close();
});

test('nothing logged: the panel just asks how long it took (and the rate, when none is remembered), and typing the hours ticks the line; Not now hides it; hand-typed lines are never replaced', async () => {
  const w = await loadPage('?jobRef=200', DATA, null);
  const panel = w.document.getElementById('jobFillPanel');
  assert.equal(panel.hidden, false);
  const box = panel.querySelector('[data-fill-key="labor"]');
  assert.equal(box.checked, false);
  assert.equal(w.document.getElementById('jobFillAddBtn').disabled, true);
  w.document.getElementById('jobFillHours').value = '1.5';
  w.document.getElementById('jobFillRate').value = '80';
  w.jobFillHoursChanged();
  assert.equal(box.checked, true);
  assert.equal(w.document.getElementById('jobFillLaborAmt').textContent, '$120.00');
  assert.equal(w.document.getElementById('jobFillAddBtn').textContent, 'Add 1 line');
  w.addJobFillLines();
  assert.deepEqual(rows(w), ['Labor|labor|1.5|80']);
  w.close();
  const w2 = await loadPage('?jobRef=107', DATA, { labor: 75, mileage: 0.67 });
  w2.document.querySelector('#lineItemsBody .li-price').value = '99';
  w2.addJobFillLines();
  assert.deepEqual(rows(w2)[0], 'Washer leaking||1|99', 'a row with a price typed in stays');
  assert.equal(rows(w2).length, 4);
  w2.undoJobFill();
  w2.dismissJobFill();
  assert.equal(w2.document.getElementById('jobFillPanel').hidden, true);
  w2.close();
});

test('the panel is wired where an invoice meets a job, and reset / Convert to Invoice start it fresh', () => {
  assert.match(INV, /<div class="job-fill" id="jobFillPanel" hidden><\/div>/);
  assert.match(INV, /invoiceJobRefEl\.addEventListener\('change', \(\) => \{ if \(typeof renderJobFillPanel === 'function'\) renderJobFillPanel\(\); \}\);/);
  assert.match(extractFn(INV, 'applyJobRefFromUrl'), /renderJobFillPanel\(\);/);
  assert.match(extractFn(INV, 'resetInvoiceForm'), /jobFillState = null;[\s\S]*renderJobFillPanel\(\);/);
  assert.match(extractFn(INV, 'convertQuoteToInvoice'), /jobFillState = null;/);
});

test('line rows escape their values and take decimal quantities (hours, miles)', () => {
  const fn = extractFn(INV, 'addLineItem');
  assert.match(fn, /class="li-desc" value="\$\{lineItemAttr\(desc\)\}"/);
  assert.match(fn, /class="li-part" value="\$\{lineItemAttr\(part\)\}"/);
  assert.match(fn, /class="li-qty" value="\$\{lineItemAttr\(qty\)\}" min="0" step="any"/);
  const q = extractFn(INV, 'addQuoteLineItem');
  assert.match(q, /class="qli-desc" value="\$\{lineItemAttr\(desc\)\}"/);
  assert.match(q, /step="any"/);
});

test('the tour and help mention it', () => {
  assert.match(TOUR, /<strong>From this job<\/strong>/);
  assert.match(INV, /<strong>From this job<\/strong>/);
});
