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
  const recordIdx = MANAGE_CARD.indexOf('await recordCardAuthorization(callerEmail, signer_name.trim(), authorizationText, signature_image);');
  // Stripe POSTs go through stripePost() with an Idempotency-Key since 2026-10-31.
  const setupIdx = MANAGE_CARD.indexOf('await stripePost("setup_intents"');
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
  assert.match(block[0], /stripePost\("setup_intents"/);
  assert.doesNotMatch(block[0], /payment_intents/);
});

test('an existing Stripe customer is reused rather than created twice', () => {
  assert.match(MANAGE_CARD, /const setupCustomerId = customerId \|\| await getOrCreateStripeCustomer\(callerEmail\);/);
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
  // Loaded by a small post-load injector (2026-10 speed pass) rather than a
  // parser-blocking <script src>, so the URL appears as a string in that loader.
  assert.match(SETTINGS, /s\.src = 'https:\/\/js\.stripe\.com\/v3\/';\s*document\.head\.appendChild\(s\);/);
  assert.match(SETTINGS, /window\.addEventListener\('load'/);
  assert.match(SETTINGS, /script-src[^"]*https:\/\/js\.stripe\.com/);
  assert.match(SETTINGS, /connect-src[^"]*https:\/\/api\.stripe\.com/);
  assert.match(SETTINGS, /frame-src https:\/\/js\.stripe\.com/);
});

// ---- Fix plan RP4.4 (2026-11-07): the gate is asked BEFORE the signature step ----

function addCardPage(answer) {
  const { JSDOM } = require('jsdom');
  const grab = (name) => {
    const start = SETTINGS.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    let depth = 0, i = SETTINGS.indexOf('{', start);
    for (; i < SETTINGS.length; i++) { if (SETTINGS[i] === '{') depth++; else if (SETTINGS[i] === '}' && --depth === 0) { i++; break; } }
    return SETTINGS.slice(start, i);
  };
  const dom = new JSDOM('<!DOCTYPE html><body><button id="addCardBtn">Add a Card</button><div id="addCardArea"></div></body>', { runScripts: 'outside-only', url: 'https://www.triplehenterprisesllc.biz/portal/settings.html' });
  const w = dom.window;
  w.fetches = [];
  w.client = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
  w.fetch = async (u, init) => { w.fetches.push(JSON.parse(init.body)); if (answer instanceof Error) throw answer; return { json: async () => answer }; };
  w.sigPadInit = () => { w.padInit = true; };
  w.eval(['addCardAllowed', 'startAddCard', 'cancelAddCard'].map(grab).join('\n') + ';window.startAddCard = startAddCard; window.cancelAddCard = cancelAddCard;');
  return w;
}

test('RP4.4: a gated account sees the explanation, never the name/signature step', async () => {
  const msg = "Saving a card isn't available on this account yet -- it needs at least one invoice, quote, job, contract or checkup from Triple H first.";
  const w = addCardPage({ ok: true, can_save_card: false, message: msg });
  await w.startAddCard();
  assert.deepEqual(w.fetches, [{ mode: 'can_save_card' }]);
  assert.equal(w.document.getElementById('addCardSignatureCanvas'), null);
  assert.equal(w.document.getElementById('addCardSignerName'), null);
  assert.equal(w.document.getElementById('addCardNotAllowed').textContent, msg);
  assert.equal(w.padInit, undefined);
  w.close();
});

test('RP4.4: an allowed account (or any unclear answer) gets the signature step as before', async () => {
  for (const answer of [{ ok: true, can_save_card: true }, { ok: false, error: 'Unknown mode.' }, new Error('offline')]) {
    const w = addCardPage(answer);
    await w.startAddCard();
    assert.ok(w.document.getElementById('addCardSignatureCanvas'), JSON.stringify(String(answer)));
    assert.ok(w.document.getElementById('addCardSignerName'));
    assert.equal(w.padInit, true);
    w.close();
  }
});
