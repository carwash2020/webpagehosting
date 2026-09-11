// A real-numbers stats strip added under the hero (2026-09-07): the
// rating and review count must match the JSON-LD aggregateRating and the
// reviews carousel exactly, and the community count must match the
// number of pages this site actually serves. No invented statistics
// (no fabricated "jobs completed" or "years in business" counts --
// those aren't sourced anywhere else on the site).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

test('the stats bar sits between the hero and the trust strip', () => {
  const heroAt = INDEX.indexOf('class="hero">');
  const statsAt = INDEX.indexOf('class="stats-bar"');
  const trustAt = INDEX.indexOf('<section class="trust">');
  assert.ok(heroAt > 0 && statsAt > 0 && trustAt > 0);
  assert.ok(heroAt < statsAt && statsAt < trustAt);
});

test('the rating stat matches the JSON-LD aggregateRating exactly', () => {
  const ratingMatch = INDEX.match(/"ratingValue":\s*"([\d.]+)"/);
  assert.ok(ratingMatch, 'expected a ratingValue in JSON-LD');
  const statMatch = INDEX.match(/data-count-to="([\d.]+)" data-decimals="1"/);
  assert.ok(statMatch, 'expected the rating stat-count element');
  assert.equal(Number(statMatch[1]).toFixed(1), ratingMatch[1]);
});

test('the review-count stat matches the JSON-LD reviewCount exactly', () => {
  const countMatch = INDEX.match(/"reviewCount":\s*"(\d+)"/);
  assert.ok(countMatch, 'expected a reviewCount in JSON-LD');
  const statBlock = INDEX.slice(INDEX.indexOf('Real 5-Star Reviews') - 200, INDEX.indexOf('Real 5-Star Reviews'));
  const statMatch = statBlock.match(/data-count-to="(\d+)">0</);
  assert.ok(statMatch, 'expected the review-count stat-count element');
  assert.equal(statMatch[1], countMatch[1]);
});

test('the communities-served stat matches the number of satellite landing pages plus this one', () => {
  // Matches only the city satellite pages (handyman-<city>-ut.html /
  // -nv.html), not service pages like handyman-repairs.html.
  const landingPages = fs.readdirSync(repo('.')).filter((f) => /^handyman-.*-(ut|nv)\.html$/.test(f));
  const statBlock = INDEX.slice(INDEX.indexOf('Southern Utah Communities Served') - 200, INDEX.indexOf('Southern Utah Communities Served'));
  const statMatch = statBlock.match(/data-count-to="(\d+)">0</);
  assert.ok(statMatch, 'expected the communities-served stat-count element');
  assert.equal(Number(statMatch[1]), landingPages.length + 1, 'stat should equal the satellite pages plus St. George itself');
});

test('none of the stats are invented figures with no source elsewhere on the page', () => {
  // A "jobs completed" or "years in business" count would have no real
  // source anywhere else on this site -- guard against ever adding one.
  const statsSection = INDEX.slice(INDEX.indexOf('class="stats-bar"'), INDEX.indexOf('</section>', INDEX.indexOf('class="stats-bar"')));
  assert.doesNotMatch(statsSection, /jobs (completed|done|finished)/i);
  assert.doesNotMatch(statsSection, /years? (in business|experience|serving)/i);
});

test('every counter animates from its own data-count-to via a shared count-up, and shows final values under reduced motion', () => {
  assert.match(INDEX, /const statCounts = document\.querySelectorAll\('\.stat-count'\);/);
  assert.match(INDEX, /if \(reduced \|\| !\('IntersectionObserver' in window\)\)/);
  const counts = [...INDEX.matchAll(/class="stat-count" data-count-to="([\d.]+)"/g)].map((m) => m[1]);
  assert.equal(counts.length, 3, 'expected 3 animated counters (rating, reviews, communities) -- the 4th stat is a text badge, not a number');
});

test('the stats bar is a distinct full-width band, not styled like the plain trust cards', () => {
  const barRule = STYLES.match(/\.stats-bar\{[^}]*\}/)[0];
  assert.match(barRule, /background:/);
  assert.match(barRule, /border-(top|bottom):/);
  const numberRule = STYLES.match(/\.stat-number\{[^}]*\}/)[0];
  assert.match(numberRule, /font-family:var\(--font-display\)/);
});

test('the stats grid degrades to fewer columns on narrow screens', () => {
  // F30 (2026-09-07): merged from 820px into 860px, matching the other
  // 2-column-tablet breakpoints (services/contact/gallery/teardown-grid).
  assert.match(STYLES, /@media \(max-width:860px\)\{\.stats-grid\{grid-template-columns:repeat\(2,1fr\)/);
  assert.match(STYLES, /@media \(max-width:480px\)\{\.stats-grid\{grid-template-columns:1fr/);
});
