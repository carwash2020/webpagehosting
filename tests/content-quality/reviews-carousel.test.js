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

test('every landing page carries the same reviewCount as the homepage, even though only the homepage has the carousel', () => {
  const homeCount = schemaOf(INDEX).aggregateRating.reviewCount;
  for (const page of LANDING_PAGES) {
    const html = fs.readFileSync(repo(page), 'utf8');
    const schema = schemaOf(html);
    assert.equal(schema.aggregateRating.reviewCount, homeCount, `${page} reviewCount is out of sync with index.html`);
    assert.equal(schema.aggregateRating.ratingValue, '5.0');
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
