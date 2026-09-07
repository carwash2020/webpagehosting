// Two additions to the homepage (2026-09-07): a third depth plane in the
// hero (a real job photo, not another graphic), and a drag-to-compare
// before/after section using real client work. The homepage previously
// showed none of the 62 job photos anywhere in the scroll; all of them
// lived only behind the "Gallery" nav link's modal.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

// ---- hero depth ----

test('the hero has a real photographic midground layer, not just the schematic grid', () => {
  assert.match(INDEX, /<div class="hero-subject" aria-hidden="true">/);
  assert.match(INDEX, /class="hero-subject"[\s\S]{0,200}?<img src="\/images\/gallery\//);
});

test('the hero-subject layer moves at its own parallax rate, distinct from the grid and the badge', () => {
  const rates = [...INDEX.matchAll(/setProperty\('--shift2?',\s*\(y \* (-?[\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.equal(rates.length, 3, 'expected three distinct rate assignments: badge, plane, subject');
  const unique = new Set(rates);
  assert.equal(unique.size, 3, `all three rates must differ, got ${rates.join(', ')}`);
});

test('the hero-subject layer is hidden on phones and inert under reduced motion', () => {
  assert.match(STYLES, /@media \(max-width:860px\)\{\s*\.hero-subject\{display:none;\}\s*\}/);
  assert.match(STYLES, /@media \(prefers-reduced-motion: reduce\)\{\s*\.hero-subject\{transform:none;\}\s*\}/);
});

test('the hero-subject photo is masked to one side and kept subdued, not a competing subject', () => {
  const rule = STYLES.match(/\.hero-subject\{[^}]*\}/)[0];
  assert.match(rule, /opacity:\.\d+/);
  assert.match(rule, /mask-image:/);
  const imgRule = STYLES.match(/\.hero-subject img\{[^}]*\}/)[0];
  assert.match(imgRule, /filter:.*blur/);
});

// ---- before/after reveal ----

test('the reveal section uses real photos and does not claim the after photo is the same room', () => {
  // Earlier pairings all tried to pin an "after" photo to the exact same
  // room as tile-kitchen-before-2.webp: tile-finished-kitchen-wide-2.webp
  // and tile-kitchen-before-1.webp were both finished-floor photos of
  // different rooms; tile-kitchen-before-2.webp + tile-finished-kitchen-wide.webp
  // was a verified same-room pair, but that "after" shot (and every other
  // photo of that same tile job -- tile-finished-6/-11 included) was taken
  // under warm indoor lighting on a heavily distressed wood-look tile, so
  // every real photo of it reads as grimy even though it's just the tile's
  // own grain. Rather than ship a same-room claim that reads as dirty, the
  // after photo is honestly a different, cleaner job (plank-finished-living-2.webp,
  // a bright honey-oak plank floor) -- so the copy no longer claims "this
  // kitchen" or "the same kitchen," just a real before and a real after.
  assert.match(INDEX, /reveal-before[\s\S]{0,200}?tile-kitchen-before-2\.webp/);
  assert.match(INDEX, /reveal-after[\s\S]{0,200}?plank-finished-living-2\.webp/);
  assert.doesNotMatch(INDEX.slice(INDEX.indexOf('id="revealJob"'), INDEX.indexOf('</section>', INDEX.indexOf('id="revealJob"'))), /same kitchen|this kitchen/i);
});

test('the reveal section sits in the main scroll flow, between Process and Reviews', () => {
  const processAt = INDEX.indexOf('id="process"');
  const revealAt = INDEX.indexOf('id="revealJob"');
  const reviewsAt = INDEX.indexOf('id="reviews"');
  assert.ok(processAt > 0 && revealAt > 0 && reviewsAt > 0);
  assert.ok(processAt < revealAt && revealAt < reviewsAt);
});

test('the reveal control is a real range input, keyboard- and touch-operable', () => {
  assert.match(INDEX, /<input type="range" id="revealScrub" class="reveal-scrub"/);
});

test('the reveal section and its scrub input share one --p convention (a 0-1 fraction)', () => {
  assert.match(INDEX, /id="revealJob"[^>]*style="--p:\.\d+"/);
  const clipRule = STYLES.match(/\.reveal-after\{[^}]*\}/)[0];
  assert.match(clipRule, /var\(--p, \.5\)/);
  const trackRule = STYLES.match(/\.reveal-scrub::-webkit-slider-runnable-track\{[^}]*\}/)[0];
  assert.match(trackRule, /var\(--p, \.5\) \* 100%/);
});

test('the reveal demo sweep is skipped under reduced motion, same guard as the teardown demo', () => {
  const revealBlock = INDEX.slice(INDEX.indexOf('const revealStage'), INDEX.indexOf('const revealStage') + 1200);
  assert.match(revealBlock, /if \(!reduced && 'IntersectionObserver' in window\)/);
});

test('the reveal images are sized to their real native dimensions', () => {
  const section = INDEX.slice(INDEX.indexOf('id="revealJob"'), INDEX.indexOf('</section>', INDEX.indexOf('id="revealJob"')));
  assert.match(section, /tile-kitchen-before-2\.webp[^"]*"\s+alt="[^"]*"\s+width="1152"\s+height="2048"/);
  assert.match(section, /plank-finished-living-2\.webp[^"]*"\s+alt="[^"]*"\s+width="1400"\s+height="1866"/);
});

test('the reveal frame crops each portrait source photo toward its own clean patch of floor', () => {
  // The before and after photos have their clutter (a floor appliance vs.
  // a cluttered counter) in different places, so each side gets its own
  // vertical anchor rather than one shared crop.
  const imgRule = STYLES.match(/\.reveal-img img\{[^}]*\}/)[0];
  assert.match(imgRule, /object-fit:cover/);
  const beforeRule = STYLES.match(/\.reveal-before img\{[^}]*\}/)[0];
  const afterRule = STYLES.match(/\.reveal-after img\{[^}]*\}/)[0];
  assert.match(beforeRule, /object-position:center \d+%/);
  assert.match(afterRule, /object-position:center \d+%/);
});
