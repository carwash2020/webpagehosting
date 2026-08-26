// Tests for tools/data-layer.js -- the shared data-access layer and the
// client registry/backfill (structural items #40 and #7).
//
// These matter more than most tests in this project: the backfill runs
// against real, already-entered business records (jobs, invoices, quotes,
// contracts, contacts). A bug here doesn't produce a visual glitch, it
// silently mis-attributes or orphans someone's actual work history. So the
// guarantees below are enforced on every push rather than verified once by
// hand and trusted thereafter.
//
// Run locally with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const DATA_LAYER_PATH = path.join(__dirname, '..', '..', 'tools', 'data-layer.js');

// Fresh sandbox per test -- its own window/localStorage, so no test can leak
// state into another (same isolation approach as parts-reference.test.js).
function loadLayer(seed) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/' });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;

  Object.entries(seed || {}).forEach(([k, v]) => {
    window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  });

  const src = fs.readFileSync(DATA_LAYER_PATH, 'utf8');
  const sandbox = {};
  // Evaluated into a function scope and the needed symbols returned, rather
  // than polluting global -- keeps each test's copy independent.
  const exportNames = [
    'thRead', 'thWrite', 'thNormalizeClientName', 'thLoadClients', 'thBackfillClients',
    'thFindClientByName', 'thFindClientById', 'thEnsureClient', 'thGetClientBundle',
    'thGetAllClientsWithTotals', 'thRunClientBackfillOnce', 'TH_KEYS',
    'thComputeJobMargin', 'thGetJobBundle',
  ];
  const fn = new Function('window', 'document', 'localStorage',
    src + '\nreturn {' + exportNames.join(',') + '};');
  Object.assign(sandbox, fn(window, window.document, window.localStorage));
  sandbox._localStorage = window.localStorage;
  return sandbox;
}

// The single most important guarantee in this file. Case and spacing
// variants of one real client currently fragment every report that groups
// by name -- that's the whole reason this registry exists.
test('backfill collapses case/spacing variants of one client into a single record', () => {
  const L = loadLayer({
    th_tracker_jobs: [
      { id: 1, title: 'a', client: 'Sarah Miller', phone: '435-555-0101', address: '12 Oak St', date: '2026-07-01' },
      { id: 2, title: 'b', client: 'sarah miller', date: '2026-08-01' },
      { id: 3, title: 'c', client: 'Sarah  Miller', date: '2026-08-10' },
    ],
    th_invoices: [
      { id: 11, clientName: 'SARAH MILLER', total: 450 },
    ],
  });
  const result = L.thBackfillClients();
  assert.equal(result.created, 1, 'four spellings of one client should create exactly one record');
  assert.equal(L.thLoadClients().length, 1);
});

test('backfill recovers contact details scattered across different record types', () => {
  const L = loadLayer({
    th_tracker_jobs: [{ id: 1, title: 'a', client: 'Sarah Miller', phone: '435-555-0101', address: '12 Oak St' }],
    th_tracker_contacts: [{ id: 31, name: 'sarah miller', email: 'sarah@example.com' }],
  });
  L.thBackfillClients();
  const c = L.thLoadClients()[0];
  assert.equal(c.phone, '435-555-0101', 'phone should come from the job record');
  assert.equal(c.address, '12 Oak St', 'address should come from the job record');
  assert.equal(c.email, 'sarah@example.com', 'email should come from the contact record');
});

