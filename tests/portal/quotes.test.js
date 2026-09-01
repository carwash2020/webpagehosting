// Tests for portal/quotes.html (2026-09-02), phase 2 of the client
// portal roadmap in docs/CLIENT-PORTAL.md. Source-inspection style,
// same reasoning as tests/portal/dashboard-invoice-pdf.test.js: this
// page depends on a real Supabase session and edge functions that
// aren't practical to simulate end-to-end in this test environment.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'portal', 'quotes.html');
const html = fs.readFileSync(PAGE_PATH, 'utf8');

test('portal/quotes.html loads none of the internal /tools/ scripts', () => {
  // The same isolation boundary dashboard.html and login.html hold --
  // confirming it holds here too, not just at those two pages.
  for (const forbidden of ['auth.js', 'sync.js', 'data-layer.js', 'tools-nav-pwa.js']) {
    assert.ok(!html.includes(forbidden), `portal/quotes.html should never load /tools/${forbidden}`);
  }
});

test('quotes.html and dashboard.html cross-link to each other', () => {
  assert.match(html, /<a href="\/portal\/dashboard\.html">Invoices<\/a>/);
  const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'dashboard.html'), 'utf8');
  assert.match(dashboardHtml, /<a href="\/portal\/quotes\.html">Quotes<\/a>/);
});

test('an unauthenticated visitor is redirected to login, not shown quotes', () => {
  assert.match(html, /if \(!session\) \{\s*window\.location\.replace\('\/portal\/login\.html'\);/);
});

test('approve/decline only ever go through the respond-to-quote edge function, never a direct table write', () => {
  assert.match(html, /functions\/v1\/respond-to-quote/);
  assert.doesNotMatch(html, /client\s*\.\s*from\(['"]client_portal_quotes['"]\)[\s\S]{0,80}\.(update|upsert|insert|delete)\(/);
});

test('asking a question ties the client_email to the caller\'s own session, not a typed-in value', () => {
  // submitQuestion() must source client_email from session.user.email,
  // never from a form field a client could edit -- the RLS with-check
  // enforces this server-side too, but the client code should never
  // even attempt anything else.
  assert.match(html, /client_email:\s*session\.user\.email/);
});

test('a pending quote offers Approve, Decline, and Ask a question; a responded quote does not', () => {
  assert.match(html, /respondToQuote\(\$\{q\.id\}, 'approve'\)/);
  assert.match(html, /respondToQuote\(\$\{q\.id\}, 'decline'\)/);
  assert.match(html, /toggleQuestionForm\(\$\{q\.id\}\)/);
  assert.match(html, /isPending \? `/);
});

test('the quote card only reads fields that actually exist on client_portal_quotes', () => {
  const fnMatch = html.match(/function renderQuoteCard\(q\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate the renderQuoteCard function body');
  const fnBody = fnMatch[0];
  const realFields = ['id', 'quote_number', 'quote_date', 'description', 'total', 'status', 'line_items', 'responded_at'];
  const fieldRefs = [...fnBody.matchAll(/q\.([a-zA-Z_]+)/g)].map(m => m[1]);
  for (const field of fieldRefs) {
    assert.ok(realFields.includes(field), `renderQuoteCard references q.${field}, which isn't a real client_portal_quotes column`);
  }
});

// ---- tools/invoice-generator.html: the internal side of phase 2 ----

const GENERATOR_PATH = path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html');
const generatorHtml = fs.readFileSync(GENERATOR_PATH, 'utf8');

test('the Quote tab has a client email field, mirroring the Invoice tab\'s field', () => {
  assert.match(generatorHtml, /<input type="email" id="quoteClientEmail"/);
});

test('saving a quote with a client email syncs to the portal, matching the invoice save pattern', () => {
  assert.match(generatorHtml, /functions\/v1\/sync-quote-to-portal/);
  assert.match(generatorHtml, /Portal sync failed \(quote still saved locally\)/);
});

test('portal quote status is read live, never written back into the local quote record', () => {
  // The whole point of refreshPortalQuoteStatuses() is a read-only
  // query against client_portal_quotes/quote_questions -- confirms it
  // never calls saveQuoteLog() or otherwise mutates the local
  // th_quotes entries it's displaying status for.
  const fnMatch = generatorHtml.match(/async function refreshPortalQuoteStatuses\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate the refreshPortalQuoteStatuses function body');
  assert.doesNotMatch(fnMatch[0], /saveQuoteLog/);
  assert.match(fnMatch[0], /rest\/v1\/client_portal_quotes/);
  assert.match(fnMatch[0], /rest\/v1\/quote_questions/);
});

test('resolving a client question is a real PATCH against quote_questions, wired to a real button', () => {
  assert.match(generatorHtml, /async function resolveQuoteQuestion\(id\)/);
  assert.match(generatorHtml, /onclick="resolveQuoteQuestion\(\$\{qq\.id\}\)"/);
});
