// Bug (Connor, 2026-11-04): on New quote > Estimate Details, the Date field
// (#quoteDate) overflowed the card's right edge at phone width on iOS
// Safari, while Estimate Number fitted; the invoice tab's Date field
// (#invoiceDate) is the same pattern. The older rule only let the input
// shrink (min-width:0); the overflow was padding-plus-border wide because
// iOS Safari sizes a natively-styled date input itself and ignores
// box-sizing: border-box. Fix: appearance:none + width:100% + border-box on
// date inputs inside .form-field. (Checked at phone width in Chromium; iOS
// Safari itself can only be checked on a phone.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const CSS = fs.readFileSync(path.join(TOOLS, 'styles-tools.css'), 'utf8');
const INV = fs.readFileSync(path.join(TOOLS, 'invoice-generator.html'), 'utf8');

test('date inputs in a form field drop the native appearance and size by border-box, like every other field', () => {
  const rule = CSS.match(/\.form-field input\[type="date"\] \{\s*-webkit-appearance: none;\s*appearance: none;\s*display: block;\s*width: 100%;\s*box-sizing: border-box;\s*\}/);
  assert.ok(rule, 'the iOS sizing rule is present');
  assert.match(CSS, /\.form-field input\[type="date"\]::-webkit-date-and-time-value \{ text-align: left; \}/, 'value stays left-aligned');
  assert.match(CSS, /\.form-field input\[type="date"\] \{ min-width: 0; max-width: 100%; \}/, 'the older shrink rule stays');
});

test('both Date fields are plain date inputs inside a .form-field, so the rule reaches them', () => {
  assert.match(INV, /<div class="form-field">\s*<label for="quoteDate">Date<\/label>\s*<input type="date" id="quoteDate">/);
  assert.match(INV, /<div class="form-field">\s*<label for="invoiceDate">Date<\/label>\s*<input type="date" id="invoiceDate">/);
  assert.doesNotMatch(INV, /#(quoteDate|invoiceDate)\s*\{[^}]*appearance:\s*(auto|menulist)/, 'no page rule puts the native appearance back');
});
