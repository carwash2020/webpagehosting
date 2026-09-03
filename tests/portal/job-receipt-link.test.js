// Tests for downloadable receipts per job (2026-09-03), item 6 of a
// roadmap: "Jobs shows completed work but no downloadable receipt per
// job." Warranty tracking already existed on this page; this closes
// the other real gap, using the internal Invoice Log's own existing
// jobRefId link rather than inventing a second, separate connection.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const JOB_TRACKER = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');
const DASHBOARD = fs.readFileSync(repo('portal', 'dashboard.html'), 'utf8');
const SYNC_FN = fs.readFileSync(repo('edge-functions', 'sync-job-to-portal-index.ts'), 'utf8');

test('a job card shows View Receipt only when a linked invoice actually exists', () => {
  const fnMatch = JOBS.match(/function renderJobCard\(j\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate renderJobCard()');
  const body = fnMatch[0];
  assert.match(body, /j\.linked_invoice_number \? `<a class="job-receipt-link"/);
  assert.match(body, /href="\/portal\/dashboard\.html\?invoice=\$\{encodeURIComponent\(j\.linked_invoice_number\)\}"/);
});

test('job-tracker.html looks up the linked invoice via the Invoice Log\'s own existing jobRefId, not a second separate mechanism', () => {
  assert.match(JOB_TRACKER, /loadInvoicesForHistory\(\)\.find\(inv => String\(inv\.jobRefId\) === String\(savedJobId\)\)/);
  assert.match(JOB_TRACKER, /linked_invoice_number: linkedInvoiceNumber,/);
});

test('the invoice lookup is looked up fresh on every sync, not cached, so re-linking an invoice later stays correct', () => {
  const doneBlockMatch = JOB_TRACKER.match(/if \(fields\.status === 'done' && clientEmailVal[\s\S]*?\}\);\s*\n\s*\}\n/);
  assert.ok(doneBlockMatch, 'expected to isolate the mark-Done sync block');
  const linkedIdx = doneBlockMatch[0].indexOf('let linkedInvoiceNumber = null;');
  const fetchIdx = doneBlockMatch[0].indexOf('fetch(`${SUPABASE_URL}/functions/v1/sync-job-to-portal`');
  assert.ok(linkedIdx !== -1 && fetchIdx !== -1);
  assert.ok(linkedIdx < fetchIdx, 'the lookup must happen before each sync call, not be a stored/cached value');
});

test('sync-job-to-portal accepts and validates linked_invoice_number as an optional string', () => {
  assert.match(SYNC_FN, /linked_invoice_number !== undefined && linked_invoice_number !== null && typeof linked_invoice_number !== "string"/);
  assert.match(SYNC_FN, /linked_invoice_number: linked_invoice_number \|\| null,/);
});

test('the dashboard auto-downloads a receipt when arriving via a real ?invoice= link, and strips the param so refreshing does not re-trigger it', () => {
  const fnMatch = DASHBOARD.match(/async function renderInvoices\(\)[\s\S]*?\n\s+\/\/ Split into two real sections/);
  assert.ok(fnMatch, 'expected to isolate the invoice-loading portion of renderInvoices()');
  const body = fnMatch[0];
  assert.match(body, /new URLSearchParams\(window\.location\.search\)\.get\('invoice'\)/);
  assert.match(body, /history\.replaceState\(null, '', window\.location\.pathname\);/);
  assert.match(body, /invoices\.find\(inv => inv\.invoice_number === requestedInvoiceNumber\)/);
  assert.match(body, /if \(match\) downloadInvoicePDF\(match\.id\);/);
});

test('an unmatched invoice number fails silently on the dashboard, not with an error message', () => {
  const fnMatch = DASHBOARD.match(/const requestedInvoiceNumber = new URLSearchParams[\s\S]*?\n    \}\n/);
  assert.ok(fnMatch, 'expected to isolate the auto-download block');
  assert.doesNotMatch(fnMatch[0], /alert\(|showToast\(|showAlert\(/);
});
