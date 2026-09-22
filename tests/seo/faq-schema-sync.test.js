// Closes a real audit gap: the visible FAQ accordion on index.html is
// fetched live from Supabase's site_faq table (editable via Dev Tools'
// CMS), but the FAQPage JSON-LD in <head> -- what Google actually
// indexes for the FAQ rich result -- stayed a static, hardcoded snapshot
// regardless. An FAQ edited through the CMS would update what a visitor
// sees but not what search results show, risking a mismatch flag under
// Google's FAQ rich-result guidelines (structured data must match
// visible content). Fixed by rebuilding the schema from the exact same
// `rows` the visible accordion renders from, in the same fetch handler
// -- not a second, independently-fetched copy that could itself drift.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');

function loadWithFaqRows(faqRows) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  // beforeParse (not a post-construction assignment): index.html's own
  // top-level IIFEs run SYNCHRONOUSLY as the HTML is parsed under
  // runScripts: 'dangerously', before `new JSDOM()` even returns -- so
  // window.fetch has to exist before parsing starts, not after.
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
      window.fetch = (url) => {
        if (String(url).includes('site_faq')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(faqRows) });
        }
        // Every other live-content fetch (site_terms, site_content,
        // leads, analytics) -- fail closed so each keeps its own static
        // fallback, isolating this test to the FAQ path only.
        return Promise.resolve({ ok: false, json: () => Promise.resolve([]) });
      };
    },
  });
  return dom.window;
}

function waitForMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 50));
}

test('the FAQPage JSON-LD script tag has a real id to target for updates', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.match(html, /<script type="application\/ld\+json" id="faqSchema">/);
});

test('a successful site_faq fetch rebuilds the FAQPage schema from the exact same rows rendered into the visible accordion', async () => {
  const rows = [
    { question: 'Do you fix a "smart" fridge?', answer: 'Yes, most models & brands.', category: 'Repairs' },
    { question: 'What is your service area?', answer: 'St. George and nearby cities.', category: 'Coverage' },
  ];
  const window = loadWithFaqRows(rows);
  await waitForMicrotasks();

  const schemaEl = window.document.getElementById('faqSchema');
  assert.ok(schemaEl, 'expected #faqSchema to exist');
  const schema = JSON.parse(schemaEl.textContent);
  assert.equal(schema['@type'], 'FAQPage');
  assert.equal(schema.mainEntity.length, rows.length);
  assert.equal(schema.mainEntity[0].name, rows[0].question);
  assert.equal(schema.mainEntity[0].acceptedAnswer.text, rows[0].answer);
  assert.equal(schema.mainEntity[1].name, rows[1].question);

  // And the visible accordion reflects the SAME data, not a second
  // independently-rendered copy that could disagree with the schema.
  const faqList = window.document.getElementById('faqList');
  assert.ok(faqList.innerHTML.includes('smart'), 'expected the visible accordion to render the fetched question text');
});

test('the visible accordion groups fetched rows by category, with a heading per group', async () => {
  const rows = [
    { question: 'Q1 in group A', answer: 'A1', category: 'Group A' },
    { question: 'Q2 in group B', answer: 'A2', category: 'Group B' },
    { question: 'Q3 also in group A', answer: 'A3', category: 'Group A' },
  ];
  const window = loadWithFaqRows(rows);
  await waitForMicrotasks();

  const faqList = window.document.getElementById('faqList');
  const headings = Array.from(faqList.querySelectorAll('h3.faq-category')).map(h => h.textContent);
  // One heading per distinct category, in first-appearance order (not
  // re-sorted, not de-duplicated per row) -- Group A appears before
  // Group B despite a Group A row also following the Group B row.
  assert.deepEqual(headings, ['Group A', 'Group B']);

  // All of a category's items are grouped together under its one
  // heading -- Q3 (Group A, 3rd row) sits right after Q1 (Group A, 1st
  // row), not interleaved in original row order with Group B's Q2.
  const items = Array.from(faqList.children);
  assert.equal(items[0].tagName, 'H3');
  assert.equal(items[1].className, 'faq-item');
  assert.equal(items[2].className, 'faq-item');
  assert.equal(items[3].tagName, 'H3');
  assert.equal(items[4].className, 'faq-item');
});

test('a row missing a category falls back to a single "General" group instead of throwing', async () => {
  const rows = [{ question: 'No category set', answer: 'Still renders.' }];
  const window = loadWithFaqRows(rows);
  await waitForMicrotasks();

  const faqList = window.document.getElementById('faqList');
  assert.match(faqList.innerHTML, /General/);
  assert.match(faqList.innerHTML, /No category set/);
});

test('a failed/empty site_faq fetch leaves the static fallback schema and accordion untouched (fail-silent, not fail-blank)', async () => {
  const window = loadWithFaqRows([]);
  await waitForMicrotasks();

  const schemaEl = window.document.getElementById('faqSchema');
  const schema = JSON.parse(schemaEl.textContent);
  // The static fallback has more than zero real questions baked in --
  // confirms nothing wiped it out on an empty/failed response.
  assert.ok(schema.mainEntity.length > 0, 'expected the static fallback FAQPage schema to remain when the fetch returns nothing');
});

test('the schema-rebuild code lives inside the same .then() as the visible accordion render, not a separate fetch', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const fnMatch = html.match(/fetch\(FAQ_SUPABASE_URL[\s\S]*?\.catch\(\(\) => \{[\s\S]*?\}\);\s*\n\s*\}\)\(\);/);
  assert.ok(fnMatch, 'expected to isolate the FAQ fetch IIFE');
  assert.match(fnMatch[0], /faqList\.innerHTML = categoryOrder\.map/, 'expected the visible-accordion render (grouped by category) in this same block');
  assert.match(fnMatch[0], /getElementById\('faqSchema'\)/, 'expected the schema rebuild in this same block, not a second fetch');
});
