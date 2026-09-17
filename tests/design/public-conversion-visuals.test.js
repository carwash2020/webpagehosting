// Public conversion visuals (2026-09-17 PR2): mobile chrome stacking,
// hero hierarchy, one primary CTA color, homepage conversion spine.
// Booking mobile summary behavior lives with the booking tests; this
// file locks the CSS/HTML contracts those changes depend on.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const BOOKING = fs.readFileSync(repo('booking.html'), 'utf8');
const COOKIE_JS = fs.readFileSync(repo('cookie-consent.js'), 'utf8');

test('documented mobile chrome stack keeps Call+Book and defers cookie off the hero', () => {
  assert.match(STYLES, /Public chrome stack/);
  assert.match(STYLES, /\.sticky-call\{[^}]*z-index:70/);
  assert.match(STYLES, /\.page-jump\{[^}]*z-index:50/);
  assert.match(STYLES, /^[\s]*\.cookie-banner\{[^}]*z-index:90/m);
  assert.match(STYLES, /body:has\(\.cookie-banner\) \.chat-bubble-btn/);
  assert.match(STYLES, /body:has\(\.cookie-banner\) \.back-to-top/);
  assert.match(STYLES, /@media \(max-width:760px\)\{\s*\.sticky-call\{display:flex;\}/);
});

test('cookie-consent.js defers the banner on ≤760px until scroll or timeout; desktop still shows immediately', () => {
  assert.match(COOKIE_JS, /HERO_DEFER_MS = 6000/);
  assert.match(COOKIE_JS, /max-width: 760px/);
  assert.match(COOKIE_JS, /scheduleBanner/);
  assert.match(COOKIE_JS, /addEventListener\('scroll'/);
  assert.match(COOKIE_JS, /setTimeout\(reveal, HERO_DEFER_MS\)/);
});

test('a real run: desktop (no 760px match) shows the cookie banner on DOMContentLoaded', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', {
    url: 'https://www.triplehenterprisesllc.biz/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.eval(COOKIE_JS);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.ok(window.document.getElementById('cookieConsentBanner'), 'desktop should show the banner immediately');
});

test('a real run: ≤760px does not show the cookie banner until the visitor scrolls', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', {
    url: 'https://www.triplehenterprisesllc.biz/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.matchMedia = (q) => ({
    matches: String(q).includes('760px'),
    addEventListener() {},
    removeEventListener() {},
  });
  Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  window.eval(COOKIE_JS);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.equal(window.document.getElementById('cookieConsentBanner'), null, 'must not cover the first hero paint');

  window.scrollY = 120;
  window.dispatchEvent(new window.Event('scroll'));
  assert.ok(window.document.getElementById('cookieConsentBanner'), 'scroll past the hero should reveal the banner');
});

test('mobile hero keeps the crest after the H1/CTAs and sizes it as a signature, not a billboard', () => {
  const live = STYLES.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(live, /\.hero-badge\{order:-1/);
  assert.match(STYLES, /\.hero-badge img\{width:96px;/);
  const heroStart = INDEX.indexOf('<section class="hero">');
  const heroEnd = INDEX.indexOf('</section>', heroStart);
  const hero = INDEX.slice(heroStart, heroEnd);
  const h1At = hero.indexOf('<h1>');
  const badgeAt = hero.indexOf('class="hero-badge"');
  const ctasAt = hero.indexOf('class="hero-ctas"');
  assert.ok(h1At > 0 && ctasAt > h1At && badgeAt > ctasAt, 'H1 then CTAs then badge in source order');
});

test('homepage conversion spine is additive: sticky page-jump (desktop) plus an in-flow Schedule rail', () => {
  assert.match(INDEX, /<nav class="page-jump" aria-label="On this page">/);
  assert.match(INDEX, /class="page-jump"[\s\S]*?href="\/booking\.html">Book<\/a>/);
  assert.match(INDEX, /<aside class="schedule-rail" aria-label="Book a visit">/);
  assert.match(INDEX, /class="schedule-rail"[\s\S]*?href="\/booking\.html"[\s\S]*?Book Instantly/);
  assert.match(STYLES, /\.page-jump\{/);
  assert.match(STYLES, /@media \(max-width:760px\)\{\s*\.page-jump\{display:none;\}/);
  assert.match(STYLES, /\.schedule-rail\{/);

  const servicesAt = INDEX.indexOf('id="services"');
  const railAt = INDEX.indexOf('class="schedule-rail"');
  const triageAt = INDEX.indexOf('id="triage"');
  assert.ok(servicesAt > 0 && railAt > servicesAt && railAt < triageAt, 'Schedule rail sits after Services, before triage');
});

test('#schedule Book Instantly stays the orange primary; Send Email stays the quiet secondary', () => {
  const start = INDEX.indexOf('<section id="schedule">');
  const end = INDEX.indexOf('</section>', start);
  const block = INDEX.slice(start, end);
  assert.match(block, /<a class="btn orange" href="\/booking\.html">/);
  assert.match(block, /class="cta-quiet-link" id="openEmailModal"/);
  assert.doesNotMatch(block, /class="btn orange" id="openEmailModal"/);
  assert.doesNotMatch(block, /class="btn blue"/);
});

test('booking.html keeps the desktop sidebar hidden at ≤960px and adds a compact mobile summary for steps 2–3', () => {
  assert.match(BOOKING, /\.booking-sidebar\{display:none;\}/);
  assert.match(BOOKING, /id="bookingMobileSummary"/);
  assert.match(BOOKING, /updateMobileSummary/);
  assert.match(BOOKING, /step >= 2 && step <= 3/);
  assert.match(BOOKING, /class="label-short">When<\/span>/);
  assert.match(BOOKING, /class="label-short">Info<\/span>/);
  assert.doesNotMatch(BOOKING, /@media \(max-width:600px\)\{\s*\.step-node \.label\{display:none;\}/);
});

test('/tools/ and /portal/ do not pick up the public conversion spine or sticky Call+Book bar', () => {
  for (const dir of ['tools', 'portal']) {
    for (const name of fs.readdirSync(repo(dir)).filter((f) => f.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(repo(dir), name), 'utf8');
      assert.doesNotMatch(src, /class="page-jump"/, `${dir}/${name}`);
      assert.doesNotMatch(src, /class="schedule-rail"/, `${dir}/${name}`);
    }
  }
});
