// A real invoice-history bar chart on the dashboard (2026-09-07),
// following the dataviz skill's procedure end to end: bar chosen over
// line/area since invoice data is discrete and sporadic, not
// continuous; colors reuse the exact same paid/unpaid status pair
// every invoice card and the ring above already use (validated via
// the skill's own palette validator against the dark surface, not
// eyeballed); a bar's click/Enter target scrolls to and highlights
// its matching card below rather than duplicating its values in a
// hover-only tooltip, since every value a bar shows already lives on
// that real card.

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
  const attrs = {};
  const el = {
    style: {}, _html: '',
    classList: {
      list: new Set(),
      add(c) { this.list.add(c); }, remove(c) { this.list.delete(c); }, contains(c) { return this.list.has(c); },
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name]; },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; this._html = String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    get textContent() { return this._text; },
    scrollIntoView() { this.scrolledIntoView = true; },
    get offsetWidth() { return 100; },
  };
  return el;
}

function makeChartSandbox(prebuiltCardIds = []) {
  const els = {
    invoiceChartCard: makeEl(),
    invoiceChartSvg: makeEl(),
  };
  for (const id of prebuiltCardIds) {
    els['invoice-card-' + id] = makeEl();
  }
  const sandbox = {
    document: {
      getElementById: (id) => els[id],
      createElement: () => makeEl(),
    },
  };
  vm.createContext(sandbox);
  const niceMaxFn = extractFn(DASHBOARD, 'niceChartMax');
  const renderFn = extractFn(DASHBOARD, 'renderInvoiceChart');
  const highlightFn = extractFn(DASHBOARD, 'highlightInvoiceCard');
  const escapeHtmlFn = extractFn(DASHBOARD, 'escapeHtml');
  const formatCurrencyFn = extractFn(DASHBOARD, 'formatCurrency');
  vm.runInContext(`
    const CHART_BAR_WIDTH = 22;
    const CHART_COLUMN_WIDTH = 46;
    const CHART_BAR_MAX_HEIGHT = 90;
    const CHART_HEIGHT = 148;
    const CHART_BASELINE_Y = 118;
    ${formatCurrencyFn}
    ${escapeHtmlFn}
    ${niceMaxFn}
    ${renderFn}
    ${highlightFn}
  `, sandbox);
  return { sandbox, els };
}

test('niceChartMax rounds up to a clean half-magnitude step, never clipping the tallest bar', () => {
  const { sandbox } = makeChartSandbox();
  assert.equal(sandbox.niceChartMax(0), 1);
  assert.equal(sandbox.niceChartMax(-5), 1);
  assert.equal(sandbox.niceChartMax(42), 45);
  assert.equal(sandbox.niceChartMax(50), 50);
  assert.equal(sandbox.niceChartMax(51), 55);
  assert.equal(sandbox.niceChartMax(340), 350);
});

test('the chart is hidden entirely below 2 invoices, where a trend reads as noise rather than a story', () => {
  const { sandbox, els } = makeChartSandbox(['a']);
  sandbox.renderInvoiceChart([{ id: 'a', total: 100, paid: true, invoice_date: '2026-01-01', invoice_number: 'INV-1' }]);
  assert.equal(els.invoiceChartCard.style.display, 'none');
});

test('with 2+ invoices the chart renders one bar per invoice, oldest to newest, and shows the card', () => {
  const { sandbox, els } = makeChartSandbox(['a', 'b']);
  sandbox.renderInvoiceChart([
    { id: 'b', total: 200, paid: false, invoice_date: '2026-02-01', invoice_number: 'INV-2' },
    { id: 'a', total: 100, paid: true, invoice_date: '2026-01-01', invoice_number: 'INV-1' },
  ]);
  assert.equal(els.invoiceChartCard.style.display, '');
  const svgHtml = els.invoiceChartSvg.innerHTML;
  const firstBarIdx = svgHtml.indexOf('INV-1');
  const secondBarIdx = svgHtml.indexOf('INV-2');
  assert.ok(firstBarIdx >= 0 && secondBarIdx > firstBarIdx, 'expected INV-1 (older) to render before INV-2 (newer)');
});

