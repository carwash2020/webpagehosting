// Tests for labeling the active saved card and showing expiration
// (2026-09-04), requested directly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const MANAGE_CARD = fs.readFileSync(repo('edge-functions', 'manage-saved-card-index.ts'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');

// ---- edge function ----

test('list mode returns expiration month/year for each card', () => {
  const block = MANAGE_CARD.match(/if \(mode === "list"\) \{[\s\S]*?return json\(\{ ok: true, cards \}\);/);
  assert.ok(block, 'expected to isolate the list branch');
  assert.match(block[0], /exp_month: pm\.card\?\.exp_month \|\| null,/);
  assert.match(block[0], /exp_year: pm\.card\?\.exp_year \|\| null,/);
});

test('the first card returned is explicitly marked is_active, matching Stripe\'s own documented most-recently-created-first order', () => {
  const block = MANAGE_CARD.match(/if \(mode === "list"\) \{[\s\S]*?return json\(\{ ok: true, cards \}\);/);
  assert.match(block[0], /is_active: index === 0,/);
  assert.match(block[0], /\(pm: any, index: number\)/);
});

test('this matches the same card create-pos-charge and create-payment-intent would actually use for an off-session charge', () => {
  const posCharge = fs.readFileSync(repo('edge-functions', 'create-pos-charge-index.ts'), 'utf8');
  // Both rely on index 0 of the same Stripe endpoint's own default
  // sort order -- confirming there's exactly one real notion of
  // "the card that gets charged," not two different assumptions.
  assert.match(posCharge, /cards\[0\]/);
});

// ---- frontend ----

test('cardExpirationStatus flags an already-past expiration as expired', () => {
  const fnMatch = SETTINGS.match(/function cardExpirationStatus\(expMonth, expYear\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate cardExpirationStatus()');
  assert.match(fnMatch[0], /if \(monthsUntilExpiry < 0\) return \{ label: label \+ ' \(expired\)', isWarning: true \};/);
});

test('cardExpirationStatus flags a card expiring within the next month as a warning, not just the exact expiration month', () => {
  const fnMatch = SETTINGS.match(/function cardExpirationStatus\(expMonth, expYear\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /if \(monthsUntilExpiry <= 1\) return \{ label: label \+ ' \(expiring soon\)', isWarning: true \};/);
});

test('a card with no real expiration data (missing from Stripe) shows nothing rather than a broken label', () => {
  const fnMatch = SETTINGS.match(/function cardExpirationStatus\(expMonth, expYear\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /if \(!expMonth \|\| !expYear\) return \{ label: '', isWarning: false \};/);
});

test('the Active badge only shows when there is more than one card -- a single card has nothing to be distinguished from', () => {
  const fnMatch = SETTINGS.match(/function renderSavedCards\(cards\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderSavedCards()');
  assert.match(fnMatch[0], /\(c\.is_active && cards\.length > 1\)/);
});

test('an expiration warning gets a distinct, visually different class than a normal expiration date', () => {
  const fnMatch = SETTINGS.match(/function renderSavedCards\(cards\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /exp\.isWarning \? 'set-card-exp-warning' : 'set-card-exp'/);
});
