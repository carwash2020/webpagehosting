// Conversion polish after the homepage estimate form (#285) and the
// washer St. George LP (#286): sticky Call + Text + Book on those two
// pages, and a compact high-intent FAQ next to the homepage form.
// Does not invent fees, does not move Connor's hex-above-CTA stack,
// and does not touch AggregateRating (stays 5.0 / 7) or the 4-card wall.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const WASHER_LP = fs.readFileSync(repo('services/washer-dryer-repair-st-george-ut.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const BOOKING = fs.readFileSync(repo('booking.html'), 'utf8');

const SMS_HREF = 'sms:+14354141667?body=Hi%2C%20I%27m%20interested%20in%20a%20service%20from%20your%20website.';

function stickyNav(src) {
  const start = src.indexOf('<nav class="sticky-call');
  if (start < 0) return '';
  const end = src.indexOf('</nav>', start);
  return src.slice(start, end);
}

function heroHtml() {
  const start = INDEX.indexOf('<section class="hero">');
  const end = INDEX.indexOf('</section>', start);
  return INDEX.slice(start, end);
}

function intentFaq() {
  const start = INDEX.indexOf('id="intent-faq"');
  assert.ok(start > 0, 'expected #intent-faq');
  const from = INDEX.lastIndexOf('<div', start);
  const end = INDEX.indexOf('</div>', INDEX.indexOf('hero-intent-more', start)) + 6;
  return INDEX.slice(from, end);
}

function schemaOf(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]);
}

test('homepage and washer St. George LP sticky bars are Call + Text + Book, tel then sms then booking', () => {
  for (const [label, src] of [['homepage', INDEX], ['washer LP', WASHER_LP]]) {
    const bar = stickyNav(src);
    assert.match(bar, /class="sticky-call sticky-call-sms"/, `${label} missing .sticky-call-sms`);
    assert.match(bar, /aria-label="Call, text, or book"/, `${label} aria-label`);
    const callAt = bar.indexOf('href="tel:+14354141667"');
    const textAt = bar.indexOf(`href="${SMS_HREF}"`);
    const bookAt = bar.indexOf('href="/booking.html" class="btn orange"');
    assert.ok(callAt > 0 && textAt > callAt && bookAt > textAt, `${label}: Call, then Text, then Book`);
    assert.match(bar, /class="btn outline js-phone-link"/, `${label} Call stays outline`);
    // js-sms-link (2026-09-24) is the hook that points it at the saved number.
    assert.match(bar, /class="btn outline js-sms-link">\s*<svg[\s\S]*?<\/svg>\s*Text/, `${label} Text stays outline`);
    assert.match(bar, /class="btn orange"/, `${label} Book stays filled orange`);
  }
});

