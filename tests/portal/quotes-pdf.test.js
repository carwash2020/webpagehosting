// Tests for the "Download PDF" feature added to portal/quotes.html
// (2026-09-16) -- closes the "no standalone quote PDF" gap noted in
// docs/CLIENT-PORTAL.md. Source inspection, not a full jsdom
// execution -- downloadQuotePDF() depends on jsPDF loaded from a real
// CDN, which isn't practical to simulate end-to-end in this test
// environment, same reasoning as tests/portal/dashboard-invoice-pdf.test.js
// for the invoice PDF this mirrors.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'portal', 'quotes.html');
const html = fs.readFileSync(PAGE_PATH, 'utf8');

test('jsPDF is loaded from the same CDN version/integrity as portal/dashboard.html', () => {
  const dashboardHtml = fs.readFileSync(
    path.join(__dirname, '..', '..', 'portal', 'dashboard.html'),
    'utf8'
  );
  const dashboardMatch = dashboardHtml.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@[^"]+)" integrity="([^"]+)"/);
  assert.ok(dashboardMatch, 'expected to find the jsPDF script tag in portal/dashboard.html to compare against');

  const quotesMatch = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@[^"]+)" integrity="([^"]+)"/);
  assert.ok(quotesMatch, 'expected portal/quotes.html to load jsPDF via the same CDN pattern');
  assert.equal(quotesMatch[1], dashboardMatch[1], 'jsPDF CDN URL/version should match the invoice PDF exactly');
  assert.equal(quotesMatch[2], dashboardMatch[2], 'jsPDF integrity hash should match the invoice PDF exactly');
});

test('downloadQuotePDF is defined and wired to a real button on every quote card', () => {
  assert.match(html, /async function downloadQuotePDF\(quoteId\)/);
  assert.match(html, /onclick="downloadQuotePDF\(\$\{q\.id\}\)"/);
});

test('downloadQuotePDF looks the quote up from the same list rendered on screen, not a fresh query', () => {
  // currentQuotes is populated once in renderQuotes() from the exact
  // query already scoped by RLS to the signed-in client's own rows,
  // then reused by downloadQuotePDF -- same RLS-boundary discipline
  // documented in docs/CLIENT-PORTAL.md.
  assert.match(html, /let currentQuotes = \[\];/);
  assert.match(html, /currentQuotes = quotes;/);
  assert.match(html, /const q = currentQuotes\.find\(x => x\.id === quoteId\);/);
});

test('the PDF only reads fields that actually exist on client_portal_quotes', () => {
  // Guards against reaching for a field this table never stores --
  // see sql/portal/create_client_portal_quotes_and_questions.sql for
  // the real schema (no per-unit price/taxable/discount/terms columns,
  // same boundary the invoice PDF test enforces for its own table).
  const fnMatch = html.match(/async function downloadQuotePDF\(quoteId\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'expected to isolate the downloadQuotePDF function body');
  const fnBody = fnMatch[0];

  const realFields = ['id', 'quote_number', 'quote_date', 'status', 'client_name', 'client_email', 'description', 'line_items', 'total'];
  const fieldRefs = [...fnBody.matchAll(/q\.([a-zA-Z_]+)/g)].map(m => m[1]);
  for (const field of fieldRefs) {
    assert.ok(realFields.includes(field), `downloadQuotePDF references q.${field}, which isn't a real client_portal_quotes column`);
  }
});

test('the generated PDF is always labeled QUOTE, and shows the real approve/decline status', () => {
  assert.match(html, /drawPdfHeader\(doc, pageW, 'QUOTE',/);
  assert.match(html, /const statusText = q\.status === 'approved' \? 'APPROVED' : q\.status === 'declined' \? 'DECLINED' : 'PENDING';/);
});

test('the total is labeled ESTIMATED, not billed, matching a quote rather than an invoice', () => {
  assert.match(html, /total: \{ label: 'ESTIMATED TOTAL', value: pdfMoney\(q\.total\) \}/);
});

test('the saved filename is based on the real quote number', () => {
  assert.match(html, /doc\.save\('Quote-' \+ q\.quote_number \+ '\.pdf'\);/);
});

test('portal/quotes.html still loads none of the internal /tools/ scripts', () => {
  // The one boundary this whole page exists to preserve -- confirming
  // it holds after adding a new feature, not just at initial build.
  for (const forbidden of ['auth.js', 'sync.js', 'data-layer.js', 'tools-nav-pwa.js']) {
    assert.ok(!html.includes(forbidden), `portal/quotes.html should never load /tools/${forbidden}`);
  }
});
