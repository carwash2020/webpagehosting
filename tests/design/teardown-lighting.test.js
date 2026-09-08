// W19/M02 fix (Master Audit, 2026-09-08): a user-supplied before/after
// audit measured the teardown ("Most of it still works") section as one
// of the page's flattest -- brightness 17 against a page average of 25,
// with nothing marking it as a second real visual moment alongside the
// finished-work reveal (which the same audit measured at a strong peak
// of 80). Adds a warm ambient glow to the section (same radial-gradient
// convention already used on .hero) plus an interactive spotlight behind
// the exploded-diagram figure whose intensity is driven by the same
// live --p custom property already used to assemble/disassemble every
// part -- so dragging the rebuild slider is rewarded twice: the parts
// come together, and the room gets visibly brighter.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

test('the teardown section has an ambient glow, same radial-gradient convention as .hero', () => {
  const rule = STYLES.match(/\.teardown::before\{([^}]*)\}/);
  assert.ok(rule, 'expected a .teardown::before rule');
  assert.match(rule[1], /position:absolute/);
  assert.match(rule[1], /radial-gradient\(/);
  assert.match(rule[1], /rgba\(255,128,0,/);
  assert.match(rule[1], /pointer-events:none/);
});

test('the ambient glow sits fully inside the section (inset:0, no negative offsets that would need overflow:hidden and risk clipping the exploded parts)', () => {
  const rule = STYLES.match(/\.teardown::before\{([^}]*)\}/)[1];
  assert.match(rule, /inset:0/);
  assert.doesNotMatch(STYLES.match(/\.teardown\{([^}]*)\}/)[1], /overflow:hidden/);
});

test('the figure gets its own spotlight, driven by the live --p custom property (not a static value)', () => {
  const rule = STYLES.match(/\.teardown-figure::before\{([^}]*)\}/);
  assert.ok(rule, 'expected a .teardown-figure::before rule');
  assert.match(rule[1], /var\(--p,\s*1\)/, 'spotlight intensity should read the same --p driving the exploded parts');
  assert.match(rule[1], /calc\(/, 'intensity should be computed, not a fixed alpha');
});

test('the figure, its svg, and the scrub control all sit above their own spotlight (z-index layering)', () => {
  assert.match(STYLES, /\.teardown-figure\{[^}]*position:relative;[^}]*\}/s);
  const beforeRule = STYLES.match(/\.teardown-figure::before\{([^}]*)\}/)[1];
  assert.match(beforeRule, /z-index:0/);
  const svgRule = STYLES.match(/\.teardown-figure svg\{([^}]*)\}/)[1];
  assert.match(svgRule, /z-index:1/);
  const scrubRule = STYLES.match(/\.teardown-figure \.td-scrub\{([^}]*)\}/)[1];
  assert.match(scrubRule, /z-index:1/);
});

test('the reduced-motion/no-JS fallback (--p:1 !important) still applies -- a visitor who never drags the slider sees the brightest, fully-assembled state, not a dim default', () => {
  assert.match(STYLES, /\.teardown\{--p:1 !important;\}/);
});

test('the tools/portal service workers were bumped for this styles.css change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 104, `expected v104 or later, got v${version}`);
});
