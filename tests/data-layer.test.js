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

const DATA_LAYER_PATH = path.join(__dirname, '..', 'tools', 'data-layer.js');

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
