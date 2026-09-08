// Two small trust-focused additions to the homepage (2026-09-07),
// requested directly after a "what other visual improvements" survey:
//
// 1. A 4th "Licensed & Insured" fact added to the existing .trust
//    strip -- backed by real data already on file in the internal
//    Compliance tracker (a registered Utah LLC + an active general
//    liability policy), not an invented claim. Deliberately worded to
//    the two facts that are actually true (LLC + insurance) rather
//    than implying a state contractor's license, which this business
//    does not hold.
// 2. A real-source badge (the actual Google "G" mark) next to each
//    review's "Verified Customer on Google" line -- NOT a per-reviewer
//    avatar. Every review on this page is deliberately anonymized (no
//    reviewer name or photo was ever collected for public display), so
//    a fabricated initial-letter or headshot avatar per review would
//    invent an identity that doesn't exist. The Google mark instead
//    visually reinforces the one true, already-stated fact: this is a
//    real Google review.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HTML = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

test('the trust strip has a 4th "Licensed & Insured" item, worded to the two real facts on file (LLC + insurance), not an unheld contractor license', () => {
  const trustSection = HTML.match(/<section class="trust">[\s\S]*?<\/section>/);
  assert.ok(trustSection, 'expected the .trust section');
  const items = [...trustSection[0].matchAll(/<div class="trust-item">/g)];
  assert.equal(items.length, 4, 'expected 4 trust items');
  const licensedItem = trustSection[0].match(/<h3>Licensed &amp; Insured<\/h3>\s*<p>([^<]*)<\/p>/);
  assert.ok(licensedItem, 'expected a Licensed & Insured item with body text');
  assert.match(licensedItem[1], /registered Utah LLC/);
  assert.match(licensedItem[1], /general liability policy/);
  assert.doesNotMatch(licensedItem[1], /contractor/i, 'should not claim a state contractor license this business does not hold');
});

test('.trust-grid is now a 4-column responsive grid, matching the adjacent .stats-grid breakpoints', () => {
  const rule = STYLES.match(/\.trust-grid\{([^}]*)\}/);
  assert.ok(rule, 'expected a .trust-grid rule');
  assert.match(rule[1], /grid-template-columns:repeat\(4,1fr\);/);
  // F30 (2026-09-07): merged from 820px into 860px, matching the other
  // 2-column-tablet breakpoints (services/contact/gallery/teardown-grid).
  assert.match(STYLES, /@media \(max-width:860px\)\{\.trust-grid\{grid-template-columns:repeat\(2,1fr\);\}\}/);
  assert.match(STYLES, /@media \(max-width:480px\)\{\.trust-grid\{grid-template-columns:1fr;\}\}/);
});

test('every review carries the real Google mark, not a fabricated per-reviewer avatar', () => {
  const attributions = [...HTML.matchAll(/<div class="review-attribution">[\s\S]*?<\/div>/g)];
  assert.equal(attributions.length, 7, 'expected all 7 reviews to have the attribution wrapper');
  for (const m of attributions) {
    assert.match(m[0], /class="review-avatar" aria-hidden="true"/);
    // The real 4-color Google "G" mark -- checked by its 4 real brand
    // colors, not a placeholder/generic icon.
    assert.match(m[0], /fill="#EA4335"/);
    assert.match(m[0], /fill="#4285F4"/);
    assert.match(m[0], /fill="#FBBC05"/);
    assert.match(m[0], /fill="#34A853"/);
    assert.match(m[0], /<strong>Verified Customer<\/strong> on Google/, 'the real, already-existing anonymized attribution text should be unchanged');
  }
});

test('no review invents a reviewer name, initial, or photo -- every one stays anonymized', () => {
  const reviewSlides = [...HTML.matchAll(/<div class="review-card">[\s\S]*?<\/div>\s*<\/div>/g)];
  assert.ok(reviewSlides.length >= 7);
  for (const m of reviewSlides) {
    assert.match(m[0], />Verified Customer</, 'every review should stay anonymized, not attributed to an invented name');
  }
});

test('the styles.css cache-bust stamp was bumped and stayed in sync across every referencing page', () => {
  const stampMatch = HTML.match(/styles\.css\?v=(\d+)/);
  assert.ok(stampMatch, 'expected a ?v= stamp on styles.css');
  const stamp = stampMatch[1];
  // execFileSync with an argument array, not execSync with an
  // interpolated shell string (CodeQL's "Shell command built from
  // environment values" alert #55, 2026-09-07) -- repo() is only ever
  // built from __dirname in this file, never truly external input, but
  // passing it as its own argv entry rather than splicing it into a
  // shell string sidesteps the whole question: there's no shell parsing
  // the path at all, so nothing in it (spaces, quotes, `;`, etc.) could
  // ever be interpreted as shell syntax.
  const referencingFiles = require('child_process')
    .execFileSync('grep', ['-rl', 'styles.css?v=', '--include=*.html', repo()], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  assert.ok(referencingFiles.length >= 30, `expected many pages to reference styles.css, found ${referencingFiles.length}`);
  for (const file of referencingFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const matches = [...content.matchAll(/styles\.css\?v=(\d+)/g)];
    for (const m of matches) {
      assert.equal(m[1], stamp, `${file} references styles.css?v=${m[1]}, expected the same stamp (${stamp}) as every other page`);
    }
  }
});

test('both service workers were bumped since styles.css (which they both precache) changed', () => {
  const rootSw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const rootVersion = Number(rootSw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(rootVersion >= 85, `expected the tools service worker at v85 or later, got v${rootVersion}`);

  const portalSw = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');
  const portalVersion = Number(portalSw.match(/const CACHE_NAME = 'th-portal-v(\d+)';/)[1]);
  assert.ok(portalVersion >= 37, `expected the portal service worker at v37 or later, got v${portalVersion}`);
});
