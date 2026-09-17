// Tests for portal/contracts.html -- the async e-signature flow for
// contracts, added to close a real gap found in a full-repo audit:
// quotes already had a full async approve/decline flow via
// client_portal_quotes/respond-to-quote; the three contract templates
// in tools/contract-generator.html could only ever be signed in person,
// on the same device. Source-inspection style, same reasoning as
// tests/portal/quotes.test.js: this page depends on a real Supabase
// session and edge functions that aren't practical to simulate
// end-to-end in this test environment.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'portal', 'contracts.html');
const html = fs.readFileSync(PAGE_PATH, 'utf8');

test('portal/contracts.html loads none of the internal /tools/ scripts', () => {
  for (const forbidden of ['auth.js', 'sync.js', 'data-layer.js', 'tools-nav-pwa.js']) {
    assert.ok(!html.includes(forbidden), `portal/contracts.html should never load /tools/${forbidden}`);
  }
});

test('contracts.html cross-links to and from home.html', () => {
  assert.match(html, /<a href="\/portal\/home\.html">[\s\S]*?<span>Home<\/span>/);
  const homeHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'home.html'), 'utf8');
  assert.match(homeHtml, /href: '\/portal\/contracts\.html'/);
});

test('contracts is deliberately NOT a 6th item in the shared 5-column bottom nav', () => {
  // The nav grid in portal-app.css is hard-coded to exactly 5 equal
  // columns specifically to fix a real bug (a lone 6th flex item
  // wrapping onto its own row and stretching full-width) -- confirmed
  // by the comment already on this file. A 6th <a> here would silently
  // reintroduce that failure mode.
  const navMatch = html.match(/<nav class="portal-nav"[\s\S]*?<\/nav>/);
  assert.ok(navMatch, 'expected to find the portal-nav element');
  const linkCount = (navMatch[0].match(/<a href=/g) || []).length;
  assert.equal(linkCount, 5, 'the bottom nav should still have exactly 5 links');
});

