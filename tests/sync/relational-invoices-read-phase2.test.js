// Relational tables Phase 2, invoices slice A (2026-09-17): shared
// cache + getInvoicesForRead() in tools/sync.js, wired into the
// Workspace Income list and Invoice Generator Recent tab. Writes stay
// on the blob (th_invoices). finance.html / runway-dashboard.html are
// deliberately NOT converted in this slice -- their invoice reads are
// synchronous helpers called from many render sites, a later pass.
// See CONTINUE-HERE.md's Phase 2 notes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const TOOLS_DIR = repo('tools');
const SYNC_JS = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
const INVOICE_GEN = fs.readFileSync(path.join(TOOLS_DIR, 'invoice-generator.html'), 'utf8');
const WORKSPACE = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
const SQL = fs.readFileSync(repo('sql', 'infra', 'add_invoices_to_realtime_phase2.sql'), 'utf8');

test('sync.js: fetchInvoicesFromRelational, cache helpers, and startInvoicesRealtime are defined, and stopRealtimeSync clears the invoices channel', () => {
  assert.match(SYNC_JS, /async function fetchInvoicesFromRelational\(\)/);
  assert.match(SYNC_JS, /let cachedRelationalInvoices = null;/);
  assert.match(SYNC_JS, /async function refreshRelationalInvoicesCache\(\)/);
  assert.match(SYNC_JS, /function invalidateRelationalInvoicesCache\(\)/);
  assert.match(SYNC_JS, /function getInvoicesForRead\(\)/);
  assert.match(SYNC_JS, /function startInvoicesRealtime\(onChange, onStatusChange\)/);
  const stopFn = SYNC_JS.match(/function stopRealtimeSync\(\)[\s\S]*?\n\}/)[0];
  assert.match(stopFn, /_invoicesRealtimeChannel/);
});

test('cachedRelationalInvoices starts as null (distinct from an empty array), not [] -- so a page with zero invoices never gets mistaken for "not loaded yet"', () => {
  assert.match(SYNC_JS, /let cachedRelationalInvoices = null;/);
  assert.doesNotMatch(SYNC_JS, /let cachedRelationalInvoices = \[\]/);
});

test('getInvoicesForRead() falls back to th_invoices only while the cache is null, never when it is a successful empty array', () => {
  assert.match(SYNC_JS, /if \(cachedRelationalInvoices !== null\) return cachedRelationalInvoices;/);
  assert.match(SYNC_JS, /localStorage\.getItem\('th_invoices'\)/);
});

