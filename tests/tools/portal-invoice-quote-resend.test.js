// Fixed 2026-09-22, found while looking for a next safe improvement to
// the client portal: tools/clients.html's "Resend" button on a portal
// invoice always reported "Sent!" even when it sent nothing at all.
//
// Root cause: resendPortalInvoice() called sync-invoice-to-portal,
// whose own send-invoice-notification trigger is gated on
// isNewInvoice (source_invoice_id not already in client_portal_invoices)
// -- deliberately, so re-saving an existing invoice's line items
// doesn't spam a duplicate email. But resending an ALREADY-synced
// invoice is exactly the case where isNewInvoice is always false, so
// the button silently upserted (a no-op) and sent no email, while its
// UI only checked the upsert's own `ok`, never whether an email
// actually went out. Quotes had no equivalent panel or resend
// mechanism at all.
//
// Fixed by calling send-invoice-notification / send-quote-notification
// directly -- the row is already synced, so a resend needs nothing
// from the sync function's upsert-then-maybe-notify logic, just the
// notification itself -- and by reading that function's real response
// (ok+skipped means the client opted out in Settings, not a failure,
// but also not silently reported as "Sent!").

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CLIENTS = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'clients.html'), 'utf8');
const DEV_SHARED = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools-shared.js'), 'utf8');
const SEND_INVOICE_NOTIF = fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'send-invoice-notification-index.ts'), 'utf8');
const SEND_QUOTE_NOTIF = fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'send-quote-notification-index.ts'), 'utf8');

function isolateFn(src, name) {
  const m = src.match(new RegExp('async function ' + name + '\\([\\s\\S]*?\\n  \\}\\n'));
  assert.ok(m, 'expected to isolate ' + name + '()');
  return m[0];
}

test('resendPortalInvoice calls send-invoice-notification directly, not sync-invoice-to-portal', () => {
  const fn = isolateFn(CLIENTS, 'resendPortalInvoice');
  assert.match(fn, /\/functions\/v1\/send-invoice-notification/);
  assert.doesNotMatch(fn, /\/functions\/v1\/sync-invoice-to-portal/);
});

test('resendPortalInvoice distinguishes a real send from an opted-out skip, not just result.ok', () => {
  const fn = isolateFn(CLIENTS, 'resendPortalInvoice');
  assert.match(fn, /result\.ok && result\.skipped/);
  assert.match(fn, /Opted out/);
  assert.match(fn, /turned off invoice\/quote emails/i);
});

test('resendPortalQuote exists and calls send-quote-notification directly', () => {
  const fn = isolateFn(CLIENTS, 'resendPortalQuote');
  assert.match(fn, /\/functions\/v1\/send-quote-notification/);
  assert.doesNotMatch(fn, /\/functions\/v1\/sync-quote-to-portal/);
  assert.match(fn, /result\.ok && result\.skipped/);
});

test('a Portal quotes panel exists, mirroring Portal invoices (search + list + info bubble)', () => {
  assert.match(CLIENTS, /<h2>Portal quotes<\/h2>/);
  assert.match(CLIENTS, /id="portalQuoteSearch"[^>]*oninput="renderPortalQuotes\(\)"/);
  assert.match(CLIENTS, /<div id="portalQuotes"><\/div>/);
  assert.match(CLIENTS, /onclick="openDevInfo\('portalquotes'\)"/);
});

test('renderPortalQuotes() fetches client_portal_quotes and renders a Resend button per row', () => {
  const fn = isolateFn(CLIENTS, 'renderPortalQuotes');
  assert.match(fn, /client_portal_quotes\?select=/);
  assert.match(fn, /resendPortalQuote\(/);
});

test('renderPortalQuotes() is called on page init alongside renderPortalInvoices()', () => {
  assert.match(CLIENTS, /renderPortalInvoices\(\);\s*\n\s*renderPortalQuotes\(\);/);
});

test('DEV_INFO has a portalquotes entry so the info bubble has something to show', () => {
  assert.match(DEV_SHARED, /portalquotes:\s*\{\s*\n\s*title: 'Portal quotes'/);
});

// ---- Confirms the root cause, not just the fix ----

test('send-invoice-notification (the function now called directly) gates on the real notification preference, not invoice novelty', () => {
  assert.match(SEND_INVOICE_NOTIF, /clientWantsNotification\(client_email, "wants_invoice_quote_emails"\)/);
  assert.match(SEND_INVOICE_NOTIF, /skipped: "client opted out of invoice\/quote emails"/);
});

test('send-quote-notification (the function now called directly) has the same shape', () => {
  assert.match(SEND_QUOTE_NOTIF, /clientWantsNotification\(client_email, "wants_invoice_quote_emails"\)/);
  assert.match(SEND_QUOTE_NOTIF, /skipped: "client opted out of invoice\/quote emails"/);
});
