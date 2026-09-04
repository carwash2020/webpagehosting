// Tests for bringing "Pay All Outstanding" in line with single-invoice
// payments (2026-09-04), found during a functional audit: bulk
// payments never attached a Stripe Customer or saved the card used --
// a real inconsistency, not an intentional difference, since it's the
// exact same client, card, and future benefit either way.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const BULK = fs.readFileSync(repo('edge-functions', 'create-bulk-payment-intent-index.ts'), 'utf8');
const SINGLE = fs.readFileSync(repo('edge-functions', 'create-payment-intent-index.ts'), 'utf8');
const DASHBOARD = fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8');

// ---- edge function ----

test('the PaymentIntent now attaches a real Stripe Customer and saves the card, matching single-invoice payments', () => {
  assert.match(BULK, /customer: stripeCustomerId,/);
  assert.match(BULK, /setup_future_usage: "off_session",/);
});

test('a signature is required only when this client has no existing saved card, same logic as create-payment-intent', () => {
  const block = BULK.match(/const existingCustomerId = await findExistingStripeCustomerId[\s\S]*?await recordCardAuthorization\([^;]+;\s*\n    \}/);
  assert.ok(block, 'expected to isolate the signature-requirement block');
  assert.match(block[0], /if \(!alreadyHasSavedCard\) \{/);
  assert.match(block[0], /if \(typeof signer_name !== "string" \|\| !signer_name\.trim\(\)\)/);
});

test('a missing signature returns a distinct needs_signature flag, not a generic error', () => {
  assert.match(BULK, /return json\(\{ ok: false, needs_signature: true, error: "A signed name is required before saving a new card\." \}, 400\);/);
});

test('the authorization is recorded before the PaymentIntent is created, and describes the batch, not a single invoice', () => {
  const recordIdx = BULK.indexOf('await recordCardAuthorization(');
  const piCreateIdx = BULK.indexOf('await fetch("https://api.stripe.com/v1/payment_intents"');
  assert.ok(recordIdx !== -1 && piCreateIdx !== -1);
  assert.ok(recordIdx < piCreateIdx);
  assert.match(BULK, /`\$\{invoiceCount\} invoices \(IDs: \$\{invoice_ids\.join\(", "\)\}\)`/);
});

test('the authorization context stays "invoice_payment", not a separate bulk-specific context -- same category of action, just covering more than one invoice', () => {
  const fnMatch = BULK.match(/async function recordCardAuthorization\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /context: "invoice_payment",/);
});

test('a failure to save the authorization blocks the payment, matching the same protection built into create-payment-intent', () => {
  const fnMatch = BULK.match(/async function recordCardAuthorization\([\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /if \(!res\.ok\) \{\s*\n\s*throw new Error/);
});

test('the existing customer id is reused rather than looked up twice, matching create-payment-intent\'s own structure', () => {
  assert.match(BULK, /const stripeCustomerId = existingCustomerId \|\| await getOrCreateStripeCustomer\(claims\.email\);/);
});

test('the Stripe customer is looked up and created by the caller\'s own verified session email, never a client-supplied value', () => {
  assert.match(BULK, /const existingCustomerId = await findExistingStripeCustomerId\(claims\.email\);/);
  assert.doesNotMatch(BULK, /getOrCreateStripeCustomer\(invoice/);
});

// ---- frontend ----

test('startBulkPayment shows the signature step on needs_signature, rather than a generic error message', () => {
  const fnMatch = DASHBOARD.match(/async function startBulkPayment\(invoiceIds, signerName\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate startBulkPayment()');
  assert.match(fnMatch[0], /if \(result\.needs_signature\) \{[\s\S]*?renderBulkPaymentSignatureStep\(invoiceIds\);/);
});

test('submitting the signature retries the exact same bulk payment flow with the typed name included', () => {
  assert.match(DASHBOARD, /function submitBulkPaymentSignature\(invoiceIds\)/);
  assert.match(DASHBOARD, /startBulkPayment\(invoiceIds, signerName\);/);
});

test('an empty signature is rejected client-side before ever retrying the request', () => {
  const fnMatch = DASHBOARD.match(/function submitBulkPaymentSignature\(invoiceIds\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /if \(!signerName\) \{[\s\S]*?return;/);
});

test('the bulk signature preview computes the real total from the actual invoices being paid, not a placeholder', () => {
  const fnMatch = DASHBOARD.match(/function renderBulkPaymentSignatureStep\(invoiceIds\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderBulkPaymentSignatureStep()');
  assert.match(fnMatch[0], /currentInvoices\s*\n\s*\.filter\(inv => invoiceIds\.includes\(inv\.id\)\)/);
  assert.match(fnMatch[0], /\.reduce\(\(sum, inv\) => sum \+ Number\(inv\.total\), 0\)/);
});
