// Tests for four changes requested directly in one batch (2026-09-02):
// removing Venmo/Cash App from invoices now that Stripe is live,
// fixing the Stripe payment modal not tracking the iOS keyboard, a
// receipt visual makeover, and archiving generated invoice PDFs
// (invoices only, not estimates).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const INVOICE_GEN = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');
const DASHBOARD = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'dashboard.html'), 'utf8');
// The invoice PDF viewer and Portal invoices panel split off Dev
// Tools onto their own /tools/clients.html (2026-09-03), requested
// directly: "lets split the portal out of tools and add it as its
// own [tool]."
const CLIENTS = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'clients.html'), 'utf8');

// ---- Venmo / Cash App removal ----

test('no Venmo or Cash App reference remains anywhere in the invoice generator', () => {
  assert.doesNotMatch(INVOICE_GEN, /Venmo/i);
  assert.doesNotMatch(INVOICE_GEN, /Cash App/i);
});

test('the default payment text still lists real accepted methods (cash, check, Stripe cards)', () => {
  assert.match(INVOICE_GEN, /We accept cash, check, and credit\/debit cards via a secure Stripe invoice\./);
});

test('the Venmo QR code image asset was removed, not just its reference', () => {
  const imgPath = path.join(__dirname, '..', '..', 'images', 'venmo-qr.png');
  assert.equal(fs.existsSync(imgPath), false, 'venmo-qr.png should no longer exist on disk');
});

test('set-invoice-paid no longer describes Venmo as a payment path it accounts for', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'set-invoice-paid-index.ts'), 'utf8');
  assert.doesNotMatch(src, /Venmo/i);
});

// ---- Stripe payment modal iOS keyboard fix ----

test('the payment modal can scroll itself, capped below the visible viewport', () => {
  // The actual reported bug: "the background would move but the
  // stripe box would not" while typing a card number -- a
  // well-documented iOS Safari issue where position:fixed elements
  // don't track the visual viewport shrinking when the keyboard
  // opens. Making the modal scroll INTERNALLY, capped below the
  // viewport height, is what actually fixes it: the browser's normal
  // scroll-input-into-view behavior then operates on the modal's own
  // scroll container instead of trying to reposition the fixed
  // overlay itself.
  const modalRule = DASHBOARD.match(/\.payment-modal \{[^}]*\}/)[0];
  assert.match(modalRule, /max-height: calc\(100vh - 40px\)/);
  assert.match(modalRule, /overflow-y: auto/);
});

test('a dvh progressive enhancement is layered on top of the vh fallback', () => {
  // 100vh itself can be stale on iOS -- it reflects the layout
  // viewport, not what's actually visible once the keyboard is up.
  // 100dvh tracks the real visible area live; @supports means
  // browsers without dvh simply keep the vh-based value already set.
  assert.match(DASHBOARD, /@supports \(max-height: 100dvh\) \{\s*\.payment-modal \{ max-height: calc\(100dvh - 40px\); \}/);
});

// ---- Receipt makeover ----

test('a paid receipt gets a real visual PAID stamp, not just swapped label text', () => {
  const fnMatch = DASHBOARD.match(/async function downloadInvoicePDF\(invoiceId\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate downloadInvoicePDF()');
  const body = fnMatch[0];
  assert.match(body, /if \(inv\.paid\) \{[\s\S]*?doc\.circle\(stampCX, stampCY, stampR, 'S'\);/);
  assert.match(body, /angle: 12/, 'the stamp text should be rotated for an authentic stamped look');
});

test('a paid receipt gets a formatted Payment Details box, not a single plain text line', () => {
  const fnMatch = DASHBOARD.match(/async function downloadInvoicePDF\(invoiceId\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.match(body, /PAYMENT DETAILS/);
  assert.match(body, /doc\.roundedRect\(40, y, boxW, boxH, 4, 4, 'FD'\)/);
  assert.match(body, /Thank you for your business!/);
  // Still distinguishes how it was paid, same real distinction the
  // code already tracked (stripe_payment_intent_id present or not).
  assert.match(body, /card \(Stripe\)/);
  assert.match(body, /cash or check/);
});

test('an unpaid invoice keeps its original plain "questions" footer, unaffected by the receipt makeover', () => {
  const fnMatch = DASHBOARD.match(/async function downloadInvoicePDF\(invoiceId\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.match(body, /Questions about this invoice\? Call \(435\) 414-1667/);
});

// ---- Invoice PDF archiving (invoices only, not estimates) ----

test('generatePDF (invoices) archives the PDF; generateQuotePDF (estimates) does not', () => {
  const invoiceFn = INVOICE_GEN.match(/async function generatePDF\(opts\)[\s\S]*?\n  \}\n/);
  assert.ok(invoiceFn, 'expected to isolate generatePDF()');
  assert.match(invoiceFn[0], /storeInvoicePdf\(/);

  const quoteFn = INVOICE_GEN.match(/async function generateQuotePDF\(\)[\s\S]*?\n  \}\n/);
  assert.ok(quoteFn, 'expected to isolate generateQuotePDF()');
  assert.doesNotMatch(quoteFn[0], /storeInvoicePdf\(/,
    'estimates must not be archived -- requested directly, to avoid accumulating storage for drafts that are routinely revised or never become anything');
});

test('the PDF is archived on both Download and Send, not only when emailing the client', () => {
  // Archiving is about the document existing at all, not about
  // whether an email went out.
  const fnMatch = INVOICE_GEN.match(/async function generatePDF\(opts\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  const shareIdx = body.indexOf('if (shouldSend)');
  const storeIdx = body.indexOf('storeInvoicePdf(');
  assert.ok(shareIdx !== -1 && storeIdx !== -1);
  assert.ok(storeIdx > shareIdx, 'the archive call should come after the shouldSend branch, so it runs on both paths');
});

test('storeInvoicePdf keys the file by invoice number and upserts on re-generation', () => {
  const fnMatch = INVOICE_GEN.match(/async function storeInvoicePdf\(doc, invoiceNumber\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate storeInvoicePdf()');
  const body = fnMatch[0];
  assert.match(body, /'invoices\/' \+ encodeURIComponent\(invoiceNumber\) \+ '\.pdf'/);
  assert.match(body, /'x-upsert': 'true'/, 're-generating the same invoice should overwrite, not error on a duplicate path');
});

test('a failed archive upload never blocks the invoice workflow', () => {
  const fnMatch = INVOICE_GEN.match(/async function storeInvoicePdf\(doc, invoiceNumber\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.match(body, /try \{[\s\S]*\} catch \(e\) \{/, 'expected the upload to be wrapped so a failure cannot throw out to the caller');
  assert.match(body, /logClientError/, 'a failure should still be logged so it can be found and fixed later');
});

test('the Clients tool can open an archived invoice PDF via a signed URL, scoped to the invoice-pdfs bucket', () => {
  const fnMatch = CLIENTS.match(/async function viewArchivedInvoicePdf\(portalRowId, btnEl\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate viewArchivedInvoicePdf()');
  const body = fnMatch[0];
  assert.match(body, /storage\/v1\/object\/sign\/invoice-pdfs\//);
  assert.match(body, /expiresIn: 300/);
});

test('the Portal invoices panel offers View PDF alongside Resend for every row', () => {
  const fnMatch = CLIENTS.match(/async function renderPortalInvoices\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderPortalInvoices()');
  assert.match(fnMatch[0], /viewArchivedInvoicePdf\(/);
  assert.match(fnMatch[0], /resendPortalInvoice\(/);
});
