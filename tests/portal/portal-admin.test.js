// Tests for the two operational fixes shipped alongside the client-
// identity unification (2026-09-02):
//
//  1. Manual paid-toggle now syncs to the portal. Most of this
//     business's payments are cash, check, or Venmo -- marked paid by
//     hand in the Invoice Log, never touching Stripe. Before this, the
//     portal kept showing those invoices as UNPAID afterwards, so a
//     client could log in and pay a second time through Stripe.
//
//  2. Portal accounts panel in Dev Tools, replacing the old
//     per-invoice Resend Invite button (which could only act on one
//     invoice's email, and only if you could find that invoice).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const INVOICE_GEN = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');
const DEV_TOOLS = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools.html'), 'utf8');
const DEV_SHARED = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools-shared.js'), 'utf8');

test('marking an invoice paid by hand syncs that status to the portal', () => {
  const fnMatch = INVOICE_GEN.match(/function toggleInvoicePaid\(id\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'toggleInvoicePaid() not found');
  assert.match(fnMatch[0], /functions\/v1\/set-invoice-paid/);
  // Must send the actual new state, not assume "paid" -- unmarking has
  // to reach the portal too, or a mistakenly-marked invoice stays
  // wrongly paid there forever.
  assert.match(fnMatch[0], /paid: entry\.paid/);
});

test('the paid-status sync only fires for an invoice actually on the portal', () => {
  const fnMatch = INVOICE_GEN.match(/function toggleInvoicePaid\(id\) \{[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /if \(entry\.clientEmail &&/,
    'an invoice with no client email was never synced to the portal, so there is nothing to update');
});

test('the paid-status sync never blocks the local save', () => {
  const fnMatch = INVOICE_GEN.match(/function toggleInvoicePaid\(id\) \{[\s\S]*?\n  \}\n/);
  // saveInvoiceLog must come before the fetch, and the fetch must be
  // fire-and-forget -- same pattern as every other portal sync here.
  const saveIdx = fnMatch[0].indexOf('saveInvoiceLog');
  const fetchIdx = fnMatch[0].indexOf('fetch(');
  assert.ok(saveIdx > -1 && fetchIdx > saveIdx, 'the local log is the real record and must be written first');
  assert.match(fnMatch[0], /\.catch\(e => console\.warn/);
});

test('the old per-invoice Resend Invite button and its function are both gone', () => {
  // Superseded by the Portal accounts panel -- leaving a half-removed
  // version behind (button without function, or vice versa) is the
  // real risk being guarded against here.
  assert.doesNotMatch(INVOICE_GEN, /onclick="resendInvite\(/);
  assert.doesNotMatch(INVOICE_GEN, /async function resendInvite\(/);
});

test('Dev Tools has a Portal accounts panel, wired up and initialised', () => {
  assert.match(DEV_TOOLS, /<h2>Portal accounts<\/h2>/);
  assert.match(DEV_TOOLS, /id="portalAccounts"/);
  assert.match(DEV_TOOLS, /async function renderPortalAccounts\(\)/);
  assert.match(DEV_TOOLS, /async function resendPortalInvite\(/);
  // Must actually be called on load, not just defined.
  assert.match(DEV_TOOLS, /renderPortalBugReports\(\);\s*\n\s*renderPortalAccounts\(\);/);
});

test('the Portal accounts panel is Owner-visible, so Steve can actually use it', () => {
  // Almost every Dev Tools panel carries dev-owner-hidden, which would
  // hide this from Steve's Owner account entirely -- the whole point
  // of putting it here rather than in a Developer-only area is that
  // he needs it day to day.
  const panelMatch = DEV_TOOLS.match(/<div class="([^"]*)">\s*<div class="dev-panel-heading">\s*<h2>Portal accounts<\/h2>/);
  assert.ok(panelMatch, 'could not isolate the Portal accounts panel element');
  assert.doesNotMatch(panelMatch[1], /dev-owner-hidden/,
    'Portal accounts must NOT be owner-hidden -- Steve is the primary user of it');
});

test('the Portal accounts panel builds from the portal tables, never the auth user list', () => {
  const fnMatch = DEV_TOOLS.match(/async function loadPortalAccounts\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'loadPortalAccounts() not found');
  for (const t of ['client_portal_invoices', 'client_portal_quotes', 'client_portal_jobs']) {
    assert.match(fnMatch[0], new RegExp(t), `should read ${t}`);
  }
  // Reading Supabase's own auth user list needs the service_role key,
  // which must never sit in this page's JavaScript.
  assert.doesNotMatch(fnMatch[0], /auth\/v1\/admin/);
  assert.doesNotMatch(DEV_TOOLS, /SERVICE_ROLE/);
});

test('the Portal accounts panel has help text like every other Dev Tools panel', () => {
  assert.match(DEV_TOOLS, /openDevInfo\('portalaccounts'\)/);
  assert.match(DEV_SHARED, /portalaccounts:\s*\{/);
});
