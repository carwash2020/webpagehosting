// UI audit findings F01-F03, F14 (7 September 2026): runway-dashboard.html
// is deliberately self-contained (never loads /styles.css or
// tools/styles-tools.css -- see docs/ARCHITECTURE-NOTES.md's "Don't
// re-litigate these") and duplicates every design token it needs locally.
// Three tokens/rules were simply missed when that was built:
//
// F01: --font-display/-body/-ui/-app were never declared in this page's
//      own :root, so every element fell back to the browser's default
//      serif (Times New Roman) despite the right font FILES already
//      being loaded via the Google Fonts <link> in <head>.
// F02: .role-blocked-overlay{display:none} only ever existed in
//      tools/styles-tools.css, which this page doesn't load, so
//      #roleBlockedOverlay was visible to every user on every load.
// F03: .skip-link's off-screen positioning only ever existed in
//      styles.css, which this page doesn't load, so it was a
//      permanently visible, default-browser-blue link.
// F14: .card was flat/borderless/flatter than every other tool page's
//      (no gradient face, no border, no shadow).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const RUNWAY = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');

test('F01: all 4 --font-* tokens are declared locally, matching styles.css\'s own mapping', () => {
  const root = RUNWAY.match(/:root\{([\s\S]*?)\n  \}/)[1];
  assert.match(root, /--font-display:\s*'Anton'/);
  assert.match(root, /--font-body:\s*'Newsreader'/);
  assert.match(root, /--font-ui:\s*'Oswald'/);
  assert.match(root, /--font-app:\s*'Archivo'/);
});

test('F01: the fonts these tokens name are actually loaded via the Google Fonts <link>', () => {
  assert.match(RUNWAY, /fonts\.googleapis\.com\/css2\?family=Anton&family=Archivo[^"]*family=Newsreader[^"]*family=Oswald/);
});

test('F02: #roleBlockedOverlay has a local default-hidden rule and an .is-shown override', () => {
  assert.match(RUNWAY, /\.role-blocked-overlay \{[\s\S]*?display: none;[\s\S]*?\}/);
  assert.match(RUNWAY, /\.role-blocked-overlay\.is-shown \{ display: flex; \}/);
});

test('F03: .skip-link has a local off-screen-by-default rule, matching styles.css\'s own values', () => {
  const rule = RUNWAY.match(/\.skip-link\{([^}]*)\}/);
  assert.ok(rule, 'expected a local .skip-link rule');
  assert.match(rule[1], /position:absolute; top:-60px/);
  assert.match(RUNWAY, /\.skip-link:focus\{top:12px;\}/);
});

test('F14: .card has a gradient face, a real border, and a resting shadow -- not a flat single-color fill', () => {
  const rule = RUNWAY.match(/\.card\{([\s\S]*?)\}/)[1];
  assert.match(rule, /linear-gradient\(180deg, var\(--bg-elevated\), var\(--bg-card\)/);
  assert.match(rule, /border: 1px solid var\(--border\);/);
  assert.match(rule, /var\(--shadow-resting\)/);
});

test('F14: --shadow-resting/--shadow-hover are declared for both dark (root) and light theme, matching styles.css\'s own dark values exactly', () => {
  assert.match(RUNWAY, /--shadow-resting: 0 1px 2px rgba\(0,0,0,\.25\), 0 8px 24px -18px rgba\(0,0,0,\.55\);/);
  assert.match(RUNWAY, /--shadow-hover: 0 4px 14px -4px rgba\(0,0,0,\.5\), 0 14px 34px -14px rgba\(0,0,0,\.65\);/);
  assert.match(RUNWAY, /\[data-theme="light"\]\{[\s\S]*?--shadow-resting: 0 1px 2px rgba\(0,0,0,\.10\)/);
});

test('the --radius token now matches the shared suite\'s 14px, not the page\'s old flatter 10px', () => {
  assert.match(RUNWAY, /--radius:14px;/);
  assert.doesNotMatch(RUNWAY, /--radius:10px;/);
});
