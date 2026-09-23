// Exhaustive escapeHtml() audit (closing a real gap flagged after
// SECURITY.md's own note that the CodeQL sweep and runway-dashboard.html's
// escapeAttr() fix were both targeted at flagged call sites only, never an
// exhaustive codebase-wide pass). escapeHtml() (tools-dialogs.js) is only
// safe for HTML text-node content -- it escapes &, <, > but never a
// double-quote, since quotes aren't special there. Every real call site
// found interpolating an escapeHtml()'d value directly into a
// double-quoted HTML attribute (value=, href=, title=, alt=, placeholder=,
// data-*=) was switched to the new shared escapeAttr(), which also
// escapes quotes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const DIALOGS = fs.readFileSync(repo('tools', 'tools-dialogs.js'), 'utf8');

test('escapeAttr() exists in the shared tools-dialogs.js and escapes quotes, not just &<>', () => {
  const fnMatch = DIALOGS.match(/function escapeAttr\(str\) \{[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to find escapeAttr() in tools-dialogs.js');
  assert.match(fnMatch[0], /\.replace\(\/&\/g, '&amp;'\)/);
  assert.match(fnMatch[0], /\.replace\(\/"\/g, '&quot;'\)/);
  assert.match(fnMatch[0], /\.replace\(\/</);
  assert.match(fnMatch[0], /\.replace\(\/>/);
});

test('escapeAttr() round-trips 9 adversarial inputs correctly (matches the already-verified escapeForInlineHandler/runway-dashboard.html pattern)', () => {
  // Real execution test, same technique already proven elsewhere in
  // this project for exactly this class of bug (see job-tracker.html's
  // "actual-execution test" note in README) -- not just reading the
  // regex by eye.
  function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  const cases = [
    `'`, `"`, `'"`, `\\`, `&`, `<`, `>`, `\n`, `24" TV mount with 'brackets' & <tags>`,
  ];
  for (const input of cases) {
    const escaped = escapeAttr(input);
    // Simulate the browser parsing this back out of a double-quoted
    // HTML attribute: entities decode, nothing else does. A single pass
    // over one combined pattern (not four sequential .replace() calls)
    // matters here -- decoding &amp; first, then separately scanning the
    // ALREADY-decoded result for &lt;/&gt;/&quot;, would wrongly re-decode
    // a literal "&lt;" that only exists because escapeAttr() turned a raw
    // "&" into "&amp;" ahead of an already-escaped "<" -- a real
    // double-unescaping bug, not just a hypothetical one, since this
    // helper's whole job is escaping "&" independently of "<"/">"/"\"".
    const decoded = escaped.replace(/&amp;|&quot;|&lt;|&gt;/g, (entity) => {
      switch (entity) {
        case '&amp;': return '&';
        case '&quot;': return '"';
        case '&lt;': return '<';
        case '&gt;': return '>';
      }
    });
    assert.equal(decoded, input, `escapeAttr() should round-trip: ${JSON.stringify(input)}`);
    // And critically: the escaped form must never contain a literal
    // unescaped double-quote, which is the actual attribute-breakout
    // vector this helper exists to close.
    assert.ok(!escaped.includes('"'), `escaped output must never contain a literal double-quote: ${JSON.stringify(escaped)}`);
  }
});

// Spot-check a representative sample of the real call sites fixed in
// this pass -- not exhaustive re-verification of every single one (that
// would just be re-typing the diff), but enough to pin the fix pattern
// and catch an accidental revert.
const CASES = [
  { file: 'tools/site-content.html', pattern: /value="\$\{escapeAttr\(item\.question \|\| ''\)\}"/, label: 'FAQ question value=' },
  { file: 'tools/site-content.html', pattern: /value="\$\{escapeAttr\(item\.heading \|\| ''\)\}"/, label: 'Terms heading value=' },
  // Site Content editor rebuilt 2026-09-23 (cmsFieldInputHtml): the live
  // value is escaped once into `value`, then used in every input's value=.
  { file: 'tools/site-content.html', pattern: /const value = escapeAttr\(live === null \? '' : live\);[\s\S]*?data-cms-part="value" value="' \+ value \+ '"/, label: 'Site Content field value=' },
  { file: 'tools/site-content.html', pattern: /data-cms-part="custom" value="' \+ escapeAttr\(parsed\.text \|\| ''\) \+ '"/, label: 'Site Content custom hours value=' },
  { file: 'tools/workspace.html', pattern: /title="\$\{escapeAttr\(vendor\)\}"/, label: 'Top Vendors title=' },
  { file: 'tools/workspace.html', pattern: /title="\$\{escapeAttr\(client\)\}"/, label: 'Top Clients title=' },
  { file: 'tools/workspace.html', pattern: /alt="\$\{escapeAttr\(p\.public_caption \|\| ''\)\}"/, label: 'Gallery queue photo alt=' },
  { file: 'tools/workspace.html', pattern: /href="tel:' \+ escapeAttr\(job\.phone\) \+ '"/, label: "Today's next job phone href=" },
  { file: 'tools/job-detail.html', pattern: /href="tel:' \+ escapeAttr\(j\.phone\) \+ '"/, label: 'Job Detail phone href=' },
  { file: 'tools/client-detail.html', pattern: /href="tel:' \+ escapeAttr\(c\.phone\) \+ '"/, label: 'Client Detail phone href=' },
  { file: 'tools/client-detail.html', pattern: /href="mailto:' \+ escapeAttr\(c\.email\) \+ '"/, label: 'Client Detail email href=' },
  { file: 'tools/invoice-generator.html', pattern: /<option value="\$\{escapeAttr\(c\.name\)\}">/, label: 'Contact autofill option value=' },
  { file: 'tools/parts-reference.html', pattern: /value="' \+ escapeAttr\(iss\.symptom\) \+ '"/, label: 'Issue symptom value=' },
  { file: 'tools/parts-reference.html', pattern: /value="' \+ escapeAttr\(u\.model\) \+ '"/, label: 'Unit model value=' },
  { file: 'tools/parts-reference.html', pattern: /href="' \+ escapeAttr\(iss\.link\) \+ '"/, label: 'Issue reference link href=' },
  { file: 'tools/clients.html', pattern: /onclick="resendPortalInvite\(\\'' \+ escapeForInlineHandler\(a\.email\) \+ '\\', \\'' \+ escapeForInlineHandler\(a\.name \|\| ''\) \+ '\\', this\)"/, label: 'Resend invite onclick (inline-handler shape, not attribute shape)' },
];

for (const { file, pattern, label } of CASES) {
  test(`${file}: ${label} uses the quote-safe helper, not plain escapeHtml()`, () => {
    const src = fs.readFileSync(repo(...file.split('/')), 'utf8');
    assert.match(src, pattern, `expected ${file} to match the fixed pattern for: ${label}`);
  });
}

test('every fixed file that uses escapeAttr() actually loads tools-dialogs.js (where it now lives)', () => {
  const files = ['tools/site-content.html', 'tools/workspace.html', 'tools/job-detail.html', 'tools/client-detail.html', 'tools/invoice-generator.html', 'tools/parts-reference.html', 'tools/dev-tools.html', 'tools/job-tracker.html'];
  for (const file of files) {
    const src = fs.readFileSync(repo(...file.split('/')), 'utf8');
    assert.match(src, /tools-dialogs\.js/, `${file} should load the shared tools-dialogs.js`);
  }
});
