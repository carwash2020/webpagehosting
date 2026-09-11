// W21/M03 fix (Master Audit, 2026-09-08): a before/after audit named
// "Where We Work" the tallest block on the page and the deadest --
// 1,240px, with the diagram's own one-time entrance animation already
// finished by the time a visitor reaches the service cards below it.
// Rather than cut the real content (6 cards with genuine descriptions
// and links to dedicated landing pages), the diagram is now linked to
// those same cards: hovering or tab-focusing a card re-lights that
// exact city's spoke/node/label.
//
// Regression-recovery follow-up (2026-09-08): a second measured audit
// found #areas still the single largest block on the page even with
// hover wired up -- activating it didn't earn its height, since with
// the diagram now carrying the interaction, the 6 full description
// cards were a second copy of the same information. The cards were
// replaced with a compact .areas-links row (still one real link per
// landing page, still paired to the diagram by data-city); the
// hover-link pairing itself, tested below, is unchanged.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const CITIES = ['st-george', 'washington-city', 'hurricane', 'santa-clara-ivins', 'la-verkin', 'leeds', 'cedar-city', 'mesquite'];

test('every areas link shares a data-city value with its matching diagram group -- no invented city, no missing one', () => {
  for (const city of CITIES) {
    assert.match(INDEX, new RegExp(`class="areas-link[^"]*" data-city="${city}"`), `expected an areas link for ${city}`);
    assert.match(INDEX, new RegExp(`<g data-city="${city}"`), `expected a diagram group for ${city}`);
  }
});

test('the 7 real landing pages are still linked from #areas, not just named', () => {
  const LANDING_PAGES = [
    'handyman-washington-city-ut.html', 'handyman-hurricane-ut.html',
    'handyman-santa-clara-ivins-ut.html', 'handyman-cedar-city-ut.html', 'handyman-mesquite-nv.html',
    'handyman-la-verkin-ut.html', 'handyman-leeds-ut.html',
  ];
  const start = INDEX.indexOf('<div class="areas-links"');
  const end = INDEX.indexOf('</section>', start);
  const block = INDEX.slice(start, end);
  for (const page of LANDING_PAGES) {
    assert.match(block, new RegExp(`href="/${page}"`), `expected a link to ${page} inside #areas`);
  }
});

test('hovering/focusing an areas link links only its own diagram group, not every group at once', () => {
  const start = INDEX.indexOf('service-area diagram: hover/focus-linked');
  const end = INDEX.indexOf('---------- motto rail', start);
  const block = INDEX.slice(start, end);
  assert.match(block, /querySelectorAll\('\.areas-link\[data-city\]'\)/);
  assert.match(block, /g\.getAttribute\('data-city'\) === city/);
  assert.match(block, /addEventListener\('mouseenter'/);
  assert.match(block, /addEventListener\('mouseleave'/);
  // focusin/focusout (not focus/blur) so the listener works via event
  // delegation semantics and fires for a link INSIDE the card, not just
  // the card element itself, which has no tabindex of its own.
  assert.match(block, /addEventListener\('focusin'/);
  assert.match(block, /addEventListener\('focusout'/);
});

test('the linked state brightens the spoke/node/label using the existing brand tokens, not new colors', () => {
  const rule = STYLES.match(/\.radius-figure g\.is-linked \.radius-spoke\{([^}]*)\}/);
  assert.ok(rule, 'expected a .radius-figure g.is-linked .radius-spoke rule');
  assert.match(rule[1], /var\(--blue-light\)/);
  assert.match(STYLES, /\.radius-figure g\.is-linked \.radius-node\{[^}]*drop-shadow/);
  assert.match(STYLES, /\.radius-figure g\.is-hub\.is-linked \.radius-hub\{[^}]*drop-shadow/);
});

test('the tools/portal service workers were bumped for this styles.css change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 108, `expected v108 or later, got v${version}`);
});
