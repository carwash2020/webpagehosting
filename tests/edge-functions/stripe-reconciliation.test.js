// Tests for the daily Stripe payment reconciliation check
// (2026-09-05), requested directly: "future proof this... what other
// layers can we add." Webhooks are handled correctly, but nothing
// previously caught a MISSED event once Stripe's own ~3-day retry
// window expired.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const RECONCILE = fs.readFileSync(repo('edge-functions', 'reconcile-stripe-payments-index.ts'), 'utf8');
const SEND_PUSH = fs.readFileSync(repo('edge-functions', 'send-push-index.ts'), 'utf8');

test('this is alert-only -- it never writes to client_portal_invoices or marks anything paid, since financial state changes need a human to review, not an automated script', () => {
  assert.doesNotMatch(RECONCILE, /method: "PATCH"/);
  assert.doesNotMatch(RECONCILE, /paid: true/);
});

test('the lookback window (8 days) is genuinely past Stripe\u2019s own ~3-day webhook retry window, not an arbitrary shorter number that could miss a real late retry', () => {
  assert.match(RECONCILE, /const LOOKBACK_DAYS = 8;/);
});

test('it extracts invoice ids from both the single-invoice and bulk-payment metadata shapes, not just one', () => {
  const fnMatch = RECONCILE.match(/function extractInvoiceIds\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate extractInvoiceIds()');
  assert.match(fnMatch[0], /metadata\.client_portal_invoice_id\b/);
  assert.match(fnMatch[0], /metadata\.client_portal_invoice_ids\b/);
});

test('an invoice already marked paid is skipped entirely -- only a genuine mismatch (Stripe succeeded, portal still unpaid) triggers an alert', () => {
  assert.match(RECONCILE, /if \(invoice\.paid\) continue; \/\/ already reconciled, nothing to alert about/);
});

test('a discrepancy is deduplicated through notification_log, so the same unresolved mismatch does not spam a fresh alert on every single run', () => {
  assert.match(RECONCILE, /notif_type=eq\.stripe-reconciliation-mismatch/);
  assert.match(RECONCILE, /if \(await wasRecentlyAlerted\(itemKey\)\) continue;/);
});

test('the alert call uses the real function\u2019s exact casing (Send-Push), not a lowercase variant that would create a separate, orphaned function', () => {
  const fnMatch = RECONCILE.match(/async function sendAlert\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate sendAlert()');
  assert.match(fnMatch[0], /\/functions\/v1\/Send-Push/);
  assert.doesNotMatch(fnMatch[0], /\/functions\/v1\/send-push[^-]/);
});

test('it uses its own dedicated, read-only-scoped Stripe secret, not the shared main secret key or the POS/saved-cards keys', () => {
  assert.match(RECONCILE, /const STRIPE_RECONCILE_SECRET_KEY = Deno\.env\.get\("STRIPE_RECONCILE_SECRET_KEY"\);/);
  assert.doesNotMatch(RECONCILE, /STRIPE_SECRET_KEY|STRIPE_POS_SECRET_KEY|STRIPE_CLIENT_CARDS_SECRET_KEY/);
});

test('Send-Push has a real, distinct handler for the new alert type, pointing at Portal invoices rather than reusing uptime-alert\u2019s hardcoded Dev Tools link', () => {
  const block = SEND_PUSH.match(/if \(payload\.type === "stripe-reconciliation-alert"\) \{[\s\S]*?\n    \}\n/);
  assert.ok(block, 'expected to isolate the stripe-reconciliation-alert branch');
  assert.match(block[0], /url: "\/tools\/clients\.html"/);
  assert.match(block[0], /sendToAllSubscriptions\(/);
});

test('exactly one Deno.serve handler, structure intact', () => {
  const matches = RECONCILE.match(/^Deno\.serve/gm) || [];
  assert.equal(matches.length, 1);
});
