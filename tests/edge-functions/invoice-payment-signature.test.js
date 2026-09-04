// Tests for signature capture on invoice payments (2026-09-03) --
// extends the same dispute-protection pattern already built for POS
// to the moment a client's card gets saved on their FIRST invoice
// payment. Lower risk than POS (the client enters their own card on
// their own device, not Connor entering it on their behalf), but a
// Stripe Customer still gets created and a card still gets saved for
// future off-session use here too.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const PAYMENT_INTENT = fs.readFileSync(repo('edge-functions', 'create-payment-intent-index.ts'), 'utf8');
const DASHBOARD = fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8');
const BULK_PAYMENT_INTENT = fs.readFileSync(repo('edge-functions', 'create-bulk-payment-intent-index.ts'), 'utf8');

// ---- edge function ----

test('a signature is required only when this client has no existing saved card', () => {
  const fnMatch = PAYMENT_INTENT.match(/const existingCustomerId = await findExistingStripeCustomerId[\s\S]*?await recordCardAuthorization\(claims\.email, signer_name\.trim\(\), authorizationText, amountCents \/ 100, invoice\.id\);\s*\n    \}/);
  assert.ok(fnMatch, 'expected to isolate the signature-requirement block');
  const body = fnMatch[0];
  assert.match(body, /if \(!alreadyHasSavedCard\) \{/);
  assert.match(body, /if \(typeof signer_name !== "string" \|\| !signer_name\.trim\(\)\)/);
});

test('a missing signature returns a distinct needs_signature flag, not a generic error', () => {
  assert.match(PAYMENT_INTENT, /return json\(\{ ok: false, needs_signature: true, error: "A signed name is required before saving a new card\." \}, 400\);/);
});

test('findExistingStripeCustomerId never creates a customer just to check', () => {
  const fnMatch = PAYMENT_INTENT.match(/async function findExistingStripeCustomerId\(email: string\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch);
  assert.doesNotMatch(fnMatch[0], /customers", \{/);
});

test('the authorization is recorded before the PaymentIntent is ever created', () => {
  const recordIdx = PAYMENT_INTENT.indexOf('await recordCardAuthorization(');
  const piCreateIdx = PAYMENT_INTENT.indexOf('await fetch("https://api.stripe.com/v1/payment_intents"');
  assert.ok(recordIdx !== -1 && piCreateIdx !== -1);
  assert.ok(recordIdx < piCreateIdx);
});

test('a failure to save the authorization blocks the payment, matching the same protection built into POS', () => {
  const fnMatch = PAYMENT_INTENT.match(/async function recordCardAuthorization\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /if \(!res\.ok\) \{\s*\n\s*throw new Error/);
});

test('the existing customer id is reused rather than looked up twice when a signature was required', () => {
  assert.match(PAYMENT_INTENT, /const stripeCustomerId = existingCustomerId \|\| await getOrCreateStripeCustomer\(claims\.email\);/);
});

// ---- frontend ----

test('startPayment shows the signature step on needs_signature, rather than a generic error message', () => {
  const fnMatch = DASHBOARD.match(/async function startPayment\(invoiceId, signerName\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate startPayment()');
  const body = fnMatch[0];
  assert.match(body, /if \(result\.needs_signature\) \{[\s\S]*?renderPaymentSignatureStep\(invoiceId\);/);
});

test('submitting the signature retries the exact same payment flow with the typed name included', () => {
  assert.match(DASHBOARD, /function submitPaymentSignature\(invoiceId\)/);
  assert.match(DASHBOARD, /startPayment\(invoiceId, signerName\);/);
});

test('an empty signature is rejected client-side before ever retrying the request', () => {
  const fnMatch = DASHBOARD.match(/function submitPaymentSignature\(invoiceId\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /if \(!signerName\) \{[\s\S]*?return;/);
});

test('the "Pay All Outstanding" bulk flow does not save cards at all, so it needs no signature step', () => {
  // Confirmed directly rather than assumed: create-bulk-payment-intent
  // has no getOrCreateStripeCustomer or setup_future_usage call at
  // all, so no card is ever saved there -- nothing for a signature to
  // protect in that flow, and no reason to have added one.
  assert.doesNotMatch(BULK_PAYMENT_INTENT, /getOrCreateStripeCustomer|setup_future_usage/);
});