test('refreshRelationalInvoicesCache() only writes the cache on result.ok -- a failed fetch must not store [] and hide the blob fallback', () => {
  const fn = SYNC_JS.match(/async function refreshRelationalInvoicesCache\(\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(result && result\.ok\) cachedRelationalInvoices = result\.invoices;/);
  assert.doesNotMatch(fn, /cachedRelationalInvoices = result\.invoices;[\s\S]*else/);
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

function loadInvoiceReadCache(fetchImpl) {
  const fetchSrc = SYNC_JS.match(/async function fetchInvoicesFromRelational\(\)[\s\S]*?\n\}/)[0];
  const cacheSrc = SYNC_JS.match(/let cachedRelationalInvoices = null;[\s\S]*?function getInvoicesForRead\(\)[\s\S]*?\n\}/)[0];
  const store = {};
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
  const sandbox = {};
  const src = fetchSrc + '\n' + cacheSrc + `
    sandbox.fetchInvoicesFromRelational = fetchInvoicesFromRelational;
    sandbox.refreshRelationalInvoicesCache = refreshRelationalInvoicesCache;
    sandbox.invalidateRelationalInvoicesCache = invalidateRelationalInvoicesCache;
    sandbox.getInvoicesForRead = getInvoicesForRead;
  `;
  // eslint-disable-next-line no-new-func
  new Function('sandbox', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'isSyncConfigured', 'getAuthToken', 'fetch', 'localStorage',
    src
  )(sandbox, 'https://example-project.supabase.co', 'fake-anon-key', () => true, () => 'fake-token', fetchImpl, localStorage);
  sandbox._store = store;
  sandbox._localStorage = localStorage;
  return sandbox;
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

test('getInvoicesForRead() returns the blob copy while the cache is still null', () => {
  const api = loadInvoiceReadCache(async () => ({ ok: false, status: 500 }));
  api._localStorage.setItem('th_invoices', JSON.stringify([{ id: 1, invoiceNumber: 'INV-BLOB', total: 10 }]));
  const list = api.getInvoicesForRead();
  assert.equal(list.length, 1);
  assert.equal(list[0].invoiceNumber, 'INV-BLOB');
});

test('getInvoicesForRead() prefers the relational cache once a fetch succeeds, even when that cache is an empty array', async () => {
  const blob = [{ id: 1, invoiceNumber: 'INV-STALE', total: 99 }];
  const api = loadInvoiceReadCache(async () => ({
    ok: true,
    json: async () => [],
  }));
  api._localStorage.setItem('th_invoices', JSON.stringify(blob));
  assert.equal(api.getInvoicesForRead()[0].invoiceNumber, 'INV-STALE', 'pre-refresh must still see the blob');

  await api.refreshRelationalInvoicesCache();
  const list = api.getInvoicesForRead();
  assert.deepEqual(list, [], 'a successful empty fetch must not fall back to the stale blob -- that is the null vs [] trap');
});

test('getInvoicesForRead() keeps the blob fallback when the relational fetch fails, and does not lock in []', async () => {
  const api = loadInvoiceReadCache(async () => ({ ok: false, status: 500 }));
  api._localStorage.setItem('th_invoices', JSON.stringify([{ id: 7, invoiceNumber: 'INV-KEEP' }]));
  await api.refreshRelationalInvoicesCache();
  const list = api.getInvoicesForRead();
  assert.equal(list.length, 1);
  assert.equal(list[0].invoiceNumber, 'INV-KEEP');
});

test('invalidateRelationalInvoicesCache() restores the blob fallback after a successful fetch', async () => {
  const api = loadInvoiceReadCache(async () => ({
    ok: true,
    json: async () => [{
      id: 99, invoice_number: 'INV-REL', client_name: 'Bob', client_id: null,
      client_email: null, invoice_date: '2026-09-01', terms: '', invoice_type: 'invoice',
      subtotal: 1, tax: 0, discount: 0, total: 1, paid: false, paid_amount: 0,
      job_id: null, job_ref_title: '', source_quote_id: null, generated_by: null,
    }],
  }));
  api._localStorage.setItem('th_invoices', JSON.stringify([{ id: 1, invoiceNumber: 'INV-BLOB' }]));
  await api.refreshRelationalInvoicesCache();
  assert.equal(api.getInvoicesForRead()[0].invoiceNumber, 'INV-REL');
  api.invalidateRelationalInvoicesCache();
  assert.equal(api.getInvoicesForRead()[0].invoiceNumber, 'INV-BLOB');
});

test('invoice-generator.html: list display uses getInvoicesForRead, writes still go to th_invoices, and init refreshes after initSyncOnLoad', () => {
  const displayFn = INVOICE_GEN.match(/function invoicesForDisplay\(\)[\s\S]*?\n  \}/)[0];
  assert.match(displayFn, /getInvoicesForRead/);
  const renderFn = INVOICE_GEN.match(/function renderInvoiceLog\(\)[\s\S]*?\n  \}/)[0];
  assert.match(renderFn, /invoicesForDisplay\(\)/);
  assert.doesNotMatch(renderFn, /loadInvoiceLog\(\)/, 'list display must not read the blob directly -- that skips the relational cache');

  const saveFn = INVOICE_GEN.match(/function saveInvoiceLog\(list\)[\s\S]*?\n  \}/)[0];
  assert.match(saveFn, /localStorage\.setItem\(INVOICE_STORAGE_KEY/);
  assert.match(saveFn, /invalidateRelationalInvoicesCache/);
  assert.match(INVOICE_GEN, /function loadInvoiceLog\(\)/, 'write path helper must remain for line_items / toggle / delete');

  assert.match(INVOICE_GEN, /initSyncOnLoad\(\)\.then\(afterInitialSync\)\.catch\(afterInitialSync\)/);
  assert.match(INVOICE_GEN, /refreshRelationalInvoicesCache\(\)\.then\(\(\) => \{ if \(typeof renderInvoiceLog === 'function'\) renderInvoiceLog\(\); \}\)/);
  assert.match(INVOICE_GEN, /if \(typeof startInvoicesRealtime === 'function'\)/);
});

test('workspace.html: Income list uses getInvoicesForRead, togglePaid still writes the blob, and init refreshes after initSyncOnLoad', () => {
  const displayFn = WORKSPACE.match(/function invoicesForDisplay\(\)[\s\S]*?\n  \}/)[0];
  assert.match(displayFn, /getInvoicesForRead/);
  const renderFn = WORKSPACE.match(/function renderInvoicesList\(\)[\s\S]*?\n  \}/)[0];
  assert.match(renderFn, /invoicesForDisplay\(\)/);

  const saveFn = WORKSPACE.match(/function saveInvoices\(list\)[\s\S]*?\n  \}/)[0];
  assert.match(saveFn, /localStorage\.setItem\('th_invoices'/);
  assert.match(saveFn, /invalidateRelationalInvoicesCache/);
  const togglePaidFn = WORKSPACE.match(/async function togglePaid\(id\)[\s\S]*?\n  \}/)[0];
  assert.match(togglePaidFn, /loadInvoices\(\)/, 'write-back must read the blob, not the relational cache (no line_items there)');
  assert.doesNotMatch(togglePaidFn, /invoicesForDisplay\(\)/);
  assert.match(togglePaidFn, /saveInvoices\(invoices\)/);
  assert.match(togglePaidFn, /mirrorInvoiceToRelational\(inv\)/);

  assert.match(WORKSPACE, /initSyncOnLoad\(\)\.then\(renderDashboard\)\.catch\(renderDashboard\)\.then\(\(\) => \{/);
  assert.match(WORKSPACE, /refreshRelationalInvoicesCache\(\)\.then\(renderDashboard\)/);
  assert.match(WORKSPACE, /if \(typeof startInvoicesRealtime === 'function'\)/);
});

test('finance.html and runway-dashboard.html are not converted in this slice -- their invoice reads stay on the blob', () => {
  const finance = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  const runway = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  assert.doesNotMatch(finance, /getInvoicesForRead|refreshRelationalInvoicesCache|startInvoicesRealtime/);
  assert.doesNotMatch(runway, /getInvoicesForRead|refreshRelationalInvoicesCache|startInvoicesRealtime/);
});

test('sql/infra/add_invoices_to_realtime_phase2.sql adds invoices to supabase_realtime and does not touch RLS', () => {
  assert.match(SQL, /alter publication supabase_realtime add table public\.invoices;/);
  assert.doesNotMatch(SQL, /create policy|drop policy|enable row level security|alter table public\.invoices enable/i);
});
