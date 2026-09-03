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

test('photos open in one gallery tab, not one window.open() per photo', () => {
  // Browsers block every popup after the first one in a single click
  // handler as unrequested -- a 3-photo request would have silently
  // shown only one photo.
  const fnMatch = DEV_TOOLS.match(/async function viewWorkOrderPhotos\(paths, btnEl\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate viewWorkOrderPhotos()');
  const body = fnMatch[0];
  const opens = (body.match(/window\.open\(/g) || []).length;
  assert.equal(opens, 1, 'exactly one window.open() call, for the single gallery tab');
  assert.match(body, /new Blob\(\[galleryHtml\], \{ type: 'text\/html' \}\)/);
});

test('the photo viewer strips the bucket prefix stored paths carry, rather than hardcoding it twice', () => {
  const fnMatch = DEV_TOOLS.match(/async function viewWorkOrderPhotos\(paths, btnEl\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /fullPath\.replace\(\/\^work-order-photos\\\/\/, ''\)/);
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
