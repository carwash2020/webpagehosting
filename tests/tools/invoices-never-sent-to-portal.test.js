// "Never sent to portal" badge on the Invoices list (corrections pack,
// 2026-11-01): a clear indicator for an invoice with no row at all in
// client_portal_invoices, so nobody assumes a client has seen it online
// just because it's in the log. Source-inspection style.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');

function extractFn(name) {
  const start = HTML.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = HTML.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === '{') depth++;
    else if (HTML[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HTML.slice(start, i);
}

test('invoicePortalBadge() flags an invoice with no client_portal_invoices row, and stays silent until the fetch resolves', () => {
  const fn = extractFn('invoicePortalBadge');
  assert.match(fn, /if \(!portalInvoiceStatusKnown\) return '';/);
  assert.match(fn, /if \(portalInvoiceInfoBySourceId\[inv\.id\]\) return '';/);
  assert.match(fn, /Never sent to portal/);
  assert.match(fn, /th-pill is-muted/);
});

test('invoiceRowHtml() renders the badge', () => {
  const fn = extractFn('invoiceRowHtml');
  assert.match(fn, /invoicePortalBadge\(inv\)/);
});

test('refreshPortalInvoiceStatuses() reads the real internal_read_client_portal_invoices RPC (same pattern as refreshPortalQuoteStatuses), and only marks status known on success', () => {
  const fn = extractFn('refreshPortalInvoiceStatuses');
  assert.match(fn, /rest\/v1\/rpc\/internal_read_client_portal_invoices\?select=id,source_invoice_id/);
  assert.match(fn, /if \(!res\.ok\) return;/);
  assert.match(fn, /portalInvoiceStatusKnown = true;/);
  assert.match(fn, /renderInvoiceLog\(\);/);
});

test('the Invoices tab, pull-to-refresh, and realtime sync all keep the portal-invoice cache fresh', () => {
  assert.match(HTML, /tab === 'recent' && typeof refreshPortalInvoiceStatuses === 'function'\) refreshPortalInvoiceStatuses\(\);/);
  assert.match(HTML, /recentPanel\.classList\.contains\('is-active'\) && typeof refreshPortalInvoiceStatuses === 'function'\) refreshPortalInvoiceStatuses\(\);/);
  const pullToRefresh = HTML.match(/setupPullToRefresh\(\(\) => \{ if \(typeof canManageInvoices[^}]*\}\);/)[0];
  assert.match(pullToRefresh, /refreshPortalInvoiceStatuses/);
  const realtimeLine = HTML.match(/startRealtimeSync\(\(\) => \{ if \(typeof canManageInvoices[^}]*\}, updateRealtimeBadge\);/)[0];
  assert.match(realtimeLine, /refreshPortalInvoiceStatuses/);
});
