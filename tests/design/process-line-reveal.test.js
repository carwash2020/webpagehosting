// A draw-in animation for the "How a visit actually goes" connecting
// line on the homepage (2026-09-07), extending the same reveal
// language already shipped for the "Where We Work" service-area
// diagram (draw-in on scroll, staggered arrival) to another naturally
// step-based section. Gated off the section-head's own [data-reveal]/
// .is-visible state via a sibling selector rather than adding
// data-reveal to .process itself, since .process-step children
// already carry their own independent reveal and stacking a second
// transform on their shared parent would double the distance they
// travel on entry.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');

test('the line starts collapsed (scaleX 0, anchored left) and draws in only once the section head has revealed', () => {
  assert.match(STYLES, /\.process::before\{[\s\S]*?transform-origin:left;\s*transform:scaleX\(0\);\s*transition:transform [\d.]+s/);
  assert.match(STYLES, /html\.reveal-ready \.section-head\.is-visible ~ \.process::before\{\s*transform:scaleX\(1\);\s*\}/);
});

test('on the stacked mobile layout the line draws top-to-bottom instead of left-to-right', () => {
  const mobileBlock = STYLES.slice(STYLES.indexOf('@media (max-width:860px){\n    .process{'));
  assert.match(mobileBlock.slice(0, 800), /\.process::before\{[\s\S]*?transform-origin:top;\s*transform:scaleY\(0\);/);
  assert.match(mobileBlock.slice(0, 800), /html\.reveal-ready \.section-head\.is-visible ~ \.process::before\{\s*transform:scaleY\(1\);\s*\}/);
});

test('the 4 process steps arrive in a staggered sequence, matching the .services-grid convention', () => {
  const delays = [...STYLES.matchAll(/html\.reveal-ready \.process \[data-reveal\]:nth-child\((\d)\)\{transition-delay:([\d.]+)s;\}/g)]
    .map((m) => ({ n: Number(m[1]), delay: Number(m[2]) }));
  assert.equal(delays.length, 3, 'expected explicit delays for steps 2, 3 and 4 (step 1 has none, arriving first)');
  const sorted = [...delays].sort((a, b) => a.n - b.n);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].delay > sorted[i - 1].delay, 'each later step should have a strictly later delay');
  }
});

test('index.html has exactly 4 process steps, each still individually reveal-gated', () => {
  const processBlock = INDEX.slice(INDEX.indexOf('<div class="process">'), INDEX.indexOf('</section>', INDEX.indexOf('<div class="process">')));
  const steps = [...processBlock.matchAll(/<div class="process-step" data-reveal>/g)];
  assert.equal(steps.length, 4);
});
