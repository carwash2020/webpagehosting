// Tests for "Pay All Outstanding" (2026-09-02) -- combines every
// unpaid invoice into one Stripe PaymentIntent. Source-inspection
// style, same reasoning as the other portal test files: this depends
// on a real Stripe/Supabase round trip that isn't practical to
// simulate end-to-end in this test environment.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '..', '..', 'portal', 'dashboard.html');
const html = fs.readFileSync(PAGE_PATH, 'utf8');

test('the Pay All Outstanding button only appears with 2+ unpaid invoices', () => {
  assert.match(html, /if \(outstanding\.length > 1\) \{/);
});

test('startPayment and startBulkPayment share the same Stripe Elements mount/confirm logic', () => {
  assert.match(html, /function mountPaymentUI\(clientSecret\)/);
  assert.match(html, /mountPaymentUI\(result\.client_secret\);/g);
  // Both call sites (single and bulk) delegate to the shared helper
  // rather than each having their own copy of the confirmPayment flow.
  const mountCalls = [...html.matchAll(/mountPaymentUI\(result\.client_secret\);/g)];
  assert.equal(mountCalls.length, 2, 'expected exactly two call sites: startPayment and startBulkPayment');
});

test('the bulk button passes every outstanding invoice id, not a hardcoded subset', () => {
  assert.match(html, /startBulkPayment\(\[\$\{outstanding\.map\(inv => inv\.id\)\.join\(','\)\}\]\)/);
});

test('startBulkPayment calls create-bulk-payment-intent, never a direct table write', () => {
  assert.match(html, /functions\/v1\/create-bulk-payment-intent/);
  assert.doesNotMatch(html, /client\s*\.\s*from\(['"]client_portal_invoices['"]\)[\s\S]{0,80}\.(update|upsert)\(/);
});
