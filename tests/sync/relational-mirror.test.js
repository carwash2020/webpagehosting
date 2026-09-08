// Tests for the relational mirror (code-health pass, 2026-09-08) -- see
// sql/infra/create_relational_jobs_invoices_quotes_contracts.sql and the
// RELATIONAL MIRROR section of tools/sync.js for the full reasoning.
// Phase 1, deliberately additive: real Postgres tables with real foreign
// keys for jobs/invoices/quotes/contracts, populated via a best-effort
// mirror alongside the existing localStorage + blob-sync saves, which
// stay completely unchanged. These tests confirm the mirror actually
// fires from every real save/delete call site, and that mirrorUpsert's
// real HTTP call has the shape the new tables actually expect.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
const SYNC_JS = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');

test('all 7 relational-mirror functions are defined in sync.js', () => {
  for (const fn of [
    'mirrorUpsert', 'mirrorDelete', 'mirrorReplaceLineItems',
    'mirrorJobsToRelational', 'mirrorInvoiceToRelational',
    'mirrorQuoteToRelational', 'mirrorContractToRelational',
  ]) {
    assert.match(SYNC_JS, new RegExp('function ' + fn + '\\('), `${fn} not found in sync.js`);
  }
});

test('job-tracker.html: saveJobs() mirrors every save, and both delete paths mirror the delete', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  const saveJobsFn = src.match(/function saveJobs\(jobs\)[\s\S]*?\n  \}/)[0];
  assert.match(saveJobsFn, /mirrorJobsToRelational\(jobs\)/);
  const deleteMirrorCalls = [...src.matchAll(/mirrorDelete\('jobs', ([\w.]+)\)/g)].map(m => m[1]);
  assert.equal(deleteMirrorCalls.length, 2, 'expected both the single-job and bulk-delete paths to mirror the delete');
  assert.ok(deleteMirrorCalls.includes('id'), 'single-job delete should mirror by id');
  assert.ok(deleteMirrorCalls.includes('j.id'), 'bulk-delete should mirror each job by its own id');
});

test('invoice-generator.html: logInvoice()/logQuote() mirror on create, the quote-conversion mirrors the updated quote, and both delete paths mirror the delete', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'invoice-generator.html'), 'utf8');
  const logInvoiceFn = src.match(/function logInvoice\(totals\)[\s\S]*?\n  \}/)[0];
  assert.match(logInvoiceFn, /mirrorInvoiceToRelational\(newEntry\)/);
  const logQuoteFn = src.match(/function logQuote\(totals\)[\s\S]*?\n  \}/)[0];
  assert.match(logQuoteFn, /mirrorQuoteToRelational\(newEntry\)/);
  assert.match(src, /quote\.convertedToInvoiceId = newEntry\.id;[\s\S]*?mirrorQuoteToRelational\(quote\)/, 'converting a quote to an invoice should re-mirror the quote with its new converted status');
  assert.match(src, /mirrorDelete\('invoices', id\)/);
  assert.match(src, /mirrorDelete\('quotes', id\)/);
});

test('workspace.html: togglePaid() mirrors the updated invoice', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const togglePaidFn = src.match(/async function togglePaid\(id\)[\s\S]*?\n  \}/)[0];
  assert.match(togglePaidFn, /mirrorInvoiceToRelational\(inv\)/);
});

test('contract-generator.html: contract creation mirrors the new entry, and delete mirrors the delete', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'contract-generator.html'), 'utf8');
  assert.match(src, /saveContractLog\(log\);\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(typeof mirrorContractToRelational === 'function'\) mirrorContractToRelational\(log\[log\.length - 1\]\)/);
  assert.match(src, /mirrorDelete\('contracts', id\)/);
});