test('client bundle attributes every linked record and total correctly', () => {
  const L = loadLayer({
    th_tracker_jobs: [
      { id: 1, title: 'a', client: 'Sarah Miller', date: '2026-07-01' },
      { id: 2, title: 'b', client: 'sarah miller', date: '2026-08-10' },
      { id: 3, title: 'c', client: 'Bob Jones', date: '2026-06-01' },
    ],
    th_invoices: [
      { id: 11, clientName: 'Sarah Miller', total: 450 },
      { id: 12, clientName: 'SARAH MILLER', total: 200 },
      { id: 13, clientName: 'Bob Jones', total: 125.5 },
    ],
    th_quotes: [{ id: 21, clientName: 'Sarah  Miller', total: 300 }],
  });
  L.thBackfillClients();
  const sarah = L.thFindClientByName('sarah miller');
  const bundle = L.thGetClientBundle(sarah.id);
  assert.equal(bundle.jobs.length, 2);
  assert.equal(bundle.invoices.length, 2);
  assert.equal(bundle.quotes.length, 1);
  assert.equal(bundle.revenue, 650, 'revenue must sum across all spelling variants');
  assert.equal(bundle.lastJobDate, '2026-08-10', 'should report the most recent job date');
  // Bob's records must NOT leak into Sarah's bundle.
  assert.ok(!bundle.invoices.some(i => i.clientName === 'Bob Jones'));
});

test('backfill is idempotent -- re-running creates no duplicates', () => {
  const L = loadLayer({
    th_tracker_jobs: [{ id: 1, title: 'a', client: 'Sarah Miller' }],
  });
  assert.equal(L.thBackfillClients().created, 1);
  assert.equal(L.thBackfillClients().created, 0, 'second run must create nothing');
  assert.equal(L.thBackfillClients().created, 0, 'third run must create nothing');
  assert.equal(L.thLoadClients().length, 1);
});

test('blank, null, and whitespace-only client names are never registered', () => {
  const L = loadLayer({
    th_tracker_jobs: [
      { id: 1, title: 'a', client: null },
      { id: 2, title: 'b' },
      { id: 3, title: 'c', client: '   ' },
      { id: 4, title: 'd', client: '' },
      { id: 5, title: 'e', client: 'Real Person' },
    ],
  });
  L.thBackfillClients();
  const names = L.thLoadClients().map(c => c.name);
  assert.deepEqual(names, ['Real Person']);
});

// Corrupted localStorage is a real scenario -- 14 load functions in this app
// had no error handling at all until it was found and fixed. The data layer
// is meant to be the place that makes that impossible to reintroduce.
test('corrupted or malformed stored data never throws', () => {
  const L = loadLayer({
    th_tracker_jobs: 'not json at all {{{',
    th_invoices: '',
    th_contracts: JSON.stringify([{ id: 1 }, null, { id: 2, fields: null }]),
  });
  assert.doesNotThrow(() => L.thBackfillClients());
  assert.deepEqual(L.thRead('th_tracker_jobs', []), [], 'unparseable value should fall back');
});

test('lookups with bad input return null rather than throwing', () => {
  const L = loadLayer({});
  assert.equal(L.thGetClientBundle('does-not-exist'), null);
  assert.equal(L.thGetClientBundle(null), null);
  assert.equal(L.thFindClientById(null), null);
  assert.equal(L.thFindClientByName(''), null);
  assert.equal(L.thFindClientByName(null), null);
});

// Date.now() alone collides when several records are created in the same
// millisecond -- exactly what a bulk backfill does.
test('rapidly created clients never collide on id', () => {
  const L = loadLayer({});
  const ids = new Set();
  for (let i = 0; i < 200; i++) ids.add(L.thEnsureClient('Client ' + i).id);
  assert.equal(ids.size, 200, 'every generated id must be unique');
});

test('thEnsureClient reuses an existing record across case/spacing variance', () => {
  const L = loadLayer({});
  const a = L.thEnsureClient('Jane Doe');
  const b = L.thEnsureClient('jane doe');
  const c = L.thEnsureClient('  JANE   DOE  ');
  assert.equal(a.id, b.id);
  assert.equal(b.id, c.id);
  assert.equal(L.thLoadClients().length, 1);
});

test('leaderboard totals sort by revenue and count records per client', () => {
  const L = loadLayer({
    th_tracker_jobs: [
      { id: 1, title: 'a', client: 'Small Client', date: '2026-01-01' },
      { id: 2, title: 'b', client: 'Big Client', date: '2026-02-01' },
    ],
    th_invoices: [
      { id: 11, clientName: 'Small Client', total: 100 },
      { id: 12, clientName: 'Big Client', total: 5000 },
    ],
  });
  L.thBackfillClients();
  const totals = L.thGetAllClientsWithTotals();
  assert.equal(totals[0].name, 'Big Client', 'highest revenue should sort first');
  assert.equal(totals[0].revenue, 5000);
  assert.equal(totals[0].jobCount, 1);
  assert.equal(totals[1].revenue, 100);
});