test('sticky Text reuses the chat-bubble sms body; booking.html stays Call + Book', () => {
  assert.match(INDEX, /id="chatTextBtn" href="sms:\+14354141667\?body=Hi%2C%20I%27m%20interested%20in%20a%20service%20from%20your%20website\."/);
  const bookingBar = stickyNav(BOOKING);
  assert.match(bookingBar, /aria-label="Call or book"/);
  assert.doesNotMatch(bookingBar, /href="sms:/);
  assert.doesNotMatch(bookingBar, /sticky-call-sms/);
});

test('three-action bar keeps 44px targets and the 760px hide-on-desktop breakpoint', () => {
  assert.match(STYLES, /\.sticky-call-sms\{gap:8px;\}/);
  assert.match(STYLES, /\.sticky-call-sms \.btn\{[^}]*min-height:44px|[\s\S]*?\.sticky-call \.btn\{[^}]*min-height:44px/);
  assert.match(STYLES, /\.sticky-call \.btn\{[^}]*min-height:44px/);
  assert.match(STYLES, /@media \(max-width:760px\)\{\s*\.sticky-call\{display:flex;\}/);
  assert.match(STYLES, /body:has\(\.sticky-call\)\{\s*padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom/);
});

test('homepage compact FAQ sits after the estimate form, still in the hero, with no CSS order', () => {
  const hero = heroHtml();
  const formAt = hero.indexOf('id="heroLeadForm"');
  const faqAt = hero.indexOf('id="intent-faq"');
  const badgeAt = hero.indexOf('class="hero-badge"');
  const proofAt = hero.indexOf('class="cta-proof"');
  assert.ok(formAt > 0 && faqAt > formAt && proofAt > faqAt && badgeAt > proofAt, 'FAQ after form, before proof/badge, still in the hero');
  assert.doesNotMatch(STYLES, /\.hero-intent-faq\{[^}]*\border\s*:/);
  assert.doesNotMatch(INDEX, /<section id="local-faq">/);
});

test('compact FAQ covers trip fee, same-day, warranty, repair-vs-replace, and payment using existing site copy', () => {
  const block = intentFaq();
  assert.match(block, /<summary>Is there a trip fee\?<\/summary>/);
  assert.match(block, /Jobs within 15 miles have no trip fee\. Beyond 15 miles, a \$25 trip fee is added to the total\./);
  assert.match(block, /<summary>Do you offer emergency or same-day service\?<\/summary>/);
  assert.match(block, /Yes, for things that can't wait, like an active leak or a fridge that's failed\./);
  assert.match(block, /<summary>Do you guarantee your work\?<\/summary>/);
  assert.match(block, /Yes, work is guaranteed\. Parts used are covered under whatever warranty the manufacturer sets/);
  assert.match(block, /<summary>Should I repair this washer or replace it\?<\/summary>/);
  assert.match(block, /We'd rather send you to buy a new unit than talk you into a repair that doesn't make sense\./);
  assert.match(block, /<summary>What payment methods do you accept\?<\/summary>/);
  assert.match(block, /Cash, check, Venmo, and Cash App are all accepted/);
  assert.equal((block.match(/<details class="faq-plain-item">/g) || []).length, 5);
  assert.match(block, /href="#faq" id="intentFaqMore">See all FAQs</);
  assert.match(INDEX, /setupSimpleModal\('faqOverlay', 'faqClose', \['navFaqDesktop','navFaqMobile','navFaqFooter','intentFaqMore'\]\)/);
});

test('repair-vs-replace and trip-fee wording is copied from existing FAQ pages, not invented', () => {
  assert.match(WASHER_LP, /Should I repair this washer or replace it\?/);
  assert.match(WASHER_LP, /We'd rather send you to buy a new unit than talk you into a repair that doesn't make sense\./);
  assert.match(INDEX, /id="faqList"[\s\S]*Is there a trip fee\?[\s\S]*Jobs within 15 miles have no trip fee/);
});

test('mobile still puts the hex crest above Schedule\/Call; the FAQ does not jump the stack', () => {
  const live = STYLES.replace(/\/\*[\s\S]*?\*\//g, '');
  const desktopChunk = live.split('@media (max-width:860px)')[0];
  assert.doesNotMatch(desktopChunk, /\.hero-badge\{[^}]*order:-1/, 'global order:-1 would swap desktop columns');
  assert.match(live, /@media \(max-width:860px\)\{[\s\S]*?\.hero-badge\{[^}]*order:-1/);
  assert.doesNotMatch(STYLES, /\.hero-intent-faq\{[^}]*\border\s*:/);
});

test('AggregateRating stays 5.0 / 7; wall stays 4 written cards; compact FAQ is not a second FAQPage', () => {
  const schema = schemaOf(INDEX);
  assert.equal(schema.aggregateRating.ratingValue, '5.0');
  assert.equal(Number(schema.aggregateRating.reviewCount), 7);
  assert.equal((INDEX.match(/class="review-card"/g) || []).length, 4);
  const faqSchemas = [...INDEX.matchAll(/"@type": "FAQPage"/g)];
  assert.equal(faqSchemas.length, 1, 'do not add a second FAQPage for the compact block');
});
