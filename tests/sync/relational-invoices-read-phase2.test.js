// Relational tables Phase 2, step 3 (2026-09-10): fetchInvoicesFromRelational()
// in tools/sync.js, same pattern as fetchJobsFromRelational(). Built for
// finance.html/runway-dashboard.html, but NOT yet wired into either page
// -- their invoice reads turned out to be synchronous helper functions
// called from many render call sites (not a single "load once" spot
// like calendar.html/route-planner.html/review-request.html were), so
// wiring them in safely needs a real cache-and-refresh restructure, not
// a same-pass drop-in swap. See CONTINUE-HERE.md's Phase 2 notes.
// This function itself is complete and tested now so that restructure
// has something ready to call when it happens.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SYNC_JS = fs.readFileSync(path.join(repo('tools'), 'sync.js'), 'utf8');

test('sync.js: fetchInvoicesFromRelational is defined', () => {
  assert.match(SYNC_JS, /async function fetchInvoicesFromRelational\(\)/);
});

function loadFetchInvoicesFromRelational() {
  const fnSrc = SYNC_JS.match(/async function fetchInvoicesFromRelational\(\)[\s\S]*?\n\}/)[0];
  const sandbox = { isSyncConfigured: () => true, getAuthToken: () => 'fake-token', fetch: (...args) => global.fetch(...args) };
  const src = fnSrc + '\nsandbox.fetchInvoicesFromRelational = fetchInvoicesFromRelational;';
  // eslint-disable-next-line no-new-func
  new Function('sandbox', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'isSyncConfigured', 'getAuthToken', 'fetch',
    src
  )(sandbox, 'https://example-project.supabase.co', 'fake-anon-key', sandbox.isSyncConfigured, sandbox.getAuthToken, sandbox.fetch);
  return sandbox.fetchInvoicesFromRelational;
}

test('fetchInvoicesFromRelational() GETs /rest/v1/invoices with the right headers and maps rows to the camelCase shape th_invoices callers expect', async () => {
  const fetchInvoicesFromRelational = loadFetchInvoicesFromRelational();
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => [{
        id: 99, invoice_number: 'INV-1', client_name: 'Bob', client_id: 'c_1',
        client_email: 'bob@example.com', invoice_date: '2026-09-01', terms: 'Due on receipt',
        invoice_type: 'invoice', subtotal: 150, tax: 0, discount: 0, total: 150,
        paid: false, paid_amount: 0, job_id: 42, job_ref_title: 'Fix dryer',
        source_quote_id: null, generated_by: 'a@b.com',
      }],
    };
  };

  const result = await fetchInvoicesFromRelational();

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/example-project\.supabase\.co\/rest\/v1\/invoices\?select=\*&order=id\.desc&limit=1000$/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer fake-token');

  assert.equal(result.ok, true);
  assert.equal(result.invoices.length, 1);
  const inv = result.invoices[0];
  assert.equal(inv.id, 99);
  assert.equal(inv.invoiceNumber, 'INV-1');
  assert.equal(inv.clientName, 'Bob');
  assert.equal(inv.date, '2026-09-01');
  assert.equal(inv.jobRefId, 42);
  assert.equal(inv.jobRefTitle, 'Fix dryer');
  assert.equal(inv.paid, false);
});

test('fetchInvoicesFromRelational() never throws, reporting ok:false on HTTP failure or a network error', async () => {
  const fetchInvoicesFromRelational = loadFetchInvoicesFromRelational();

  global.fetch = async () => ({ ok: false, status: 500 });
  let result = await fetchInvoicesFromRelational();
  assert.equal(result.ok, false);
  assert.deepEqual(result.invoices, []);

  global.fetch = async () => { throw new Error('network down'); };
  await assert.doesNotReject(async () => {
    result = await fetchInvoicesFromRelational();
    assert.equal(result.ok, false);
  });
});
