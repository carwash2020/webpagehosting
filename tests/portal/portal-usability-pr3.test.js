// Portal usability PR3 (2026-09-17): Home action inbox, next-appointment
// hero, pay-first invoices, contracts in primary IA, unified empty states.
// Markup/JS structure tests -- these pages are auth-gated, so this file
// does not require a live client session.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HOME = fs.readFileSync(repo('portal', 'home.html'), 'utf8');
const DASHBOARD = fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8');
const QUOTES = fs.readFileSync(repo('portal', 'quotes.html'), 'utf8');
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const CONTRACTS = fs.readFileSync(repo('portal', 'contracts.html'), 'utf8');
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
const APP_CSS = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
const SW = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

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
  return { get innerHTML() { return value; }, set innerHTML(v) { value = v; } };
}

function runAttention(summary) {
  const fn = extractFn(HOME, 'renderAttention');
  const moneyFn = extractFn(HOME, 'money');
  const dateFn = extractFn(HOME, 'formatInvoiceDate');
  const el = makeEl();
  const ctx = {
    console,
    document: { getElementById: (id) => (id === 'attentionArea' ? el : null) },
    escapeHtml: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    Intl,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(`${moneyFn}\n${dateFn}\n${fn}\nthis.renderAttention = renderAttention;`, ctx);
  ctx.renderAttention(summary);
  return el.innerHTML;
}

function runPayFirst(invoices) {
  const formatCurrency = DASHBOARD.match(/function formatCurrency\(n\) \{[\s\S]*?\n  \}/)[0];
  const formatDate = DASHBOARD.match(/function formatDate\(d\) \{[\s\S]*?\n  \}/)[0];
  const hideFn = extractFn(DASHBOARD, 'hidePayFirst');
  const fn = extractFn(DASHBOARD, 'renderPayFirst');
  const el = makeEl();
  const ctx = {
    console,
    document: { getElementById: (id) => (id === 'payFirstArea' ? el : { innerHTML: '' }) },
    escapeHtml: (s) => String(s == null ? '' : s),
    Intl,
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(`${formatCurrency}\n${formatDate}\n${hideFn}\n${fn}\nthis.renderPayFirst = renderPayFirst;`, ctx);
  ctx.renderPayFirst(invoices);
  return el.innerHTML;
}

function navOf(html) {
  const nav = html.match(/<nav class="portal-nav"[\s\S]*?<\/nav>/);
  assert.ok(nav, 'expected portal-nav');
  return nav[0];
}

// ---- 1. Needs Your Attention as action inbox ----

test('the action inbox sorts unpaid invoices before contracts, quotes, and requests', () => {
  const html = runAttention({
    invoices: [{ id: 9, paid: false, total: 120, invoice_number: 'INV-9', invoice_date: '2026-09-01' }],
    quotes: [{ id: 3, status: 'pending', total: 80 }],
    requests: [{ id: 4, status: 'submitted', title: 'Leak' }],
    contracts: [{ id: 2, status: 'pending', contract_title: 'Service agreement' }],
    // 2026-09-22: Reply now appears only for a real unread message from
    // Triple H (get_portal_unread_counts), not for every open request.
    unread: [{ thread_type: 'work_order', thread_id: 4, unread_count: 1, latest_unread_at: '2026-09-20T10:00:00Z' }],
  });
  const payAt = html.indexOf('>Pay<');
  const signAt = html.indexOf('>Sign<');
  const approveAt = html.indexOf('>Approve<');
  const replyAt = html.indexOf('>Reply<');
  assert.ok(payAt >= 0 && signAt > payAt && approveAt > signAt && replyAt > approveAt,
    'expected Pay, then Sign, then Approve, then Reply');
});

test('inbox Pay / Approve / Sign / Reply use existing page links, not new APIs', () => {
  const html = runAttention({
    invoices: [{ id: 9, paid: false, total: 50, invoice_number: 'INV-9', invoice_date: '2026-09-01' }],
    quotes: [{ id: 3, status: 'pending', total: 80 }],
    requests: [{ id: 4, status: 'submitted', title: 'Leak' }],
    contracts: [{ id: 2, status: 'pending', contract_title: 'Service agreement' }],
    // 2026-09-22: Reply now appears only for a real unread message from
    // Triple H (get_portal_unread_counts), not for every open request.
    unread: [{ thread_type: 'work_order', thread_id: 4, unread_count: 1, latest_unread_at: '2026-09-20T10:00:00Z' }],
  });
  assert.match(html, /href="\/portal\/dashboard\.html#invoice-card-9"/);
  assert.match(html, /href="\/portal\/quotes\.html#quote-card-3"/);
  assert.match(html, /href="\/portal\/contracts\.html#contract-card-2"/);
  assert.match(html, /href="\/portal\/work-orders\.html#wo-card-4"/);
  assert.doesNotMatch(HOME, /functions\/v1\//);
});

test('scheduled visits are not duplicated as inbox rows', () => {
  const html = runAttention({
    invoices: [],
    quotes: [],
    requests: [{ id: 1, status: 'scheduled', scheduled_at: '2026-09-20T10:00:00Z', title: 'Visit' }],
    contracts: [],
  });
  assert.equal(html, '');
});

test('inbox cards are real action items, not a single text row', () => {
  const html = runAttention({
    invoices: [{ id: 1, paid: false, total: 40, invoice_number: 'INV-1', invoice_date: '2026-09-02' }],
    quotes: [],
    requests: [],
    contracts: [],
  });
  assert.match(html, /class="attention-item is-pay"/);
  assert.match(html, /class="attention-item-action"/);
  assert.match(html, /Needs Your Attention/);
  assert.match(html, /\$40\.00/);
});

// ---- 2. Next appointment hero ----

test('the next-appointment hero is the largest Home surface and includes Call/Text', () => {
  const bannerFn = extractFn(HOME, 'renderNextAppointmentBanner');
  assert.match(HOME, /\.next-appt-hero \{/);
  assert.match(HOME, /font-size: 22px/);
  assert.match(bannerFn, /tel:\+14354141667/);
  assert.match(bannerFn, /sms:\+14354141667/);
  assert.match(bannerFn, /What/);
  assert.match(bannerFn, /Where/);
  const heroPad = HOME.match(/\.next-appt-hero \{[^}]*padding: (\d+)px/);
  const cardPad = HOME.match(/\.home-card \{[^}]*padding: (\d+)px/);
  assert.ok(heroPad && cardPad, 'expected padding on hero and home cards');
  assert.ok(Number(heroPad[1]) > Number(cardPad[1]), 'hero padding should exceed a home card');
});

test('#nextAppointmentArea sits above the action inbox in the page', () => {
  assert.ok(HOME.indexOf('id="nextAppointmentArea"') < HOME.indexOf('id="attentionArea"'));
});

// ---- 3. Pay-first invoices ----

test('#payFirstArea is above the analytics ring and history chart in the dashboard markup', () => {
  const payAt = DASHBOARD.indexOf('id="payFirstArea"');
  const ringAt = DASHBOARD.indexOf('id="invoiceSummary"');
  const chartAt = DASHBOARD.indexOf('id="invoiceChartCard"');
  assert.ok(payAt >= 0 && ringAt > payAt && chartAt > ringAt);
});

test('pay-first shows amount, invoice-date context, and the existing pay handlers', () => {
  const one = runPayFirst([{ id: 4, paid: false, total: 85, invoice_number: 'INV-4', invoice_date: '2026-09-10' }]);
  assert.match(one, /\$85\.00/);
  assert.match(one, /Invoiced/);
  assert.match(one, /startPayment\(4\)/);
  assert.doesNotMatch(one, /startBulkPayment/);

  const many = runPayFirst([
    { id: 1, paid: false, total: 10, invoice_number: 'INV-1', invoice_date: '2026-08-01' },
    { id: 2, paid: false, total: 20, invoice_number: 'INV-2', invoice_date: '2026-09-01' },
  ]);
  assert.match(many, /\$30\.00/);
  assert.match(many, /startBulkPayment\(\[1,2\]\)/);
  assert.match(many, /oldest invoiced/);
});

test('pay-first hides when every invoice is paid, and does not invent a due_date column', () => {
  assert.equal(runPayFirst([{ id: 1, paid: true, total: 50, invoice_date: '2026-09-01' }]), '');
  assert.doesNotMatch(extractFn(DASHBOARD, 'renderPayFirst'), /\.due_date\b/);
  assert.match(DASHBOARD, /function renderPayFirst\(invoices\)/);
  const renderFn = extractFn(DASHBOARD, 'renderInvoices');
  const payAt = renderFn.indexOf('renderPayFirst(invoices)');
  const ringAt = renderFn.indexOf('renderInvoiceSummary(invoices)');
  const chartAt = renderFn.indexOf('renderInvoiceChart(invoices)');
  assert.ok(payAt >= 0 && ringAt > payAt && chartAt > ringAt);
});

// ---- 4. Contracts in primary IA ----

test('contracts is a Home account card, not a footer-only link, and still not a 6th tab', () => {
  assert.match(HOME, /href: '\/portal\/contracts\.html'/);
  assert.doesNotMatch(HOME, /View your contracts/);
  for (const [name, html] of Object.entries({
    home: HOME, dashboard: DASHBOARD, quotes: QUOTES, jobs: JOBS,
    contracts: CONTRACTS, 'work-orders': WORK_ORDERS, settings: SETTINGS,
  })) {
    const links = navOf(html).match(/<a href=/g) || [];
    assert.equal(links.length, 5, `${name}: expected exactly 5 tabs`);
    assert.doesNotMatch(navOf(html), /contracts\.html/, `${name}: contracts must stay out of the 5-tab bar`);
  }
  assert.doesNotMatch(navOf(SETTINGS), /is-active/, 'Settings stays out of the bar');
  assert.match(APP_CSS, /grid-template-columns: repeat\(5, 1fr\)/);
});

test('deep-link ids exist on invoice, quote, contract, and work-order cards', () => {
  assert.match(DASHBOARD, /id="invoice-card-\$\{inv\.id\}"/);
  assert.match(QUOTES, /id="quote-card-\$\{q\.id\}"/);
  assert.match(CONTRACTS, /id="contract-card-\$\{c\.id\}"/);
  assert.match(WORK_ORDERS, /id="wo-card-\$\{wo\.id\}"/);
});

// ---- 5. Unified empty / error / first-run states ----

test('invoice empty and error states match quotes/jobs: icon variants, not the same gray blob', () => {
  assert.match(DASHBOARD, /empty-state is-error/);
  assert.match(DASHBOARD, /empty-state is-neutral/);
  assert.match(DASHBOARD, /No invoices on file yet/);
  assert.match(DASHBOARD, /Couldn't load your invoices/);
  assert.match(DASHBOARD, /empty-state-cta">Request Work/);
});

test('quotes and jobs empty states keep their nav icons and add a Request Work CTA', () => {
  assert.match(QUOTES, /empty-state-cta">Request Work/);
  assert.match(JOBS, /empty-state-cta">Request Work/);
  assert.match(QUOTES, /When we send you an estimate/);
  assert.match(JOBS, /Finished work and warranties/);
});

test('contracts empty state is neutral with an icon, and does not invent a create-contract CTA', () => {
  assert.match(CONTRACTS, /empty-state is-neutral/);
  assert.match(CONTRACTS, /No contracts on file yet/);
  assert.doesNotMatch(CONTRACTS, /empty-state-cta">Request Work/);
});

test('the portal service worker cache is at or above v89 for this pass', () => {
  const versionMatch = SW.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 89, `expected v89 or later, got v${versionMatch[1]}`);
});
