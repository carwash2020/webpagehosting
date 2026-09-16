// Bug fix (2026-09-16): checkOverdueInvoices in send-push checked
// `inv.paid` directly, so an invoice paid in full via a logged
// paidAmount (without the legacy `paid` boolean ever getting flipped)
// kept firing a wrongful "Invoice Overdue" push every day. Found on a
// real invoice (INV-2026-0905): paidAmount === total, paid still
// false. Fixed by deriving "still owed" from paidAmount/total the
// same whole-cents-rounded way workspace.html and
// send-payment-reminder-index.ts already do, instead of trusting the
// boolean.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SRC = fs.readFileSync(repo('edge-functions', 'send-push-index.ts'), 'utf8');

test('checkOverdueInvoices derives "still owed" from paidAmount/total, never the raw paid boolean', () => {
  const fnMatch = SRC.match(/async function checkOverdueInvoices\(invoices: any\[\]\) \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate checkOverdueInvoices()');
  assert.match(fnMatch[0], /if \(getRemainingCents\(inv\) <= 0\) continue; \/\/ paid in full/);
  assert.doesNotMatch(fnMatch[0], /if \(inv\.paid\) continue;/, 'must not trust the legacy paid boolean directly -- it can desync from paidAmount');
});

test('getPaidAmount/getRemainingCents match workspace.html\'s exact whole-cents rounding and legacy fallback', () => {
  assert.match(SRC, /function toCents\(n: unknown\): number \{\s*return Math\.round\(\(Number\(n\) \|\| 0\) \* 100\);\s*\}/);
  assert.match(SRC, /function getPaidAmount\(invoice: Record<string, unknown>\): number \{/);
  assert.match(SRC, /if \(invoice\.paidAmount !== undefined && invoice\.paidAmount !== null\) return Number\(invoice\.paidAmount\) \|\| 0;/);
  assert.match(SRC, /return invoice\.paid \? Number\(invoice\.total\) \|\| 0 : 0;/);
  assert.match(SRC, /function getRemainingCents\(invoice: Record<string, unknown>\): number \{\s*return Math\.max\(0, toCents\(invoice\.total\) - toCents\(getPaidAmount\(invoice\)\)\);\s*\}/);
});
