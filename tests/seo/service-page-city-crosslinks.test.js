// Tests for real, keyword-rich internal links from each service page to
// every city landing page (lead-gen improvement: "service x city"
// long-tail searches like "dishwasher repair Hurricane UT" previously had
// no on-page anchor text targeting that combination -- only generic city
// names in the nav dropdown/footer, which carry no service context).
//
// Deliberately NOT 42 separate near-duplicate pages (a doorway-page
// anti-pattern) -- instead each of the 5 service pages gets a real
// .areas-links block (the same component/CSS the homepage's #areas
// section already uses) with the service name baked into each link's
// visible text, reusing the exact same per-city distance notes already
// used elsewhere on the site for consistency.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const SERVICE_PAGES = {
  'services/assembly-installation.html': 'Assembly &amp; Installation',
  'services/drywall-painting.html': 'Drywall &amp; Painting',
  'services/plumbing-repairs.html': 'Plumbing Repairs',
  'services/washer-dryer-repair.html': 'Washer &amp; Dryer Repair',
  'services/handyman-repairs.html': 'Handyman Repairs',
};

const CITIES = [
  { file: 'locations/handyman-washington-city-ut.html', name: 'Washington City', requestClass: false },
  { file: 'locations/handyman-hurricane-ut.html', name: 'Hurricane', requestClass: false },
  { file: 'locations/handyman-santa-clara-ivins-ut.html', name: 'Santa Clara &amp; Ivins', requestClass: false },
  { file: 'locations/handyman-leeds-ut.html', name: 'Leeds', requestClass: false },
  { file: 'locations/handyman-la-verkin-ut.html', name: 'La Verkin', requestClass: false },
  { file: 'locations/handyman-cedar-city-ut.html', name: 'Cedar City', requestClass: true },
  { file: 'locations/handyman-mesquite-nv.html', name: 'Mesquite, NV', requestClass: true },
];

const WASHER_ST_GEORGE = {
  file: 'services/washer-dryer-repair-st-george-ut.html',
  name: 'St. George',
  requestClass: false,
};

function citiesFor(page) {
  if (page === 'services/washer-dryer-repair.html') return [WASHER_ST_GEORGE, ...CITIES];
  return CITIES;
}

for (const [page, serviceName] of Object.entries(SERVICE_PAGES)) {
  test(`${page} has a real areas-links block cross-linking to every city page, with the service name in each link's text`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    const idx = html.indexOf('<div class="areas-links" data-reveal>');
    assert.ok(idx !== -1, `${page} should have an areas-links block`);
    const block = html.slice(idx, idx + 2500);

    for (const city of citiesFor(page)) {
      const classAttr = city.requestClass ? 'class="areas-link is-request"' : 'class="areas-link"';
      const re = new RegExp(
        `<a ${classAttr.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[^>]*href="/${city.file}">\\s*<b>${serviceName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')} in ${city.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}</b>`
      );
      assert.match(block, re, `${page} should link to ${city.file} with "${serviceName.replace(/&amp;/, '&')} in ${city.name.replace(/&amp;/, '&')}" anchor text`);
    }
  });
}

test('every service page cross-links to all 7 cities, not a partial subset', () => {
  for (const page of Object.keys(SERVICE_PAGES)) {
    const html = fs.readFileSync(repo(page), 'utf8');
    const idx = html.indexOf('<div class="areas-links" data-reveal>');
    const block = html.slice(idx, idx + 2500);
    const linkCount = (block.match(/<a class="areas-link/g) || []).length;
    const expected = page === 'services/washer-dryer-repair.html' ? 8 : 7;
    assert.equal(linkCount, expected, `${page} should have exactly ${expected} areas-link entries`);
  }
});
