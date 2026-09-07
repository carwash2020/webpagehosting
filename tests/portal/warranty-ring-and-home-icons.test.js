// Two dataviz-informed additions (2026-09-07), both driven off numbers
// already computed on these pages -- no invented statistics.
//
//   1. jobs.html's warranty pill gained a small ring showing days-left
//      as a fraction of the 30-day warranty, not just the number as text.
//   2. home.html's stat cards and attention rows gained icons, reusing
//      the exact SVG paths already established by this page's own
//      bottom nav rather than inventing a second icon language.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const HOME = fs.readFileSync(repo('portal', 'home.html'), 'utf8');

// ---- warranty ring ----

test('the ring fraction is real days-left over the real 30-day warranty window, not invented', () => {
  assert.match(JOBS, /function warrantyRingSvg\(fraction\)/);
  assert.match(JOBS, /warrantyRingSvg\(daysLeft \/ 30\)/);
});

test('the ring is legible at a low fraction: sized and coloured for it, not just mathematically correct', () => {
  // A first attempt at 16px with a .3-opacity track reduced a 1-in-30
  // fraction to 1-2 lit pixels, indistinguishable from the empty track
  // at actual render size (checked by rendering it, not by reading the
  // math). Fixed by sizing up and brightening the track.
  const svgFn = JOBS.slice(JOBS.indexOf('function warrantyRingSvg'), JOBS.indexOf('function warrantyBadgeHtml'));
  assert.match(svgFn, /width="20" height="20"/);
  assert.match(JOBS, /\.warranty-ring-track \{ opacity: \.35; \}/);
});

test('an expired job (daysLeft < 0) gets no ring, only the plain badge', () => {
  const expiredBranch = JOBS.slice(JOBS.indexOf('function warrantyBadgeHtml'), JOBS.indexOf('function renderWarrantyOverview'));
  assert.match(expiredBranch, /Warranty expired<\/span>`;\s*\}\s*$/m);
  assert.doesNotMatch(expiredBranch.slice(expiredBranch.indexOf('Warranty expired') - 5), /warrantyRingSvg/);
});

test('the warranty overview list rows also carry a ring, using the same helper (no second formula)', () => {
  assert.match(JOBS, /warrantyRingSvg\(x\.daysLeft \/ 30\)/);
});

// ---- home page icons ----

test('every home stat card has an icon field, reusing the bottom nav\'s own SVG paths', () => {
  const navIcons = HOME.match(/class="portal-nav"[\s\S]*?<\/nav>/)[0];
  const cardsBlock = HOME.slice(HOME.indexOf('const cards = ['), HOME.indexOf('const cards = [') + 1500);
  for (const card of ['dashboard.html', 'quotes.html', 'jobs.html', 'work-orders.html']) {
    const cardBlock = cardsBlock.slice(cardsBlock.indexOf(`href: '/portal/${card}'`), cardsBlock.indexOf(`href: '/portal/${card}'`) + 400);
    const iconMatch = cardBlock.match(/icon: '([^']+)'/);
    assert.ok(iconMatch, `expected an icon field on the ${card} card`);
    // The icon markup (modulo whitespace) should appear somewhere in the nav too.
    const path0 = iconMatch[1].split('/>')[0];
    assert.ok(navIcons.includes(path0), `expected the ${card} card's icon to match a path already used in the bottom nav`);
  }
});

test('the card icon renders inside a labelled accent chip, not a bare floating icon', () => {
  assert.match(HOME, /class="home-card-icon"><svg viewBox="0 0 24 24" aria-hidden="true">/);
  assert.match(HOME, /\.home-card-icon \{[^}]*border-radius: 10px/);
});

test('attention rows carry an icon per row type, reusing the same fixed paths (not user data)', () => {
  const rowsBlock = HOME.slice(HOME.indexOf('function renderAttention'), HOME.indexOf('function renderAttention') + 3000);
  const iconCount = [...rowsBlock.matchAll(/icon: '<.*?>'/g)].length;
  assert.equal(iconCount, 4, 'expected all four row types (scheduled, unpaid, pending quote, open request) to carry an icon');
});
