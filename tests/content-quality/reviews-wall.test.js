// Three new 5-star Google reviews added 2026-09-07 (PD IND., Belinda
// Christensen, Jilleen Zufelt), bringing the homepage wall from 4
// to 7. U03 (same day) converted the carousel to a static two-column
// wall. Renamed from reviews-carousel.test.js.
//
// Corrected 2026-09-16, on a real review audit against the actual
// Google Business Profile: 4 of the original 7 quotes didn't trace
// back to a real, verifiable Google review. Removed the unverifiable
// quotes and added Jilleen Walker's real review text. Wall is 4
// written cards, all verified against the live Google listing.
//
// 2026-09-17 owner unlock: Google Business Profile shows 5.0 from 7
// Google reviews. aggregateRating.ratingValue stays 5.0 and
// reviewCount now matches that GBP total (7), including star-only
// reviews that have no written text to quote. The wall still shows
// only the 4 verified quotes -- do not invent Review objects or
// cards for the star-only reviews. Update reviewCount by hand when
// the owner confirms a new GBP total.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');

const LANDING_PAGES = [
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-st-george-ut.html',
  'handyman-washington-city-ut.html',
  'washer-dryer-repair-st-george-ut.html',
  'refrigerator-repair-st-george-ut.html',
  'dishwasher-repair-st-george-ut.html',
];

function schemaOf(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]);
}

test('the homepage wall has one review-card per review actually written', () => {
  const cardCount = (INDEX.match(/class="review-card"/g) || []).length;
  assert.equal(cardCount, 4);
});

test("the homepage's aggregateRating matches Google Business Profile (5.0 from 7), not invented Review objects", () => {
  const cardCount = (INDEX.match(/class="review-card"/g) || []).length;
  const schema = schemaOf(INDEX);
  assert.equal(cardCount, 4, 'wall stays at the 4 written, verified quotes');
  assert.equal(schema.aggregateRating.ratingValue, '5.0');
  assert.equal(Number(schema.aggregateRating.reviewCount), 7, 'reviewCount matches the owner-confirmed GBP total');
  assert.doesNotMatch(INDEX, /"@type":\s*"Review"/, 'do not invent individual Review JSON-LD objects');
});

// Corrected 2026-09-07, found in an SEO audit: every landing page used
// to carry the exact same aggregateRating as the homepage, despite
// having no review content, stars, or testimonials of their own --
// only a link back to the homepage's own review section. Schema.org
// and Google's own guidelines require rating markup to reflect real,
// visible on-page content, so claiming a rating with nothing on the
// page to back it is a real structured-data violation, not just
// unnecessary duplication. The homepage keeps its own aggregateRating,
// since it's the one page with the actual review wall.
test('landing pages do not claim an aggregateRating they have no visible reviews to back', () => {
  for (const page of LANDING_PAGES) {
    const html = fs.readFileSync(repo(page), 'utf8');
    const schema = schemaOf(html);
    assert.ok(!('aggregateRating' in schema), `${page} should not carry aggregateRating with no visible review content on the page`);
  }
});

test('the three newest reviews are present verbatim, newest first', () => {
  const quotes = [...INDEX.matchAll(/<p class="review-quote">"([^"]*)"<\/p>/g)].map((m) => m[1]);
  assert.equal(quotes[0], 'Awesome guy to work with!');
  assert.match(quotes[1], /Steven was wonderful! Got our washer fixed quickly/);
  assert.match(quotes[2], /Best experience ever with a handyman/);
});

test('the 4th review (Jilleen Walker, added 2026-09-16) is present verbatim', () => {
  const quotes = [...INDEX.matchAll(/<p class="review-quote">"([^"]*)"<\/p>/g)].map((m) => m[1]);
  assert.match(quotes[3], /Steve such a handsome guy very fast and efficient/);
});

test('no carousel machinery (slider track, dots, autoplay, swipe) remains -- this is a static wall now', () => {
  assert.doesNotMatch(INDEX, /reviewsTrack|reviewDots|reviewPrev|reviewNext/);
  assert.doesNotMatch(INDEX, /class="reviews-carousel"|class="review-slide"|class="carousel-controls"|class="carousel-dot"/);
  assert.doesNotMatch(INDEX, /AUTOPLAY_MS/);
});
