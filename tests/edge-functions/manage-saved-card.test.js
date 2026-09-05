// Tests for client-facing saved card management (2026-09-03),
// requested directly: "Saved card management (view/remove)." Since
// invoice payments and POS both now save a card automatically, a
// client had no way to even know one was on file, let alone remove
// it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const MANAGE_CARD = fs.readFileSync(repo('edge-functions', 'manage-saved-card-index.ts'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

// ---- edge function ----

test('uses its own dedicated Stripe secret, not the shared one, matching the "one key one function" practice from POS', () => {
  assert.match(MANAGE_CARD, /Deno\.env\.get\("STRIPE_CLIENT_CARDS_SECRET_KEY"\)/);
  assert.doesNotMatch(MANAGE_CARD, /Deno\.env\.get\("STRIPE_SECRET_KEY"\)/);
});

test('list mode looks up the caller\'s own customer by their verified session email, never a client-supplied value', () => {
  assert.match(MANAGE_CARD, /const customerId = await findExistingStripeCustomerId\(claims\.email\.toLowerCase\(\)\);/);
});

test('a client with no Stripe customer at all gets an empty list, not an error', () => {
  const listBlock = MANAGE_CARD.match(/if \(mode === "list"\) \{[\s\S]*?\n    \}\n/);
  assert.ok(listBlock);
  assert.match(listBlock[0], /if \(!customerId\) return json\(\{ ok: true, cards: \[\] \}\);/);
});

test('remove mode re-verifies the payment method actually belongs to the caller before detaching it, rather than trusting the id alone', () => {
  const removeBlock = MANAGE_CARD.match(/if \(mode === "remove"\) \{[\s\S]*?return json\(\{ ok: true, removed: true \}\);\s*\n    \}/);
  assert.ok(removeBlock, 'expected to isolate the remove branch');
  const body = removeBlock[0];
  const fetchPmIdx = body.indexOf('payment_methods/${payment_method_id}`');
  const customerCheckIdx = body.indexOf("pm.customer !== customerId");
  const detachIdx = body.indexOf('/detach');
  assert.ok(fetchPmIdx !== -1 && customerCheckIdx !== -1 && detachIdx !== -1);
  assert.ok(fetchPmIdx < customerCheckIdx && customerCheckIdx < detachIdx,
    'must fetch and verify ownership BEFORE detaching, not after or never');
});

test('a payment_method_id that does not look like a real Stripe id is rejected before any Stripe call', () => {
  const removeBlock = MANAGE_CARD.match(/if \(mode === "remove"\) \{[\s\S]*?\n    \}\n/);
  assert.match(removeBlock[0], /!payment_method_id\.startsWith\("pm_"\)/);
});

// ---- frontend ----

test('the settings page shows a Saved Cards section and loads it on init', () => {
  assert.match(SETTINGS, /<span class="set-card-title">Saved Cards<\/span>/);
  assert.match(SETTINGS, /loadSavedCards\(\);/);
});

test('a card row has a Remove button that calls the real removeSavedCard function', () => {
  const fnMatch = SETTINGS.match(/function renderSavedCards\(cards\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderSavedCards()');
  assert.match(fnMatch[0], /onclick="removeSavedCard\(/);
});

test('removing a card confirms first using the portal\'s own real confirm pattern, not an undefined helper', () => {
  // Real bug caught and fixed while building this (a repeat of the
  // same mistake from earlier this session with showToast): I first
  // wrote showConfirm(), a function that does not exist on this page.
  // The portal's actual established pattern, confirmed directly
  // against portal/quotes.html, is plain window.confirm().
  const fnMatch = SETTINGS.match(/async function removeSavedCard\(paymentMethodId\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate removeSavedCard()');
  assert.match(fnMatch[0], /window\.confirm\(/);
  assert.doesNotMatch(fnMatch[0], /showConfirm\(/);
});
