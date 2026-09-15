// Tests for adding a quote-to-invoice conversion rate metric to
// invoice-generator.html (audit item #17). Quotes already tracked
// their own status ('converted' once logInvoice() turns one into an
// invoice, 'pending' otherwise -- see renderQuoteLog()'s own status
// badge), but that had never been rolled up into a single rate
// anywhere, even though it's a real, useful measure of how often a
// quote actually turns into paid work.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INVOICE_GEN = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');

function renderQuoteLogSrc() {
  const fn = INVOICE_GEN.match(/function renderQuoteLog\(\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'expected to isolate renderQuoteLog()');
  return fn[0];
}

test('the Recent Quotes section has a conversion-rate stat element', () => {
  assert.match(INVOICE_GEN, /<p class="contract-log-meta" id="quoteConversionStat" style="margin:0 0 14px;"><\/p>/);
});

test('the stat is computed over the FULL log, before the search filter narrows what is displayed', () => {
  const fn = renderQuoteLogSrc();
  const statBlockIdx = fn.indexOf("document.getElementById('quoteConversionStat')");
  const searchFilterIdx = fn.indexOf('if (searchTerm) {');
  assert.ok(statBlockIdx !== -1 && searchFilterIdx !== -1);
  assert.ok(statBlockIdx < searchFilterIdx, 'the stat must be computed before the search term filters the log, so searching never changes the rate shown');
});

test('the stat still excludes quotes pending deletion, same as the rendered list itself', () => {
  const fn = renderQuoteLogSrc();
  const pendingDeleteFilterIdx = fn.indexOf('if (pendingDeleteQuoteIds.size > 0)');
  const statBlockIdx = fn.indexOf("document.getElementById('quoteConversionStat')");
  assert.ok(pendingDeleteFilterIdx !== -1 && statBlockIdx !== -1);
  assert.ok(pendingDeleteFilterIdx < statBlockIdx, 'pending-delete quotes must already be filtered out before the stat is computed');
});

test('the percentage is converted-count over total log length, rounded to a whole number', () => {
  const fn = renderQuoteLogSrc();
  assert.match(fn, /const convertedCount = log\.filter\(q => q\.status === 'converted'\)\.length;/);
  assert.match(fn, /const pct = Math\.round\(\(convertedCount \/ log\.length\) \* 100\);/);
});

test('an empty quote log shows no stat at all, rather than a misleading "0 of 0 (NaN%)"', () => {
  const fn = renderQuoteLogSrc();
  const ifEmptyMatch = fn.match(/if \(log\.length === 0\) \{\s*\n\s*statEl\.textContent = '';/);
  assert.ok(ifEmptyMatch, 'expected an explicit empty-log branch clearing the stat text');
});

test('the stat text is grammatically correct for exactly one quote (no "1 quotes")', () => {
  const fn = renderQuoteLogSrc();
  assert.match(fn, /\$\{log\.length === 1 \? '' : 's'\}/);
});

test('the stat text names both the count and the percentage plainly', () => {
  const fn = renderQuoteLogSrc();
  assert.match(fn, /statEl\.textContent = `\$\{convertedCount\} of \$\{log\.length\} quote\$\{log\.length === 1 \? '' : 's'\} \(\$\{pct\}%\) converted to an invoice`;/);
});

// Direct verification of the actual math, run independently of the
// shipped source, against a range of realistic counts -- confirms the
// formula itself (not just that these exact tokens appear in the file)
// produces sensible output.
test('conversion percentage math produces the expected result for realistic quote counts', () => {
  const cases = [
    { converted: 0, total: 1, expectedPct: 0 },
    { converted: 1, total: 1, expectedPct: 100 },
    { converted: 1, total: 3, expectedPct: 33 }, // rounds down from 33.33
    { converted: 2, total: 3, expectedPct: 67 }, // rounds up from 66.67
    { converted: 5, total: 8, expectedPct: 63 },
  ];
  for (const { converted, total, expectedPct } of cases) {
    const pct = Math.round((converted / total) * 100);
    assert.equal(pct, expectedPct, `${converted}/${total} should round to ${expectedPct}%`);
  }
});
