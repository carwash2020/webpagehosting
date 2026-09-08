// W23 remainder (Master Audit, 2026-09-08): the Motion/Lighting audit
// found the generic opacity+translateY entrance fade applied identically
// to all 10 .section-head headings sitewide, diluting the handful of
// places where scroll-triggered motion is a deliberate, designed moment.
// Section headings now render immediately -- the [data-reveal]/
// .is-visible machinery stays fully wired (a MORE SPECIFIC override, not
// an HTML change) since #process's connecting line and the draft-line
// tick marks both key off the exact same .section-head.is-visible state.
// Also tones down the service-area diagram's node-arrival pulse, which
// read as an oversized, cartoonish jump for a small 6px node.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');

test('section headings render immediately -- no opacity/transform fade -- via a more specific override, not by removing data-reveal', () => {
  const rule = STYLES.match(/html\.reveal-ready \.section-head\[data-reveal\]\{([^}]*)\}/);
  assert.ok(rule, 'expected an override rule neutralizing the generic fade for .section-head');
  assert.match(rule[1], /opacity:1/);
  assert.match(rule[1], /transform:none/);
  // Every remaining section-head instance still carries data-reveal in
  // the HTML -- only the CSS fade is suppressed, so .is-visible keeps
  // getting added by the same shared IntersectionObserver every other
  // reveal-gated feature on the page depends on. Was 10; the
  // regression-recovery pass folded #contact's own section-head into
  // #schedule's (one merged section, one heading), making 9. The
  // SEO fix that added the "From the blog" teaser section brought its
  // own section-head, making 10 again.
  const count = [...INDEX.matchAll(/class="section-head" data-reveal>/g)].length;
  assert.equal(count, 10, 'expected all 10 remaining section-head instances to still carry data-reveal');
});

test('the process step-line draw-in (gated on .section-head.is-visible via a sibling selector) is untouched', () => {
  assert.match(STYLES, /html\.reveal-ready \.section-head\.is-visible ~ \.process::before\{\s*transform:scaleX\(1\);\s*\}/);
});

test('the draft-line tick-mark annotation (also gated on .section-head.is-visible) is untouched', () => {
  assert.match(STYLES, /\.section-head\.is-visible::before,\s*html:not\(\.reveal-ready\) \.section-head::before\{transform:scaleX\(1\);\}/);
});

test('the service-area diagram\'s node-arrival pulse now peaks at scale(1.25), not the old scale(1.8)', () => {
  const kf = STYLES.match(/@keyframes radiusPulse\{([\s\S]*?)\n  \}/);
  assert.ok(kf, 'expected the radiusPulse keyframes block');
  assert.match(kf[1], /50%\{transform:scale\(1\.25\);/);
  assert.doesNotMatch(kf[1], /scale\(1\.8\)/);
});

test('the tools/portal service workers were bumped for this styles.css change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 107, `expected v107 or later, got v${version}`);
});
