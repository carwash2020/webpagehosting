// POS's charge-success state (2026-09-07) was a bare line of green
// text -- less visual weight than a validation error -- for what is
// the single most important confirmation in the app: the moment money
// actually changes hands. Given a proper checkmark-badge treatment,
// matching the "done" language already established elsewhere in this
// codebase (portal home's Completed Jobs icon, the teardown device's
// finished state).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const POS = fs.readFileSync(repo('tools', 'pos.html'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

test('showSuccess renders a checkmark badge, not just coloured text', () => {
  const fn = extractFn(POS, 'showSuccess');
  assert.match(fn, /class="pos-success-icon"/);
  assert.match(fn, /<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"\/><\/svg>/);
});

test('the amount is still the visually dominant element, just larger', () => {
  const fn = extractFn(POS, 'showSuccess');
  assert.match(fn, /class="pos-success-amount">\$' \+ amount\.toFixed\(2\) \+ '<\/div>/);
  const rule = POS.match(/\.pos-success-amount \{[^}]*\}/)[0];
  assert.match(rule, /font-size: 30px/);
});

test('the underlying charge flow is untouched -- same amount, same "logged to Income" fact, same reset wiring', () => {
  assert.match(POS, /function showSuccess\(amount\) \{/);
  assert.match(POS, /Charged and logged to Income/);
  assert.match(POS, /onclick="resetPosForm\(\)"/);
  // showSuccess is still called with the real charged amount, from the
  // real Stripe confirmation branch -- not a new, separate code path.
  assert.match(POS, /paymentIntent\.status === 'succeeded'\) \{\s*showSuccess\(parseFloat\(document\.getElementById\('posAmount'\)\.value\)\);/);
});

test('the success card visually distinguishes itself from the plain .pos-error text above it', () => {
  const successRule = POS.match(/\.pos-success \{[^}]*\}/)[0];
  assert.match(successRule, /background:/);
  assert.match(successRule, /border:/);
  assert.match(successRule, /border-radius:/);
  const errorRule = POS.match(/\.pos-error \{[^}]*\}/)[0];
  assert.doesNotMatch(errorRule, /background:|border:/, 'the error state should stay plain text, by contrast');
});
