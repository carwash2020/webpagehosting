// Service × city landing page template (2026-09-18).
// First instance: washer / appliance repair in St. George.
// Clones: refrigerator and dishwasher in St. George (2026-09-18).
// Dryer-only was skipped: washer-dryer-repair-st-george-ut.html already
// covers both laundry appliances. City pages (`handyman-{city}-ut.html`)
// and service pages (`washer-dryer-repair.html`) already exist separately.
// Combined URL pattern: `{service-slug}-{city-slug}.html`.
//
// Keep this a real converting page, not a thin doorway clone: unique
// H1/title, St. George / Washington County copy, service-specific FAQs.
// See docs/service-city-landing-pages.md for how to clone it.
//
// AggregateRating is intentionally omitted (same rule as other
// city/service pages: rating markup only on index.html, which has the
// full wall). Visible copy still says the GBP-matched "5.0 from 7
// Google reviews". If a future clone adds aggregateRating, it must
// stay 5.0 / 7.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const PAGES = [
  {
    file: 'services/washer-dryer-repair-st-george-ut.html',
    title: 'Washer & Appliance Repair in St. George, UT | Triple H Enterprises',
    h1: 'Washer &amp; Appliance Repair in St. George',
    description: /<meta name="description" content="Washer and appliance repair in St\. George and Washington County\./,
    repairFaq: /repair this washer or replace/i,
    blogPost: '/blog/washer-wont-drain.html',
    heroQuote: /Steven was wonderful! Got our washer fixed quickly/,
    inboundLabel: /Washer &amp; Dryer Repair in St\. George/,
  },
  {
    file: 'services/refrigerator-repair-st-george-ut.html',
    title: 'Refrigerator Repair in St. George, UT | Triple H Enterprises',
    h1: 'Refrigerator Repair in St. George',
    description: /<meta name="description" content="Refrigerator repair in St\. George and Washington County\./,
    repairFaq: /repair this refrigerator or replace/i,
    blogPost: '/blog/fridge-not-cooling.html',
    heroQuote: /Had a few of my appliances fixed in no time/,
    inboundLabel: /Refrigerator repair in St\. George/,
  },
  {
    file: 'services/dishwasher-repair-st-george-ut.html',
    title: 'Dishwasher Repair in St. George, UT | Triple H Enterprises',
    h1: 'Dishwasher Repair in St. George',
    description: /<meta name="description" content="Dishwasher repair in St\. George and Washington County\./,
    repairFaq: /repair this dishwasher or replace/i,
    blogPost: '/blog/dishwasher-not-cleaning.html',
    heroQuote: /Had a few of my appliances fixed in no time/,
    inboundLabel: /Dishwasher repair in St\. George/,
  },
];

function jsonLdBlocks(src) {
  return [...src.matchAll(/<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/g)]
    .map((m) => JSON.parse(m[1]));
}

