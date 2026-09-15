// Tests for a small hero-area addition to the 7 city landing pages
// (proposed visual improvement #3 in docs/ACTION-ITEMS.md: "local
// imagery on city landing pages"). Since these pages all deliberately
// share one hero photo/layout with the homepage (and there's no real,
// distinct photography per city to swap in), the buildable version of
// that idea is a small pill in the hero -- right next to the existing
// coverage-badge -- stating each city's own direction/ETA from
// St. George. That fact is already stated in body copy further down
// each page; this just surfaces it where a visitor sees it first.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const PAGES = {
  'handyman-cedar-city-ut.html': /About 50 miles \/ an hour north of St\. George/,
  'handyman-hurricane-ut.html': /About 20&ndash;25 minutes east of St\. George/,
  'handyman-la-verkin-ut.html': /About 25&ndash;30 minutes east of St\. George/,
  'handyman-leeds-ut.html': /About 15&ndash;20 minutes north of St\. George/,
  'handyman-mesquite-nv.html': /About 40 miles \/ 40 minutes southwest of St\. George/,
  'handyman-santa-clara-ivins-ut.html': /Just west of St\. George, about 10&ndash;15 minutes/,
  'handyman-washington-city-ut.html': /Right next door, directly east of St\. George/,
};

for (const [name, expectedText] of Object.entries(PAGES)) {
  test(`${name}'s hero has a distance chip with its own direction/ETA from St. George`, () => {
    const html = fs.readFileSync(repo(name), 'utf8');
    const heroIdx = html.indexOf('<section class="hero">');
    assert.ok(heroIdx !== -1, 'expected a hero section');
    const heroSection = html.slice(heroIdx, heroIdx + 2500);

    assert.match(heroSection, /<p class="hero-distance-chip">/);
    assert.match(heroSection, expectedText);

    // The chip must sit right after the H1, inside the hero, not
    // floating loose somewhere else in the section.
    const h1Idx = heroSection.indexOf('<h1>');
    const chipIdx = heroSection.indexOf('hero-distance-chip');
    assert.ok(h1Idx !== -1 && chipIdx > h1Idx, 'chip should follow the H1');
  });
}

test('the distance chip text matches each page\'s own "Distance from St. George" body copy (no contradicting claims)', () => {
  for (const name of Object.keys(PAGES)) {
    const html = fs.readFileSync(repo(name), 'utf8');
    const bodyMatch = html.match(/<strong>Distance from St\. George:<\/strong>\s*([^<]+)/);
    assert.ok(bodyMatch, `${name} should still have its body "Distance from St. George" paragraph`);
    const heroIdx = html.indexOf('<section class="hero">');
    const heroSection = html.slice(heroIdx, heroIdx + 2500);
    const chipMatch = heroSection.match(/<p class="hero-distance-chip">.*?<\/svg>([^<]+)<\/p>/s);
    assert.ok(chipMatch, `${name} should have chip text`);
    // Cheap consistency check: every number mentioned in the chip
    // (minutes/miles) must also appear somewhere in the body paragraph,
    // so the two can't silently drift apart over an edit.
    const chipNumbers = chipMatch[1].match(/\d+/g) || [];
    for (const num of chipNumbers) {
      assert.ok(
        bodyMatch[1].includes(num),
        `${name}: chip mentions "${num}" but the body distance paragraph doesn't`
      );
    }
  }
});

test("styles.css defines .hero-distance-chip", () => {
  const css = fs.readFileSync(repo('styles.css'), 'utf8');
  assert.match(css, /\.hero-distance-chip\{/);
  assert.match(css, /\.hero-distance-chip svg\{/);
});
