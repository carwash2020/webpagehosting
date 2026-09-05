// Tests for the iOS Safari zoom-on-focus fix (2026-09-05), reported
// directly: "the invoicing tab is really hard to navigate on phone,
// you click on a field and it zooms in. Zooming back out swipes over
// to the next tab." iOS Safari auto-zooms the page when a tapped
// form field's font-size is under 16px -- confirmed directly that
// most fields on this page had no explicit font-size at all
// (falling back to the browser's own sub-16px default), and the few
// that did were explicitly 14-15px.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'invoice-generator.html'), 'utf8');

test('a genuine, comprehensive rule covers every input/select/textarea at 16px, not just the ones that already had an explicit override', () => {
  assert.match(HTML, /input, select, textarea \{ font-size: 16px; \}/);
});

test('no input, select, or textarea on this page is left below the 16px zoom threshold -- confirmed by scanning every font-size declaration, not just the ones already known about', () => {
  // A more specific selector always wins over the generic rule above,
  // regardless of where either rule sits in the file -- so every
  // pre-existing override needs its own individual bump too. This
  // scans for genuinely dangerous rules: any selector applying to a
  // real form-field type with a sub-16px font-size still attached.
  const styleBlockRaw = HTML.match(/<style>[\s\S]*?<\/style>/)[0];
  // Strips CSS comments first -- found necessary 2026-09-05, after a
  // real false positive: a comment mentioning "the Qty input" got
  // matched as if it were part of an actual selector, incorrectly
  // flagging a plain <span> text label (.qli-qty-unit) that isn't a
  // form field at all and was never at risk of triggering the zoom.
  const styleBlock = styleBlockRaw.replace(/\/\*[\s\S]*?\*\//g, '');
  const dangerousRules = [...styleBlock.matchAll(/([^{}]*\b(?:input|select|textarea)\b[^{}]*)\{([^}]*)\}/g)]
    .filter(([, selector, body]) => {
      if (/input, select, textarea \{ font-size: 16px; \}/.test(selector + '{' + body + '}')) return false; // the fix itself
      const m = body.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
      return m && parseFloat(m[1]) < 16;
    });
  assert.deepEqual(dangerousRules.map((m) => m[0]), [], 'expected zero remaining sub-16px font-size rules on any input/select/textarea selector');
});

test('the line-items table inputs (description, part #, qty, price -- the fields most directly tied to the reported complaint) are explicitly at 16px, not relying on the generic rule alone being enough to notice if it regresses', () => {
  // Updated 2026-09-05: the selector now also covers <select>
  // elements in this same table (the Type dropdown added the same
  // day), combined into one rule rather than two separate ones.
  assert.match(HTML, /\.line-items-table input, \.line-items-table select \{[^}]*font-size: 16px;/);
});

test('both saved-job-type picker selects are explicitly at 16px', () => {
  const matches = HTML.match(/font-size:16px; font-family:inherit;/g) || [];
  assert.equal(matches.length, 2, 'expected both invoicePriceRefSelect and quotePriceRefSelect bumped');
});
