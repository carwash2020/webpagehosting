// Tests for the tombstone pattern extended to expenses, income,
// contacts, and contracts (2026-08-26) -- the same union-merge
// resurrection bug already found and fixed for clients (2026-08-25)
// and jobs (earlier the same day as this file), found a third and
// fourth+ time by systematically checking every real delete function
// in the codebase against it, rather than assuming the first two
// fixes covered everything.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');
const DEV_TOOLS_PATH = path.join(TOOLS_DIR, 'dev-tools.html');

function loadDevTools() {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const dataLayerSrc = fs.readFileSync(path.join(TOOLS_DIR, 'data-layer.js'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
    },
  });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = dataLayerSrc;
  window.document.head.appendChild(s);
  window.showToast = () => {};
  return window;
}

function loadSyncFunctions(window) {
  const syncJs = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
  const syncDataKeysMatch = syncJs.match(/const SYNC_DATA_KEYS = \[[\s\S]*?\n\];/);
  const mergeKeyFieldMatch = syncJs.match(/const MERGE_KEY_FIELD = \{[\s\S]*?\n\};/);
  const mergeRecordArraysMatch = syncJs.match(/function mergeRecordArrays[\s\S]*?\n\}/);
  const mergePartsMatch = syncJs.match(/function mergePartsReferenceUnits[\s\S]*?\n\}/);
  const mergeClientErrorLogMatch = syncJs.match(/const CLIENT_ERROR_LOG_MAX_AFTER_MERGE[\s\S]*?function mergeClientErrorLog[\s\S]*?\n\}/);
  const applySyncDataMatch = syncJs.match(/function applySyncData[\s\S]*?\n\}/);
  assert.ok(syncDataKeysMatch && mergeKeyFieldMatch && mergeRecordArraysMatch && mergePartsMatch && mergeClientErrorLogMatch && applySyncDataMatch, 'one or more required sync.js functions not found');
  const combined = [
    syncDataKeysMatch[0], mergeKeyFieldMatch[0], mergeRecordArraysMatch[0],
    mergePartsMatch[0], mergeClientErrorLogMatch[0], applySyncDataMatch[0],
  ].join('\n');
  window.eval(combined);
  return syncDataKeysMatch[0];
}

// --- Expenses --------------------------------------------------------

test('thAddExpenseTombstone records a tombstone by id', () => {
  const window = loadDevTools();
  window.thAddExpenseTombstone('e1');
  const tombstones = window.thLoadExpenseTombstones();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, 'e1');
});

test('deleteExpense (finance.html) actually calls thAddExpenseTombstone when the deletion finalizes', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  const fnMatch = src.match(/async function deleteExpense\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteExpense not found');
  assert.match(fnMatch[0], /thAddExpenseTombstone\(/);
});

test('clearAllExpenses (finance.html) records a tombstone for every entry being wiped, not just single deletes', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  const fnMatch = src.match(/async function clearAllExpenses\(\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'clearAllExpenses not found');
  assert.match(fnMatch[0], /thAddExpenseTombstone\(/);
});

test('a stale device pushing back its old copy of a deleted expense does not resurrect it on pull', () => {
  const window = loadDevTools();
  window.thAddExpenseTombstone('e1');
  const syncDataKeys = loadSyncFunctions(window);
  assert.match(syncDataKeys, /th_expense_tombstones/, 'th_expense_tombstones should be a synced key');

  window.applySyncData({
    th_expense_log: JSON.stringify([{ id: 'e1', amount: 42 }]),
    th_expense_tombstones: JSON.stringify([]),
  });

  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_expense_log')), []);
});

// --- Income ------------------------------------------------------------

test('thAddIncomeTombstone records a tombstone by id', () => {
  const window = loadDevTools();
  window.thAddIncomeTombstone('i1');
  const tombstones = window.thLoadIncomeTombstones();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, 'i1');
});

test('deleteIncomeEntry (finance.html) actually calls thAddIncomeTombstone when the deletion finalizes', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  const fnMatch = src.match(/async function deleteIncomeEntry\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteIncomeEntry not found');
  assert.match(fnMatch[0], /thAddIncomeTombstone\(/);
});

test('clearAllIncome (finance.html) records a tombstone for every entry being wiped, not just single deletes', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  const fnMatch = src.match(/async function clearAllIncome\(\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'clearAllIncome not found');
  assert.match(fnMatch[0], /thAddIncomeTombstone\(/);
});

test('a stale device pushing back its old copy of a deleted income entry does not resurrect it on pull', () => {
  const window = loadDevTools();
  window.thAddIncomeTombstone('i1');
  const syncDataKeys = loadSyncFunctions(window);
  assert.match(syncDataKeys, /th_income_tombstones/, 'th_income_tombstones should be a synced key');

  window.applySyncData({
    th_income_log: JSON.stringify([{ id: 'i1', amount: 500 }]),
    th_income_tombstones: JSON.stringify([]),
  });

  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_income_log')), []);
});

// --- Contacts ------------------------------------------------------------

test('thAddContactTombstone records a tombstone by id', () => {
  const window = loadDevTools();
  window.thAddContactTombstone('ct1');
  const tombstones = window.thLoadContactTombstones();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, 'ct1');
});

test('deleteContact (job-tracker.html) actually calls thAddContactTombstone when the deletion finalizes', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  const fnMatch = src.match(/async function deleteContact\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteContact not found');
  assert.match(fnMatch[0], /thAddContactTombstone\(/);
});

test('a stale device pushing back its old copy of a deleted contact does not resurrect it on pull', () => {
  const window = loadDevTools();
  window.thAddContactTombstone('ct1');
  const syncDataKeys = loadSyncFunctions(window);
  assert.match(syncDataKeys, /th_contact_tombstones/, 'th_contact_tombstones should be a synced key');

  window.applySyncData({
    th_tracker_contacts: JSON.stringify([{ id: 'ct1', name: 'Old Contact' }]),
    th_contact_tombstones: JSON.stringify([]),
  });

  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_tracker_contacts')), []);
});

// --- Contracts ------------------------------------------------------------

test('thAddContractTombstone records a tombstone by id', () => {
  const window = loadDevTools();
  window.thAddContractTombstone('ctr1');
  const tombstones = window.thLoadContractTombstones();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, 'ctr1');
});

test('deleteContractLogEntry (contract-generator.html) actually calls thAddContractTombstone when the deletion finalizes', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'contract-generator.html'), 'utf8');
  const fnMatch = src.match(/async function deleteContractLogEntry\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteContractLogEntry not found');
  assert.match(fnMatch[0], /thAddContractTombstone\(/);
});

test('a stale device pushing back its old copy of a deleted contract does not resurrect it on pull', () => {
  const window = loadDevTools();
  window.thAddContractTombstone('ctr1');
  const syncDataKeys = loadSyncFunctions(window);
  assert.match(syncDataKeys, /th_contract_tombstones/, 'th_contract_tombstones should be a synced key');

  window.applySyncData({
    th_contracts: JSON.stringify([{ id: 'ctr1', client: 'Old Client' }]),
    th_contract_tombstones: JSON.stringify([]),
  });

  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_contracts')), []);
});

// --- Invoices and quotes ---------------------------------------------
// Unlike every record type above, delete never existed for these two
// at all before now (2026-08-26) -- added for the first time here,
// with the tombstone fix built in from the start rather than as a
// later fix, per the direct request.

test('thAddInvoiceTombstone records a tombstone by id', () => {
  const window = loadDevTools();
  window.thAddInvoiceTombstone(501);
  const tombstones = window.thLoadInvoiceTombstones();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, 501);
});

