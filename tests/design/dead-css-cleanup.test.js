// Dead CSS cleanup (2026-09-07), same shape as the .blog-meta find
// earlier this session: rules with no base definition and no markup
// anywhere referencing them.
//   - .teardown-sticky / .teardown-track only ever existed as
//     prefers-reduced-motion overrides -- no base rule, no markup.
//   - .terms-disclaimer was a styled callout box, but terms.html
//     renders its disclaimer content dynamically into #termsBody
//     without ever applying the class.
//   - .gallery-note was a styled caption note never emitted by the
//     Gallery modal's markup or its JS.
// Pure deletion, no behavior change -- this test just locks in that
// they stay gone rather than silently creeping back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const DEAD_SELECTORS = ['.teardown-sticky', '.teardown-track', '.terms-disclaimer', '.gallery-note'];

for (const selector of DEAD_SELECTORS) {
  test(`${selector} no longer appears anywhere in styles.css`, () => {
    assert.doesNotMatch(STYLES, new RegExp(selector.replace('.', '\\.')));
  });
}

test('the surviving .teardown reduced-motion rule and the gallery-grid breakpoint rule right after it are untouched', () => {
  assert.match(STYLES, /\.teardown\{--p:1 !important;\}/);
  // F30 (2026-09-07): the gallery-grid 2-col breakpoint merged from 900px
  // into 860px, consolidating a near-duplicate value shared with
  // services-grid/contact-grid/teardown-grid.
  assert.match(STYLES, /@media \(max-width:860px\)\{\.gallery-grid\{grid-template-columns:repeat\(2,1fr\);\}\}/);
});
