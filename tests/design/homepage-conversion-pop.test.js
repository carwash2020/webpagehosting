// Homepage conversion pop (2026-09-17): stronger Google-review ask,
// $25 referral off the FAQ-only shelf, tighter above-the-fold, no
// redesign and no AggregateRating inflation.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const BOOKING = fs.readFileSync(repo('booking.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const REVIEW_TOOL = fs.readFileSync(repo('tools', 'review-request.html'), 'utf8');

const GBP_REVIEW = 'https://g.page/r/CVJ0Qr-SsDkgEAI/review';

const LANDING_PAGES = [
  'drywall-painting.html',
  'plumbing-repairs.html',
  'washer-dryer-repair.html',
  'assembly-installation.html',
  'handyman-repairs.html',
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-st-george-ut.html',
  'handyman-washington-city-ut.html',
  'about.html',
  'our-work.html',
];

function schemaOf(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]);
}

test('the leave-a-review CTA uses the same real GBP write-a-review URL as the review-request tool', () => {
  const toolMatch = REVIEW_TOOL.match(/const GOOGLE_REVIEW_LINK = '([^']+)'/);
  assert.ok(toolMatch, 'expected GOOGLE_REVIEW_LINK in tools/review-request.html');
  assert.equal(toolMatch[1], GBP_REVIEW);

  const reviewsStart = INDEX.indexOf('<section id="reviews">');
  const reviewsEnd = INDEX.indexOf('</section>', reviewsStart);
  const reviews = INDEX.slice(reviewsStart, reviewsEnd);
  assert.match(reviews, /class="reviews-ask"/);
  assert.match(reviews, /Leave a Google review/);
  assert.match(reviews, new RegExp(`class="btn orange" href="${GBP_REVIEW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.doesNotMatch(reviews, /placeholder/i);
});

test('hero and Book Instantly proof lines also offer the real GBP write-a-review URL', () => {
  const heroCtasAt = INDEX.indexOf('<div class="hero-ctas">');
  const mottoAt = INDEX.indexOf('class="hero-motto"');
  const heroProof = INDEX.slice(heroCtasAt, mottoAt);
  assert.match(heroProof, new RegExp(GBP_REVIEW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(BOOKING, new RegExp(GBP_REVIEW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('landing and work pages keep Read all reviews and add a leave-Google-review path', () => {
  for (const name of LANDING_PAGES) {
    const html = fs.readFileSync(repo(name), 'utf8');
    assert.match(html, /<p class="blog-teaser-more"><a href="\/#reviews">Read all reviews &rarr;<\/a><\/p>/, name);
    assert.match(html, new RegExp(`class="reviews-ask-inline"[\\s\\S]*?href="${GBP_REVIEW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), name);
    assert.doesNotMatch(html, /"aggregateRating"/, name);
  }
});

test('$25 referral is on the trust rail, schedule rail, and hero — not FAQ-only', () => {
  assert.match(INDEX, /class="trust-referral"/);
  const trust = INDEX.match(/<p class="trust-referral">[\s\S]*?<\/p>/)[0];
  assert.match(trust, /\$25 referral credit/);
  assert.match(trust, /complete and paid/);
  assert.match(INDEX, /class="hero-referral"/);
  assert.match(INDEX, /class="schedule-rail-note"/);
  assert.match(BOOKING, /class="referral-nudge"/);
  assert.match(BOOKING, /class="conf-referral"/);
  assert.match(BOOKING, /\$25 credit/);
});

test('hero keeps Schedule as the filled orange primary and Call as outline', () => {
  const heroStart = INDEX.indexOf('<section class="hero">');
  const heroEnd = INDEX.indexOf('</section>', heroStart);
  const hero = INDEX.slice(heroStart, heroEnd);
  const orangeAt = hero.indexOf('class="btn orange"');
  const outlineAt = hero.indexOf('class="btn outline js-phone-link"');
  assert.ok(orangeAt > 0 && outlineAt > orangeAt, 'Book/Schedule first, Call second');
  assert.match(hero, /href="\/booking\.html"/);
});

test('teardown stays on the page but no longer sits between trust and services', () => {
  const trustAt = INDEX.indexOf('<section class="trust">');
  const servicesAt = INDEX.indexOf('id="services"');
  const teardownAt = INDEX.indexOf('id="teardownStage"');
  const revealAt = INDEX.indexOf('id="revealJob"');
  const reviewsAt = INDEX.indexOf('id="reviews"');
  assert.ok(trustAt > 0 && servicesAt > trustAt);
  assert.ok(teardownAt > servicesAt, 'services should reach the fold before the shop-drawing');
  assert.ok(revealAt > 0 && teardownAt > revealAt && teardownAt < reviewsAt);
  assert.match(INDEX, /id="teardownStage"/);
});

test('AggregateRating stays honest at 5.0 / 7 matching GBP; wall stays 4 written cards', () => {
  const schema = schemaOf(INDEX);
  const cards = (INDEX.match(/class="review-card"/g) || []).length;
  assert.equal(cards, 4, 'do not invent extra quote cards');
  assert.equal(schema.aggregateRating.ratingValue, '5.0');
  assert.equal(Number(schema.aggregateRating.reviewCount), 7);
  assert.match(INDEX, /5\.0 from 7 Google reviews/);
  assert.doesNotMatch(INDEX, /5\.0 from 4 Google reviews/);
});

test('new conversion chrome uses brand orange tokens and keeps 44px leave-review tap target', () => {
  assert.match(STYLES, /\.trust-referral\{/);
  assert.match(STYLES, /\.reviews-ask\{\n    margin-top:32px;/);
  assert.match(STYLES, /\.reviews-ask \.btn\{[\s\S]*?min-height:44px;/);
  assert.match(STYLES, /\.reviews-ask\{\n    margin-top:32px;[\s\S]*?--orange-tint-border/);
  assert.doesNotMatch(STYLES, /\.reviews-ask\{[^}]*position:fixed/);
  assert.match(STYLES, /@media \(max-width:760px\)\{[\s\S]*?\.hero-referral\{display:none;\}/);
});