// Functional test: mirrorUpsert's actual HTTP call shape, with a mocked
// fetch -- confirms it targets the right table/method/headers and sends
// real row data, not just that the function exists.
function loadMirrorFunctions() {
  const upsertSrc = SYNC_JS.match(/async function mirrorUpsert[\s\S]*?\n\}/)[0];
  const deleteSrc = SYNC_JS.match(/async function mirrorDelete[\s\S]*?\n\}/)[0];
  const replaceLineItemsSrc = SYNC_JS.match(/async function mirrorReplaceLineItems[\s\S]*?\n\}/)[0];
  const jobsSrc = SYNC_JS.match(/function mirrorJobsToRelational[\s\S]*?\n\}/)[0];
  const invoiceSrc = SYNC_JS.match(/function mirrorInvoiceToRelational[\s\S]*?\n\}/)[0];
  assert.ok(upsertSrc && deleteSrc && replaceLineItemsSrc && jobsSrc && invoiceSrc, 'one or more mirror functions not found in sync.js');

  // fetchWithRetry is what these actually call -- a minimal real stand-in
  // (not the retry logic itself, which has its own dedicated tests) that
  // just forwards to whatever global.fetch a given test installs.
  const fetchWithRetryStub = 'async function fetchWithRetry(url, opts) { return fetch(url, opts); }\n';

  const sandbox = { isSyncConfigured: () => true, getAuthToken: () => 'fake-token', fetch: (...args) => global.fetch(...args) };
  const src = fetchWithRetryStub + upsertSrc + '\n' + deleteSrc + '\n' + replaceLineItemsSrc + '\n' + jobsSrc + '\n' + invoiceSrc +
    '\nsandbox.mirrorUpsert = mirrorUpsert; sandbox.mirrorDelete = mirrorDelete; sandbox.mirrorReplaceLineItems = mirrorReplaceLineItems; sandbox.mirrorJobsToRelational = mirrorJobsToRelational; sandbox.mirrorInvoiceToRelational = mirrorInvoiceToRelational;' +
    '\nsandbox.fetchWithRetry = fetchWithRetry; sandbox.fetch = fetch;';
  // eslint-disable-next-line no-new-func
  new Function('sandbox', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'isSyncConfigured', 'getAuthToken', 'fetch',
    src
  )(sandbox, 'https://example-project.supabase.co', 'fake-anon-key', sandbox.isSyncConfigured, sandbox.getAuthToken, sandbox.fetch);
  return sandbox;
}

test('mirrorJobsToRelational() POSTs a real upsert to /rest/v1/jobs with the right headers and mapped row shape', async () => {
  const { mirrorJobsToRelational } = loadMirrorFunctions();
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201 }; };

  mirrorJobsToRelational([{ id: 42, title: 'Fix dryer', client: 'Alice', clientId: 'c_1', phone: '555-1234', address: '1 Main St', status: 'not-started', priority: 'medium', date: '2026-09-08', notes: '', showOnCalendar: true, createdBy: 'a@b.com', lastEditedBy: 'a@b.com' }]);
  await new Promise(resolve => setTimeout(resolve, 10)); // mirrorUpsert is async and not awaited by its caller, matching real usage

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example-project.supabase.co/rest/v1/jobs');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer fake-token');
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.length, 1);
  assert.equal(body[0].id, 42);
  assert.equal(body[0].title, 'Fix dryer');
  assert.equal(body[0].client_id, 'c_1');
  assert.equal(body[0].show_on_calendar, true);
});

test('mirrorInvoiceToRelational() upserts the invoice AND replaces its line items (delete then insert)', async () => {
  const { mirrorInvoiceToRelational } = loadMirrorFunctions();
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, method: opts.method, opts }); return { ok: true, status: 200 }; };

  mirrorInvoiceToRelational({
    id: 99, invoiceNumber: 'INV-1', clientName: 'Bob', total: 150, subtotal: 150, tax: 0, discount: 0,
    paid: false, jobRefId: '42', jobRefTitle: 'Fix dryer', generatedBy: 'a@b.com',
    line_items: [{ desc: 'Labor', part: '', qty: 1, price: 150, amount: 150, taxable: false, type: 'labor' }],
  });
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.equal(calls.length, 3, 'expected: upsert invoice, delete old line items, insert new line items');
  assert.match(calls[0].url, /\/rest\/v1\/invoices$/);
  assert.equal(calls[0].method, 'POST');
  const invoiceBody = JSON.parse(calls[0].opts.body);
  assert.equal(invoiceBody[0].job_id, 42, 'jobRefId string should be cast to a real number for the bigint FK column');

  assert.match(calls[1].url, /\/rest\/v1\/invoice_line_items\?invoice_id=eq\.99$/);
  assert.equal(calls[1].method, 'DELETE');

  assert.match(calls[2].url, /\/rest\/v1\/invoice_line_items$/);
  assert.equal(calls[2].method, 'POST');
  const lineItemsBody = JSON.parse(calls[2].opts.body);
  assert.equal(lineItemsBody.length, 1);
  assert.equal(lineItemsBody[0].invoice_id, 99);
  assert.equal(lineItemsBody[0].description, 'Labor');
});

test('mirror functions never throw even when fetch itself fails -- best-effort, never blocks the real save', async () => {
  const { mirrorJobsToRelational } = loadMirrorFunctions();
  global.fetch = async () => { throw new Error('network down'); };
  await assert.doesNotReject(async () => {
    mirrorJobsToRelational([{ id: 1, title: 'x' }]);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
});
