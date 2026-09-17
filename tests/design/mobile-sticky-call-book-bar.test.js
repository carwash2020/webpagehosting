// Conversion UX (2026-09-17): a persistent mobile Call + Book bar, and
// a hero CTA swap so Schedule/Book is the filled primary and Call is
// the outline secondary. Locks the destinations, the 760px hide-on-
// desktop breakpoint already used by back-to-top/chat, safe-area
// padding so last content isn't covered, and the cookie/chat/back-to-
// top lift so those don't sit on the bar.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');

const MARKETING_PAGES = [
  'index.html',
  'assembly-installation.html',
  'drywall-painting.html',
  'plumbing-repairs.html',
  'washer-dryer-repair.html',
  'handyman-repairs.html',
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-st-george-ut.html',
  'handyman-washington-city-ut.html',
  'our-work.html',
  'about.html',
  'blog/index.html',
];

const HERO_PAGES = MARKETING_PAGES.filter((f) =>
  !['our-work.html', 'about.html', 'blog/index.html'].includes(f)
);

test('the sticky bar is a two-action Call + Book nav, hidden above 760px', () => {
  const rule = STYLES.match(/\.sticky-call\{([^}]*)\}/)[1];
  assert.match(rule, /display:none/);
  assert.match(rule, /position:fixed/);
  assert.match(rule, /bottom:0/);
  assert.match(rule, /env\(safe-area-inset-bottom/);
  assert.match(STYLES, /@media \(max-width:760px\)\{\s*\.sticky-call\{display:flex;\}/);
});

test('pages with the bar get bottom padding and lift cookie/chat/back-to-top; pages without it do not', () => {
  assert.match(STYLES, /body:has\(\.sticky-call\)\{\s*padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom/);
  assert.match(STYLES, /body:has\(\.sticky-call\) \.cookie-banner\{/);
  assert.match(STYLES, /body:has\(\.sticky-call\) \.back-to-top\{/);
  assert.match(STYLES, /body:has\(\.sticky-call\) \.chat-bubble-btn\{/);
  assert.doesNotMatch(STYLES, /@media \(max-width:760px\)\{\s*body\{padding-bottom:70px;\}/);
});

test('sticky bar entrance animation is gated on prefers-reduced-motion: no-preference', () => {
  assert.match(STYLES, /@media \(prefers-reduced-motion: no-preference\)\{\s*\.sticky-call\{animation:stickyCallIn/);
});

test('.btn.outline is a transparent orange-border sibling, not a second filled primary', () => {
  const rule = STYLES.match(/\.btn\.outline\{([^}]*)\}/)[1];
  assert.match(rule, /background:transparent/);
  assert.match(rule, /border:1\.5px solid var\(--orange-tint-border\)/);
  assert.doesNotMatch(rule, /linear-gradient/);
});

function stickyNav(src) {
  const start = src.indexOf('<nav class="sticky-call"');
  if (start < 0) return '';
  const end = src.indexOf('</nav>', start);
  return src.slice(start, end);
}

test('every public marketing page that shares the nav CTAs carries the sticky Call + Book bar', () => {
  for (const file of MARKETING_PAGES) {
    const src = fs.readFileSync(repo(file), 'utf8');
    const bar = stickyNav(src);
    assert.match(bar, /<nav class="sticky-call" aria-label="Call or book">/, `${file} missing sticky bar`);
    assert.match(bar, /href="tel:\+14354141667" class="btn outline js-phone-link"/, `${file} sticky Call missing tel link`);
    assert.match(bar, /class="btn orange"/, `${file} missing a filled Book button`);
  }
});

test('sticky Book goes to /booking.html on every public marketing page that carries the bar', () => {
  for (const file of MARKETING_PAGES) {
    const src = fs.readFileSync(repo(file), 'utf8');
    assert.match(stickyNav(src), /href="\/booking\.html" class="btn orange"/, `${file} sticky Book should go to /booking.html`);
  }
});

test('homepage hero: Schedule is the filled primary and Call keeps the phone number as the outline secondary', () => {
  const start = INDEX.indexOf('<div class="hero-ctas">');
  const end = INDEX.indexOf('</div>', start);
  const block = INDEX.slice(start, end);
  assert.match(block, /href="\/booking\.html" class="btn orange"/);
  assert.match(block, /Schedule an appointment/);
  assert.match(block, /class="btn outline js-phone-link"/);
  assert.match(block, /Call <span class="js-phone-text">\(435\) 414-1667<\/span>/);
  const scheduleAt = block.indexOf('class="btn orange"');
  const callAt = block.indexOf('class="btn outline js-phone-link"');
  assert.ok(scheduleAt >= 0 && callAt > scheduleAt, 'Schedule/Book should come before Call in the homepage hero');
});

test('city and service page heroes use the same Schedule-primary / Call-outline pairing', () => {
  for (const file of HERO_PAGES) {
    if (file === 'index.html') continue;
    const src = fs.readFileSync(repo(file), 'utf8');
    const start = src.indexOf('<div class="hero-ctas">');
    assert.ok(start >= 0, `${file} missing .hero-ctas`);
    const end = src.indexOf('</div>', start);
    const block = src.slice(start, end);
    assert.match(block, /class="btn orange" href="\/booking\.html"/, `${file} hero Book`);
    assert.match(block, /Schedule an appointment/, `${file} hero copy`);
    assert.match(block, /class="btn outline js-phone-link" href="tel:\+14354141667"/, `${file} hero Call`);
    assert.match(block, /js-phone-text">\(435\) 414-1667/, `${file} must keep the phone number in the hero`);
  }
});

test('/tools/ and /portal/ pages do not pick up the public sticky conversion bar', () => {
  const toolsDir = repo('tools');
  const portalDir = repo('portal');
  for (const dir of [toolsDir, portalDir]) {
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
      const src = fs.readFileSync(path.join(dir, name), 'utf8');
      assert.doesNotMatch(src, /class="sticky-call"/, `${path.basename(dir)}/${name} should not have the public sticky bar`);
    }
  }
});
