// SEO/data-consistency audit (2026-09-07), phase 3 of this session's
// ongoing improvement pass:
//   - The public JSON-LD's postal code (84770) drifted from the real
//     one used internally for actual contracts/invoices (84790,
//     tools/contract-generator.html + tools/workspace.html). No
//     street address is ever exposed publicly (this is a mobile
//     business run from a home address, deliberately kept private) --
//     only the ZIP, which was simply wrong. Corrected to match.
//   - Each of the 5 city landing pages carried a 5.0-star/7-review
//     aggregateRating copied from the homepage, but none of those
//     pages show any review content themselves -- a real violation of
//     schema.org/Google's guideline that review markup must reflect
//     visible on-page content. Removed from the 5 landing pages;
//     index.html keeps it, since that's the one page with the actual
//     7-review carousel backing it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const LANDING_PAGES = [
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-washington-city-ut.html',
];

function extractJsonLd(html) {
  const m = html.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/);
  assert.ok(m, 'expected to find a JSON-LD script block');
  return JSON.parse(m[1]);
}

test('index.html: postal code matches the real one used internally for contracts, and it keeps its real aggregateRating', () => {
  const html = fs.readFileSync(repo('index.html'), 'utf8');
  const data = extractJsonLd(html);
  assert.equal(data.address.postalCode, '84790');
  assert.ok(!data.address.streetAddress, 'no street address should ever be exposed publicly');
  assert.deepEqual(data.aggregateRating, { '@type': 'AggregateRating', ratingValue: '5.0', reviewCount: '7' });
});

for (const page of LANDING_PAGES) {
  test(`${page}: postal code corrected, no street address, and no aggregateRating claim without visible review content`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    const data = extractJsonLd(html);
    assert.equal(data.address.postalCode, '84790');
    assert.ok(!data.address.streetAddress, 'no street address should ever be exposed publicly');
    assert.ok(!('aggregateRating' in data), `${page} should not claim a rating it has no visible reviews to back`);
  });
}

test('the real internal contract/invoice address (used for actual paperwork, not public SEO) is untouched and still 84790', () => {
  const contractGen = fs.readFileSync(repo('tools', 'contract-generator.html'), 'utf8');
  const workspace = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
  assert.match(contractGen, /124 N 2750 E, St\. George, UT 84790/);
  assert.match(workspace, /124 N 2750 E, St\. George, UT 84790/);
});
