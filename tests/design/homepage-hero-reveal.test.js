// Two additions to the homepage (2026-09-07): a third depth plane in the
// hero (a real job photo, not another graphic), and a drag-to-compare
// before/after section using real client work. The homepage previously
// showed none of the 62 job photos anywhere in the scroll; all of them
// lived only behind the "Gallery" nav link's modal.
//
// The reveal section was briefly expanded (same day) to a 3-pair
// gallery, then reverted back to this single pair: direct feedback
// was "the second/third slider shows the same before pictures from
// different angles and then different floors as the after product --
// shows as fake work." Pairs 2 and 3 had each been checked only for
// lighting/griminess, not for whether the two rooms actually looked
// like the same space -- a drag-reveal control inherently claims "this
// exact spot, before vs. after," so two visibly different rooms read
// as dishonest no matter the caption. This one pair is the one that
// was actually checked for that -- see the test below.
//
// Design feedback (2026-09-08, earlier the same day): the "before" side
// was swapped from tile-kitchen-before-2.webp to tile-kitchen-before-3.webp --
// both are the same honestly-different-job tile floor (neither claims to
// be the after photo's room, per the note above), but before-2's frame is
// dominated by a cluttered counter (coffee maker, mouthwash, a beer
// bottle) above the floor, while before-3 keeps the camera low and the
// floor itself -- worn grout, dingy tile -- as the actual subject.
//
// Direct request (2026-09-08, later the same day): swapped again, this
// time to a real underlayment-prep-to-finished pair from one flooring
// job (plank-underlayment-prep.webp -> flooring-finished-detail.webp),
// replacing the tile/plank cross-job pairing above entirely. The copy
// still doesn't claim "this exact room" -- same policy as before, just
// applied to a pair that's honestly closer to it (same job, not just
// "both real photos").

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

// ---- hero depth ----
//
// The hero-subject midground layer (a desaturated/blurred job photo
// layered over the canyon background) was removed entirely (direct
// feedback, 2026-09-09: "it looks terrible. just keep the main
// background"). The badge and grid-plane parallax layers stay -- see
// the reduced-hero-depth test below.

test('the hero-subject midground layer has been removed, keeping only the canyon background', () => {
  assert.doesNotMatch(INDEX, /hero-subject/);
  assert.doesNotMatch(STYLES, /hero-subject/);
});

test('the remaining hero depth layers (badge, grid plane) still parallax at their own distinct rates', () => {
  const rates = [...INDEX.matchAll(/setProperty\('--shift',\s*\(y \* (-?[\d.]+)\)/g)].map((m) => Number(m[1]));
  assert.equal(rates.length, 2, 'expected two rate assignments: badge and plane');
  const unique = new Set(rates);
  assert.equal(unique.size, 2, `both rates must differ, got ${rates.join(', ')}`);
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
  assert.match(INDEX, /reveal-before[\s\S]{0,200}?plank-underlayment-prep\.webp/);
  assert.match(INDEX, /reveal-after[\s\S]{0,200}?flooring-finished-detail\.webp/);
  assert.doesNotMatch(INDEX.slice(INDEX.indexOf('id="revealJob"'), INDEX.indexOf('</section>', INDEX.indexOf('id="revealJob"'))), /same kitchen|this kitchen|same room|this room/i);
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
  const revealBlock = INDEX.slice(INDEX.indexOf('const revealStage'), INDEX.indexOf('const revealStage') + 3200);
  assert.match(revealBlock, /if \(!reduced && 'IntersectionObserver' in window\)/);
});

test('the reveal images are sized to their real native dimensions', () => {
  const section = INDEX.slice(INDEX.indexOf('id="revealJob"'), INDEX.indexOf('</section>', INDEX.indexOf('id="revealJob"')));
  assert.match(section, /plank-underlayment-prep\.webp[^"]*"\s+alt="[^"]*"\s+width="1400"\s+height="1050"/);
  assert.match(section, /flooring-finished-detail\.webp[^"]*"\s+alt="[^"]*"\s+width="640"\s+height="853"/);
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

test('the reveal section is back to a single static pair -- no pair-switching gallery, no leftover dots/array/functions from the reverted attempt', () => {
  assert.doesNotMatch(INDEX, /REVEAL_PAIRS/);
  assert.doesNotMatch(INDEX, /revealDots/);
  assert.doesNotMatch(INDEX, /goToRevealPair/);
  assert.doesNotMatch(INDEX, /revealDemoCancelled/);
  assert.doesNotMatch(STYLES, /#revealDots/);
  const section = INDEX.slice(INDEX.indexOf('id="revealJob"'), INDEX.indexOf('</section>', INDEX.indexOf('id="revealJob"')));
  assert.equal((section.match(/<img /g) || []).length, 2, 'expected exactly one before image and one after image, no gallery');
});
