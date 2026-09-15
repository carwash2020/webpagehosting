// Targeted "Liquid Glass"-inspired polish (2026-09-15), scoped
// deliberately: a specular sheen sweep on buttons (layered on top of
// the existing flat fill, not replacing it -- U01, 2026-09-07,
// deliberately killed a glossy gradient FILL for looking dated, and
// this doesn't reopen that, see u01-flat-primary-button.test.js),
// frosted glass on already-translucent surfaces (badges, chips, the
// service-detail modal card), tactile press feedback, and glass CSS
// vars for both themes. Not a system-wide restyle.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

test('--bg-glass and --glass-highlight are defined for both dark (:root) and light theme', () => {
  const rootBlock = STYLES.match(/:root\{[\s\S]*?\n  \}/)[0];
  assert.match(rootBlock, /--bg-glass:\s*rgba\(/);
  assert.match(rootBlock, /--glass-highlight:\s*rgba\(/);
  const lightBlock = STYLES.match(/\[data-theme="light"\]\{[\s\S]*?\n  \}/)[0];
  assert.match(lightBlock, /--bg-glass:\s*rgba\(/);
  assert.match(lightBlock, /--glass-highlight:\s*rgba\(/);
});

test('.btn gets a one-time hover sheen via ::before, layered on top of the existing flat fill (not a gradient fill on .btn.orange itself)', () => {
  const btnRule = STYLES.match(/\n  \.btn\{([^}]*)\}/)[1];
  assert.match(btnRule, /position:relative/);
  assert.match(btnRule, /overflow:hidden/);

  const beforeRule = STYLES.match(/\.btn::before\{([^}]*)\}/)[1];
  assert.match(beforeRule, /linear-gradient/);
  assert.match(beforeRule, /position:absolute/);

  assert.match(STYLES, /\.btn:hover::before\{left:130%;\}/);

  // U01's own guard already asserts .btn.orange has no gradient in its
  // own rule body -- confirm that's still true after this change.
  const orangeRule = STYLES.match(/\.btn\.orange\{([^}]*)\}/)[1];
  assert.doesNotMatch(orangeRule, /linear-gradient/);
});

test('the button sheen is disabled under prefers-reduced-motion', () => {
  const reducedMotionBlock = STYLES.match(/@media \(prefers-reduced-motion:reduce\)\{\s*\.btn::before\{display:none;\}\s*\}/);
  assert.ok(reducedMotionBlock, 'expected .btn::before to be hidden under prefers-reduced-motion:reduce');
});

test('buttons and service cards get tactile press feedback (scale on :active)', () => {
  assert.match(STYLES, /\.btn:active\{transform:translateY\(0\) scale\(\.97\);\}/);
  assert.match(STYLES, /\.service-card:active\{transform:[^;]*scale\(\.98\);\}/);
});

test('.coverage-badge and .open-status keep their required shared pill treatment (see frontend-design-tells-removed.test.js) with a deepened blur/saturate', () => {
  const badgeBody = STYLES.match(/\.coverage-badge\{([^}]*)\}/)[1];
  const openStatusBody = STYLES.match(/\.open-status\{([^}]*)\}/)[1];
  assert.match(badgeBody, /backdrop-filter:blur\(10px\) saturate\(1\.4\)/);
  assert.match(openStatusBody, /backdrop-filter:blur\(10px\) saturate\(1\.4\)/);
});

test('.hero-distance-chip is now a real frosted glass pill, not plain inline text', () => {
  const chipRule = STYLES.match(/\.hero-distance-chip\{([^}]*)\}/)[1];
  assert.match(chipRule, /backdrop-filter:blur\(10px\) saturate\(1\.4\)/);
  assert.match(chipRule, /border-radius:999px/);
  // Hardcoded, not a theme var -- it sits on the hero's permanently
  // dark photo backdrop in both themes.
  assert.match(chipRule, /border:1px solid rgba\(255,255,255,/);
});

test('.modal is a frosted glass card (var(--bg-glass) + backdrop-filter), floating over the already-blurred .modal-overlay scrim', () => {
  const modalRule = STYLES.match(/\n\s*\.modal\{([^}]*)\}/)[1];
  assert.match(modalRule, /background:var\(--bg-glass\)/);
  assert.match(modalRule, /backdrop-filter:blur\(18px\) saturate\(1\.3\)/);
  // Still keeps the existing open animation this rule is also tested
  // for elsewhere (round-3-visual-polish.test.js).
  assert.match(modalRule, /transform:scale\(\.96\) translateY\(8px\)/);
});

test('.theme-toggle gets a subtle glass fill but still carries no backdrop-filter of its own (nested inside the sticky header -- see theme-toggle.test.js\'s iOS ghosting-bug guard)', () => {
  const toggleRule = STYLES.match(/\n  \.theme-toggle\{([^}]*)\}/)[1];
  assert.match(toggleRule, /background:rgba\(255,255,255,/);
  assert.doesNotMatch(toggleRule, /backdrop-filter/);
});
