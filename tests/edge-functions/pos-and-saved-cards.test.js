// Tests for saved cards and the POS charge tool (2026-09-03), requested
// directly: "We need to start collecting card info to each email to
// make it easy to pay next time" and "add a tool to type in and charge
// a client from my phone without creating an invoice... we could name
// the tool POS."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const PAYMENT_INTENT = fs.readFileSync(repo('edge-functions', 'create-payment-intent-index.ts'), 'utf8');
const POS_CHARGE = fs.readFileSync(repo('edge-functions', 'create-pos-charge-index.ts'), 'utf8');
const WEBHOOK = fs.readFileSync(repo('edge-functions', 'stripe-webhook-index.ts'), 'utf8');
const POS_PAGE = fs.readFileSync(repo('tools', 'pos.html'), 'utf8');
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');

// ---- Saved cards on the normal invoice payment flow ----

test('paying an invoice now attaches a real Stripe Customer and saves the card for off-session use', () => {
  const fnMatch = PAYMENT_INTENT.match(/async function getOrCreateStripeCustomer\(email: string\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate getOrCreateStripeCustomer()');
  assert.match(PAYMENT_INTENT, /const stripeCustomerId = await getOrCreateStripeCustomer\(claims\.email\);/);
  assert.match(PAYMENT_INTENT, /customer: stripeCustomerId,/);
  assert.match(PAYMENT_INTENT, /setup_future_usage: "off_session",/);
});

test('the Stripe customer is looked up by the caller\'s own verified session email, never a client-supplied value', () => {
  const fnMatch = PAYMENT_INTENT.match(/const stripeCustomerId = await getOrCreateStripeCustomer\([^)]+\);/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /claims\.email/);
});

test('creating a Stripe customer upserts the mapping to avoid a race producing two customers for one email', () => {
  const fnMatch = PAYMENT_INTENT.match(/async function getOrCreateStripeCustomer\(email: string\)[\s\S]*?\n\}\n/);
  assert.match(fnMatch[0], /on_conflict=client_email/);
  assert.match(fnMatch[0], /resolution=ignore-duplicates/);
});

// ---- create-pos-charge: authorization ----

test('create-pos-charge is internal-only, using the same "has any role at all" gate as other internal-only sync functions', () => {
  assert.match(POS_CHARGE, /async function callerIsInternalAccount\(email: string\)/);
  assert.match(POS_CHARGE, /if \(!\(await callerIsInternalAccount\(claims\.email\)\)\)/);
});

// ---- create-pos-charge: the three modes ----

