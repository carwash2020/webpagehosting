// Tests for physical/drawn signature capture (2026-09-22), requested
// directly: "Currently they just type a name, i want a physical
// signature." Extends the existing card_authorizations dispute-
// protection pattern (typed name + text) with an actual canvas-drawn
// signature image, stored alongside the typed name rather than
// replacing it. The shared drawing implementation (signature-pad.js)
// was extracted from portal/contracts.html's own already-working
// canvas signature pad, generalized with a sigPad* prefix so its
// globals never collide with that page's own like-named wrapper
// functions (initSignaturePad/clearContractSignature/
// getContractSignatureDataUrl), which portal/contracts.html keeps for
// its existing onclick handlers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SIGNATURE_PAD = fs.readFileSync(repo('signature-pad.js'), 'utf8');
const CONTRACTS = fs.readFileSync(repo('portal', 'contracts.html'), 'utf8');
const DASHBOARD = fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8');
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
const INVOICE_GEN = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');
const POS_CHARGE = fs.readFileSync(repo('edge-functions', 'create-pos-charge-index.ts'), 'utf8');
const PAYMENT_INTENT = fs.readFileSync(repo('edge-functions', 'create-payment-intent-index.ts'), 'utf8');
const BULK_PAYMENT_INTENT = fs.readFileSync(repo('edge-functions', 'create-bulk-payment-intent-index.ts'), 'utf8');
const MANAGE_CARD = fs.readFileSync(repo('edge-functions', 'manage-saved-card-index.ts'), 'utf8');
const MIGRATION = fs.readFileSync(repo('sql', 'infra', 'add_signature_image_to_card_authorizations.sql'), 'utf8');

// ---- signature-pad.js itself ----

test('signature-pad.js defines the 4 sigPad* globals, prefixed so they never collide with a page\'s own like-named wrappers', () => {
  assert.match(SIGNATURE_PAD, /function sigPadInit\(canvasId, statusElId\)/);
  assert.match(SIGNATURE_PAD, /function sigPadClear\(canvasId, statusElId\)/);
  assert.match(SIGNATURE_PAD, /function sigPadHasDrawing\(canvasId\)/);
  assert.match(SIGNATURE_PAD, /function sigPadDataUrl\(canvasId\)/);
});

