// Tests for the portal app-shell pass (2026-09-04), requested
// directly: "Make boxes pop. Make swiping feel good, but don't over
// do it just clean everything up and make it feel more user friendly
// and app facing." Grounded in the research done first: 3-5
// destinations in a fixed bottom bar (thumb zone), 44px minimum
// touch targets, real tap feedback so people don't double-tap.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const CSS = fs.readFileSync(repo('portal', 'portal-app.css'), 'utf8');
const SW = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

const NAV_PAGES = ['home', 'dashboard', 'jobs', 'quotes', 'work-orders', 'settings'];
const ALL_PAGES = [...NAV_PAGES, 'login', 'set-password'];
const read = (p) => fs.readFileSync(repo('portal', `${p}.html`), 'utf8');

test('the nav is fixed to the bottom, not scrolling away at the top like the old website-style grid', () => {
  const block = CSS.match(/\.portal-nav \{[\s\S]*?\}/);
  assert.ok(block, 'expected a .portal-nav rule');
  assert.match(block[0], /position: fixed;/);
  assert.match(block[0], /bottom: 0;/);
});

test('exactly five destinations -- the documented ceiling before targets get too close together', () => {
  for (const page of NAV_PAGES) {
    const html = read(page);
    const nav = html.match(/<nav class="portal-nav"[\s\S]*?<\/nav>/);
    assert.ok(nav, `${page}: expected a portal-nav`);
    const links = nav[0].match(/<a href=/g) || [];
    assert.equal(links.length, 5, `${page}: expected exactly 5 tab destinations`);
  }
});

test('touch targets meet the 44px minimum', () => {
  const block = CSS.match(/\.portal-nav a \{[\s\S]*?\}/);
  assert.ok(block);
  assert.match(block[0], /min-height: 44px;/);
});

test('the bar clears the iPhone home indicator, with a real floor for browsers where env() resolves to 0px', () => {
  const block = CSS.match(/\.portal-nav \{[\s\S]*?\}/);
  assert.match(block[0], /max\(6px, env\(safe-area-inset-bottom\)\)/);
});

test('page content is padded so the last card is never stranded under the fixed bar', () => {
  assert.match(CSS, /body\.portal-page \{[\s\S]*?padding-bottom: calc\(72px \+ env\(safe-area-inset-bottom\)\);/);
  // The rule targets a class, so the class must actually be on the body.
  for (const page of NAV_PAGES) {
    assert.match(read(page), /<body class="portal-page">/, `${page}: body needs the class the padding rule targets`);
  }
});

test('login and set-password get the stylesheet but NOT the bottom padding -- they have no nav bar to clear', () => {
  for (const page of ['login', 'set-password']) {
    const html = read(page);
    assert.match(html, /portal-app\.css/, `${page}: should still get shared button tap feedback`);
    assert.doesNotMatch(html, /<body class="portal-page">/, `${page}: has no nav, so needs no bottom padding`);
  }
});

test('each page marks its own tab active, with aria-current for screen readers', () => {
  const expected = {
    home: 'home', dashboard: 'dashboard', jobs: 'jobs',
    quotes: 'quotes', 'work-orders': 'work-orders',
  };
  for (const [page, slug] of Object.entries(expected)) {
    const html = read(page);
    const re = new RegExp(`<a href="/portal/${slug}\\.html" class="is-active" aria-current="page">`);
    assert.match(html, re, `${page}: expected its own tab marked active`);
  }
});

test('settings marks no tab active -- it is a header icon button, not a tab destination', () => {
  const html = read('settings');
  assert.doesNotMatch(html, /is-active/, 'settings is deliberately not one of the five tabs');
  assert.match(html, /<nav class="portal-nav"/, 'but it still shows the bar so navigation stays available');
});

test('every real card class gets elevation -- confirmed against the classes that actually exist, not a guessed list', () => {
  const cardClasses = ['attention-card', 'help-card', 'home-card', 'invoice-card',
                       'job-card', 'quote-card', 'set-card', 'wo-card', 'wo-form-card'];
  for (const cls of cardClasses) {
    assert.match(CSS, new RegExp(`\\.${cls}[,\\s]`), `expected .${cls} to be covered by the elevation rule`);
  }
  assert.match(CSS, /box-shadow: 0 1px 2px rgba\(0, 0, 0, 0\.3\), 0 4px 14px/);
});

test('the attention card keeps its own orange tint rather than being flattened to match the rest', () => {
  const block = CSS.match(/\n\.attention-card \{[\s\S]*?\}/);
  assert.ok(block, 'expected a dedicated .attention-card override');
  assert.match(block[0], /background: var\(--orange-tint-soft\);/);
});

test('buttons have a real pressed state, since hover does nothing on a phone', () => {
  assert.match(CSS, /\.btn:active[\s\S]*?transform: scale\(0\.97\);/);
});

test('motion is kept restrained, per the explicit "don\u2019t over do it" -- transitions stay at or under 180ms', () => {
  const durations = [...CSS.matchAll(/transition:[^;]*?([\d.]+)s/g)].map((m) => parseFloat(m[1]));
  assert.ok(durations.length > 0, 'expected to find real transitions');
  for (const d of durations) {
    assert.ok(d <= 0.18, `found a ${d}s transition -- longer than the restrained ceiling`);
  }
});

test('prefers-reduced-motion is respected -- every transition here is decorative, so removing it costs nothing', () => {
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
  const block = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\}/);
  assert.match(block[0], /transition: none;/);
  assert.match(block[0], /transform: none;/);
});

test('the nav CSS lives in one shared file now, not copy-pasted into six pages', () => {
  for (const page of NAV_PAGES) {
    const html = read(page);
    assert.match(html, /portal-app\.css/, `${page}: should load the shared stylesheet`);
    assert.doesNotMatch(html, /grid-template-columns: repeat\(5, 1fr\); gap: 6px/,
      `${page}: the old duplicated nav CSS should be gone`);
  }
});

test('the new stylesheet is precached and CACHE_NAME was bumped -- a precached file changing without a bump is a documented real failure mode', () => {
  assert.match(SW, /'\/portal\/portal-app\.css'/);
  assert.match(SW, /const CACHE_NAME = 'th-portal-v7';/);
});
