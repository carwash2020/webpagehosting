// Tests for Client Lookup (2026-09-05), requested directly: "Put in
// a email, name, phone number... to locate a guest and see how much
// they have spent how many work orders/invoices/estimates, their
// signature with a download button for all of it in the event of a
// dispute." Confirmed directly this belongs in tools/clients.html
// (Steve-accessible, not Developer-gated), not Dev Tools.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('tools', 'clients.html'), 'utf8');
const DEV_SHARED = fs.readFileSync(repo('tools', 'dev-tools-shared.js'), 'utf8');

test('the panel lives on clients.html, which is confirmed accessible to Owner accounts, not gated behind Developer-only Dev Tools', () => {
  assert.match(HTML, /<h2>Client Lookup<\/h2>/);
  assert.match(HTML, /requireAuth\(\);/);
  assert.doesNotMatch(HTML, /requireRole\(['"]developer['"]\)/i);
});

test('the search input requires no special setup and calls the debounced search on every keystroke', () => {
  assert.match(HTML, /id="clientLookupSearch" placeholder="Search by email, name, or phone\.\.\." [^>]*oninput="scheduleClientLookupSearch\(\)"/);
});

test('the search is debounced at 400ms, matching the interval already established elsewhere in this codebase, since this fires up to 4 real REST calls per search', () => {
  const fnMatch = HTML.match(/function scheduleClientLookupSearch\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate scheduleClientLookupSearch()');
  assert.match(fnMatch[0], /setTimeout\(renderClientLookup, 400\)/);
});

test('a search term is properly quoted for PostgREST\u2019s or=() filter syntax, so a comma or parenthesis in a client\u2019s name cannot be misread as a filter delimiter', () => {
  const fnMatch = HTML.match(/function ilikePattern\(term\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate ilikePattern()');
  assert.ok(fnMatch[0].includes(`return '"*' + term.replace(/"/g, `), 'expected the value wrapped in literal double quotes, with embedded quotes escaped');
  assert.ok(fnMatch[0].includes(`) + '*"';`), 'expected the closing wildcard and quote');
});

test('the search requires at least 3 characters before firing, avoiding an overly broad single-letter search across 4 tables', () => {
  const fnMatch = HTML.match(/async function renderClientLookup\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderClientLookup()');
  assert.match(fnMatch[0], /if \(term\.length < 3\)/);
});

test('findMatchingClientEmails searches all four tables a client\u2019s info could actually live in, and is best-effort per table', () => {
  const fnMatch = HTML.match(/async function findMatchingClientEmails\(term\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate findMatchingClientEmails()');
  for (const table of ['client_profiles', 'client_portal_invoices', 'client_portal_quotes', 'client_portal_work_orders']) {
    assert.match(fnMatch[0], new RegExp(`/rest/v1/${table}\\?`));
  }
  assert.match(fnMatch[0], /try \{[\s\S]*?catch \(e\) \{ \/\* continue to the next table \*\/ \}/);
});

test('client_portal_work_orders is searched by its own phone column too, not just name/email, since not every client has a phone saved in client_profiles yet', () => {
  const fnMatch = HTML.match(/async function findMatchingClientEmails\(term\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /client_portal_work_orders\?or=\(client_email\.ilike\.[^,]+,client_name\.ilike\.[^,]+,phone\.ilike\./);
});

test('total spent only ever counts PAID invoices, never unpaid ones -- a real financial figure, not just a count of everything on file', () => {
  const fnMatch = HTML.match(/async function loadClientLookupProfile\(email\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate loadClientLookupProfile()');
  assert.match(fnMatch[0], /invoices\.filter\(i => i\.paid\)\.reduce\(\(sum, i\) => sum \+ \(Number\(i\.total\) \|\| 0\), 0\)/);
});

test('the download button uses the correct escaping function for its inline-handler context, not escapeHtml -- the exact bug class fixed elsewhere in this codebase earlier the same day', () => {
  const fnMatch = HTML.match(/function renderClientLookupCard\(p\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderClientLookupCard()');
  assert.match(fnMatch[0], /downloadClientDisputeReport\(\\'\' \+ escapeForInlineHandler\(p\.email\)/);
});

test('the PDF export has the same defensive "still loading" check as invoice-generator.html, since jsPDF loads async', () => {
  const fnMatch = HTML.match(/async function downloadClientDisputeReport\(email\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate downloadClientDisputeReport()');
  assert.match(fnMatch[0], /if \(!window\.jspdf\)/);
});

test('the dispute PDF includes all four real sections: invoices, estimates, work orders, and the full text of signed authorizations', () => {
  const fnMatch = HTML.match(/async function downloadClientDisputeReport\(email\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /addLine\('Invoices \(' \+ p\.invoices\.length \+ '\)'/);
  assert.match(fnMatch[0], /addLine\('Estimates \(' \+ p\.quotes\.length \+ '\)'/);
  assert.match(fnMatch[0], /addLine\('Work Orders \(' \+ p\.workOrders\.length \+ '\)'/);
  assert.match(fnMatch[0], /addLine\('Signed Authorizations \(' \+ p\.authorizations\.length \+ '\)'/);
  assert.match(fnMatch[0], /doc\.splitTextToSize\(a\.authorization_text \|\| '', 500\)/);
});

test('the CSP was widened to allow jsPDF from the same CDN already trusted on invoice-generator.html, and the script tag matches its exact SRI hash and async loading', () => {
  assert.match(HTML, /script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net/);
  assert.match(HTML, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co https:\/\/cdn\.jsdelivr\.net/);
  assert.match(HTML, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jspdf@2\.5\.1\/dist\/jspdf\.umd\.min\.js" integrity="sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO\/SWXgMjoVqcKyIIWOLk" crossorigin="anonymous" async><\/script>/);
});

test('the info bubble has a real, matching DEV_INFO entry -- a missing one would make the ? button silently do nothing', () => {
  assert.match(HTML, /onclick="openDevInfo\('clientlookup'\)"/);
  assert.match(DEV_SHARED, /clientlookup: \{/);
});

test('the HTML is well-formed -- opening and closing divs balance exactly after this addition', () => {
  const opens = (HTML.match(/<div\b/g) || []).length;
  const closes = (HTML.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, `expected balanced divs, got ${opens} opening vs ${closes} closing`);
});

test('loadPortalAccounts survived intact -- a real mistake made and caught during this build accidentally dropped its own function declaration line', () => {
  assert.match(HTML, /async function loadPortalAccounts\(\) \{/);
});
