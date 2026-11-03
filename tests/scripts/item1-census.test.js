// scripts/item1-census.js lists every read/write of an Item 1 migrated key
// (docs/ITEM-1-INVENTORY.md). The Phase 4 device checklist and Phase 5
// cutover rely on that list being complete, so pin the alias forms it must
// resolve against real call sites. If one of these moves, update the
// expectation, not the script's coverage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scan, helpers, aliasesFor } = require('../../scripts/item1-census.js');

const rows = scan();
const has = (file, key, kind) => rows.some((r) => r.file === file && r.key === key && r.kind === kind);

// The page-level aliases these first pinned (finance.html EXPENSE_STORAGE_KEY,
// job-tracker.html STORAGE_KEYS.contacts) are gone: since 2026-11-03 every
// page reads and writes these keys through the data-layer.js seams, which is
// exactly what this census is for. The alias forms are still resolved --
// pinned against the scanner itself -- and the pages are pinned clean.
test('resolves a local constant alias and a local key-map alias', () => {
  const src = "const EXPENSE_STORAGE_KEY = 'th_expense_log';\n  const STORAGE_KEYS = { jobs: 'th_tracker_jobs', contacts: 'th_tracker_contacts' };";
  const a = aliasesFor(src, {});
  assert.equal(a.EXPENSE_STORAGE_KEY, 'th_expense_log');
  assert.equal(a['STORAGE_KEYS.contacts'], 'th_tracker_contacts');
});

test('no page writes a migrated key behind the data layer\'s back any more (thWrite is the data layer)', () => {
  const pageWrites = rows.filter((r) => /^tools\/[^/]+\.html$/.test(r.file) && r.kind === 'write' && !/\bthWrite\(/.test(r.text));
  assert.deepEqual(pageWrites.map((r) => r.file + ':' + r.line + ' ' + r.key), []);
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
