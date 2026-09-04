// Test for a real, if narrow, gap found during a full portal audit
// (2026-09-04): respondToQuote() had no disable-on-click guard.
// window.confirm() being a blocking modal dialog already prevents
// most double-clicks, but a fast double-tap landing after the dialog
// closes and before the fetch resolves could still fire two real
// requests -- the backend's own guard (quote.status !== 'pending')
// would reject the second one harmlessly, but the client would see a
// confusing "something went wrong" error for a response that had
// actually already succeeded moments earlier.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'quotes.html'), 'utf8');

test('both Approve and Decline buttons pass their own element through to respondToQuote', () => {
  assert.match(html, /onclick="respondToQuote\(\$\{q\.id\}, 'approve', this\)"/);
  assert.match(html, /onclick="respondToQuote\(\$\{q\.id\}, 'decline', this\)"/);
});

test('both sibling buttons are disabled together via their shared .quote-actions parent, not just the one clicked', () => {
  const fnMatch = html.match(/async function respondToQuote\(quoteId, action, btnEl\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'expected to isolate respondToQuote()');
  const body = fnMatch[0];
  assert.match(body, /btnEl\.closest\('\.quote-actions'\)/);
  assert.match(body, /buttonsToDisable\.forEach\(b => \{ b\.disabled = true; \}\);/);
});

test('the buttons are re-enabled on both a real server error and a network failure, never left permanently stuck', () => {
  const fnMatch = html.match(/async function respondToQuote\(quoteId, action, btnEl\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  const reEnableCount = (body.match(/buttonsToDisable\.forEach\(b => \{ b\.disabled = false; \}\);/g) || []).length;
  assert.equal(reEnableCount, 2, 'expected exactly two re-enable calls: the !result.ok branch and the catch block');
});

test('a successful response does not need to manually re-enable the buttons -- renderQuotes() replaces the whole card', () => {
  const fnMatch = html.match(/async function respondToQuote\(quoteId, action, btnEl\)[\s\S]*?\n  \}\n/);
  const body = fnMatch[0];
  const successBlock = body.match(/if \(!result\.ok\) \{[\s\S]*?\n      \}\n      renderQuotes\(\);/);
  assert.ok(successBlock, 'expected to isolate the path from the ok-check through renderQuotes()');
  // Only the failure branch inside this slice should re-enable -- the
  // success path falls through directly to renderQuotes() with no
  // re-enable call of its own.
  const afterFailureBranch = successBlock[0].slice(successBlock[0].indexOf('return;') + 'return;'.length);
  assert.doesNotMatch(afterFailureBranch, /buttonsToDisable/);
});