test('backfill never modifies the original source records', () => {
  const originalJobs = [{ id: 1, title: 'a', client: 'Sarah Miller', phone: '435-555-0101' }];
  const L = loadLayer({ th_tracker_jobs: originalJobs, th_invoices: [{ id: 11, clientName: 'Sarah Miller', total: 450 }] });
  L.thBackfillClients();
  // The whole safety premise of this migration is that it only ADDS a new
  // key and leaves every existing record byte-for-byte untouched.
  assert.deepEqual(L.thRead('th_tracker_jobs', []), originalJobs);
  assert.deepEqual(L.thRead('th_invoices', []), [{ id: 11, clientName: 'Sarah Miller', total: 450 }]);
});

test('run-once helper does not repeat its work on a second call', () => {
  const L = loadLayer({ th_tracker_jobs: [{ id: 1, title: 'a', client: 'Sarah Miller' }] });
  const first = L.thRunClientBackfillOnce();
  assert.equal(first.created, 1);
  assert.equal(L.thRunClientBackfillOnce(), null, 'second call should no-op');
});

// Push 2 (2026-08-20): verifies the ACTUAL wiring added to job-tracker.html's
// addJob(), invoice-generator.html's logInvoice()/logQuote(), and
// contract-generator.html's contract save -- not just thEnsureClient() in
// isolation (already covered above), but the real call sites that now run
// on every save going forward. Extracts the relevant source rather than
// loading the full page (job-tracker.html alone is 2,400+ lines with a
// realtime-sync/photo/calendar init sequence unrelated to what's being
// verified here), matching the extraction approach sync-merge.test.js
// already uses for sync.js.

test('addJob() in job-tracker.html calls thEnsureClient with the typed client name', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
  const fnMatch = src.match(/async function addJob\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'addJob() not found -- did it get renamed or removed?');
  const fnSrc = fnMatch[0];
  assert.match(fnSrc, /thEnsureClient\(clientName,\s*\{\s*phone,\s*address\s*\}\)/,
    'addJob() should call thEnsureClient with the client name and phone/address');
  assert.match(fnSrc, /clientId,/, 'the resulting id should be stored on the job record as clientId');
});

test('logInvoice() and logQuote() in invoice-generator.html both call thEnsureClient', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');
  const invoiceFn = src.match(/function logInvoice\(totals\)[\s\S]*?\n  \}\n/);
  const quoteFn = src.match(/function logQuote\(totals\)[\s\S]*?\n  \}\n/);
  assert.ok(invoiceFn, 'logInvoice() not found');
  assert.ok(quoteFn, 'logQuote() not found');
  assert.match(invoiceFn[0], /thEnsureClient\(/, 'logInvoice() should register/look up the client');
  assert.match(quoteFn[0], /thEnsureClient\(/, 'logQuote() should register/look up the client');
  assert.match(invoiceFn[0], /clientId,/);
  assert.match(quoteFn[0], /clientId:/);
});

test('contract save in contract-generator.html calls thEnsureClient and stores clientId at the top level (matching thGetClientBundle\'s check)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'contract-generator.html'), 'utf8');
  assert.match(src, /thEnsureClient\(fields\.clientName/, 'contract save should register/look up the client from fields.clientName');
  // thGetClientBundle() in data-layer.js checks c.clientId (top-level on
  // the log entry), not c.fields.clientId -- this guards against that
  // exact mismatch being reintroduced silently.
  assert.match(src, /clientId:\s*contractClientId,/, 'clientId must be a top-level field on the log entry, not nested inside fields');
});

// Push 3 (2026-08-20): thComputeJobMargin/thGetJobBundle -- moved out of
// job-tracker.html (which had the only copy) into the shared data layer,
// since the new Job Detail page needed the exact same calculation. These
// lock in the math itself; a separate test below confirms job-tracker.html
// was actually updated to delegate to it rather than keeping its own copy.

