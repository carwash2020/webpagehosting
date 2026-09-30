// scripts/item1-census.js lists every read/write of an Item 1 migrated key
// (docs/ITEM-1-INVENTORY.md). The Phase 4 device checklist and Phase 5
// cutover rely on that list being complete, so pin the alias forms it must
// resolve against real call sites. If one of these moves, update the
// expectation, not the script's coverage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scan, helpers } = require('../../scripts/item1-census.js');

const rows = scan();
const has = (file, key, kind) => rows.some((r) => r.file === file && r.key === key && r.kind === kind);

test('resolves a local constant alias (finance.html EXPENSE_STORAGE_KEY)', () => {
  assert.ok(has('tools/finance.html', 'th_expense_log', 'write'));
  assert.ok(has('tools/finance.html', 'th_expense_log', 'read'));
});

test('resolves a local key-map alias (job-tracker.html STORAGE_KEYS.contacts)', () => {
  assert.ok(has('tools/job-tracker.html', 'th_tracker_contacts', 'write'));
});

test('resolves the shared TH_KEYS alias (data-layer.js thRead(TH_KEYS.jobs))', () => {
  assert.ok(has('tools/data-layer.js', 'th_tracker_jobs', 'read'));
});

test('covers every migrated entity, tombstones included', () => {
  const keys = new Set(rows.map((r) => r.key));
  for (const k of ['th_tracker_jobs', 'th_invoices', 'th_quotes', 'th_contracts', 'th_expense_log',
    'th_income_log', 'th_tracker_contacts', 'th_clients', 'th_job_tombstones', 'th_client_tombstones']) {
    assert.ok(keys.has(k), `${k} not found`);
  }
});

test('follows shared helpers to their page callers, including indirect ones', () => {
  const h = Object.fromEntries(helpers(rows).map((x) => [x.name, x]));
  assert.ok(h.thLoadClients, 'direct helper');
  assert.ok(h.thEnsureClient, 'indirect helper (via thLoadClients)');
  assert.ok(h.thEnsureClient.callers.some((c) => c.file === 'tools/job-tracker.html'));
  assert.ok(h.getInvoicesForRead.callers.some((c) => c.file === 'tools/finance.html'));
  // Inner arrow functions are not helpers other pages can call.
  assert.equal(h.match, undefined);
  assert.equal(h.linked, undefined);
});
