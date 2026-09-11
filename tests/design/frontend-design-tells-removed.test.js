// Removes 3 patterns the Anthropic frontend-design skill's own checklist
// names as the commonest AI-generated-design tells (2026-09-07): a
// tracked-out ALL-CAPS "eyebrow" label above nearly every heading (11
// instances on index.html alone, plus 2-3 per city landing page and
// terms.html), a single word/phrase in a headline set in a different
// color (the hero's "DONE RIGHT."), and middle-dot-joined meta strings.
//
// This wasn't a blanket delete-everything pass: genuinely redundant
// eyebrows (restating the h2 right below them) were removed outright;
// real, non-redundant information (the hero's location; each city
// page's real "serving X" / "available by request" coverage status)
// was either folded into real prose or given an actual status-UI
// treatment -- a new .coverage-badge pill that reuses the exact same
// dot+pill idiom this site already uses for its live open/closed
// status, rather than inventing a new visual language or deleting real
// facts to chase the checklist.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const TERMS = fs.readFileSync(repo('terms.html'), 'utf8');
const BOOKING = fs.readFileSync(repo('booking.html'), 'utf8');

const CITY_PAGES = {
  'handyman-cedar-city-ut.html': { variant: 'is-by-request', text: 'Available by request' },
  'handyman-hurricane-ut.html': { variant: 'is-standard', text: 'Serving Hurricane' },
  'handyman-mesquite-nv.html': { variant: 'is-by-request', text: 'Available by request' },
  'handyman-santa-clara-ivins-ut.html': { variant: 'is-standard', text: 'Serving Santa Clara & Ivins' },
  'handyman-washington-city-ut.html': { variant: 'is-standard', text: 'Serving Washington City' },
  'handyman-la-verkin-ut.html': { variant: 'is-standard', text: 'Serving La Verkin' },
  'handyman-leeds-ut.html': { variant: 'is-standard', text: 'Serving Leeds' },
};

test('no marketing page carries the generic ALL-CAPS eyebrow label anymore', () => {
  assert.doesNotMatch(INDEX, /class="eyebrow/);
  assert.doesNotMatch(TERMS, /class="eyebrow/);
  for (const file of Object.keys(CITY_PAGES)) {
    const html = fs.readFileSync(repo(file), 'utf8');
    assert.doesNotMatch(html, /class="eyebrow/, `${file} should not carry an .eyebrow label`);
  }
});

test('booking.html keeps its own local, page-scoped .eyebrow -- a functional sidebar section label, not a marketing kicker', () => {
  // Different job: labels a real checklist ("Service", "Date & time"),
  // not a decorative tag floating above a marketing headline, so it's
  // out of scope for this pass.
  assert.match(BOOKING, /<p class="eyebrow">Your Appointment<\/p>/);
  assert.match(BOOKING, /\.eyebrow\{/, 'expected booking.html to keep its own local .eyebrow CSS');
});

test('the shared .eyebrow/.accent CSS is fully retired from styles.css', () => {
  assert.doesNotMatch(STYLES, /^\s*\.eyebrow\{/m);
  assert.doesNotMatch(STYLES, /\.eyebrow\.is-blue/);
  assert.doesNotMatch(STYLES, /\.eyebrow\.is-orange/);
  assert.doesNotMatch(STYLES, /\.hero \.eyebrow/);
  assert.doesNotMatch(STYLES, /\.hero h1 \.accent/);
  assert.doesNotMatch(INDEX, /class="accent"/);
});

test('the hero headline is no longer split into two colors -- one clean sentence, no single-word accent', () => {
  assert.match(INDEX, /<h1>HANDYMAN AND APPLIANCE REPAIR, DONE RIGHT\.<\/h1>/);
});

test('the hero location is real prose now, not a floating label -- no information was dropped', () => {
  assert.match(INDEX, /<p class="lede">Serving St\. George and Southern Utah, Triple H Enterprises fixes what's broken/);
});

test('the "WHAT WE FIX" eyebrow and the weaker "Services" h2 were merged into one real heading', () => {
  assert.doesNotMatch(INDEX, />Services<\/h2>/);
  assert.match(INDEX, /<h2>What we fix<\/h2>/);
});

test('review attribution reads as a natural phrase, not a middle-dot-joined tag', () => {
  assert.doesNotMatch(INDEX, /Verified Customer<\/strong> &middot;/);
  const count = (INDEX.match(/<strong>Verified Customer<\/strong> on Google<\/p>/g) || []).length;
  assert.equal(count, 7, 'expected all 7 review-meta lines to use the same natural phrasing');
});

test('the footer LLC line reads as real sentences, not a middle-dot-joined tag', () => {
  assert.doesNotMatch(INDEX, /limited liability company &middot;/);
  assert.match(INDEX, /A registered Utah limited liability company\. Reliable Service\. Quality Work\. Done Right\./);
});

test('the teardown section keeps its shop-drawing draft-line device -- moved onto the real heading, not deleted along with the eyebrow it used to hang off of', () => {
  assert.doesNotMatch(STYLES, /\.teardown-copy \.eyebrow/);
  assert.match(STYLES, /\.teardown-copy h2\{[^}]*position:relative;[^}]*padding-top:18px;/s);
  assert.match(STYLES, /\.teardown-copy h2::before\{/);
});

test('each city landing page carries a real .coverage-badge with the correct standard/by-request variant and dot', () => {
  for (const [file, expected] of Object.entries(CITY_PAGES)) {
    const html = fs.readFileSync(repo(file), 'utf8');
    const re = new RegExp(`<p class="coverage-badge ${expected.variant}"><span class="dot"></span>${expected.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p>`);
    assert.match(html, re, `${file} should carry the expected coverage badge`);
  }
});

test('.coverage-badge reuses the exact same dot+pill idiom as the existing live open/closed status, not a new visual language', () => {
  const badgeBody = STYLES.match(/\.coverage-badge\{([^}]*)\}/)[1];
  const openStatusBody = STYLES.match(/\.open-status\{([^}]*)\}/)[1];
  const strip = (s) => s.replace(/margin-(top|bottom):[^;]+;/, '').replace(/\s+/g, '');
  assert.equal(strip(badgeBody), strip(openStatusBody), 'expected .coverage-badge and .open-status to share the same pill treatment');
  assert.match(STYLES, /\.coverage-badge \.dot\{[\s\S]{0,80}border-radius:50%;/);
  assert.match(STYLES, /\.coverage-badge\.is-standard \.dot\{background:var\(--blue\)/);
  assert.match(STYLES, /\.coverage-badge\.is-by-request \.dot\{background:var\(--orange\)/);
});

test('the tools and portal service worker caches were bumped for the shared styles.css change', () => {
  const toolsSw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const portalSw = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');
  const toolsVersion = Number(toolsSw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  const portalVersion = Number(portalSw.match(/const CACHE_NAME = 'th-portal-v(\d+)';/)[1]);
  assert.ok(toolsVersion >= 79, `expected tools service worker v79 or later, got v${toolsVersion}`);
  assert.ok(portalVersion >= 36, `expected portal service worker v36 or later, got v${portalVersion}`);
});
