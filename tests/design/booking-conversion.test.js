// Booking conversion pass (2026-09-17): sticky mobile Call + Book on
// booking.html (it was left off the marketing-page bar on purpose in
// #265), held-slot success copy, $25 referral credit on the flow and
// confirmation, and Service/ReserveAction JSON-LD. AggregateRating
// lives on index.html only (5.0 / 7, matching Google Business Profile).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const BOOKING = fs.readFileSync(repo('booking.html'), 'utf8');
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');

function stickyNav(src) {
  const start = src.indexOf('<nav class="sticky-call"');
  if (start < 0) return '';
  const end = src.indexOf('</nav>', start);
  return src.slice(start, end);
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/g)]
    .map((m) => JSON.parse(m[1]));
}

test('booking.html has the same sticky Call + Book bar pattern as the homepage', () => {
  const bar = stickyNav(BOOKING);
  assert.match(bar, /<nav class="sticky-call" aria-label="Call or book">/);
  assert.match(bar, /href="tel:\+14354141667" class="btn outline js-phone-link"/);
  assert.match(bar, /id="stickyBook"/);
  assert.match(bar, />\s*Book\s*</);
  assert.match(BOOKING, /\.sticky-call\{[^}]*display:none/);
  assert.match(BOOKING, /@media \(max-width:760px\)\{\s*\.sticky-call\{display:flex;\}/);
  assert.match(BOOKING, /body:has\(\.sticky-call\)\{\s*padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom/);
});

test('sticky Book on booking.html does not reload the live form; after confirm it starts a fresh booking', () => {
  const bar = stickyNav(BOOKING);
  assert.match(bar, /href="#stepService" class="btn orange" id="stickyBook"/);
  assert.doesNotMatch(bar, /href="\/booking\.html" class="btn orange"/);
  assert.match(BOOKING, /stickyBook\.setAttribute\('href', step >= 4 \? '\/booking\.html' : '#stepService'\)/);
});

test('index.html AggregateRating is 5.0 from 7 Google reviews; booking.html JSON-LD never claims a rating', () => {
  const indexLd = jsonLdBlocks(INDEX);
  const localBiz = indexLd.find((b) => b.aggregateRating);
  assert.ok(localBiz, 'homepage must keep AggregateRating');
  assert.deepEqual(localBiz.aggregateRating, {
    '@type': 'AggregateRating',
    ratingValue: '5.0',
    reviewCount: '7',
  });

  for (const block of jsonLdBlocks(BOOKING)) {
    assert.ok(!('aggregateRating' in block), 'booking.html must not carry AggregateRating');
    const asText = JSON.stringify(block);
    assert.doesNotMatch(asText, /"ratingValue"/);
    assert.doesNotMatch(asText, /"reviewCount"/);
  }
});

test('booking.html has Service + ReserveAction JSON-LD and breadcrumbs, with the real NAP and no street address', () => {
  const blocks = jsonLdBlocks(BOOKING);
  const service = blocks.find((b) => b['@type'] === 'Service');
  assert.ok(service, 'expected a Service JSON-LD block');
  assert.equal(service.url, 'https://www.triplehenterprisesllc.biz/booking.html');
  assert.equal(service.provider['@type'], 'HomeAndConstructionBusiness');
  assert.equal(service.provider.name, 'Triple H Enterprises');
  assert.equal(service.provider.telephone, '+14354141667');
  assert.equal(service.provider.address.postalCode, '84790');
  assert.ok(!service.provider.address.streetAddress, 'no street address should be exposed publicly');
  assert.equal(service.potentialAction['@type'], 'ReserveAction');
  assert.equal(
    service.potentialAction.target.urlTemplate,
    'https://www.triplehenterprisesllc.biz/booking.html'
  );

  const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
  assert.ok(crumbs, 'expected BreadcrumbList JSON-LD');
  assert.equal(crumbs.itemListElement[1].item, 'https://www.triplehenterprisesllc.biz/booking.html');
});
