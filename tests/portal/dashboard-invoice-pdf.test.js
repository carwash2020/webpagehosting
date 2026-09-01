// Tests for the "Download PDF" feature added to portal/dashboard.html
// (2026-09-01). Source inspection, not a full jsdom execution --
// downloadInvoicePDF() depends on jsPDF loaded from a real CDN, which
// isn't practical to simulate end-to-end in this test environment, and
// CONTRIBUTING.md's own guidance for exactly this case is to confirm
// the real call site via source inspection instead. This is the first
// test file for anything under /portal/, so it also pins down the
// isolation rule documented in docs/CLIENT-PORTAL.md: no /tools/
// script is ever loaded here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'portal', 'dashboard.html');
const html = fs.readFileSync(PAGE_PATH, 'utf8');

test('jsPDF is loaded from the same CDN version/integrity as tools/invoice-generator.html', () => {
  const generatorHtml = fs.readFileSync(
    path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'),
    'utf8'
  );
  const generatorMatch = generatorHtml.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@[^"]+)" integrity="([^"]+)"/);
  assert.ok(generatorMatch, 'expected to find the jsPDF script tag in tools/invoice-generator.html to compare against');

  const dashboardMatch = html.match(/<script src="(https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@[^"]+)" integrity="([^"]+)"/);
  assert.ok(dashboardMatch, 'expected portal/dashboard.html to load jsPDF via the same CDN pattern');
  assert.equal(dashboardMatch[1], generatorMatch[1], 'jsPDF CDN URL/version should match the internal tool exactly');
  assert.equal(dashboardMatch[2], generatorMatch[2], 'jsPDF integrity hash should match the internal tool exactly');
});

test('downloadInvoicePDF is defined and wired to a real button in every invoice card', () => {
  assert.match(html, /async function downloadInvoicePDF\(invoiceId\)/);
  assert.match(html, /onclick="downloadInvoicePDF\(\$\{inv\.id\}\)"/);
});

test('downloadInvoicePDF looks the invoice up from the same list rendered on screen, not a fresh query', () => {
  // currentInvoices is populated once in renderInvoices() from the
  // exact query already scoped by RLS to the signed-in client's own
  // rows, then reused by downloadInvoicePDF -- no second query, no
  // separate trust boundary to keep in sync with the RLS lesson
  // documented in docs/CLIENT-PORTAL.md.
  assert.match(html, /let currentInvoices = \[\];/);
  assert.match(html, /currentInvoices = invoices;/);
  assert.match(html, /const inv = currentInvoices\.find\(i => i\.id === invoiceId\);/);
});

test('the PDF only reads fields that actually exist on client_portal_invoices', () => {
  // Guards against silently reintroducing fields from the internal
  // invoice-generator.html template (per-unit price, taxable flag,
  // discount, payment terms, job address) that this table has never
  // stored -- see sql/portal/create_client_portal_tables.sql for the
  // real schema.
  const fnMatch = html.match(/async function downloadInvoicePDF\(invoiceId\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate the downloadInvoicePDF function body');
  const fnBody = fnMatch[0];

  const realFields = ['invoice_number', 'invoice_date', 'paid', 'client_name', 'client_email', 'description', 'line_items', 'total', 'paid_at'];
  const fieldRefs = [...fnBody.matchAll(/inv\.([a-zA-Z_]+)/g)].map(m => m[1]);
  for (const field of fieldRefs) {
    assert.ok(realFields.includes(field), `downloadInvoicePDF references inv.${field}, which isn't a real client_portal_invoices column`);
  }
});

test('portal/dashboard.html still loads none of the internal /tools/ scripts', () => {
  // The one boundary this whole page exists to preserve -- confirming
  // it holds after adding a new feature, not just at initial build.
  for (const forbidden of ['auth.js', 'sync.js', 'data-layer.js', 'tools-nav-pwa.js']) {
    assert.ok(!html.includes(forbidden), `portal/dashboard.html should never load /tools/${forbidden}`);
  }
});
