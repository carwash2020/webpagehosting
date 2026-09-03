// Tests for the Portal work orders panel (now on tools/clients.html,
// split off Dev Tools 2026-09-03) and the permission relabel, both
// requested directly after a real test submission: "there is no
// 'work order' section on the portal tab in dev tools, also Steve
// should have full access to the portal and it should be added to
// the permissions boxes."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
// The work orders panel, photo viewer, and invoice PDF viewer all
// split off Dev Tools onto their own /tools/clients.html (2026-09-03),
// requested directly: "lets split the portal out of tools and add it
// as its own [tool]." Account permissions (the relabel test below)
// stayed on dev-tools.html -- a genuinely different feature (the
// Access tab) that was never part of the split.
const CLIENTS = fs.readFileSync(repo('tools', 'clients.html'), 'utf8');
const DEV_TOOLS = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');
const SHARED = fs.readFileSync(repo('tools', 'dev-tools-shared.js'), 'utf8');

test('the Clients tool has a work orders panel alongside accounts, invoices, and bug reports', () => {
  // The gap that started this: a real submission existed in the
  // database with a working day preference and an uploaded photo, but
  // nothing in Dev Tools' old Portal tab showed it existed.
  assert.match(CLIENTS, /<h2>Portal work orders<\/h2>/);
  assert.match(CLIENTS, /id="portalWorkOrders"/);
});

test('the work orders panel renders on page load with the other Clients panels', () => {
  assert.match(CLIENTS, /renderPortalInvoices\(\);\s*renderPortalWorkOrders\(\);/);
});

