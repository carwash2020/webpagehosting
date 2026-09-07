// A real-data addition to the client portal's invoice page (2026-09-07):
// a paid-vs-outstanding ring above the invoice list, summed from the
// exact same `invoices` array the existing Outstanding/Paid section
// split already reads -- not a second, separately-computed figure.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const DASHBOARD = fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

function makeEl() {
  let value = '';
  let display = '';
  return {
    get textContent() { return value; },
    set textContent(v) { value = String(v); },
    style: { get display() { return display; }, set display(v) { display = v; } },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
  };
}

function loadRenderInvoiceSummary() {
  const circumferenceLine = DASHBOARD.match(/const INVOICE_SUMMARY_RING_CIRCUMFERENCE = [^;]+;/)[0];
  const fnSrc = extractFn(DASHBOARD, 'renderInvoiceSummary');
  const els = {
    invoiceSummary: makeEl(),
    invoiceSummaryRingFill: makeEl(),
    invoiceSummaryPercent: makeEl(),
    invoiceSummaryPaid: makeEl(),
    invoiceSummaryOutstanding: makeEl(),
  };
  const ctx = {
    console,
    document: { getElementById: (id) => els[id] },
    formatCurrency: (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n),
  };
  vm.createContext(ctx);
  vm.runInContext(`${circumferenceLine}\n${fnSrc}\nthis.renderInvoiceSummary = renderInvoiceSummary;`, ctx);
  return { renderInvoiceSummary: ctx.renderInvoiceSummary, els };
}

test('the paid fraction is real dollars paid over real dollars invoiced, not invented', () => {
  const { renderInvoiceSummary, els } = loadRenderInvoiceSummary();
  renderInvoiceSummary([
    { paid: true, total: 300 },
    { paid: true, total: 200 },
    { paid: false, total: 100 },
  ]);
  assert.equal(els.invoiceSummaryPercent.textContent, '83%'); // 500/600
  assert.equal(els.invoiceSummaryPaid.textContent, '$500.00');
  assert.equal(els.invoiceSummaryOutstanding.textContent, '$100.00');
});

test('the ring geometry matches the displayed percentage', () => {
  const { renderInvoiceSummary, els } = loadRenderInvoiceSummary();
  renderInvoiceSummary([{ paid: true, total: 300 }, { paid: false, total: 100 }]);
  const circumference = 2 * Math.PI * 30;
  const dasharray = Number(els.invoiceSummaryRingFill.getAttribute('stroke-dasharray'));
  const offset = Number(els.invoiceSummaryRingFill.getAttribute('stroke-dashoffset'));
  assert.ok(Math.abs(dasharray - circumference) < 0.01);
  const fraction = 1 - offset / circumference;
  assert.ok(Math.abs(fraction - 0.75) < 0.01, `expected ~0.75 fraction (300/400), got ${fraction}`);
  assert.equal(els.invoiceSummary.style.display, '');
});

test('a client with no invoices at all gets no ring, not a meaningless 0%', () => {
  const { renderInvoiceSummary, els } = loadRenderInvoiceSummary();
  renderInvoiceSummary([]);
  assert.equal(els.invoiceSummary.style.display, 'none');
});

test('the summary hides again when the invoice list reload finds zero invoices', () => {
  assert.match(DASHBOARD, /if \(!invoices\.length\) \{\s*listEl\.innerHTML = `<div class="empty-state">No invoices on file yet\.<\/div>`;\s*document\.getElementById\('invoiceSummary'\)\.style\.display = 'none';/);
});

test('the summary is (re)computed every time invoices are rendered, from the same array the list uses', () => {
  const bodyMatch = DASHBOARD.match(/currentInvoices = invoices;[\s\S]{0,300}?renderInvoiceSummary\(invoices\);/);
  assert.ok(bodyMatch, 'expected renderInvoiceSummary(invoices) to be called with the same invoices array used elsewhere in this render');
});

test('the ring uses the same paid/outstanding colors already established by the invoice-status pills on this page', () => {
  assert.match(DASHBOARD, /\.invoice-status\.is-paid \{ background: rgba\(76,175,120,0\.15\); color: #4caf78; \}/);
  assert.match(DASHBOARD, /\.invoice-summary-ring-fill \{ stroke: #4caf78;/);
  assert.match(DASHBOARD, /\.invoice-status\.is-unpaid \{ background: rgba\(255,167,38,0\.15\); color: #ffa726; \}/);
  assert.match(DASHBOARD, /\.invoice-summary-dot\.is-outstanding \{ background: #ffa726; \}/);
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 21, `expected v21 or later, got v${versionMatch[1]}`);
});
