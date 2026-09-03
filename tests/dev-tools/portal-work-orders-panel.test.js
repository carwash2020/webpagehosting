// Tests for the Portal work orders panel in Dev Tools and the
// permission relabel (2026-09-03), both requested directly after a
// real test submission: "there is no 'work order' section on the
// portal tab in dev tools, also Steve should have full access to the
// portal and it should be added to the permissions boxes."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const DEV_TOOLS = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');
const SHARED = fs.readFileSync(repo('tools', 'dev-tools-shared.js'), 'utf8');

test('the Portal tab has a work orders panel alongside accounts, invoices, and bug reports', () => {
  // The gap that started this: a real submission existed in the
  // database with a working day preference and an uploaded photo, but
  // nothing in the Portal tab showed it existed.
  const portalTab = DEV_TOOLS.match(/<div class="dev-panels-grid" data-tab-panel="portal">[\s\S]*?<div class="dev-panels-grid" data-tab-panel="access">/);
  assert.ok(portalTab, 'expected to isolate the Portal tab');
  assert.match(portalTab[0], /<h2>Portal work orders<\/h2>/);
  assert.match(portalTab[0], /id="portalWorkOrders"/);
});

test('the work orders panel renders on page load with the other Portal panels', () => {
  assert.match(DEV_TOOLS, /renderPortalInvoices\(\);\s*renderPortalWorkOrders\(\);/);
});

test('the work orders panel is read-only visibility -- status is not advanced from here', () => {
  // Status moves from Workspace's own Action Items queue, on purpose:
  // two panels that could each show a different status for the same
  // request would be worse than one.
  const fnMatch = DEV_TOOLS.match(/async function renderPortalWorkOrders\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderPortalWorkOrders()');
  assert.doesNotMatch(fnMatch[0], /advanceWorkRequest|status=|PATCH/);
});

test('photos render inline under the row -- no window.open() at all, which Safari blocks after an await', () => {
  // Reported directly: "The photo will not open." The first version
  // called window.open() AFTER awaiting the signed-URL fetch, which
  // Safari treats as an unrequested popup and silently drops. Inline
  // rendering sidesteps popups entirely.
  const fnMatch = DEV_TOOLS.match(/async function toggleWorkOrderPhotos\(workOrderId, paths, btnEl\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate toggleWorkOrderPhotos()');
  const body = fnMatch[0];
  assert.doesNotMatch(body, /window\.open\(/);
  assert.match(body, /<img src="' \+ url \+ '"/, 'photos should render as inline <img> tags');
  assert.match(body, /strip\.dataset\.loaded = '1'/, 'signed URLs should be fetched once, then the strip just toggles');
});

test('dev-tools.html\'s CSP allows signed Storage image URLs, or the inline photos could never render', () => {
  const csp = DEV_TOOLS.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const imgSrc = csp.match(/img-src ([^;]+)/)[1];
  assert.match(imgSrc, /https:\/\/\*\.supabase\.co/);
});

test('the photo viewer strips the bucket prefix stored paths carry, rather than hardcoding it twice', () => {
  const fnMatch = DEV_TOOLS.match(/async function toggleWorkOrderPhotos\(workOrderId, paths, btnEl\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /fullPath\.replace\(\/\^work-order-photos\\\/\/, ''\)/);
});

test('the invoice PDF viewer opens its tab synchronously, before any await -- the same Safari popup fix', () => {
  const fnMatch = DEV_TOOLS.match(/async function viewArchivedInvoicePdf\(invoiceNumber, btnEl\)[\s\S]*?\n  \}\n/);
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
  assert.match(DEV_TOOLS, /id="portalWorkOrderShowClosed"/);
  const fnMatch = DEV_TOOLS.match(/async function renderPortalWorkOrders\(\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.match(body, /const CLOSED_STATUSES = \['completed', 'declined'\];/);
  assert.match(body, /showClosed \? _portalWorkOrdersCache : _portalWorkOrdersCache\.filter\(w => !CLOSED_STATUSES\.includes\(w\.status\)\)/);
});

test('Export CSV downloads every work order regardless of the filter, and nothing on the panel deletes one', () => {
  // client_portal_work_orders has no DELETE policy at all (confirmed
  // directly) -- and erasing a client-submitted record is a bigger
  // decision than a panel button should quietly make. Export + hide
  // covers the real need without destroying anything.
  assert.match(DEV_TOOLS, /onclick="exportPortalWorkOrdersCsv\(\)"/);
  const fnMatch = DEV_TOOLS.match(/async function exportPortalWorkOrdersCsv\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate exportPortalWorkOrdersCsv()');
  const body = fnMatch[0];
  assert.match(body, /const rows = _portalWorkOrdersCache \|\| \[\];/, 'export should use the full cache, not the filtered view');
  assert.match(body, /type: 'text\/csv'/);
  assert.match(body, /s\.replace\(\/"\/g, '""'\)/, 'cells must be CSV-escaped');
  const portalTab = DEV_TOOLS.match(/<div class="dev-panels-grid" data-tab-panel="portal">[\s\S]*?<div class="dev-panels-grid" data-tab-panel="access">/)[0];
  assert.doesNotMatch(portalTab, /client_portal_work_orders[^\n]*DELETE|deleteWorkOrder/);
});

test('the panel has help text like every other Dev Tools panel', () => {
  assert.match(DEV_TOOLS, /openDevInfo\('portalworkorders'\)/);
  assert.match(SHARED, /portalworkorders: \{/);
});

test('the permission that actually gates Portal access says so in its label', () => {
  // Checked directly first: Steve already had can_manage_invoices:true,
  // which is the one permission gating every Portal action. He had
  // full access; the label just never said so.
  assert.match(DEV_TOOLS, /\{ field: 'can_manage_invoices', label: 'Invoices, Quotes & Portal' \}/);
  assert.doesNotMatch(DEV_TOOLS, /label: 'Invoices & Quotes' \}/);
});
