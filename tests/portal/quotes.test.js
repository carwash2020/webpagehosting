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
  const realFields = ['id', 'quote_number', 'quote_date', 'description', 'total', 'status', 'line_items', 'responded_at', 'scheduled_at'];
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

test('saving a quote with a client email syncs to the portal, with real Sent/Failed pop-up feedback rather than a silent console.warn', () => {
  // Changed 2026-09-03, matching the exact fix made to the invoice
  // side the same day: the old pattern was a detached fire-and-forget
  // call whose failure handler only logged to the console (invisible
  // to Connor) and had no success handler at all. Now properly
  // awaited from generateQuotePDF(), with a real showAlert() pop-up --
  // a modal that must be dismissed -- on both outcomes.
  assert.match(generatorHtml, /functions\/v1\/sync-quote-to-portal/);
  assert.doesNotMatch(generatorHtml, /Portal sync failed \(quote still saved locally\)/,
    'the old silent console.warn-only failure path should be gone');
  const fnMatch = generatorHtml.match(/async function generateQuotePDF\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate generateQuotePDF()');
  const body = fnMatch[0];
  assert.match(body, /const newEntry = logQuote\(\{ subtotal, tax, discount, total \}\);/,
    'generateQuotePDF() should capture logQuote()\'s return value, not call it as a bare statement');
  assert.match(body, /const syncRes = await fetch\(`\$\{SUPABASE_URL\}\/functions\/v1\/sync-quote-to-portal`/,
    'the sync should be properly awaited, not a detached .then()/.catch() chain');
  assert.match(body, /await showAlert\('Sent! Estimate ' \+ newEntry\.quoteNumber/);
  assert.match(body, /await showAlert\('Failed to send: ' \+/);
});

test('logQuote() returns the entry it creates, rather than leaving callers to reference an out-of-scope variable', () => {
  const fnMatch = generatorHtml.match(/function logQuote\(totals\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate logQuote()');
  assert.match(fnMatch[0], /const newEntry = \{/,
    'the quote entry should be a named variable, not an anonymous object literal pushed directly');
  assert.match(fnMatch[0], /return newEntry;\n  \}\n$/);
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

// ---- phase 3: scheduling the job from an approved quote ----

test('scheduling only ever offered for an approved, not-yet-scheduled quote', () => {
  assert.match(html, /q\.status === 'approved' \? \(q\.scheduled_at \? `/);
  assert.match(html, /toggleScheduleForm\(\$\{q\.id\}\)/);
});

test('a scheduled job shows a confirmation note instead of the scheduling flow again', () => {
  assert.match(html, /Job scheduled\. We'll see you then!/);
});

test('booking creation and the quote scheduled_at write-back both go through schedule-quote-job, never a direct table write', () => {
  assert.match(html, /functions\/v1\/schedule-quote-job/);
  assert.doesNotMatch(html, /client\s*\.\s*from\(['"]th_bookings['"]\)/);
  assert.doesNotMatch(html, /client\s*\.\s*from\(['"]client_portal_quotes['"]\)[\s\S]{0,80}\.(update|upsert|insert|delete)\(/);
});

test('the scheduling flow shares business hours and timezone from one file, not three independent copies', () => {
  // Rewritten 2026-09-03: this used to compare booking.html's and
  // quotes.html's own independently-typed copies of these constants,
  // to catch the two silently drifting apart -- which is exactly what
  // happened to need catching, since each page maintained its own
  // hand-typed copy with a comment saying to "keep these in sync
  // manually." Requested directly ("other ways we can connect all 3
  // together even more"), and unification kept turning up MORE
  // duplicates than first expected -- five real business-hours users
  // in total (booking.html, manage-booking.html, portal/quotes.html,
  // portal/jobs.html, and portal/work-orders.html), several with a
  // comment literally saying to keep the copy in sync by hand --
  // booking.html, portal/quotes.html, and portal/work-orders.html --
  // now load ONE shared /business-hours.js instead. Drift between two
  // copies is no longer a risk worth testing for, because there is
  // only one copy; what matters now is that no page has quietly grown
  // its own local copy again.
  for (const [label, filePath] of [
    ['booking.html', path.join(__dirname, '..', '..', 'booking.html')],
    ['manage-booking.html', path.join(__dirname, '..', '..', 'manage-booking.html')],
    ['quotes.html', path.join(__dirname, '..', '..', 'portal', 'quotes.html')],
    ['jobs.html', path.join(__dirname, '..', '..', 'portal', 'jobs.html')],
    ['work-orders.html', path.join(__dirname, '..', '..', 'portal', 'work-orders.html')],
  ]) {
    const src = fs.readFileSync(filePath, 'utf8');
    assert.match(src, /<script src="\/business-hours\.js\?v=1"><\/script>/, `${label}: should load the shared business-hours file`);
    assert.doesNotMatch(src, /const HOURS_BY_WEEKDAY\s*=/, `${label}: should not define its own local copy of HOURS_BY_WEEKDAY`);
    assert.doesNotMatch(src, /const BUSINESS_TIMEZONE\s*=/, `${label}: should not define its own local copy of BUSINESS_TIMEZONE`);
  }

  const sharedSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'business-hours.js'), 'utf8');
  assert.match(sharedSrc, /const BUSINESS_TIMEZONE = 'America\/Denver';/);
  assert.match(sharedSrc, /0: \[14, 20\], 1: \[14, 22\], 2: \[14, 22\], 3: \[14, 22\], 4: \[14, 22\], 5: \[14, 22\], 6: \[7, 22\]/);
});

test('a booking is never confirmed sooner than MIN_LEAD_HOURS from now, matching booking.html', () => {
  const bookingHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'booking.html'), 'utf8');
  const bookingLead = bookingHtml.match(/const MIN_LEAD_HOURS = (\d+)/);
  const quotesLead = html.match(/const MIN_LEAD_HOURS = (\d+)/);
  assert.ok(bookingLead && quotesLead);
  assert.equal(quotesLead[1], bookingLead[1]);
});
