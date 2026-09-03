// Tests for two 2026-09-02 changes to invoice-generator.html.
//
// 1. Deleting an invoice now removes the income entry it CREATED, so
//    the Business Snapshot reflects reality. Reported directly after
//    test invoices left phantom revenue behind: "buisness snapshot
//    needs to update when a invoice gets deleted, as now it has test
//    data as real figures."
//
// 2. An invoice type (Standard / Deposit / Balance / Progress) that
//    prints on the PDF and is stored on the record.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');

test('deleting an invoice removes the income entry that invoice created, and only that one', () => {
  const fnMatch = SRC.match(/function removeIncomeEntriesForInvoice\(invoiceId\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected removeIncomeEntriesForInvoice()');
  const body = fnMatch[0];
  // Scoped by BOTH the origin marker and the specific invoice id --
  // manually-entered income (no origin/invoiceId link) must never be
  // touched. This is removing a derived record, not cascading into an
  // unrelated one.
  assert.match(body, /e\.origin === 'invoice' && e\.invoiceId === invoiceId/);
  // Tombstoned so a stale device can't resurrect it on the next sync.
  assert.match(body, /thAddIncomeTombstone\(e\.id\)/);
  assert.match(body, /scheduleSync\(\)/);
});

test('deleteInvoiceLogEntry calls the income cleanup inside the committed delete, after the undo window', () => {
  const fnMatch = SRC.match(/async function deleteInvoiceLogEntry\(id\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected deleteInvoiceLogEntry()');
  const body = fnMatch[0];
  const timerIdx = body.indexOf('setTimeout(');
  const cleanupIdx = body.indexOf('removeIncomeEntriesForInvoice(id)');
  assert.ok(timerIdx !== -1 && cleanupIdx !== -1);
  // Inside the timer, not before it: undo must still be able to
  // restore both the invoice AND its income entry untouched.
  assert.ok(cleanupIdx > timerIdx, 'income cleanup must happen inside the deferred delete, so Undo still works');
});

test('deleting an invoice also removes its portal copy, via the service-role edge function', () => {
  // client_portal_invoices has no delete policy for authenticated at
  // all (deliberately -- a client must never remove their own invoice),
  // so this must go through an edge function, never a direct DELETE.
  assert.match(SRC, /functions\/v1\/delete-portal-invoice/);
  assert.doesNotMatch(SRC, /client_portal_invoices[^\n]*method: 'DELETE'/);
  const fnMatch = SRC.match(/async function deleteInvoiceLogEntry\(id\)[\s\S]*?\n  \}\n/);
  assert.match(fnMatch[0], /removePortalInvoice\(id\)/);
});

test('the delete confirmation explains what else will be removed, rather than telling the user to go clean up elsewhere', () => {
  const fnMatch = SRC.match(/async function deleteInvoiceLogEntry\(id\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  assert.match(body, /Business Snapshot stays accurate/);
  // The old text literally instructed the user to delete the income
  // entry separately on Finance -- exactly the friction that was
  // reported. It must be gone.
  assert.doesNotMatch(body, /delete that separately on Finance/);
});

test('an invoice type selector exists with the four real-world types', () => {
  assert.match(SRC, /id="invoiceType"/);
  for (const v of ['standard', 'deposit', 'balance', 'progress']) {
    assert.match(SRC, new RegExp(`<option value="${v}"`), `missing invoice type: ${v}`);
  }
});

test('the invoice type drives the PDF title, so a client can tell a deposit from a final bill', () => {
  assert.match(SRC, /DEPOSIT INVOICE/);
  assert.match(SRC, /BALANCE DUE/);
  assert.match(SRC, /PROGRESS PAYMENT/);
  // Standard keeps the plain title -- no change for the common case.
  assert.match(SRC, /standard: 'INVOICE'/);
});

test('the invoice type is stored on the log entry and reset on form clear', () => {
  assert.match(SRC, /invoiceType: \(document\.getElementById\('invoiceType'\) \|\| \{\}\)\.value \|\| 'standard'/);
  assert.match(SRC, /getElementById\('invoiceType'\)\.value = 'standard'/);
});
