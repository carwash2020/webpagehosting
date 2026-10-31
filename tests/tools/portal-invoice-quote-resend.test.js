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

// Redundancy pass (2026-10-31): Clients' Portal invoices / Portal quotes
// panels (and resendPortalInvoice / resendPortalQuote) left -- the
// Invoices list resends both. The fix pinned below moved with them: a
// resend of an unchanged email calls the notification function directly
// (not sync-*-to-portal's new-only email path) and reports an opted-out
// client honestly. tests/tools/resend-invoice-actually-emails.test.js runs
// the invoice side for real.
const INVOICES = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');

test('Clients no longer has Portal invoices / Portal quotes panels or their Resend functions; the portal tables are still read by Client Lookup', () => {
  assert.doesNotMatch(CLIENTS, /<h2>Portal invoices<\/h2>|<h2>Portal quotes<\/h2>|id="portalInvoices"|id="portalQuotes"/);
  assert.doesNotMatch(CLIENTS, /async function (resendPortalInvoice|resendPortalQuote|renderPortalInvoices|renderPortalQuotes)\(/);
  assert.match(CLIENTS, /client_portal_invoices/);
  assert.match(CLIENTS, /client_portal_quotes/);
});

test('the Invoices list\'s invoice Resend calls send-invoice-notification directly and distinguishes an opted-out skip from a real send', () => {
  const fn = isolateFn(INVOICES, 'resendInvoiceToClient');
  assert.match(fn, /\/functions\/v1\/send-invoice-notification/);
  assert.match(fn, /result && result\.ok && result\.skipped/);
  assert.match(fn, /turned off invoice\/quote emails/i);
});

test('the Invoices list\'s quote Resend calls send-quote-notification directly, with the same opted-out handling', () => {
  const fn = isolateFn(INVOICES, 'resendQuoteToClient');
  assert.match(fn, /\/functions\/v1\/send-quote-notification/);
  assert.match(fn, /result && result\.ok && result\.skipped/);
});

test('the Invoices list offers Resend on every invoice and quote row (desktop row and the row ⋯ sheet)', () => {
  assert.match(INVOICES, /<button class="small-btn" onclick="resendInvoiceToClient\(' \+ inv\.id \+ '\)">Resend<\/button>/);
  assert.match(INVOICES, /<button class="small-btn" onclick="resendQuoteToClient\(\$\{q\.id\}\)">Resend<\/button>/);
  assert.match(INVOICES, /label: inv\.clientEmail \? 'Resend' : 'Send to an email', onClick: \(\) => resendInvoiceToClient\(id\)/);
  assert.match(INVOICES, /label: q\.clientEmail \? 'Resend' : 'Send to an email', onClick: \(\) => resendQuoteToClient\(id\)/);
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
