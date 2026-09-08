// W21/M03 fix (Master Audit, 2026-09-08): a before/after audit named
// "Where We Work" the tallest block on the page and the deadest --
// 1,240px, with the diagram's own one-time entrance animation already
// finished by the time a visitor reaches the service cards below it.
// Rather than cut the real content (6 cards with genuine descriptions
// and links to dedicated landing pages), the diagram is now linked to
// those same cards: hovering or tab-focusing a card re-lights that
// exact city's spoke/node/label, giving it an ongoing reason to keep
// drawing the eye instead of a one-shot animation nobody revisits.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const CITIES = ['st-george', 'washington-city', 'hurricane', 'santa-clara-ivins', 'cedar-city', 'mesquite'];

test('every service card shares a data-city value with its matching diagram group -- no invented city, no missing one', () => {
  for (const city of CITIES) {
    assert.match(INDEX, new RegExp(`class="service-card[^"]*" data-reveal data-city="${city}"`), `expected a service card for ${city}`);
    assert.match(INDEX, new RegExp(`<g data-city="${city}"`), `expected a diagram group for ${city}`);
  }
});

test('hovering/focusing a service card links only its own diagram group, not every group at once', () => {
  const start = INDEX.indexOf('service-area diagram: hover/focus-linked');
  const end = INDEX.indexOf('---------- motto rail', start);
  const block = INDEX.slice(start, end);
  assert.match(block, /querySelectorAll\('\.service-card\[data-city\]'\)/);
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
  assert.ok(version >= 106, `expected v106 or later, got v${version}`);
});
