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

// Since 2026-10-31 (Stripe hardening) the claim is made inside
// stripe_record_event() -> stripe_apply_pi_succeeded() in
// sql/payments/01_stripe_event_ledger_payments_refunds.sql, and the
// webhook acts on its pos_first result. create-pos-charge's charge_saved
// path now claims the same row too (it used to log without claiming, so
// the webhook's claim always won and could log the sale twice).
const LEDGER_SQL = fs.readFileSync(repo('sql', 'payments', '01_stripe_event_ledger_payments_refunds.sql'), 'utf8');
const POS_CHARGE = fs.readFileSync(repo('edge-functions', 'create-pos-charge-index.ts'), 'utf8');

function sqlPosBlock() {
  const fn = LEDGER_SQL.match(/create or replace function public\.stripe_apply_pi_succeeded[\s\S]*?\n\$\$;/);
  assert.ok(fn, 'expected to isolate stripe_apply_pi_succeeded()');
  const block = fn[0].match(/if \(v_meta ->> 'pos_charge'\) = 'true' then[\s\S]*?end if;/);
  assert.ok(block, 'expected to isolate its POS branch');
  return block[0];
}
function posBlock() {
  const match = WEBHOOK.match(/if \(result\.action === "pos_charge"\) \{[\s\S]*?\n  \}\n/);
  assert.ok(match, 'expected to isolate the webhook POS branch');
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

// ---- claim (SQL) + webhook + create-pos-charge ----

test('the POS claim is an atomic insert on the payment_intent_id primary key, never a scan of th_income_log', () => {
  const block = sqlPosBlock();
  assert.match(block, /insert into public\.stripe_pos_charges_logged \(payment_intent_id\) values \(p_pi ->> 'id'\)\s*\n\s*on conflict \(payment_intent_id\) do nothing;/);
  assert.doesNotMatch(WEBHOOK, /const alreadyLogged/);
});

test('the claim carries only the PaymentIntent id', () => {
  assert.match(sqlPosBlock(), /\(payment_intent_id\) values \(p_pi ->> 'id'\)/);
});

test('winning the race is decided from whether the insert actually inserted a row', () => {
  const block = sqlPosBlock();
  assert.match(block, /get diagnostics v_pos_first = row_count;/);
  assert.match(block, /'pos_first', v_pos_first/);
});

test('the income-log read-modify-write only happens when this delivery won the race', () => {
  assert.match(posBlock(), /if \(result\.pos_first\) \{\s*\n\s*await logPosIncome\(pi\);/);
});

test('the receipt email is only sent inside the pos_first branch, so a losing duplicate delivery never re-sends it', () => {
  const block = posBlock();
  const wonIdx = block.indexOf('if (result.pos_first) {');
  const emailIdx = block.indexOf('await sendPosReceiptEmail(');
  assert.ok(wonIdx !== -1 && emailIdx !== -1);
  assert.ok(wonIdx < emailIdx, 'sendPosReceiptEmail must be inside the pos_first branch');
});

test('the POS branch still always returns 200 to Stripe, whether or not this delivery won the race', () => {
  assert.match(posBlock(), /return new Response\(JSON\.stringify\(\{ received: true, pos_charge: true \}\), \{ status: 200 \}\);/);
});

test('create-pos-charge charge_saved claims the same row before logging, so it and the webhook never both log one sale', () => {
  const fn = POS_CHARGE.match(/async function claimPosCharge\([\s\S]*?\n\}\n/);
  assert.ok(fn, 'expected claimPosCharge()');
  assert.match(fn[0], /stripe_pos_charges_logged\?on_conflict=payment_intent_id/);
  assert.match(fn[0], /Prefer: "resolution=ignore-duplicates,return=representation"/);
  assert.match(POS_CHARGE, /if \(await claimPosCharge\(pi\.id\)\) \{\s*\n\s*await logPosIncomeToWorkspaceSync\([^)]*\);\s*\n\s*await sendPosReceiptEmail\(/);
});