test('the work orders panel is read-only visibility -- status is not advanced from here', () => {
  // Status moves from Workspace's own Action Items queue, on purpose:
  // two panels that could each show a different status for the same
  // request would be worse than one.
  const fnMatch = CLIENTS.match(/async function renderPortalWorkOrders\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderPortalWorkOrders()');
  assert.doesNotMatch(fnMatch[0], /advanceWorkRequest|status=|PATCH/);
});

test('photos render inline under the row -- no window.open() at all, which Safari blocks after an await', () => {
  // Reported directly: "The photo will not open." The first version
  // called window.open() AFTER awaiting the signed-URL fetch, which
  // Safari treats as an unrequested popup and silently drops. Inline
  // rendering sidesteps popups entirely.
  const fnMatch = CLIENTS.match(/async function toggleWorkOrderPhotos\(workOrderId, btnEl\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate toggleWorkOrderPhotos()');
  const body = fnMatch[0];
  assert.doesNotMatch(body, /window\.open\(/);
  assert.match(body, /<img src="' \+ url \+ '"/, 'photos should render as inline <img> tags');
  assert.match(body, /strip\.dataset\.loaded = '1'/, 'signed URLs should be fetched once, then the strip just toggles');
});

test('clients.html\'s CSP allows signed Storage image URLs, or the inline photos could never render', () => {
  const csp = CLIENTS.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const imgSrc = csp.match(/img-src ([^;]+)/)[1];
  assert.match(imgSrc, /https:\/\/\*\.supabase\.co/);
});

test('dev-tools.html\'s CSP no longer needs the Storage image allowance, since the feature that used it moved out', () => {
  // Reverted alongside the split -- leaving a wider CSP than a page
  // actually needs is unnecessary, and dev-tools.html no longer
  // displays any Supabase-hosted images directly.
  const csp = DEV_TOOLS.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const imgSrc = csp.match(/img-src ([^;]+)/)[1];
  assert.doesNotMatch(imgSrc, /supabase\.co/);
});

test('the photo viewer strips the bucket prefix stored paths carry, rather than hardcoding it twice', () => {
  const fnMatch = CLIENTS.match(/async function toggleWorkOrderPhotos\(workOrderId, btnEl\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /fullPath\.replace\(\/\^work-order-photos\\\/\/, ''\)/);
});

test('the invoice PDF viewer opens its tab synchronously, before any await -- the same Safari popup fix', () => {
  const fnMatch = CLIENTS.match(/async function viewArchivedInvoicePdf\(portalRowId, btnEl\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate viewArchivedInvoicePdf()');
  const body = fnMatch[0];
  const openIdx = body.indexOf("window.open('', '_blank')");
  // A real await STATEMENT, not the word "await" inside a code comment
  // (the explanatory comment above the window.open() call mentions it).
  const awaitIdx = body.search(/^\s*(?:const [a-zA-Z_$]+ = |if \([^)]*\) )?await /m);
  assert.ok(openIdx !== -1, 'should pre-open a blank tab');
  assert.ok(awaitIdx !== -1, 'expected at least one real await statement');
  assert.ok(openIdx < awaitIdx, 'the window.open() must come BEFORE the first await, inside the tap gesture');
  assert.match(body, /pdfWindow\.location\.href = url/);
  assert.match(body, /pdfWindow\.close\(\)/, 'the blank tab should be closed again if the PDF cannot be found');
});

test('closed requests are hidden by default, with a toggle and a count, so the panel does not flood over time', () => {
  // Requested directly: "How do i 'clear' or Export all the work
  // orders so overtime it does not get flooded."
  assert.match(CLIENTS, /id="portalWorkOrderShowClosed"/);
  const fnMatch = CLIENTS.match(/async function renderPortalWorkOrders\(\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.match(body, /const CLOSED_STATUSES = \['completed', 'declined'\];/);
  assert.match(body, /showClosed \? _portalWorkOrdersCache : _portalWorkOrdersCache\.filter\(w => !CLOSED_STATUSES\.includes\(w\.status\)\)/);
});

test('Export CSV downloads every work order regardless of the filter, and nothing on the panel deletes one', () => {
  // client_portal_work_orders has no DELETE policy at all (confirmed
  // directly) -- and erasing a client-submitted record is a bigger
  // decision than a panel button should quietly make. Export + hide
  // covers the real need without destroying anything.
  assert.match(CLIENTS, /onclick="exportPortalWorkOrdersCsv\(\)"/);
  const fnMatch = CLIENTS.match(/async function exportPortalWorkOrdersCsv\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate exportPortalWorkOrdersCsv()');
  const body = fnMatch[0];
  assert.match(body, /const rows = _portalWorkOrdersCache \|\| \[\];/, 'export should use the full cache, not the filtered view');
  assert.match(body, /type: 'text\/csv'/);
  assert.match(body, /s\.replace\(\/"\/g, '""'\)/, 'cells must be CSV-escaped');
  assert.doesNotMatch(CLIENTS, /client_portal_work_orders[^\n]*DELETE|deleteWorkOrder/);
});

test('the panel has help text like every other Clients panel', () => {
  assert.match(CLIENTS, /openDevInfo\('portalworkorders'\)/);
  assert.match(SHARED, /portalworkorders: \{/);
});

test('the permission that actually gates Portal access says so in its label', () => {
  // Checked directly first: Steve already had can_manage_invoices:true,
  // which is the one permission gating every Portal action. He had
  // full access; the label just never said so. Account permissions
  // (Access tab) stayed on dev-tools.html -- unaffected by the split.
  assert.match(DEV_TOOLS, /\{ field: 'can_manage_invoices', label: 'Invoices, Quotes & Portal' \}/);
  assert.doesNotMatch(DEV_TOOLS, /label: 'Invoices & Quotes' \}/);
});

test('no inline event handler anywhere embeds JSON.stringify -- its double quotes truncate a double-quoted attribute', () => {
  // The real cause of "the photo will not open," twice: the button was
  // built as onclick="fn(1, ["path"], this)" -- the JSON's own double
  // quotes end the attribute at `fn(1, [`, a syntax error, and the tap
  // does nothing. Proven with jsdom. The invoice View PDF button had it
  // too and had never worked. Inline handlers should carry only a
  // numeric id and look everything else up.
  for (const rel of ['tools/dev-tools.html', 'tools/clients.html', 'tools/workspace.html', 'tools/invoice-generator.html', 'tools/job-tracker.html', 'portal/dashboard.html', 'portal/quotes.html', 'portal/jobs.html', 'portal/work-orders.html']) {
    const s = fs.readFileSync(repo(...rel.split('/')), 'utf8');
    const hits = [...s.matchAll(/on(?:click|input|change|submit)="[^"\n]*JSON\.stringify/g)];
    assert.equal(hits.length, 0, rel + ': inline handler embeds JSON.stringify: ' + hits.map(h => h[0]).join(' | '));
  }
});