test('thComputeJobMargin sums linked invoices and manual income, subtracts linked expenses', () => {
  const L = loadLayer({});
  const job = { id: 1, title: 'Fix sink' };
  const invoices = [{ id: 10, jobRefId: 1, total: 300 }, { id: 11, jobRefId: 2, total: 999 }];
  const expenses = [{ id: 20, jobRefId: 1, amount: 80 }, { id: 21, jobRefId: 2, amount: 999 }];
  const income = [{ id: 30, jobRefId: 1, amount: 50 }];
  const result = L.thComputeJobMargin(job, invoices, expenses, income);
  assert.equal(result.revenue, 350, 'invoice total + manual income for THIS job only');
  assert.equal(result.cost, 80);
  assert.equal(result.margin, 270);
  assert.equal(result.hasInvoice, true);
  assert.equal(result.hasCost, true);
  // job 2's numbers must never leak into job 1's result
  assert.notEqual(result.revenue, 350 + 999);
});

test('thComputeJobMargin reports hasInvoice/hasCost false with no linked records, without dividing by zero', () => {
  const L = loadLayer({});
  const result = L.thComputeJobMargin({ id: 1 }, [], [], []);
  assert.equal(result.hasInvoice, false);
  assert.equal(result.hasCost, false);
  assert.equal(result.revenue, 0);
  assert.equal(result.marginPct, 0, 'percentage of zero revenue should be 0, not NaN or Infinity');
});

test('thGetJobBundle returns null for an unknown job id rather than throwing', () => {
  const L = loadLayer({ th_tracker_jobs: [{ id: 1, title: 'a' }] });
  assert.equal(L.thGetJobBundle('does-not-exist'), null);
  assert.equal(L.thGetJobBundle(999), null);
});

test('thGetJobBundle resolves the client via clientId first, falling back to name matching', () => {
  const L = loadLayer({
    th_tracker_jobs: [
      { id: 1, title: 'Job with id', client: 'Old Name On File', clientId: 'c_fixed' },
      { id: 2, title: 'Job without id', client: 'Sarah Miller' },
    ],
  });
  // Manually seed a client whose CURRENT name differs from what job 1
  // still has on file -- clientId must win over the stale name.
  L._localStorage.setItem('th_clients', JSON.stringify([
    { id: 'c_fixed', name: 'Current Correct Name' },
  ]));
  const bundle1 = L.thGetJobBundle(1);
  assert.equal(bundle1.client.name, 'Current Correct Name', 'clientId should be preferred over the possibly-stale name string');

  L.thBackfillClients();
  const bundle2 = L.thGetJobBundle(2);
  assert.equal(bundle2.client.name, 'Sarah Miller', 'a job with no clientId should still resolve by name');
});

test('thGetJobBundle only links records for the requested job, never a different one', () => {
  const L = loadLayer({
    th_tracker_jobs: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }],
    th_invoices: [{ id: 10, jobRefId: 1, total: 100 }, { id: 11, jobRefId: 2, total: 999 }],
    th_quotes: [{ id: 20, jobRefId: 1, total: 50 }],
    th_expense_log: [{ id: 30, jobRefId: 2, amount: 999 }],
  });
  const bundle = L.thGetJobBundle(1);
  assert.equal(bundle.linkedInvoices.length, 1);
  assert.equal(bundle.linkedInvoices[0].total, 100);
  assert.equal(bundle.linkedQuotes.length, 1);
  assert.equal(bundle.linkedExpenses.length, 0, 'job 2\'s expense must not appear on job 1\'s bundle');
});

test('job-tracker.html delegates to the shared thComputeJobMargin rather than keeping its own duplicate copy', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
  const fnMatch = src.match(/function computeJobMargin\(job, invoices, expenses, manualIncome\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'computeJobMargin() not found in job-tracker.html');
  assert.match(fnMatch[0], /return thComputeJobMargin\(/,
    'computeJobMargin() should delegate to the shared thComputeJobMargin(), not recompute the math itself');
});
