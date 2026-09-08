// UI audit findings F26, F29, F30, F31, F32, F33, F34 (7 September 2026)
// -- Commit 7, the last block: coverage-map no-JS fallback, a doubled
// divider under the stats strip, breakpoint consolidation, a
// background-attachment:fixed performance fix, a real class for the
// landing-page hero lede, the FAQ accordion's max-height clipping bug,
// and shared class-name collisions between the two stylesheets.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const STYLES_TOOLS = fs.readFileSync(repo('tools', 'styles-tools.css'), 'utf8');
const INDEX_HTML = fs.readFileSync(repo('index.html'), 'utf8');

test('F26: the service radius diagram\'s connector lines have a no-JS fallback, not just the reveal-ready/is-visible driven draw-in', () => {
  assert.match(STYLES, /html:not\(\.reveal-ready\) \.radius-figure \.radius-spoke:not\(\.is-request\)\{stroke-dashoffset:0;\}/);
  assert.match(STYLES, /html:not\(\.reveal-ready\) \.radius-figure \.radius-spoke\.is-request\{opacity:1;\}/);
});

test('F29: .trust no longer doubles up with .stats-bar\'s own border, and has real padding-top for breathing room', () => {
  const rule = STYLES.match(/\.trust\{([^}]*)\}/)[1];
  assert.match(rule, /border-top:\s*none/);
  assert.match(rule, /padding:\s*44px 0 88px/);
});

test('F30: the near-duplicate breakpoints were merged into the codebase\'s already-dominant values', () => {
  // 820/900 -> 860 (tablet 2-col grids), 640 -> 600, 700 -> 760
  assert.doesNotMatch(STYLES, /@media \(max-width:820px\)/);
  assert.doesNotMatch(STYLES, /@media \(max-width:900px\)/);
  assert.doesNotMatch(STYLES, /@media \(max-width:640px\)/);
  assert.doesNotMatch(STYLES, /@media \(max-width:700px\)/);
  assert.match(STYLES, /@media \(max-width:860px\)\{\.stats-grid/);
  assert.match(STYLES, /@media \(max-width:860px\)\{\.trust-grid/);
  assert.match(STYLES, /@media \(max-width:860px\)\{\.services-grid/);
  assert.match(STYLES, /@media \(max-width:860px\)\{\.gallery-grid/);
  assert.match(STYLES, /@media \(max-width:600px\)\{\s*\.form-row\{grid-template-columns:1fr;\}\s*\}/);
});

test('F31: the blueprint background moved off body\'s own background-attachment:fixed onto a real position:fixed element', () => {
  const liveCode = STYLES.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(liveCode, /background-attachment:fixed/);
  assert.match(STYLES, /\.bg-blueprint\{\s*position:fixed; inset:0; z-index:-1;\s*background-color:var\(--bg\);/);
  assert.match(STYLES, /body\.has-blueprint-bg\{background:transparent;\}/);
  for (const file of ['index.html', 'handyman-cedar-city-ut.html', 'handyman-hurricane-ut.html', 'handyman-mesquite-nv.html', 'handyman-santa-clara-ivins-ut.html', 'handyman-washington-city-ut.html']) {
    const src = fs.readFileSync(repo(file), 'utf8');
    assert.match(src, /<body class="has-blueprint-bg">/, `${file} should carry the has-blueprint-bg class`);
    assert.match(src, /<div class="bg-blueprint" aria-hidden="true"><\/div>/, `${file} should have the fixed backdrop element`);
  }
});

test('F32: the landing-page hero lede is a real class, not an attribute-presence selector fighting an inline style with !important', () => {
  assert.doesNotMatch(STYLES, /\[style\]/);
  const rule = STYLES.match(/\.hero-lede\{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /!important/, 'the real class should not need !important to beat an inline style anymore');
  for (const file of ['handyman-cedar-city-ut.html', 'handyman-hurricane-ut.html', 'handyman-mesquite-nv.html', 'handyman-santa-clara-ivins-ut.html', 'handyman-washington-city-ut.html']) {
    const src = fs.readFileSync(repo(file), 'utf8');
    assert.match(src, /<p class="hero-lede">/, `${file} should use the real class`);
    assert.doesNotMatch(src, /<p style="max-width:62ch/, `${file} should not still have the old inline-styled paragraph`);
  }
});

test('F33: the FAQ accordion uses grid-template-rows, not a JS-measured max-height that goes stale on resize/rotate', () => {
  const rule = STYLES.match(/\.faq-answer\{([^}]*)\}/)[1];
  assert.match(rule, /display:grid/);
  assert.match(rule, /grid-template-rows:0fr/);
  assert.doesNotMatch(rule, /max-height/);
  assert.match(STYLES, /\.faq-item\.is-open \.faq-answer\{grid-template-rows:1fr;\}/);
  const indexSrc = INDEX_HTML;
  assert.doesNotMatch(indexSrc, /answer\.style\.maxHeight/, 'the JS should no longer measure/set an inline max-height');
});

test('F34: the dead-code class-name collisions between styles.css and styles-tools.css are gone', () => {
  for (const selector of ['.theme-toggle', '.theme-switch', '.theme-switch-track', '.theme-switch-thumb', '.theme-icon-light', '.mobile-theme-row', '.hours-grid', '.hours-row', '.hours-day', '.hours-value']) {
    const re = new RegExp('^\\s*' + selector.replace('.', '\\.') + '\\s*\\{', 'm');
    assert.doesNotMatch(STYLES_TOOLS, re, `${selector} should no longer be defined in styles-tools.css (dead code, collided with styles.css's real one)`);
    assert.match(STYLES, re, `${selector} should still be defined in styles.css (the real, live one)`);
  }
  assert.doesNotMatch(STYLES_TOOLS, /^\s*\.lightbox-nav \.th-icon/m);
  // the one genuinely-redundant internal duplicate found (position:relative
  // repeated on .quote-block's second declaration) was cleaned up too.
  const secondQuoteBlockRule = [...STYLES.matchAll(/\.quote-block\{([^}]*)\}/g)][1][1];
  assert.doesNotMatch(secondQuoteBlockRule, /position:relative/);
});
