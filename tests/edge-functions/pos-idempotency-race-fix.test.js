// Tests for the Stripe POS double-log race fix (audit item #7). The
// 'new_card' POS charge path in stripe-webhook-index.ts used to check
// for an existing th_income_log entry with a matching
// stripePaymentIntentId by scanning the workspace_sync JSON blob in
// JS, then append only if none was found -- a plain check-then-act
// with no atomic guarantee. Two near-simultaneous webhook deliveries
// for the same event (Stripe does redeliver, and can rarely
// double-deliver close together) could both pass that check before
// either write landed, producing two income-log entries and two
// duplicate receipt emails for one real charge. The fix replaces the
// JS-array scan with an atomic INSERT against a real Postgres unique
// constraint (stripe_pos_charges_logged.payment_intent_id), gating
// the income-log write and receipt email behind whether this request
// actually won that insert race.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WEBHOOK = fs.readFileSync(repo('edge-functions', 'stripe-webhook-index.ts'), 'utf8');
const SQL = fs.readFileSync(repo('sql', 'infra', 'add_stripe_pos_charge_idempotency.sql'), 'utf8');

function posBlock() {
  const match = WEBHOOK.match(/if \(pi\.metadata\?\.pos_charge === "true"\) \{[\s\S]*?\n  \}\n\n  \/\/ Looked up by the PaymentIntent id first/);
  assert.ok(match, 'expected to isolate the POS-charge branch');
  return match[0];
}

// ---- SQL migration ----

test('stripe_pos_charges_logged has payment_intent_id as a real primary key', () => {
  assert.match(SQL, /create table stripe_pos_charges_logged \(\s*\n\s*payment_intent_id text primary key,/);
});

test('the idempotency table has row level security enabled', () => {
  assert.match(SQL, /alter table stripe_pos_charges_logged enable row level security;/);
});

test('the idempotency table has no insert/update/delete policy for the authenticated role -- only the service role (used server-side) can write to it', () => {
  assert.doesNotMatch(SQL, /for insert/);
  assert.doesNotMatch(SQL, /for update/);
  assert.doesNotMatch(SQL, /for delete/);
});

test('the select policy restricts reads to internal accounts, matching the rest of the schema\'s internal-only pattern', () => {
  assert.match(SQL, /create policy "internal accounts can view pos charge idempotency records"\s*\n\s*on stripe_pos_charges_logged for select\s*\n\s*to authenticated\s*\n\s*using \(exists \(select 1 from account_roles where email = \(select auth\.email\(\)\)\)\);/);
});

// ---- edge function ----

test('the POS branch claims the payment_intent_id via an atomic on_conflict insert instead of scanning th_income_log', () => {
  const block = posBlock();
  assert.match(block, /stripe_pos_charges_logged\?on_conflict=payment_intent_id/);
  assert.doesNotMatch(block, /JSON\.parse\(blob\.th_income_log[\s\S]{0,80}\)\s*\n\s*const alreadyLogged/);
});

test('the claim insert uses ignore-duplicates so the losing request gets a normal empty response, not a 409 to handle', () => {
  const block = posBlock();
  assert.match(block, /Prefer: "resolution=ignore-duplicates,return=representation",/);
});

test('the claim insert body carries only the PaymentIntent id', () => {
  const block = posBlock();
  assert.match(block, /body: JSON\.stringify\(\{ payment_intent_id: pi\.id \}\),/);
});

test('winning the race is decided from whether the insert actually returned a row', () => {
  const block = posBlock();
  assert.match(block, /const claimRows = claimRes\.ok \? await claimRes\.json\(\) : \[\];/);
  assert.match(block, /const wonTheRace = claimRows\.length > 0;/);
});

test('the income-log read-modify-write only happens when this request won the race', () => {
  const block = posBlock();
  assert.match(block, /if \(wonTheRace\) \{\s*\n\s*const syncRes = await fetch\(/);
});

test('the receipt email is only sent inside the wonTheRace branch, so a losing duplicate delivery never re-sends it', () => {
  const block = posBlock();
  const wonIdx = block.indexOf('if (wonTheRace) {');
  const emailIdx = block.indexOf('await sendPosReceiptEmail(');
  assert.ok(wonIdx !== -1 && emailIdx !== -1);
  assert.ok(wonIdx < emailIdx, 'sendPosReceiptEmail must be inside the wonTheRace branch');
});

test('the POS branch still always returns 200 to Stripe, whether or not this request won the race', () => {
  const block = posBlock();
  assert.match(block, /return new Response\(JSON\.stringify\(\{ received: true, pos_charge: true \}\), \{ status: 200 \}\);/);
});
