// Tests for adding a new card from Settings (2026-09-04), requested
// directly: "can we add a way for them to update their saved card
// info from the settings?" Stripe payment methods are immutable --
// there's no way to edit an existing card in place, only add a
// replacement (Remove already covers getting rid of an old one).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const MANAGE_CARD = fs.readFileSync(repo('edge-functions', 'manage-saved-card-index.ts'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

// ---- edge function ----

test('create_setup_intent requires a signature before creating anything, matching every other place a new card gets saved', () => {
  const block = MANAGE_CARD.match(/if \(mode === "create_setup_intent"\) \{[\s\S]*?return json\(\{ ok: true, client_secret: setupIntent\.client_secret \}\);\s*\n    \}/);
  assert.ok(block, 'expected to isolate the create_setup_intent branch');
  assert.match(block[0], /if \(typeof signer_name !== "string" \|\| !signer_name\.trim\(\)\)/);
  assert.match(block[0], /needs_signature: true/);
});

test('the authorization is recorded before the SetupIntent is created', () => {
  const recordIdx = MANAGE_CARD.indexOf('await recordCardAuthorization(claims.email, signer_name.trim(), authorizationText);');
  const setupIdx = MANAGE_CARD.indexOf('await fetch("https://api.stripe.com/v1/setup_intents"');
  assert.ok(recordIdx !== -1 && setupIdx !== -1);
  assert.ok(recordIdx < setupIdx);
});

test('the authorization uses a distinct context ("settings_add_card"), not reused from POS or invoice payment', () => {
  const fnMatch = MANAGE_CARD.match(/async function recordCardAuthorization\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /context: "settings_add_card",/);
});

test('a failure to save the authorization blocks card setup, matching the same protection built into every other card-saving flow', () => {
  const fnMatch = MANAGE_CARD.match(/async function recordCardAuthorization\([\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /if \(!res\.ok\) \{\s*\n\s*throw new Error/);
});

test('a SetupIntent is used, not a PaymentIntent -- this must never charge anything, only save a payment method', () => {
  const block = MANAGE_CARD.match(/if \(mode === "create_setup_intent"\) \{[\s\S]*?\n    \}\n/);
  assert.match(block[0], /https:\/\/api\.stripe\.com\/v1\/setup_intents/);
  assert.doesNotMatch(block[0], /payment_intents/);
});

test('an existing Stripe customer is reused rather than created twice', () => {
  assert.match(MANAGE_CARD, /const setupCustomerId = customerId \|\| await getOrCreateStripeCustomer\(claims\.email\.toLowerCase\(\)\);/);
});

test('getOrCreateStripeCustomer reuses findExistingStripeCustomerId rather than duplicating the lookup', () => {
  const fnMatch = MANAGE_CARD.match(/async function getOrCreateStripeCustomer\(email: string\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /const existing = await findExistingStripeCustomerId\(email\);/);
});

// ---- frontend ----

test('the settings page shows an Add a Card button that starts the signature flow', () => {
  assert.match(SETTINGS, /id="addCardBtn"/);
  assert.match(SETTINGS, /onclick="startAddCard\(\)"/);
});

test('the request uses mode: create_setup_intent with the signed name', () => {
  const fnMatch = SETTINGS.match(/async function submitAddCardSignature\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate submitAddCardSignature()');
  assert.match(fnMatch[0], /mode: 'create_setup_intent', signer_name: signerName/);
});

test('an empty signature is rejected client-side before ever calling the server', () => {
  const fnMatch = SETTINGS.match(/async function submitAddCardSignature\(\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /if \(!signerName\) \{[\s\S]*?return;/);
});

test('the Stripe Elements confirmation uses confirmSetup, never confirmPayment -- adding a card must never trigger an actual charge', () => {
  const fnMatch = SETTINGS.match(/function mountAddCardSetupUI\(clientSecret\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate mountAddCardSetupUI()');
  assert.match(fnMatch[0], /stripeInstance\.confirmSetup\(/);
  assert.doesNotMatch(fnMatch[0], /confirmPayment/);
});

test('a successful save reloads the saved cards list so the new card actually shows up without a manual refresh', () => {
  const fnMatch = SETTINGS.match(/function mountAddCardSetupUI\(clientSecret\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /loadSavedCards\(\);/);
});

test('cancelling clears the form and restores the Add a Card button, rather than leaving a half-open form behind', () => {
  const fnMatch = SETTINGS.match(/function cancelAddCard\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate cancelAddCard()');
  assert.match(fnMatch[0], /getElementById\('addCardArea'\)\.innerHTML = '';/);
  assert.match(fnMatch[0], /getElementById\('addCardBtn'\)\.style\.display = 'block';/);
});

test('Stripe.js is loaded and the CSP allows it, matching the same pattern already established on dashboard.html', () => {
  assert.match(SETTINGS, /<script src="https:\/\/js\.stripe\.com\/v3\/"><\/script>/);
  assert.match(SETTINGS, /script-src[^"]*https:\/\/js\.stripe\.com/);
  assert.match(SETTINGS, /connect-src[^"]*https:\/\/api\.stripe\.com/);
  assert.match(SETTINGS, /frame-src https:\/\/js\.stripe\.com/);
});
