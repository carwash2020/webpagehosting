// Service history PDF (2026-09-22), part of "Do them all": every job
// Triple H has done for a client, with dates, invoices and what was
// done, as one PDF -- the record a homeowner hands over when they sell
// the house or file an insurance claim. Built client-side with the
// same pinned jsPDF the Invoices and Quotes PDFs already use, from rows
// the client can already see.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const DASHBOARD = fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8');

// Skips past the parameter list before looking for the body's brace --
// buildServiceHistory takes a destructured object, so the first "{"
// after the name is in its parameters, not its body.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  let p = src.indexOf('(', start), parens = 0;
  for (; p < src.length; p++) {
    if (src[p] === '(') parens++;
    else if (src[p] === ')') { parens--; if (parens === 0) break; }
  }
  const braceStart = src.indexOf('{', p);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const isAsync = src.slice(Math.max(0, start - 6), start) === 'async ';
  return (isAsync ? 'async ' : '') + src.slice(start, i);
}

function ctx() {
  const c = { Intl, Date, Math, Number, String, Array };
  vm.createContext(c);
  vm.runInContext(['historyMoney', 'historyDate', 'buildServiceHistory', 'drawServiceHistoryPdf'].map((n) => extractFn(JOBS, n)).join('\n') +
    '\nthis.build = buildServiceHistory; this.draw = drawServiceHistoryPdf;', c);
  return c;
}

const EMAIL = 'jane@example.com';
const NOW = new Date(2026, 8, 22, 12).getTime();
const jobs = [
  { id: 1, client_email: EMAIL, title: 'Dryer vent cleaning', job_date: '2025-11-03', linked_invoice_number: null },
  { id: 2, client_email: EMAIL, title: 'Water heater flush', job_date: '2026-09-17', linked_invoice_number: 'INV-2' },
  { id: 3, client_email: EMAIL, title: 'Kitchen faucet', job_date: '2026-06-14', linked_invoice_number: 'INV-3' },
  { id: 9, client_email: 'someone.else@example.com', title: 'NOT YOURS', job_date: '2026-08-01', linked_invoice_number: 'INV-9' },
];
const invoices = [
  { client_email: EMAIL, invoice_number: 'INV-2', total: 285, paid: false, description: 'Flush and inspect 50-gal water heater', line_items: [{ desc: 'Drain valve', qty: 1, amount: 100 }] },
  { client_email: EMAIL, invoice_number: 'INV-3', total: 412.5, paid: true, description: 'Kitchen faucet', line_items: [{ desc: 'Braided supply line', qty: 2, amount: 23.5 }, { desc: '  ', qty: 1, amount: 0 }] },
  { client_email: 'someone.else@example.com', invoice_number: 'INV-9', total: 999, paid: true, description: 'x', line_items: [] },
];
const checkups = [{ client_email: EMAIL, title: 'Annual water heater check-up', interval_months: 12, last_created_date: '2025-09-01' }];

// ---- the data behind the PDF ----

test('only the signed-in client\'s own jobs and invoices, newest first -- never another client\'s rows', () => {
  const m = ctx().build({ jobs, invoices, checkups, email: EMAIL, name: 'Jane', address: '1 Main St', now: NOW });
  assert.deepEqual(Array.from(m.rows, (r) => r.title), ['Water heater flush', 'Kitchen faucet', 'Dryer vent cleaning']);
  assert.ok(!JSON.stringify(m).includes('NOT YOURS'));
  assert.equal(m.total, 697.5, 'the other client\'s $999 must not count');
});

test('each job carries its invoice number, amount and paid state; a job without one shows none', () => {
  const m = ctx().build({ jobs, invoices, checkups, email: EMAIL, now: NOW });
  const [flush, faucet, vent] = m.rows;
  assert.equal(flush.invoice, 'INV-2'); assert.equal(flush.amount, 285); assert.equal(flush.paid, false);
  assert.equal(faucet.paid, true);
  assert.equal(vent.invoice, ''); assert.equal(vent.amount, null); assert.equal(vent.paid, null);
});

test('what was done: the invoice description when it adds something, then the line items (with quantity), blanks skipped', () => {
  const m = ctx().build({ jobs, invoices, checkups, email: EMAIL, now: NOW });
  assert.deepEqual(Array.from(m.rows[0].details), ['Flush and inspect 50-gal water heater', 'Drain valve']);
  assert.deepEqual(Array.from(m.rows[1].details), ['Braided supply line (x2)'], 'a description that just repeats the title is left out');
});

test('the 30-day labor warranty is noted only while it is still running', () => {
  const m = ctx().build({ jobs, invoices, checkups, email: EMAIL, now: NOW });
  assert.match(m.rows[0].warranty, /^Labor warranty active until Oct 17, 2026$/);
  assert.equal(m.rows[1].warranty, '');
});

