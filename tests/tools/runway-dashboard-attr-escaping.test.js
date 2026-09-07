// CodeQL "DOM text reinterpreted as HTML" alert #54 (2026-09-07), on the
// SVG-building innerHTML assignment in drawRevCostChart(). Root cause:
// escapeHtml() here is only safe for HTML *text-node* content -- it
// escapes &, <, > (what innerHTML's own text-node serializer escapes),
// but never a double-quote, since quotes aren't special there. Several
// call sites in this file instead interpolated an escapeHtml()'d value
// directly into an attribute value (data-*, id, title, aria-label),
// where an un-escaped `"` lets the string break out of the attribute and
// inject new attributes/markup. Fixed by adding escapeAttr() (escapes &,
// ", <, > -- safe for direct attribute embedding) and switching every
// attribute-position call site to use it; text-node call sites (row
// labels, table cells, stat-box captions) correctly keep escapeHtml().

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const RUNWAY = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');

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

test('escapeAttr() exists and round-trips adversarial inputs exactly through a real attribute parse', () => {
  const fn = extractFn(RUNWAY, 'escapeAttr');
  const escapeAttr = eval(`(${fn})`); // eslint-disable-line no-eval

  const dom = new JSDOM('<!DOCTYPE html><div id="root"></div>');
  const document = dom.window.document;
  const inputs = [
    "lone-single-quote-'",
    'lone-double-quote-"',
    'both-\'-and-"',
    'back\\slash',
    'amp-&-ersand',
    'angle-<brackets>',
    'raw\nnewline',
    '24" TV mount with \'brackets\'',
    '"><img src=x onerror=alert(1)>',
  ];
  for (const input of inputs) {
    const root = document.getElementById('root');
    root.innerHTML = `<button data-test-id="${escapeAttr(input)}">x</button>`;
    assert.equal(root.children.length, 1, `expected no injected elements for input ${JSON.stringify(input)}`);
    const btn = root.querySelector('button');
    assert.equal(btn.getAttribute('data-test-id'), input, `expected exact round-trip for input ${JSON.stringify(input)}`);
  }
});

test('escapeAttr() treats null/undefined the same way escapeHtml() does', () => {
  const fn = extractFn(RUNWAY, 'escapeAttr');
  const escapeAttr = eval(`(${fn})`); // eslint-disable-line no-eval
  assert.equal(escapeAttr(null), '');
  assert.equal(escapeAttr(undefined), '');
});

test('every escapeHtml() call landing inside an attribute value uses escapeAttr() instead', () => {
  // Every data-*="...", id="...", title="...", and aria-label="..." built
  // from escapeHtml() was the actual vulnerability; none should remain.
  const attrPatterns = [
    /data-[\w-]+="\$\{escapeHtml\(/,
    /\bid="[^"]*\$\{escapeHtml\(/,
    /\btitle="[^"]*\$\{escapeHtml\(/,
    /\baria-label="[^"]*\$\{escapeHtml\(/,
  ];
  for (const re of attrPatterns) {
    assert.doesNotMatch(RUNWAY, re, `expected no attribute-position escapeHtml() calls matching ${re}`);
  }
});

test('the two chart aria-labels CodeQL flagged now use escapeAttr()', () => {
  assert.match(RUNWAY, /aria-label="\$\{escapeAttr\(n\.month\)\}, net profit \$\{fmt\(n\.y\)\}"/);
  assert.match(RUNWAY, /aria-label="\$\{escapeAttr\(p\.month\)\}: revenue \$\{fmt\(p\.revenue\)\}, costs \$\{fmt\(p\.costs\)\}"/);
});

test('text-node call sites correctly keep escapeHtml(), not escapeAttr()', () => {
  assert.match(RUNWAY, /<div class="row-label">\$\{escapeHtml\(d\.name\)\}<\/div>/);
  assert.match(RUNWAY, /<td>\$\{escapeHtml\(m\.month\)\}<\/td>/);
});