test('bar color reuses the exact same paid/unpaid status colors as the invoice cards and summary ring, not new ones', () => {
  const { sandbox, els } = makeChartSandbox(['a', 'b']);
  sandbox.renderInvoiceChart([
    { id: 'a', total: 100, paid: true, invoice_date: '2026-01-01', invoice_number: 'INV-1' },
    { id: 'b', total: 200, paid: false, invoice_date: '2026-02-01', invoice_number: 'INV-2' },
  ]);
  assert.match(DASHBOARD, /\.invoice-summary-dot\.is-paid \{ background: #4caf78; \}/);
  assert.match(DASHBOARD, /\.invoice-summary-dot\.is-outstanding \{ background: #ffa726; \}/);
  const svgHtml = els.invoiceChartSvg.innerHTML;
  assert.match(svgHtml, /fill="#4caf78"/);
  assert.match(svgHtml, /fill="#ffa726"/);
});

test('a taller amount produces a taller bar, scaled against the shared chart max', () => {
  const { sandbox, els } = makeChartSandbox(['a', 'b']);
  sandbox.renderInvoiceChart([
    { id: 'a', total: 50, paid: true, invoice_date: '2026-01-01', invoice_number: 'INV-1' },
    { id: 'b', total: 100, paid: true, invoice_date: '2026-02-01', invoice_number: 'INV-2' },
  ]);
  const heights = [...els.invoiceChartSvg.innerHTML.matchAll(/class="invoice-chart-bar" x="[\d.]+" y="[\d.]+" width="22" height="([\d.]+)"/g)].map(m => Number(m[1]));
  assert.equal(heights.length, 2);
  assert.ok(heights[1] > heights[0], `expected the $100 bar (${heights[1]}) taller than the $50 bar (${heights[0]})`);
});

test('each bar is a real click/keyboard target labeled with its own invoice number, amount, status, and date', () => {
  const { sandbox, els } = makeChartSandbox(['a']);
  sandbox.renderInvoiceChart([
    { id: 'a', total: 75, paid: false, invoice_date: '2026-03-05', invoice_number: 'INV-9' },
    { id: 'a2', total: 80, paid: true, invoice_date: '2026-04-01', invoice_number: 'INV-10' },
  ]);
  const svgHtml = els.invoiceChartSvg.innerHTML;
  assert.match(svgHtml, /role="button"/);
  assert.match(svgHtml, /tabindex="0"/);
  assert.match(svgHtml, /aria-label="INV-9, \$75\.00, Unpaid, 3\/5"/);
  assert.match(svgHtml, /onclick="highlightInvoiceCard\(a\)"/);
  assert.match(svgHtml, /onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)\{event\.preventDefault\(\);highlightInvoiceCard\(a\)/);
});

test('clicking a bar scrolls to and (re-)highlights its matching real invoice card, not a duplicate tooltip', () => {
  const { sandbox, els } = makeChartSandbox(['a']);
  els['invoice-card-a'].classList.add('is-highlighted');
  sandbox.highlightInvoiceCard('a');
  assert.ok(els['invoice-card-a'].scrolledIntoView);
  assert.ok(els['invoice-card-a'].classList.contains('is-highlighted'), 'should still be highlighted (removed then re-added to restart the animation)');
});

test('highlighting a missing invoice id is a no-op, not a crash', () => {
  const { sandbox } = makeChartSandbox([]);
  assert.doesNotThrow(() => sandbox.highlightInvoiceCard('does-not-exist'));
});

test('every invoice card now carries a stable id the chart can scroll to', () => {
  assert.match(DASHBOARD, /<div class="invoice-card" id="invoice-card-\$\{inv\.id\}">/);
});

test('the empty-invoices state also hides the chart card, not just the summary', () => {
  const emptyBlock = DASHBOARD.slice(DASHBOARD.indexOf('if (!invoices.length) {'), DASHBOARD.indexOf('renderInvoiceSummary(invoices);'));
  assert.match(emptyBlock, /document\.getElementById\('invoiceChartCard'\)\.style\.display = 'none';/);
});

test('the chart is wired into renderInvoices right after the summary, driven off the same invoices array', () => {
  const renderFn = extractFn(DASHBOARD, 'renderInvoices');
  const summaryIdx = renderFn.indexOf('renderInvoiceSummary(invoices);');
  const chartIdx = renderFn.indexOf('renderInvoiceChart(invoices);');
  assert.ok(summaryIdx >= 0 && chartIdx > summaryIdx, 'expected renderInvoiceChart to be called right after renderInvoiceSummary');
});

test('marks follow the dataviz mark spec: bars are <=24px thick with a 4px rounded data-end, and labels never wear the data color', () => {
  assert.match(DASHBOARD, /CHART_BAR_WIDTH = 22;/);
  assert.match(DASHBOARD, /class="invoice-chart-bar" x="\$\{x\}" y="\$\{y\}" width="\$\{CHART_BAR_WIDTH\}" height="\$\{Math\.max\(barHeight, 2\)\}" rx="4"/);
  assert.match(DASHBOARD, /\.invoice-chart-value \{ [^}]*fill: var\(--text\);/, 'value labels should use a text token, not the bar color');
  assert.match(DASHBOARD, /\.invoice-chart-date \{ [^}]*fill: var\(--text-dim\);/, 'date labels should use a text token, not the bar color');
});

test('a legend is present since the chart plots two series (paid vs unpaid)', () => {
  assert.match(DASHBOARD, /<div class="invoice-chart-legend">\s*<span><span class="invoice-summary-dot is-paid"><\/span>Paid<\/span>\s*<span><span class="invoice-summary-dot is-outstanding"><\/span>Unpaid<\/span>\s*<\/div>/);
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 35, `expected v35 or later, got v${versionMatch[1]}`);
});