test('the summary: jobs since the first one, the plan\'s check-ups in plain words', () => {
  const m = ctx().build({ jobs, invoices, checkups, email: EMAIL, name: 'Jane', address: '1 Main St', now: NOW });
  assert.equal(m.since, 'Nov 2025');
  assert.equal(m.name, 'Jane');
  assert.equal(m.address, '1 Main St');
  assert.deepEqual(JSON.parse(JSON.stringify(m.checkups)), [{ title: 'Annual water heater check-up', every: 'Every year', last: 'Sep 1, 2025' }]);
  const six = ctx().build({ jobs: [], invoices: [], checkups: [{ title: 'Filter', interval_months: 6 }], email: EMAIL, now: NOW });
  assert.equal(six.checkups[0].every, 'Every 6 months');
});

// ---- drawing: a recording stand-in for jsPDF ----

function fakeDoc() {
  const pages = [[]];
  let current = 0;
  const rec = (op) => (...args) => { pages[current].push([op, ...args]); };
  return {
    pages,
    internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 }, getNumberOfPages: () => pages.length },
    addPage() { pages.push([]); current = pages.length - 1; },
    setPage(n) { current = n - 1; },
    splitTextToSize: (t) => [String(t)],
    getTextWidth: (t) => String(t).length * 6,
    text: rec('text'), rect: rec('rect'), line: rec('line'), addImage: rec('image'),
    setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {}, setDrawColor() {}, setLineWidth() {},
  };
}
const texts = (page) => page.filter((c) => c[0] === 'text').map((c) => c[1]);

test('a long history flows onto more pages, each with the running header, the table head and "Page N of M"', () => {
  const c = ctx();
  const many = Array.from({ length: 40 }, (_, k) => ({ client_email: EMAIL, title: 'Visit ' + k, job_date: '2024-01-' + String((k % 28) + 1).padStart(2, '0'), linked_invoice_number: 'I' + k }));
  const invs = many.map((j, k) => ({ client_email: EMAIL, invoice_number: 'I' + k, total: 10, paid: true, description: 'd' + k, line_items: [{ desc: 'Part', qty: 1 }] }));
  const model = c.build({ jobs: many, invoices: invs, checkups: [], email: EMAIL, name: 'Jane', now: NOW });
  const doc = fakeDoc();
  c.draw(doc, model, null);
  assert.ok(doc.pages.length >= 3, `expected several pages, got ${doc.pages.length}`);
  doc.pages.forEach((page, i) => {
    const t = texts(page);
    assert.ok(t.includes('Page ' + (i + 1) + ' of ' + doc.pages.length), `page ${i + 1} footer`);
    assert.ok(t.includes('WORK DONE'), `page ${i + 1} table head`);
    if (i > 0) assert.ok(t.some((x) => /^SERVICE HISTORY · Jane$/.test(x)), `page ${i + 1} running header`);
  });
  const all = [].concat(...doc.pages.map(texts));
  assert.equal(all.filter((x) => /^Visit \d+$/.test(x)).length, 40, 'every job drawn exactly once');
});

test('unpaid is flagged, a missing invoice reads as a dash, and an active warranty is printed', () => {
  const c = ctx();
  const doc = fakeDoc();
  c.draw(doc, c.build({ jobs, invoices, checkups, email: EMAIL, name: 'Jane', now: NOW }), null);
  const t = texts(doc.pages[0]);
  assert.ok(t.includes('UNPAID'));
  assert.ok(t.includes('—'));
  assert.ok(t.includes('Labor warranty active until Oct 17, 2026'));
  assert.ok(t.includes('ONGOING MAINTENANCE'));
  assert.ok(t.includes('Invoiced total $697.50'));
});

// ---- wiring ----

test('the download only appears once there is a job to put in it', () => {
  assert.match(JOBS, /<div class="history-download" id="historyDownload" hidden>/);
  assert.match(extractFn(JOBS, 'renderJobs'), /currentJobs = jobs;\s*document\.getElementById\('historyDownload'\)\.hidden = false;/);
});

test('jsPDF is the same pinned build and integrity hash Invoices already loads', () => {
  const tag = (src) => src.match(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@[^"]+" integrity="[^"]+" crossorigin="anonymous" async><\/script>/);
  assert.ok(tag(JOBS), 'jobs.html loads jsPDF with SRI');
  assert.equal(tag(JOBS)[0], tag(DASHBOARD)[0]);
});

test('every lookup is scoped to the signed-in email with explicit columns -- nothing internal can ride along', () => {
  const fn = extractFn(JOBS, 'downloadServiceHistory');
  for (const table of ['client_portal_invoices', 'client_portal_checkups', 'client_profiles', 'client_portal_work_orders', 'client_portal_quotes']) {
    assert.match(fn, new RegExp(`from\\('${table}'\\)\\.select\\('[^'*]+'\\)\\.eq\\('client_email', email\\)`), table);
  }
  assert.match(fn, /buildServiceHistory\(\{ jobs: currentJobs, invoices: invoiceRows, checkups: checkups\.data \|\| \[\], email, name, address, now: Date\.now\(\) \}\)/);
  assert.match(fn, /doc\.save\('Triple-H-service-history-' \+ new Date\(\)\.toISOString\(\)\.slice\(0, 10\) \+ '\.pdf'\);/);
  assert.match(fn, /finally \{\s*btn\.disabled = false;/);
});
