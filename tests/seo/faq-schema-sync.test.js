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

test('a successful site_faq fetch rebuilds the FAQPage schema from the exact same rows rendered into the visible tabs/accordion', async () => {
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

  // And the visible accordion panels reflect the SAME data, not a
  // second independently-rendered copy that could disagree with the
  // schema.
  const panels = window.document.getElementById('faqPanels');
  assert.ok(panels.innerHTML.includes('smart'), 'expected the visible accordion to render the fetched question text');
});

test('the FAQ is rebuilt into one topic tab + accordion panel per category, in first-appearance order', async () => {
  const rows = [
    { question: 'Q1 in group A', answer: 'A1', category: 'Group A' },
    { question: 'Q2 in group B', answer: 'A2', category: 'Group B' },
    { question: 'Q3 also in group A', answer: 'A3', category: 'Group A' },
  ];
  const window = loadWithFaqRows(rows);
  await waitForMicrotasks();

  // One tab per distinct category, in first-appearance order (not
  // re-sorted, not de-duplicated per row) -- Group A appears before
  // Group B despite a Group A row also following the Group B row.
  const tabs = Array.from(window.document.querySelectorAll('#faqTabs .faq-tab'));
  assert.deepEqual(tabs.map(t => t.textContent), ['Group A', 'Group B']);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true', 'first tab starts selected');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'false');

  // All of a category's items are grouped together under its one
  // panel -- Q3 (Group A, 3rd row) sits in the same panel as Q1
  // (Group A, 1st row), not interleaved in row order with Group B's Q2.
  const panels = Array.from(window.document.querySelectorAll('#faqPanels .faq-panel'));
  assert.equal(panels.length, 2);
  assert.equal(panels[0].id, tabs[0].getAttribute('aria-controls'));
  assert.equal(panels[1].id, tabs[1].getAttribute('aria-controls'));
  assert.equal(panels[0].querySelectorAll('.faq-item').length, 2);
  assert.ok(panels[0].textContent.includes('Q1 in group A') && panels[0].textContent.includes('Q3 also in group A'));
  assert.equal(panels[1].querySelectorAll('.faq-item').length, 1);
  assert.ok(panels[1].textContent.includes('Q2 in group B'));
  assert.equal(panels[0].hidden, false, 'first panel starts visible');
  assert.equal(panels[1].hidden, true, 'non-active panels start hidden');
});

test('a row missing a category falls back to a single "General" tab instead of throwing', async () => {
  const rows = [{ question: 'No category set', answer: 'Still renders.' }];
  const window = loadWithFaqRows(rows);
  await waitForMicrotasks();

  const tabs = Array.from(window.document.querySelectorAll('#faqTabs .faq-tab')).map(t => t.textContent);
  assert.deepEqual(tabs, ['General']);
  const panels = window.document.getElementById('faqPanels');
  assert.match(panels.innerHTML, /No category set/);
});

test('a failed/empty site_faq fetch leaves the static fallback schema and tabs/accordion untouched (fail-silent, not fail-blank)', async () => {
  const window = loadWithFaqRows([]);
  await waitForMicrotasks();

  const schemaEl = window.document.getElementById('faqSchema');
  const schema = JSON.parse(schemaEl.textContent);
  // The static fallback has more than zero real questions baked in --
  // confirms nothing wiped it out on an empty/failed response.
  assert.ok(schema.mainEntity.length > 0, 'expected the static fallback FAQPage schema to remain when the fetch returns nothing');
  const tabs = window.document.querySelectorAll('#faqTabs .faq-tab');
  assert.ok(tabs.length > 0, 'expected the static fallback tabs to remain when the fetch returns nothing');
});

test('the schema-rebuild code lives inside the same .then() as the visible tabs/accordion render, not a separate fetch', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const fnMatch = html.match(/fetch\(FAQ_URL[\s\S]*?\.catch\(\(\) => \{[\s\S]*?\}\);\s*\n\s*\}\)\(\);/);
  assert.ok(fnMatch, 'expected to isolate the FAQ fetch IIFE');
  assert.match(fnMatch[0], /tabsEl\.innerHTML = categoryOrder\.map/, 'expected the visible-tabs render (grouped by category) in this same block');
  assert.match(fnMatch[0], /panelsEl\.innerHTML = categoryOrder\.map/, 'expected the visible-accordion render (grouped by category) in this same block');
  assert.match(fnMatch[0], /getElementById\('faqSchema'\)/, 'expected the schema rebuild in this same block, not a second fetch');
});

test('the FAQ tabs and accordion panels carry real ARIA tab/tabpanel roles and states', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.match(html, /<div class="faq-tabs" role="tablist" aria-label="FAQ topics" id="faqTabs">/);
  assert.match(html, /class="faq-tab is-active" role="tab" id="faqTab-0" aria-selected="true" aria-controls="faqPanel-0"/);
  assert.match(html, /<div class="faq-panel" role="tabpanel" id="faqPanel-0" aria-labelledby="faqTab-0"/);
  // Every non-first static panel starts hidden.
  const hiddenPanels = (html.match(/class="faq-panel" role="tabpanel"[^>]*tabindex="0" hidden>/g) || []).length;
  assert.ok(hiddenPanels >= 1, 'expected at least one non-active panel to start hidden');
});
