// Tests for signature capture before saving a new card in POS
// (2026-09-03), requested directly: "we also need to collect
// signitures when we collect and create accounts within stripe incase
// we ever have to handle a dispute." Stripe has no native "collect a
// signature before charging" feature for card-not-present
// transactions; this is the merchant-side equivalent -- a signed
// authorization record, held ourselves, submittable as dispute
// evidence if one ever comes in.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const POS_CHARGE = fs.readFileSync(repo('edge-functions', 'create-pos-charge-index.ts'), 'utf8');
const POS_PAGE = fs.readFileSync(repo('tools', 'pos.html'), 'utf8');

// ---- edge function ----

test('new_card mode rejects a missing or blank signer_name before doing anything else', () => {
  const fnMatch = POS_CHARGE.match(/if \(typeof signer_name !== "string" \|\| !signer_name\.trim\(\)\) \{[\s\S]*?\n    \}\n/);
  assert.ok(fnMatch, 'expected to isolate the signer_name validation');
  assert.match(fnMatch[0], /A signed name is required before saving a new card\./);
});

test('the authorization is recorded BEFORE the Stripe customer is created or a card gets saved', () => {
  const newCardSection = POS_CHARGE.match(/\/\/ mode === 'new_card'[\s\S]*?const customerId = await getOrCreateStripeCustomer/);
  assert.ok(newCardSection, 'expected to isolate the new_card section up through customer creation');
  const recordIdx = newCardSection[0].indexOf('recordCardAuthorization(');
  const createCustomerIdx = newCardSection[0].indexOf('getOrCreateStripeCustomer');
  assert.ok(recordIdx !== -1 && createCustomerIdx !== -1);
  assert.ok(recordIdx < createCustomerIdx, 'the authorization must be recorded before the customer/card is ever created');
});

test('charge_saved does NOT require a fresh signature every time -- that would defeat its one-tap purpose', () => {
  const chargeSavedBlock = POS_CHARGE.match(/if \(mode === "charge_saved"\) \{[\s\S]*?return json\(\{ ok: true, charged: true \}\);\s*\n    \}/);
  assert.ok(chargeSavedBlock);
  assert.doesNotMatch(chargeSavedBlock[0], /signer_name|recordCardAuthorization/);
});

test('a failure to save the authorization record blocks the charge entirely, rather than silently proceeding without it', () => {
  const fnMatch = POS_CHARGE.match(/async function recordCardAuthorization\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate recordCardAuthorization()');
  assert.match(fnMatch[0], /if \(!res\.ok\) \{\s*\n\s*throw new Error/,
    'must throw on failure, not swallow the error and let the caller proceed anyway');
});

test('the stored authorization text is built from the actual submitted amount and description, not a generic template with no specifics', () => {
  assert.match(POS_CHARGE, /authorize Triple H Enterprises to charge \$\$\{amount\.toFixed\(2\)\}/);
  assert.match(POS_CHARGE, /for "\$\{description \|\| "a POS sale"\}"/);
});

test('the authorization record is tied to the specific internal account who ran the charge', () => {
  const fnMatch = POS_CHARGE.match(/async function recordCardAuthorization\([\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /internal_account: internalAccount,/);
  assert.match(POS_CHARGE, /recordCardAuthorization\(normalizedEmail, signer_name\.trim\(\), authorizationText, amount, description, claims\.email\);/);
});

// ---- frontend ----

test('the signature box appears before the card entry button, with the client\'s name required to type', () => {
  const fnMatch = POS_PAGE.match(/function renderNewCardOption\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderNewCardOption()');
  const body = fnMatch[0];
  const authBoxIdx = body.indexOf('pos-auth-box');
  const buttonIdx = body.indexOf('id="posNewCardBtn"');
  assert.ok(authBoxIdx !== -1 && buttonIdx !== -1);
  assert.ok(authBoxIdx < buttonIdx, 'the signature box must render before the charge button');
  assert.match(body, /id="posSignerName"/);
});

test('the authorization preview stays in sync with live edits to amount and description -- a stale preview would undermine the whole point', () => {
  // Real correctness issue found and fixed while building this:
  // without live updates, editing the amount AFTER the signature box
  // first rendered would let the client sign for one figure while a
  // different one actually gets charged and recorded.
  assert.match(POS_PAGE, /document\.getElementById\('posAmount'\)\.addEventListener\('input', updateAuthPreview\);/);
  assert.match(POS_PAGE, /document\.getElementById\('posDescription'\)\.addEventListener\('input', updateAuthPreview\);/);
  const fnMatch = POS_PAGE.match(/function updateAuthPreview\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate updateAuthPreview()');
  assert.match(fnMatch[0], /amountEl\.textContent = '\$' \+ amount\.toFixed\(2\);/);
});

test('startNewCardCharge refuses to proceed without a signed name, and never sends an empty one to the server', () => {
  const fnMatch = POS_PAGE.match(/async function startNewCardCharge\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate startNewCardCharge()');
  const body = fnMatch[0];
  assert.match(body, /if \(!signerName\) \{[\s\S]*?return;/);
  assert.match(body, /signer_name: signerName/);
});

test('no inline handler introduced for the signature field embeds JSON.stringify', () => {
  const hits = [...POS_PAGE.matchAll(/oninput="[^"\n]*posSignerName[^"\n]*JSON\.stringify/g)];
  assert.equal(hits.length, 0);
});