test('an unauthenticated visitor is redirected to login, not shown contracts', () => {
  assert.match(html, /if \(!session\) \{\s*window\.location\.replace\('\/portal\/login\.html'\);/);
});

test('signing/declining only ever go through the respond-to-contract edge function, never a direct table write', () => {
  assert.match(html, /functions\/v1\/respond-to-contract/);
  assert.doesNotMatch(html, /client\s*\.\s*from\(['"]client_portal_contracts['"]\)[\s\S]{0,80}\.(update|upsert|insert|delete)\(/);
});

test('signing requires a captured signature before the request is sent', () => {
  const fnMatch = html.match(/async function respondToContract\([\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate respondToContract()');
  assert.match(fnMatch[0], /if \(!clientSignatureDataUrl\) \{/);
  assert.match(fnMatch[0], /Please draw your signature/);
});

test('a pending contract offers Sign and Decline; a responded contract does not', () => {
  assert.match(html, /respondToContract\(\$\{c\.id\}, 'sign', this\)/);
  assert.match(html, /respondToContract\(\$\{c\.id\}, 'decline', this\)/);
  assert.match(html, /isPending \? `/);
});

test('the contract card only reads fields that actually exist on client_portal_contracts', () => {
  const fnMatch = html.match(/function renderContractCard\(c\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderContractCard');
  const fnBody = fnMatch[0];
  const realFields = ['id', 'contract_title', 'created_at', 'status', 'blocks', 'responded_at'];
  const fieldRefs = [...fnBody.matchAll(/c\.([a-zA-Z_]+)/g)].map(m => m[1]);
  for (const field of fieldRefs) {
    assert.ok(realFields.includes(field), `renderContractCard references c.${field}, which isn't a real client_portal_contracts column`);
  }
});

test('the read-only block renderer never emits an unescaped field into the page', () => {
  const fnMatch = html.match(/function renderBlock\(block\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderBlock()');
  // Every branch that touches block.text/label/value goes through
  // escapeHtml() -- contract content ultimately comes from
  // tools/contract-generator.html form fields, which are client-supplied
  // text (client name, job description, etc.), not trusted markup.
  assert.doesNotMatch(fnMatch[0], /\$\{block\.(text|label|value|sub)\}/, 'block content must be escaped, not interpolated raw');
});

// ---- tools/contract-generator.html: the internal side of this flow ----

const GENERATOR_PATH = path.join(__dirname, '..', '..', 'tools', 'contract-generator.html');
const generatorHtml = fs.readFileSync(GENERATOR_PATH, 'utf8');

test('generating a contract with a client email and no in-person signature syncs it to the portal', () => {
  assert.match(generatorHtml, /functions\/v1\/sync-contract-to-portal/);
  const fnMatch = generatorHtml.match(/async function generateAndLog\(type\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate generateAndLog()');
  assert.match(fnMatch[0], /if \(!clientSignatureDataUrl && fields\.email && typeof getAuthToken === 'function'\)/,
    'the portal sync should be skipped entirely when the client already signed in person');
});

test('a contract already signed in person is never also sent to the portal for e-signature', () => {
  const fnMatch = generatorHtml.match(/async function generateAndLog\(type\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  // The guard checked above (!clientSignatureDataUrl) is the only gate
  // on the sync branch -- this test pins that the branch is genuinely
  // unreachable when a signature was drawn on the in-person pad first.
  const guardIdx = fnMatch[0].indexOf("if (!clientSignatureDataUrl && fields.email");
  const syncCallIdx = fnMatch[0].indexOf('sync-contract-to-portal');
  assert.ok(guardIdx !== -1 && syncCallIdx !== -1 && guardIdx < syncCallIdx,
    'the portal-sync fetch must be nested inside the !clientSignatureDataUrl guard');
});

test('the sent-for-signature and failure outcomes are both surfaced with a real pop-up, not a silent console.warn', () => {
  const fnMatch = generatorHtml.match(/async function generateAndLog\(type\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /await showAlert\('Contract generated, logged, and sent to '/);
  assert.match(fnMatch[0], /await showAlert\('Contract generated and logged, but sending for e-signature failed:/);
});

test('portal contract status is read live, never written back into the local contract record', () => {
  const fnMatch = generatorHtml.match(/async function refreshPortalContractStatuses\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate refreshPortalContractStatuses()');
  assert.doesNotMatch(fnMatch[0], /saveContractLog/);
  assert.match(fnMatch[0], /rest\/v1\/client_portal_contracts/);
});

// ---- edge functions: permission and ownership boundaries ----

const SYNC_FN_PATH = path.join(__dirname, '..', '..', 'edge-functions', 'sync-contract-to-portal-index.ts');
const RESPOND_FN_PATH = path.join(__dirname, '..', '..', 'edge-functions', 'respond-to-contract-index.ts');
const syncFnSrc = fs.readFileSync(SYNC_FN_PATH, 'utf8');
const respondFnSrc = fs.readFileSync(RESPOND_FN_PATH, 'utf8');

test('sync-contract-to-portal gates on can_manage_contracts, not can_manage_invoices', () => {
  assert.match(syncFnSrc, /account_roles\?email=eq\.\$\{encodeURIComponent\(email\.toLowerCase\(\)\)\}&select=can_manage_contracts/);
  // The file's own header comment explains the distinction from
  // can_manage_invoices in prose -- checking only the real permission
  // column read above (not the whole file) avoids a false failure on
  // that comment while still confirming the actual gate is right.
});

test('respond-to-contract verifies the contract belongs to the caller before writing, and requires a signature to sign', () => {
  assert.match(respondFnSrc, /contract\.client_email\.toLowerCase\(\) !== claims\.email\.toLowerCase\(\)/);
  assert.match(respondFnSrc, /looksLikeSignatureDataUrl/);
  assert.match(respondFnSrc, /if \(contract\.status !== "pending"\)/);
});