test('sigPadDataUrl returns null (not a blank data URL) when nothing has been drawn, so callers can tell "no signature" apart from "a signature exists"', () => {
  const fn = SIGNATURE_PAD.match(/function sigPadDataUrl\(canvasId\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(!sigPadHasDrawing\(canvasId\)\) return null;/);
});

test('sigPadInit is keyed by canvasId, not a record id, so a page can host more than one pad or reuse whatever DOM id it already has', () => {
  const fn = SIGNATURE_PAD.match(/function sigPadInit\(canvasId, statusElId\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /document\.getElementById\(canvasId\)/);
  assert.match(fn, /_signaturePadState\[canvasId\]/);
});

test('drawing is captured via pointer events (not mouse-only), so it works on a touchscreen phone', () => {
  const fn = SIGNATURE_PAD.match(/function sigPadInit\(canvasId, statusElId\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /addEventListener\('pointerdown'/);
  assert.match(fn, /addEventListener\('pointermove'/);
  assert.match(fn, /addEventListener\('pointerup'/);
  assert.match(fn, /addEventListener\('pointercancel'/);
});

test('sigPadClear resets the drawn state, not just the canvas pixels, so sigPadDataUrl correctly reports "no signature" again after Clear', () => {
  const fn = SIGNATURE_PAD.match(/function sigPadClear\(canvasId, statusElId\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\);/);
  assert.match(fn, /_signaturePadState\[canvasId\]\.hasDrawing = false/);
});

test('signature-pad.js is loaded by all 4 pages that now capture a drawn signature', () => {
  for (const [name, html] of [['contracts.html', CONTRACTS], ['dashboard.html', DASHBOARD], ['settings.html', SETTINGS], ['invoice-generator.html', INVOICE_GEN]]) {
    assert.match(html, /<script src="\/signature-pad\.js\?v=[a-f0-9]+"/, `${name} should load the shared signature-pad.js`);
  }
});

// ---- portal/contracts.html: refactored onto the shared pad, same external API ----

test('contracts.html keeps its own function names (initSignaturePad/clearContractSignature/getContractSignatureDataUrl) as thin wrappers, so its existing onclick handlers keep working unmodified', () => {
  assert.match(CONTRACTS, /function initSignaturePad\(contractId\) \{\s*\n\s*sigPadInit\('signatureCanvas-' \+ contractId, 'signatureStatus-' \+ contractId\);\s*\n\s*\}/);
  assert.match(CONTRACTS, /function clearContractSignature\(contractId\) \{\s*\n\s*sigPadClear\('signatureCanvas-' \+ contractId, 'signatureStatus-' \+ contractId\);\s*\n\s*\}/);
  assert.match(CONTRACTS, /function getContractSignatureDataUrl\(contractId\) \{\s*\n\s*return sigPadDataUrl\('signatureCanvas-' \+ contractId\);\s*\n\s*\}/);
});

// ---- tools/invoice-generator.html: POS Quick Charge new-card signature ----

test('invoice-generator.html: the Quick Charge new-card form has a real signature canvas, initialized via sigPadInit', () => {
  assert.match(INVOICE_GEN, /<canvas id="posSignatureCanvas"/);
  assert.match(INVOICE_GEN, /onclick="sigPadClear\(\\'posSignatureCanvas\\', \\'posSignatureStatus\\'\)"/);
  assert.match(INVOICE_GEN, /sigPadInit\('posSignatureCanvas', 'posSignatureStatus'\);/);
});

test('invoice-generator.html: startNewCardCharge requires a drawn signature (not just a typed name) before entering a card', () => {
  const fn = INVOICE_GEN.match(/const signatureImage = typeof sigPadDataUrl === 'function' \? sigPadDataUrl\('posSignatureCanvas'\) : null;[\s\S]*?\n\s*\}/)[0];
  assert.match(fn, /if \(!signatureImage\) \{/);
  assert.match(fn, /showError\('A drawn signature is required before entering a card\.'\);/);
  assert.match(fn, /return;/);
});

test('invoice-generator.html: the drawn signature is sent to create-pos-charge as signature_image', () => {
  assert.match(INVOICE_GEN, /body: JSON\.stringify\(\{ mode: 'new_card', client_email: fields\.email, amount: fields\.amount, description: fields\.description, signer_name: signerName, signature_image: signatureImage \}\)/);
});

// ---- portal/dashboard.html: single + bulk invoice payment signature ----

test('dashboard.html: both single and bulk payment signature steps render a real signature canvas', () => {
  assert.match(DASHBOARD, /<canvas id="paySignatureCanvas"/);
  assert.match(DASHBOARD, /<canvas id="bulkPaySignatureCanvas"/);
});

test('dashboard.html: submitPaymentSignature requires a drawn signature before retrying startPayment', () => {
  const fn = DASHBOARD.match(/function submitPaymentSignature\(invoiceId\)[\s\S]*?\n  \}\n/)[0];
  assert.match(fn, /sigPadDataUrl\('paySignatureCanvas'\)/);
  assert.match(fn, /if \(!signatureImage\) \{[\s\S]*?return;/);
  assert.match(fn, /startPayment\(invoiceId, signerName, signatureImage\);/);
});

test('dashboard.html: submitBulkPaymentSignature requires a drawn signature before retrying startBulkPayment', () => {
  const fn = DASHBOARD.match(/function submitBulkPaymentSignature\(invoiceIds\)[\s\S]*?\n  \}\n/)[0];
  assert.match(fn, /sigPadDataUrl\('bulkPaySignatureCanvas'\)/);
  assert.match(fn, /if \(!signatureImage\) \{[\s\S]*?return;/);
  assert.match(fn, /startBulkPayment\(invoiceIds, signerName, signatureImage\);/);
});

test('dashboard.html: the drawn signature is sent to create-payment-intent and create-bulk-payment-intent as signature_image', () => {
  assert.match(DASHBOARD, /body: JSON\.stringify\(\{ invoice_id: invoiceId, signer_name: signerName \|\| undefined, signature_image: signatureImage \|\| undefined \}\)/);
  assert.match(DASHBOARD, /body: JSON\.stringify\(\{ invoice_ids: invoiceIds, signer_name: signerName \|\| undefined, signature_image: signatureImage \|\| undefined \}\)/);
});

// ---- portal/settings.html: add-card signature + authorization history ----

test('settings.html: startAddCard renders a real signature canvas, initialized via sigPadInit', () => {
  assert.match(SETTINGS, /<canvas id="addCardSignatureCanvas"/);
  assert.match(SETTINGS, /sigPadInit\('addCardSignatureCanvas', 'addCardSignatureStatus'\);/);
});

test('settings.html: submitAddCardSignature requires a drawn signature before calling manage-saved-card', () => {
  const fn = SETTINGS.match(/async function submitAddCardSignature\(\)[\s\S]*?\n  \}\n/)[0];
  assert.match(fn, /sigPadDataUrl\('addCardSignatureCanvas'\)/);
  assert.match(fn, /if \(!signatureImage\) \{[\s\S]*?showToast\('Please sign to continue\.', \{ type: 'error' \}\);[\s\S]*?return;/);
});

test('settings.html: loadAuthorizations selects signature_image and renders a thumbnail when present, staying backward compatible with older rows that have none', () => {
  assert.match(SETTINGS, /\.select\('signer_name,authorization_text,context,amount,description,signature_image,created_at'\)/);
  assert.match(SETTINGS, /const signatureHtml = a\.signature_image\s*\n\s*\? '<img src="' \+ a\.signature_image \+ '"/);
});

// ---- edge functions: all 4 require a real data:image/ signature, not just a typed name ----

for (const [name, src, needle] of [
  ['create-pos-charge', POS_CHARGE, 'signature_image'],
  ['create-payment-intent', PAYMENT_INTENT, 'signature_image'],
  ['create-bulk-payment-intent', BULK_PAYMENT_INTENT, 'signature_image'],
  ['manage-saved-card', MANAGE_CARD, 'signature_image'],
]) {
  test(`${name}: rejects a request with a signer_name but no real drawn signature_image`, () => {
    assert.match(src, /typeof signature_image !== "string" \|\| !signature_image\.startsWith\("data:image\/"\)/);
    assert.match(src, new RegExp(`const \\{[^}]*${needle}[^}]*\\} = await req\\.json\\(\\);`));
  });
}

test('create-pos-charge and create-payment-intent/create-bulk-payment-intent/manage-saved-card all pass signature_image through to recordCardAuthorization, alongside the typed signer_name', () => {
  assert.match(POS_CHARGE, /recordCardAuthorization\(normalizedEmail, signer_name\.trim\(\), authorizationText, amount, description, claims\.email, signature_image\);/);
  assert.match(PAYMENT_INTENT, /recordCardAuthorization\(claims\.email, signer_name\.trim\(\), authorizationText, amountCents \/ 100, invoice\.id, signature_image\);/);
  assert.match(BULK_PAYMENT_INTENT, /recordCardAuthorization\(claims\.email, signer_name\.trim\(\), authorizationText, amountCents \/ 100, `\$\{invoiceCount\} invoices \(IDs: \$\{invoice_ids\.join\(", "\)\}\)`, signature_image\);/);
  assert.match(MANAGE_CARD, /recordCardAuthorization\(claims\.email, signer_name\.trim\(\), authorizationText, signature_image\);/);
});

// ---- schema ----

test('the card_authorizations.signature_image column is additive and nullable, so existing rows (typed-name-only) need no backfill', () => {
  assert.match(MIGRATION, /alter table public\.card_authorizations add column if not exists signature_image text;/);
});