test('deleteInvoiceLogEntry (invoice-generator.html) actually calls thAddInvoiceTombstone when the deletion finalizes', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'invoice-generator.html'), 'utf8');
  const fnMatch = src.match(/async function deleteInvoiceLogEntry\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteInvoiceLogEntry not found');
  assert.match(fnMatch[0], /thAddInvoiceTombstone\(/);
});

test('deleteInvoiceLogEntry deliberately never touches the income log, matching this codebase\'s established "deletion never cascades to a different record type" philosophy', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'invoice-generator.html'), 'utf8');
  const fnMatch = src.match(/async function deleteInvoiceLogEntry\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteInvoiceLogEntry not found');
  assert.doesNotMatch(fnMatch[0], /INCOME_LOG_KEY|income_log/i, 'should not touch the income log directly');
});

test('a stale device pushing back its old copy of a deleted invoice does not resurrect it on pull', () => {
  const window = loadDevTools();
  window.thAddInvoiceTombstone(501);
  const syncDataKeys = loadSyncFunctions(window);
  assert.match(syncDataKeys, /th_invoice_tombstones/, 'th_invoice_tombstones should be a synced key');

  window.applySyncData({
    th_invoices: JSON.stringify([{ id: 501, invoiceNumber: 'INV-501', total: 800 }]),
    th_invoice_tombstones: JSON.stringify([]),
  });

  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_invoices')), []);
});

test('thAddQuoteTombstone records a tombstone by id', () => {
  const window = loadDevTools();
  window.thAddQuoteTombstone(601);
  const tombstones = window.thLoadQuoteTombstones();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, 601);
});

test('deleteQuoteLogEntry (invoice-generator.html) actually calls thAddQuoteTombstone when the deletion finalizes', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'invoice-generator.html'), 'utf8');
  const fnMatch = src.match(/async function deleteQuoteLogEntry\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteQuoteLogEntry not found');
  assert.match(fnMatch[0], /thAddQuoteTombstone\(/);
});

test('a stale device pushing back its old copy of a deleted quote does not resurrect it on pull', () => {
  const window = loadDevTools();
  window.thAddQuoteTombstone(601);
  const syncDataKeys = loadSyncFunctions(window);
  assert.match(syncDataKeys, /th_quote_tombstones/, 'th_quote_tombstones should be a synced key');

  window.applySyncData({
    th_quotes: JSON.stringify([{ id: 601, quoteNumber: 'Q-601', total: 300 }]),
    th_quote_tombstones: JSON.stringify([]),
  });

  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_quotes')), []);
});

test('the invoice log and quote log rendering both filter out entries pending deletion (mid-undo-window), matching the established pattern from expenses/contacts', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'invoice-generator.html'), 'utf8');
  assert.match(src, /pendingDeleteInvoiceIds\.size > 0.*filter/, 'renderInvoiceLog should filter pending deletions');
  assert.match(src, /pendingDeleteQuoteIds\.size > 0.*filter/, 'renderQuoteLog should filter pending deletions');
});
