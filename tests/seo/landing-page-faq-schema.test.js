// Tests for adding FAQPage schema (with matching real, visible content)
// to every landing page that was missing it (audit item #18). Only
// index.html carried FAQPage schema before this -- every service page,
// city page, about.html and our-work.html had none, and structured
// data must match visible content: adding schema with nothing on the
// page to back it would be exactly the kind of gap
// tests/content-quality/landing-page-social-proof.test.js already
// guards against for aggregateRating.
//
// The fix adds a condensed, real 5-question FAQ section (zero-JS
// <details>/<summary>, no accordion script needed) plus a matching
// FAQPage JSON-LD block naming exactly those 5 questions -- not the
// full 15-question set index.html has, and not duplicating its live
// Supabase fetch, since these 5 are evergreen policy answers, not
// live-editable per-page content. A "See all FAQs" link points at
// /#faq, a new hash-driven auto-open path added to index.html's own
// FAQ modal, the same pattern already proven for /#terms.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const PAGES_WITH_SCHEDULE = [
  'services/drywall-painting.html',
  'services/plumbing-repairs.html',
  'services/washer-dryer-repair.html',
  'services/washer-dryer-repair-st-george-ut.html',
  'services/refrigerator-repair-st-george-ut.html',
  'services/dishwasher-repair-st-george-ut.html',
  'services/assembly-installation.html',
  'services/handyman-repairs.html',
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-st-george-ut.html',
  'handyman-washington-city-ut.html',
];
const PAGES_WITHOUT_SCHEDULE = ['about.html', 'our-work.html'];
const ALL_PAGES = [...PAGES_WITH_SCHEDULE, ...PAGES_WITHOUT_SCHEDULE];

function read(name) {
  return fs.readFileSync(repo(name), 'utf8');
}

for (const name of ALL_PAGES) {
  test(`${name} has a local-faq section with at least 5 visible questions`, () => {
    const html = read(name);
    assert.match(html, /<section id="local-faq">/);
    const items = html.match(/<details class="faq-plain-item">/g) || [];
    assert.ok(items.length >= 5, `expected at least 5 FAQ items, found ${items.length}`);
  });

  test(`${name} has a FAQPage schema block naming exactly the same number of questions as are visible on the page`, () => {
    const html = read(name);
    // Captures just the JSON body in its own group, between the known
    // opening/closing <script> tags, rather than matching the whole
    // <script>...</script> block and then stripping the tags back out
    // with a second regex -- CodeQL flags that strip-then-parse pattern
    // as an incomplete HTML sanitizer (a single-pass tag-removal regex
    // can be defeated by overlapping/malformed markup), which doesn't
    // apply here since there's nothing to sanitize: capturing the JSON
    // directly out of a match against this file's own known-safe,
    // self-generated content sidesteps the concern entirely.
    const schemaMatch = html.match(/<script type="application\/ld\+json">\s*(\{\s*\n\s*"@context": "https:\/\/schema\.org",\s*\n\s*"@type": "FAQPage",[\s\S]*?)\n<\/script>/i);
    assert.ok(schemaMatch, 'expected to find a FAQPage JSON-LD block');
    const parsed = JSON.parse(schemaMatch[1].trim());
    assert.equal(parsed['@type'], 'FAQPage');
    const visibleCount = (html.match(/<details class="faq-plain-item">/g) || []).length;
    assert.equal(parsed.mainEntity.length, visibleCount, "schema question count must match the page's own visible FAQ items");
  });

  test(`${name}'s FAQ section links back to the full FAQ modal on the homepage`, () => {
    const html = read(name);
    assert.match(html, /<p class="blog-teaser-more"><a href="\/#faq">See all FAQs &rarr;<\/a><\/p>/);
  });

  test(`${name} exactly one local-faq section`, () => {
    const html = read(name);
    assert.equal((html.match(/<section id="local-faq">/g) || []).length, 1);
  });
}

for (const name of PAGES_WITH_SCHEDULE) {
  test(`${name}'s local-faq section sits inside <main>, after local-reviews and before schedule`, () => {
    const html = read(name);
    const mainIdx = html.indexOf('<main');
    const reviewsIdx = html.indexOf('<section id="local-reviews">');
    const faqIdx = html.indexOf('<section id="local-faq">');
    const scheduleIdx = html.indexOf('<section id="schedule">');
    const mainCloseIdx = html.indexOf('</main>');
    assert.ok(mainIdx !== -1 && reviewsIdx !== -1 && faqIdx !== -1 && scheduleIdx !== -1 && mainCloseIdx !== -1);
    assert.ok(mainIdx < reviewsIdx && reviewsIdx < faqIdx && faqIdx < scheduleIdx && scheduleIdx < mainCloseIdx);
  });
}

for (const name of PAGES_WITHOUT_SCHEDULE) {
  test(`${name}'s local-faq section sits inside <main>, after local-reviews, before it closes`, () => {
    const html = read(name);
    const reviewsIdx = html.indexOf('<section id="local-reviews">');
    const faqIdx = html.indexOf('<section id="local-faq">');
    const mainCloseIdx = html.indexOf('</main>');
    assert.ok(reviewsIdx !== -1 && faqIdx !== -1 && mainCloseIdx !== -1);
    assert.ok(reviewsIdx < faqIdx && faqIdx < mainCloseIdx);
  });
}

test('index.html captures setupSimpleModal(\'faqOverlay\', ...)\'s return value so /#faq can auto-open it, the same way /#terms already does', () => {
  const html = read('index.html');
  assert.match(html, /const faqModal = setupSimpleModal\('faqOverlay', 'faqClose', \['navFaqDesktop','navFaqMobile','navFaqFooter','intentFaqMore'\]\);/);
  assert.match(html, /if \(window\.location\.hash === '#faq' && faqModal\) \{\s*\n\s*faqModal\.open\(\);/);
});

test('index.html keeps the live-fetched FAQ modal and does not grow a landing-page local-faq section', () => {
  const html = read('index.html');
  assert.match(html, /<div class="modal-overlay" id="faqOverlay">/);
  assert.doesNotMatch(html, /<section id="local-faq">/);
});
