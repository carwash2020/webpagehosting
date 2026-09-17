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

// Partial payments (2026-09-17) replaced the plain `invoice.paid`
// check here: a correctly-processed partial payment leaves
// `paid: false` by design, and checking the boolean alone would have
// this cron nudge Steve every day about a "missed" payment that was
// never missed. The real question is whether THIS specific succeeded
// PaymentIntent was ever recorded against THIS invoice in the ledger
// stripe-webhook writes to.
test('a mismatch is decided from the client_portal_invoice_payments ledger, not the invoice.paid boolean', () => {
  assert.doesNotMatch(RECONCILE, /if \(invoice\.paid\) continue;/);
  assert.match(RECONCILE, /client_portal_invoice_payments\?invoice_id=in\./);
  assert.match(RECONCILE, /if \(recordedPairs\.has\(`\$\{invoice\.id\}:\$\{pi\.id\}`\)\) continue; \/\/ already reconciled, nothing to alert about/);
});

test('a legitimate partial payment (ledger has this exact PaymentIntent recorded, invoice still unpaid) does not trigger a false mismatch alert', () => {
  // The mismatch loop only ever alerts on a (invoice, pi) pair that is
  // NOT in recordedPairs -- a partial payment's own PaymentIntent IS
  // recorded there the moment stripe-webhook processes it, same as a
  // full payment's, so it's excluded by the same check regardless of
  // whether the invoice ever reaches paid: true.
  const fnMatch = RECONCILE.match(/const recordedPairs = new Set[\s\S]*?mismatchCount\+\+;/);
  assert.ok(fnMatch, 'expected to isolate the mismatch-detection block');
  assert.doesNotMatch(fnMatch[0], /invoice\.paid/);
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

// A real production bug (found 2026-09-13 from a live Postgres error:
// 23505 duplicate key on notification_log_notif_type_item_key_key):
// merge-duplicates without an explicit on_conflict targets the
// primary key (id) by default, which is a fresh random uuid every
// insert and can never collide. That silently turned this "upsert"
// into a bare INSERT, which then hit the real
// UNIQUE(notif_type, item_key) constraint and failed outright every
// time the same item was renotified after its resend interval
// elapsed. Fixed in both places that write to notification_log by
// naming that constraint explicitly.
test('markAlerted (reconcile-stripe-payments) upserts notification_log against its real unique constraint, not the default primary key', () => {
  const fnMatch = RECONCILE.match(/async function markAlerted\(itemKey: string\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate markAlerted()');
  assert.match(fnMatch[0], /\/rest\/v1\/notification_log\?on_conflict=notif_type,item_key/);
  assert.match(fnMatch[0], /Prefer: "resolution=merge-duplicates"/);
});

test('markNotified (send-push) upserts notification_log against its real unique constraint, not the default primary key', () => {
  const fnMatch = SEND_PUSH.match(/async function markNotified\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate markNotified()');
  assert.match(fnMatch[0], /\/rest\/v1\/notification_log\?on_conflict=notif_type,item_key/);
  assert.match(fnMatch[0], /Prefer: "resolution=merge-duplicates"/);
});
