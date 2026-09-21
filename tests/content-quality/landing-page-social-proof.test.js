// Tests for adding social proof (real Google reviews) to every
// landing page (audit item #8). A full-repo audit found that only
// index.html carried the reviews wall -- every service page
// (drywall-painting, plumbing-repairs, washer-dryer-repair,
// assembly-installation, handyman-repairs), every city page
// (handyman-*-ut.html, handyman-mesquite-nv.html), and both about.html
// and our-work.html sent visitors all the way through a full page,
// including a schedule/CTA section, with zero third-party validation
// that this business is legitimate and does good work -- a real
// conversion gap for anyone who lands on one of these pages directly
// (from local SEO, a city-specific search, or a shared link) rather
// than the homepage.
//
// The fix reuses the exact same real Google review quotes and the
// exact same reviews-wall/review-card CSS classes already proven on
// index.html (no new CSS needed), with a "Read all reviews" link back
// to /#reviews rather than duplicating the full 7-review wall (and its
// aggregateRating schema) on every page.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const PAGES_WITH_SCHEDULE = [
  'services/drywall-painting.html',
  'services/plumbing-repairs.html',
  'services/washer-dryer-repair.html',
  'services/washer-dryer-repair-st-george-ut.html',
  'services/refrigerator-repair-st-george-ut.html',
  'services/dishwasher-repair-st-george-ut.html',
  'services/assembly-installation.html',
  'services/handyman-repairs.html',
  'locations/handyman-cedar-city-ut.html',
  'locations/handyman-hurricane-ut.html',
  'locations/handyman-la-verkin-ut.html',
  'locations/handyman-leeds-ut.html',
  'locations/handyman-mesquite-nv.html',
  'locations/handyman-santa-clara-ivins-ut.html',
  'locations/handyman-st-george-ut.html',
  'locations/handyman-washington-city-ut.html',
];

const PAGES_WITHOUT_SCHEDULE = ['about.html', 'our-work.html'];

const ALL_PAGES = [...PAGES_WITH_SCHEDULE, ...PAGES_WITHOUT_SCHEDULE];

function read(name) {
  return fs.readFileSync(repo(name), 'utf8');
}

for (const name of ALL_PAGES) {
  test(`${name} has a local-reviews section with real review cards`, () => {
    const html = read(name);
    assert.match(html, /<section id="local-reviews">/);
    const matches = html.match(/<div class="review-card" data-reveal>/g) || [];
    assert.ok(matches.length >= 3, `expected at least 3 review cards, found ${matches.length}`);
  });

  test(`${name}'s local-reviews section links back to the full reviews wall on the homepage`, () => {
    const html = read(name);
    assert.match(html, /<p class="blog-teaser-more"><a href="\/#reviews">Read all reviews &rarr;<\/a><\/p>/);
    assert.match(html, /class="reviews-ask-inline"/);
    assert.match(html, /https:\/\/g\.page\/r\/CVJ0Qr-SsDkgEAI\/review/);
  });

  test(`${name} does not duplicate the full 7-review wall or its aggregateRating schema`, () => {
    const html = read(name);
    const cardCount = (html.match(/<div class="review-card" data-reveal>/g) || []).length;
    assert.ok(cardCount < 7, 'a per-page condensed proof section should stay smaller than the homepage\'s full wall');
    assert.doesNotMatch(html, /"aggregateRating"/);
  });

  test(`${name} exactly one local-reviews section, one main open and close tag`, () => {
    const html = read(name);
    assert.equal((html.match(/<section id="local-reviews">/g) || []).length, 1);
    assert.equal((html.match(/<main[ >]/g) || []).length, 1);
    assert.equal((html.match(/<\/main>/g) || []).length, 1);
  });
}

for (const name of PAGES_WITH_SCHEDULE) {
  test(`${name}'s local-reviews section sits before the schedule/CTA section, inside <main>`, () => {
    const html = read(name);
    const mainIdx = html.indexOf('<main');
    const reviewsIdx = html.indexOf('<section id="local-reviews">');
    const scheduleIdx = html.indexOf('<section id="schedule">');
    const mainCloseIdx = html.indexOf('</main>');
    assert.ok(mainIdx !== -1 && reviewsIdx !== -1 && scheduleIdx !== -1 && mainCloseIdx !== -1);
    assert.ok(mainIdx < reviewsIdx && reviewsIdx < scheduleIdx && scheduleIdx < mainCloseIdx);
  });
}

for (const name of PAGES_WITHOUT_SCHEDULE) {
  test(`${name}'s local-reviews section sits inside <main>, before it closes`, () => {
    const html = read(name);
    const mainIdx = html.indexOf('<main');
    const reviewsIdx = html.indexOf('<section id="local-reviews">');
    const mainCloseIdx = html.indexOf('</main>');
    assert.ok(mainIdx !== -1 && reviewsIdx !== -1 && mainCloseIdx !== -1);
    assert.ok(mainIdx < reviewsIdx && reviewsIdx < mainCloseIdx);
  });
}

test('index.html has the full written reviews wall (4 verified quotes); aggregateRating is the GBP total (7)', () => {
  const html = read('index.html');
  assert.match(html, /<section id="reviews">/);
  const cardCount = (html.match(/<div class="review-card" data-reveal>/g) || []).length;
  assert.equal(cardCount, 4, 'the homepage should carry exactly the verified written quotes -- do not invent cards for star-only Google reviews');
  assert.match(html, /"reviewCount": "7"/);
});
