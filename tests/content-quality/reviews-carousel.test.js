// Three new 5-star Google reviews added 2026-09-07 (PD IND., Belinda
// Christensen, Jilleen Zufelt), bringing the homepage carousel from 4
// to 7. The aggregateRating schema is a straight count of the quotes
// actually shown on the page, so it moves in lockstep -- it is not
// pulled from live Google data, so it has to be updated by hand
// whenever a review is added here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');

const LANDING_PAGES = [
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-washington-city-ut.html',
];

function schemaOf(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]);
}

test('the homepage carousel has one review-slide per review actually written', () => {
  const slideCount = (INDEX.match(/class="review-slide"/g) || []).length;
  assert.equal(slideCount, 7);
});

test("the homepage's aggregateRating.reviewCount matches the number of slides actually shown", () => {
  const slideCount = (INDEX.match(/class="review-slide"/g) || []).length;
  const schema = schemaOf(INDEX);
  assert.equal(Number(schema.aggregateRating.reviewCount), slideCount);
  assert.equal(schema.aggregateRating.ratingValue, '5.0');
});

// Corrected 2026-09-07, found in an SEO audit: every landing page used
// to carry the exact same aggregateRating as the homepage, despite
// having no review content, stars, or testimonials of their own --
// only a link back to the homepage's own review section. Schema.org
// and Google's own guidelines require rating markup to reflect real,
// visible on-page content, so claiming a rating with nothing on the
// page to back it is a real structured-data violation, not just
// unnecessary duplication. The homepage keeps its own aggregateRating,
// since it's the one page with the actual 7-review carousel.
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

test('the carousel JS builds its dots dynamically off the actual slide count, not a hardcoded number', () => {
  assert.match(INDEX, /const slides = track \? Array\.from\(track\.children\) : \[\];/);
  assert.doesNotMatch(INDEX, /reviewIndex\s*<\s*[4-9]\b/);
});