test('"check" mode never creates a Stripe Customer, only looks up an existing one', () => {
  const fnMatch = POS_CHARGE.match(/async function findExistingStripeCustomerId\(email: string\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate findExistingStripeCustomerId()');
  assert.doesNotMatch(fnMatch[0], /customers", \{/, 'check mode must not call the Stripe customer-creation endpoint');
  const checkBlockMatch = POS_CHARGE.match(/if \(mode === "check"\) \{[\s\S]*?\n    \}\n/);
  assert.ok(checkBlockMatch);
  assert.match(checkBlockMatch[0], /findExistingStripeCustomerId\(normalizedEmail\)/);
});

test('"charge_saved" mode confirms off-session and synchronously, with a real decline reason surfaced on failure', () => {
  const blockMatch = POS_CHARGE.match(/if \(mode === "charge_saved"\) \{[\s\S]*?return json\(\{ ok: true, charged: true \}\);\s*\n    \}/);
  assert.ok(blockMatch, 'expected to isolate the charge_saved branch');
  const body = blockMatch[0];
  assert.match(body, /off_session: "true",/);
  assert.match(body, /confirm: "true",/);
  assert.match(body, /pi\?\.error\?\.message \|\| pi\?\.last_payment_error\?\.message \|\| "Charge was not approved\."/);
});

test('"new_card" mode returns a client_secret for Stripe Elements, tagged with pos_charge metadata for the webhook', () => {
  assert.match(POS_CHARGE, /"metadata\[pos_charge\]": "true",/);
  assert.match(POS_CHARGE, /"metadata\[pos_client_email\]": normalizedEmail,/);
  assert.match(POS_CHARGE, /return json\(\{ ok: true, client_secret: pi\.client_secret \}\);/);
});

// ---- idempotency: the real bug caught and fixed while building this ----

test('a synchronously-confirmed charge_saved charge is logged with its own PaymentIntent id, so the webhook can recognize it was already logged', () => {
  // Real bug found and fixed while building this: Stripe sends
  // payment_intent.succeeded for EVERY successful charge regardless of
  // how it was confirmed -- including one already confirmed
  // synchronously via confirm:true right here. Without an idempotency
  // key, the webhook's own pos_charge handling would log the same sale
  // to Income a second time.
  const fnMatch = POS_CHARGE.match(/async function logPosIncomeToWorkspaceSync\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate logPosIncomeToWorkspaceSync()');
  const body = fnMatch[0];
  assert.match(body, /entry\.stripePaymentIntentId === stripePaymentIntentId/);
  assert.match(body, /stripePaymentIntentId,/, 'the logged entry must actually store the id it checks against');
  assert.match(POS_CHARGE, /await logPosIncomeToWorkspaceSync\(description, amount, normalizedEmail, claims\.email, pi\.id\);/);
});

test('the webhook checks for pos_charge metadata BEFORE any invoice lookup, and is idempotent on the same PaymentIntent id', () => {
  const piIdx = WEBHOOK.indexOf('const pi = event.data.object');
  const posIdx = WEBHOOK.indexOf('pi.metadata?.pos_charge === "true"');
  const invoiceLookupIdx = WEBHOOK.indexOf('client_portal_invoices?stripe_payment_intent_id=eq.');
  assert.ok(piIdx !== -1 && posIdx !== -1 && invoiceLookupIdx !== -1);
  assert.ok(piIdx < posIdx && posIdx < invoiceLookupIdx, 'pos_charge must be checked before the invoice lookup, which a POS sale has none of');
  assert.match(WEBHOOK, /entry\.stripePaymentIntentId === pi\.id/);
});

test('the webhook logs a POS sale using the same th_income_log shape logInvoiceToIncomeLog() already writes', () => {
  const posBlockMatch = WEBHOOK.match(/if \(pi\.metadata\?\.pos_charge === "true"\) \{[\s\S]*?\n  \}\n/);
  assert.ok(posBlockMatch, 'expected to isolate the pos_charge webhook branch');
  const body = posBlockMatch[0];
  for (const field of ['date:', 'desc:', 'amount:', 'source:', 'payment:', 'origin: "pos",']) {
    assert.match(body, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing field: ${field}`);
  }
});

// ---- POS tool page ----

test('the POS page checks for a saved card automatically as the email is typed, debounced', () => {
  assert.match(POS_PAGE, /checkTimer = setTimeout\(\(\) => checkForSavedCard\(email\), 500\);/);
});

test('a stale saved-card check for an email the user has since changed cannot overwrite the current screen', () => {
  const fnMatch = POS_PAGE.match(/async function checkForSavedCard\(email\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate checkForSavedCard()');
  assert.match(fnMatch[0], /if \(email !== lastCheckedEmail\) return;/);
});

test('an incomplete or malformed email shows a clear message, not silence', () => {
  // Real bug found and fixed (2026-09-03), reported directly with a
  // screenshot: a typo'd email ("testemajl.gmail.com" -- missing the
  // @) silently cleared the charge area with zero explanation. There
  // was text visibly typed into the field and a blank space below it
  // with no hint why nothing was happening. The empty starting state
  // (nothing typed yet) still stays silent -- only text that looks
  // incomplete gets a message.
  const listenerMatch = POS_PAGE.match(/document\.getElementById\('posClientEmail'\)\.addEventListener\('input', \(\) => \{[\s\S]*?\n  \}\);\n/);
  assert.ok(listenerMatch, 'expected to isolate the email input listener');
  const body = listenerMatch[0];
  assert.match(body, /if \(!email\) \{[\s\S]*?area\.innerHTML = '';[\s\S]*?return;/, 'empty field should stay silent');
  assert.match(body, /if \(!email\.includes\('@'\)\) \{[\s\S]*?doesn\\'t look like a complete email yet/, 'incomplete email should show a real message');
});

test('a failed saved-card check always falls back to the manual entry option, never leaves nothing clickable', () => {
  // Real bug found and fixed (2026-09-03), reported directly: "once
  // you type in the info there is no submit option... that pops up."
  // The check failing (server error, network hiccup, cold start) used
  // to clear the charge area to nothing at all. Checking for a saved
  // card is a convenience; its failure must never block the fallback
  // that always works.
  const fnMatch = POS_PAGE.match(/async function checkForSavedCard\(email\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.doesNotMatch(body, /area\.innerHTML = '';/, 'no branch of this function should clear the area to nothing');
  const notOkBranch = body.match(/if \(!result\.ok\) \{[^}]*\}/);
  assert.ok(notOkBranch, 'expected the !result.ok branch');
  assert.match(notOkBranch[0], /renderNewCardOption\(\)/);
  const catchBlock = body.match(/\} catch \(e\) \{[\s\S]*?\n    \}/);
  assert.ok(catchBlock, 'expected the catch block');
  assert.match(catchBlock[0], /renderNewCardOption\(\)/);
});

test('the saved-card charge and the fresh-card flow both call create-pos-charge with the correct mode', () => {
  assert.match(POS_PAGE, /mode: 'charge_saved', client_email: fields\.email/);
  assert.match(POS_PAGE, /mode: 'new_card', client_email: fields\.email/);
});

test('the fresh-card flow reuses the exact Stripe Elements mount-and-confirm pattern already proven in portal/dashboard.html', () => {
  const fnMatch = POS_PAGE.match(/function mountCardEntry\(clientSecret\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate mountCardEntry()');
  const body = fnMatch[0];
  assert.match(body, /stripeInstance\.elements\(\{ clientSecret \}\)/);
  assert.match(body, /redirect: 'if_required',/);
});

test('POS never creates an invoice, quote, or portal record -- only a charge and an income entry', () => {
  assert.doesNotMatch(POS_PAGE, /client_portal_invoices|client_portal_quotes|client_portal_jobs|client_portal_work_orders/);
});

// ---- workspace.html: the tile ----

test('the POS tile is gated by the same permission as Invoices and Clients', () => {
  const tileMatch = WORKSPACE.match(/<div class="tool-tile" data-tile-perm="can_manage_invoices">\s*<a href="\/tools\/pos\.html"/);
  assert.ok(tileMatch, 'expected the POS tile to carry data-tile-perm="can_manage_invoices"');
});

test('the POS tile has help text', () => {
  assert.match(WORKSPACE, /onclick="event\.stopPropagation\(\); openCardInfo\('tool-pos'\)"/);
  assert.match(WORKSPACE, /'tool-pos': \{/);
});

// ---- POS receipt email (2026-09-03) ----

test('a synchronously-confirmed charge_saved sends a receipt to the client right after logging income', () => {
  const chargeSavedBlock = POS_CHARGE.match(/if \(mode === "charge_saved"\) \{[\s\S]*?return json\(\{ ok: true, charged: true \}\);\s*\n    \}/);
  assert.ok(chargeSavedBlock);
  const body = chargeSavedBlock[0];
  const logIdx = body.indexOf('logPosIncomeToWorkspaceSync');
  const receiptIdx = body.indexOf('sendPosReceiptEmail');
  assert.ok(logIdx !== -1 && receiptIdx !== -1);
  assert.match(body, /await sendPosReceiptEmail\(normalizedEmail, description, amount\);/);
});

test('the webhook only sends a receipt alongside a genuinely new income log entry, guarded by the same idempotency check', () => {
  const posBlockMatch = WEBHOOK.match(/if \(pi\.metadata\?\.pos_charge === "true"\) \{[\s\S]*?\n  \}\n/);
  assert.ok(posBlockMatch);
  const body = posBlockMatch[0];
  const notAlreadyLoggedIdx = body.indexOf('if (!alreadyLogged) {');
  const sendReceiptIdx = body.indexOf('await sendPosReceiptEmail(');
  assert.ok(notAlreadyLoggedIdx !== -1 && sendReceiptIdx !== -1);
  assert.ok(notAlreadyLoggedIdx < sendReceiptIdx, 'the receipt send must be inside the !alreadyLogged guard');
});

test('a receipt email failing to send never blocks or undoes an already-succeeded charge', () => {
  const fnMatch = POS_CHARGE.match(/async function sendPosReceiptEmail\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate sendPosReceiptEmail()');
  assert.match(fnMatch[0], /try \{[\s\S]*?\} catch \(err\) \{/);
});

test('the receipt shows the date, description, and amount -- exactly what was charged, nothing else', () => {
  const fnMatch = POS_CHARGE.match(/function buildPosReceiptEmail\([\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate buildPosReceiptEmail()');
  const body = fnMatch[0];
  assert.match(body, /\$\{dateLabel\}/);
  assert.match(body, /escapeHtmlPos\(description \|\| "Service call"\)/);
  assert.match(body, /\$\{amountLabel\}/);
});