for (const page of PAGES) {
  const html = fs.readFileSync(repo(page.file), 'utf8');

  test(`${page.file}: live path, title, canonical, and H1 name this service in St. George`, () => {
    assert.equal(html.includes(`<title>${page.title}</title>`), true, 'title');
    assert.equal(html.includes(`<link rel="canonical" href="https://www.triplehenterprisesllc.biz/${page.file}">`), true, 'canonical');
    assert.equal(html.includes(`<h1>${page.h1}</h1>`), true, 'h1');
    assert.match(html, page.description);
  });

  test(`${page.file}: hero pairs Schedule (orange, booking.html) with Call (outline, real tel) and GBP-matched 5.0 / 7 proof`, () => {
    const end = html.indexOf('</section>', html.indexOf('<section class="hero">'));
    const hero = html.slice(html.indexOf('<section class="hero">'), end);
    assert.match(hero, /class="btn orange" href="\/booking\.html"/);
    assert.match(hero, /Schedule an appointment/);
    assert.match(hero, /class="btn outline js-phone-link" href="tel:\+14354141667"/);
    assert.match(hero, /5\.0 from 7 Google reviews/);
    assert.match(hero, page.heroQuote);
    assert.match(hero, /href="\/#reviews"/);
    assert.match(hero, /https:\/\/g\.page\/r\/CVJ0Qr-SsDkgEAI\/review/);
    assert.doesNotMatch(hero, /5\.0 from 4 Google reviews/);
  });

  test(`${page.file}: 3-step process, Steven owner-operated copy, and Washington County coverage`, () => {
    assert.equal((html.match(/class="process-num"/g) || []).length, 3);
    assert.match(html, /You talk to Steven/);
    assert.match(html, /Owner Operated/);
    assert.match(html, /Washington County/);
    assert.match(html, /Bloomington/);
    assert.match(html, /id="process"/);
  });

  test(`${page.file}: FAQs cover repair vs replace, trip fee, same-day, and warranty, and match FAQPage schema count`, () => {
    const faqs = jsonLdBlocks(html).find((d) => d['@type'] === 'FAQPage');
    assert.ok(faqs, 'expected FAQPage JSON-LD');
    const names = faqs.mainEntity.map((q) => q.name);
    assert.ok(names.some((n) => page.repairFaq.test(n)));
    assert.ok(names.some((n) => /trip fee/i.test(n)));
    assert.ok(names.some((n) => /same-day/i.test(n)));
    assert.ok(names.some((n) => /guarantee/i.test(n)));
    const visible = (html.match(/<details class="faq-plain-item">/g) || []).length;
    assert.equal(faqs.mainEntity.length, visible);
  });

  test(`${page.file}: Service JSON-LD targets St. George / Washington County; AggregateRating omitted, and if added later must stay 5.0 / 7`, () => {
    const blocks = jsonLdBlocks(html);
    const service = blocks.find((d) => d['@type'] === 'Service');
    assert.ok(service, 'expected Service JSON-LD');
    assert.equal(service.provider.address.postalCode, '84790');
    assert.ok(!service.provider.address.streetAddress, 'no public street address');
    const area = JSON.stringify(service.areaServed);
    assert.match(area, /St\. George/);
    assert.match(area, /Washington County/);

    for (const block of blocks) {
      if (block.aggregateRating) {
        assert.equal(block.aggregateRating.ratingValue, '5.0');
        assert.equal(String(block.aggregateRating.reviewCount), '7');
      }
    }
    assert.ok(
      blocks.every((b) => !('aggregateRating' in b)),
      'this template follows city/service pages: no aggregateRating without the homepage wall'
    );
    assert.doesNotMatch(html, /"@type":\s*"Review"/);
  });

  test(`${page.file}: links into booking, the parent service page, the St. George city page, nearby cities, and a matching blog post`, () => {
    assert.match(html, /href="\/booking\.html"/);
    assert.match(html, /href="\/services\/washer-dryer-repair\.html"/);
    assert.match(html, /href="\/locations\/handyman-st-george-ut\.html"/);
    assert.match(html, /href="\/locations\/handyman-hurricane-ut\.html"/);
    assert.match(html, /href="\/locations\/handyman-washington-city-ut\.html"/);
    assert.match(html, /href="\/blog\/appliance-repair-or-replace\.html"/);
    assert.equal(html.includes(`href="${page.blogPost}"`), true, 'matching blog post');
  });

  test(`${page.file}: sitemap lists the live path`, () => {
    const sitemap = fs.readFileSync(repo('sitemap.xml'), 'utf8');
    assert.equal(
      sitemap.includes(`<loc>https://www.triplehenterprisesllc.biz/${page.file}</loc>`),
      true,
      'sitemap loc'
    );
  });

  test(`${page.file}: parent service and city pages link into this instance`, () => {
    const service = fs.readFileSync(repo('services/washer-dryer-repair.html'), 'utf8');
    const city = fs.readFileSync(repo('locations/handyman-st-george-ut.html'), 'utf8');
    assert.equal(service.includes(`href="/${page.file}"`), true, 'parent service inbound href');
    assert.match(service, page.inboundLabel);
    assert.equal(city.includes(`href="/${page.file}"`), true, 'parent city inbound href');
  });
}
