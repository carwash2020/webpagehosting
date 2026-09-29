// Regression tests for the 2026-09-29 fix (docs/specialist-logs/security.md):
// client_portal_invoices, client_portal_jobs, client_portal_quotes,
// client_portal_contracts and client_portal_work_orders all allow either
// the matching client OR any internal account to SELECT (added 2026-09-22
// so tools/clients.html could look up a client's portal data). An internal
// account has nothing stopping it from signing into /portal/login.html with
// its own real password, so a portal page that queries one of these tables
// with no .eq('client_email', ...) filter -- trusting RLS alone -- shows
// that internal account every client's rows, not just its own. These tests
// pin the explicit client-side filter on every affected query so this can't
// silently regress if a future page/edit drops it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (p) => fs.readFileSync(repo('portal', p), 'utf8');

function isolate(source, fnSignaturePattern) {
  const match = source.match(fnSignaturePattern);
  assert.ok(match, `expected to isolate a function matching ${fnSignaturePattern}`);
  return match[0];
}

test('dashboard.html scopes its client_portal_invoices query to the signed-in session email', () => {
  const fn = isolate(read('dashboard.html'), /async function renderInvoices\(\)[\s\S]*?\n  \}\n/);
  assert.match(fn, /\.from\('client_portal_invoices'\)\s*\n\s*\.select\('\*'\)\s*\n\s*\.eq\('client_email', session\.user\.email/);
});

test('home.html scopes every table in loadSummary()\'s Promise.all to the passed-in email', () => {
  const fn = isolate(read('home.html'), /async function loadSummary\(email\)[\s\S]*?\n  \}\n/);
  for (const table of [
    'client_portal_invoices', 'client_portal_quotes', 'client_portal_jobs',
    'client_portal_work_orders', 'client_portal_contracts',
  ]) {
    const re = new RegExp(`\\.from\\('${table}'\\)[^\\n]*\\.eq\\('client_email', email\\)`);
    assert.match(fn, re, `${table} query in loadSummary() must be filtered by email`);
  }
});

test('jobs.html scopes its client_portal_jobs list query to the signed-in session email', () => {
  const fn = isolate(read('jobs.html'), /async function renderJobs\(\)[\s\S]*?\n  \}\n/);
  assert.match(fn, /\.from\('client_portal_jobs'\)\s*\n\s*\.select\('\*'\)\s*\n\s*\.eq\('client_email', session\.user\.email/);
});

test('quotes.html scopes its client_portal_quotes list query to the signed-in session email', () => {
  const fn = isolate(read('quotes.html'), /async function renderQuotes\(\)[\s\S]*?\n  \}\n/);
  assert.match(fn, /\.from\('client_portal_quotes'\)\s*\n\s*\.select\('\*'\)\s*\n\s*\.eq\('client_email', session\.user\.email/);
});

test('contracts.html scopes its client_portal_contracts query to the signed-in session email', () => {
  const fn = isolate(read('contracts.html'), /async function renderContracts\(\)[\s\S]*?\n  \}\n/);
  assert.match(fn, /\.from\('client_portal_contracts'\)\s*\n\s*\.select\('\*'\)\s*\n\s*\.eq\('client_email', session\.user\.email/);
});

test('work-orders.html\'s renderMyRequests() fetches its own session and scopes the query to it', () => {
  const fn = isolate(read('work-orders.html'), /async function renderMyRequests\(\)[\s\S]*?\n  \}\n/);
  assert.match(fn, /const \{ data: \{ session \} \} = await client\.auth\.getSession\(\)/);
  assert.match(fn, /\.from\('client_portal_work_orders'\)[^\n]*\n\s*\.select\('id,title,description,urgency,status,scheduled_at,created_at'\)\s*\n\s*\.eq\('client_email', session\.user\.email/);
});

test('settings.html scopes both invoice/quote name-prefill fallback queries to the signed-in email', () => {
  const fn = isolate(read('settings.html'), /async function init\(\)[\s\S]*?renderSettingsProfile\(name, email\);\n/);
  assert.match(fn, /\.from\('client_portal_invoices'\)\s*\n\s*\.select\('client_name'\)\s*\n\s*\.eq\('client_email', email\)/);
  assert.match(fn, /\.from\('client_portal_quotes'\)\s*\n\s*\.select\('client_name'\)\s*\n\s*\.eq\('client_email', email\)/);
});
