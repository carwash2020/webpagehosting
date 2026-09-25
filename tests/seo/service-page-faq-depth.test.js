// Content-depth guard for the 5 service pages (2026-09-25).
//
// Before this pass, the schema-paired "Frequently Asked Questions"
// block on plumbing, drywall, handyman and assembly held the same 5
// site-wide policy answers, word for word, on every page (and on the
// homepage). So those pages' FAQPage JSON-LD said nothing about the
// service itself. Each page's "Common Questions" block also ended with
// the same generic "How is pricing handled?", which repeated the
// estimates answer a few sections further down the same page.
//
// The fix gives every service page at least one schema question that no
// other service page has, drawn from the site's own blog posts. It
// replaces the repeated pricing entry with service-specific questions
// and adds the cancellation policy, which none of the service pages
// stated. These tests keep it that way. They also check the
// visible text and the schema text match exactly, not just by count
// (landing-page-faq-schema.test.js only compares counts).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const SERVICE_PAGES = [
  'services/washer-dryer-repair.html',
  'services/plumbing-repairs.html',
  'services/drywall-painting.html',
  'services/handyman-repairs.html',
  'services/assembly-installation.html',
];

const TRIP_FEE_SENTENCE = 'Jobs within 15 miles have no trip fee. Beyond 15 miles, a $25 trip fee is added to the total.';

function read(name) {
  return fs.readFileSync(repo(name), 'utf8');
}

function decode(s) {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function schemaFaq(html) {
  const m = html.match(/<script type="application\/ld\+json">\s*(\{\s*\n\s*"@context": "https:\/\/schema\.org",\s*\n\s*"@type": "FAQPage",[\s\S]*?)\n<\/script>/);
  assert.ok(m, 'expected a FAQPage JSON-LD block');
  return JSON.parse(m[1]).mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }));
}

function visibleFaq(html) {
  const section = html.match(/<section id="local-faq">([\s\S]*?)<\/section>/);
  assert.ok(section, 'expected a local-faq section');
  return [...section[1].matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)]
    .map((m) => ({ q: decode(m[1]), a: decode(m[2]) }));
}

function commonQuestions(html) {
  const block = html.match(/<h2>Common Questions<\/h2>([\s\S]*?)<\/section>/);
  assert.ok(block, 'expected a Common Questions block');
  return [...block[1].matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => decode(m[1]).trim());
}

const schemaByPage = Object.fromEntries(SERVICE_PAGES.map((p) => [p, schemaFaq(read(p))]));

for (const page of SERVICE_PAGES) {
  test(`${page}: FAQPage schema questions and answers match the visible FAQ text exactly, in order`, () => {
    assert.deepEqual(schemaByPage[page], visibleFaq(read(page)));
  });

  test(`${page}: at least one schema question is specific to this page, not shared with another service page`, () => {
    const others = new Set(SERVICE_PAGES.filter((p) => p !== page).flatMap((p) => schemaByPage[p].map((e) => e.q)));
    const own = schemaByPage[page].filter((e) => !others.has(e.q));
    assert.ok(own.length >= 1, 'every schema question on this page also appears on another service page');
  });

  test(`${page}: states the same-day cancellation fee the Terms state`, () => {
    const terms = read('terms.html');
    assert.match(terms, /A \$50 cancellation fee may apply if an appointment is cancelled the same day as the scheduled service\./);
    const entry = schemaByPage[page].find((e) => e.q === "What's your cancellation policy?");
    assert.ok(entry, 'expected a cancellation-policy question');
    assert.match(entry.a, /A \$50 cancellation fee may apply if a scheduled visit is cancelled the same day as the appointment\./);
  });

  test(`${page}: trip-fee answer keeps the site-wide policy sentence verbatim`, () => {
    const entry = schemaByPage[page].find((e) => e.q === 'Is there a trip fee?');
    assert.ok(entry, 'expected a trip-fee question');
    assert.ok(entry.a.startsWith(TRIP_FEE_SENTENCE), entry.a);
  });

  test(`${page}: has at least 4 Common Questions`, () => {
    assert.ok(commonQuestions(read(page)).length >= 4);
  });
}

test('no Common Questions entry is copy-pasted across service pages', () => {
  const seen = new Map();
  for (const page of SERVICE_PAGES) {
    for (const q of commonQuestions(read(page))) {
      assert.ok(!seen.has(q), `"${q}" appears on both ${seen.get(q)} and ${page}`);
      seen.set(q, page);
    }
  }
});

test('assembly-installation links both blog posts that cover its work: TV mounting and TV wire management', () => {
  const html = read('services/assembly-installation.html');
  assert.ok(html.includes('<a class="blog-index-item" href="/blog/tv-mount-drywall-anchors.html"'));
  assert.ok(html.includes('<a class="blog-index-item" href="/blog/handyman-to-do-list.html"'));
  // The linked post really does cover wire management; don't keep the link if that section goes away.
  assert.match(read('blog/handyman-to-do-list.html'), /Wire management behind the TV/);
});

test('plumbing-repairs links the flapper post and the dishwasher-drain post, whose sink-drain section is plumbing work', () => {
  const html = read('services/plumbing-repairs.html');
  assert.ok(html.includes('<a class="blog-index-item" href="/blog/toilet-running-flapper-valve.html"'));
  assert.ok(html.includes('<a class="blog-index-item" href="/blog/dishwasher-not-draining.html"'));
  // The reason for the link: the post's disposal / sink-drain section, which routes readers to plumbing.
  const post = read('blog/dishwasher-not-draining.html');
  assert.match(post, /A newly installed garbage disposal/);
  assert.match(post, /href="\/services\/plumbing-repairs\.html"/);
});
