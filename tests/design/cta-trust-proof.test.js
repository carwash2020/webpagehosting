// Compact social proof next to primary Book/Schedule CTAs (2026-09-17).
// Must reuse a real on-site Google review and the GBP-matched 5.0 / 7
// count already locked by reviews-wall.test.js / aggregateRating --
// never a new invented card.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const BOOKING = fs.readFileSync(repo('booking.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

function reviewQuotes(html) {
  return [...html.matchAll(/<p class="review-quote">"([^"]*)"<\/p>/g)].map((m) => m[1]);
}

test('homepage hero and Book Instantly each carry compact proof that quotes a real on-site review', () => {
  const quotes = reviewQuotes(INDEX);
  assert.ok(quotes.length === 4, 'homepage wall stays at 4 written reviews');
  const washer = quotes.find((q) => q.includes('Steven was wonderful! Got our washer fixed quickly'));
  assert.ok(washer, 'expected the washer review on the homepage wall');

  const heroCtasAt = INDEX.indexOf('<div class="hero-ctas">');
  const mottoAt = INDEX.indexOf('class="hero-motto"');
  const heroProof = INDEX.slice(heroCtasAt, mottoAt);
  assert.match(heroProof, /class="cta-proof"/);
  assert.match(heroProof, /5\.0 from 7 Google reviews/);
  assert.match(heroProof, /Steven was wonderful! Got our washer fixed quickly/);
  assert.match(heroProof, /href="#reviews"/);
  assert.match(heroProof, /https:\/\/g\.page\/r\/CVJ0Qr-SsDkgEAI\/review/);

  const bookInstantlyAt = INDEX.indexOf('Book Instantly');
  const bookBlock = INDEX.slice(bookInstantlyAt, INDEX.indexOf('Send Email', bookInstantlyAt));
  assert.match(bookBlock, /class="cta-proof"/);
  assert.match(bookBlock, /5\.0 from 7 Google reviews/);
  assert.match(bookBlock, /href="#reviews"/);
});

test('compact proof does not add review cards; count matches Google Business Profile (5.0 / 7)', () => {
  const cards = INDEX.match(/class="review-card"/g) || [];
  assert.equal(cards.length, 4, 'homepage wall stays at the 4 written, verified quotes');
  assert.match(INDEX, /"reviewCount": "7"/);
  assert.match(INDEX, /5\.0 from 7 Google reviews/);
  assert.equal((INDEX.match(/class="cta-proof"/g) || []).length, 2);
});

test('booking.html has a light proof line using the same real excerpt, linking back to the homepage wall', () => {
  assert.match(BOOKING, /class="cta-proof"/);
  assert.match(BOOKING, /5\.0 from 7 Google reviews/);
  assert.match(BOOKING, /Steven was wonderful! Got our washer fixed quickly/);
  assert.match(BOOKING, /href="\/#reviews"/);
  assert.doesNotMatch(BOOKING, /class="review-card"/);
  assert.doesNotMatch(BOOKING, /"aggregateRating"/);
});

test('cta-proof is compact text, not a second sticky bar or extra card chrome', () => {
  const rule = STYLES.match(/\.cta-proof\{[\s\S]*?\n  \}/);
  assert.ok(rule, 'expected a .cta-proof rule in styles.css');
  assert.doesNotMatch(rule[0], /position:fixed/);
  assert.doesNotMatch(rule[0], /position:sticky/);
  assert.match(STYLES, /\.hero \.cta-proof\{/);
  assert.match(STYLES, /\.booking-cta \.cta-proof\{/);
});

test('hero proof hides at the sticky-bar breakpoint so it is not covered on first paint', () => {
  assert.match(
    STYLES,
    /@media \(max-width:760px\)\{[\s\S]*?\.hero \.cta-proof\{display:none;\}/
  );
});
