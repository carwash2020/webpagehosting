// U02/W16 fix (High-Impact Upgrades, Master Audit, 2026-09-08):
// "Customers do not arrive thinking 'appliance repair'; they arrive
// thinking 'it won't drain'." The triage tool's entry point used to be
// an appliance-category picker (step 1) before ever showing a symptom
// -- this adds a flat grid of the same 20 symptoms already in
// triage.js's own DATA, in plain language, as the real first thing
// shown. The original appliance-first picker is kept, unchanged, just
// demoted into a <details> disclosure below the grid for anyone who'd
// rather browse that way -- no schema change, no invented content.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const TRIAGE_JS = fs.readFileSync(repo('triage.js'), 'utf8');

const LANDING_PAGES = [
  'handyman-cedar-city-ut.html',
  'handyman-hurricane-ut.html',
  'handyman-mesquite-nv.html',
  'handyman-santa-clara-ivins-ut.html',
  'handyman-washington-city-ut.html',
];

function loadTriagePage(html) {
  // Inline triage.js's real content in place of its <script src> tag,
  // so jsdom never needs to fetch anything external to run it.
  const inlined = html.replace(
    /<script src="\/triage\.js\?v=[a-f0-9]+" defer><\/script>/,
    `<script>${TRIAGE_JS}</script>`
  );
  assert.notEqual(inlined, html, 'expected to find and inline the triage.js script tag');
  const dom = new JSDOM(inlined, { runScripts: 'dangerously', url: 'https://example.com/' });
  return dom.window;
}

test('the symptom grid is the first thing shown -- one card per symptom already in triage.js\'s own DATA, nothing invented', () => {
  const window = loadTriagePage(INDEX);
  const cards = window.document.querySelectorAll('#triageSymptomGrid .triage-symptom-card');
  const dataSymptomCount = Object.values(window.TRIAGE_DATA).reduce((sum, a) => sum + a.symptoms.length, 0);
  assert.equal(dataSymptomCount, 20, 'sanity check: triage.js should still have exactly 20 symptoms across 5 appliances');
  assert.equal(cards.length, dataSymptomCount, 'expected one grid card per symptom in DATA -- no more, no fewer');
});

test('clicking a symptom card shows the exact same verdict/body triage.js already had for it, with no second copy of that text', () => {
  const window = loadTriagePage(INDEX);
  const { document } = window;
  const rows = [...document.querySelectorAll('#triageSymptomGrid .triage-appliance-row')];
  const washerRow = rows.find(r => r.querySelector('.triage-appliance-heading').textContent.trim() === 'Washer');
  assert.ok(washerRow, 'expected a Washer row');
  const drainCard = [...washerRow.querySelectorAll('.triage-symptom-card')]
    .find(c => c.querySelector('.triage-symptom-card-q').textContent === "Won't drain");
  assert.ok(drainCard, 'expected a Washer / "Won\'t drain" card');

  drainCard.dispatchEvent(new window.Event('click', { bubbles: true }));

  const expected = window.TRIAGE_DATA.washer.symptoms.find(s => s.q === "Won't drain");
  assert.equal(document.getElementById('triageResult').hidden, false);
  assert.equal(document.getElementById('triageVerdict').textContent, expected.v);
  assert.equal(document.getElementById('triageBody').textContent, expected.a);
});

test('the original appliance-first picker still works exactly as before, now inside a collapsed <details> disclosure', () => {
  const window = loadTriagePage(INDEX);
  const { document } = window;

  const details = document.querySelector('.triage-browse-toggle');
  assert.ok(details, 'expected a .triage-browse-toggle <details> element');
  assert.equal(details.tagName, 'DETAILS');
  assert.equal(details.open, false, 'should be collapsed by default -- the symptom grid is the real entry point now');
  assert.ok(details.querySelector('#triageAppliances'), 'the original appliance picker should still be inside it, unchanged');
  assert.ok(details.querySelector('#triageSymptomStep'), 'the original symptom-after-appliance step should still be inside it, unchanged');

  const applianceChips = document.querySelectorAll('#triageAppliances .triage-chip');
  assert.equal(applianceChips.length, 5, 'all 5 appliance categories should still be selectable manually');

  applianceChips[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  const symptomChips = document.querySelectorAll('#triageSymptoms .triage-chip');
  assert.equal(symptomChips.length, 4, 'picking an appliance should still populate its 4 symptoms, same as before');
});

test('every symptom card sits inside a row that names its appliance, so 20 cards read unambiguously without repeating the appliance on every single card', () => {
  // Design feedback (2026-09-08): each card used to repeat its own
  // appliance name (e.g. "WASHER") even though the enclosing row's own
  // <summary> already says "Washer" -- 4x redundant per row, and it
  // read as an unfinished template. The row itself is still required to
  // name its appliance; the per-card repetition is what's gone.
  const window = loadTriagePage(INDEX);
  const rows = [...window.document.querySelectorAll('#triageSymptomGrid .triage-appliance-row')];
  assert.equal(rows.length, 5, 'expected 5 appliance rows');
  for (const row of rows) {
    const heading = row.querySelector('.triage-appliance-heading');
    assert.ok(heading && heading.textContent.trim().length > 0, 'every row should name its appliance');
    assert.ok(row.querySelector('.triage-appliance-icon svg'), 'every row should have its own icon');
    const cards = [...row.querySelectorAll('.triage-symptom-card')];
    assert.equal(cards.length, 4, 'expected 4 symptom cards per appliance row');
    for (const card of cards) {
      const symptom = card.querySelector('.triage-symptom-card-q');
      assert.ok(symptom && symptom.textContent.trim().length > 0, 'every card should name its symptom');
      assert.ok(!card.querySelector('.triage-symptom-card-appliance'), 'the per-card appliance label is redundant now and should be gone');
    }
  }
});

test('all 5 city landing pages carry the same symptom-first triage markup as the homepage', () => {
  for (const page of LANDING_PAGES) {
    const html = fs.readFileSync(repo(page), 'utf8');
    assert.match(html, /<div class="triage-symptom-grid" id="triageSymptomGrid"/, `${page} is missing the symptom grid`);
    assert.match(html, /<details class="triage-browse-toggle">/, `${page} is missing the demoted appliance-first disclosure`);
    assert.match(html, /<div class="triage-options" id="triageAppliances"/, `${page} should still have the original appliance picker, unchanged`);
  }
});

test('triage.js exposes its DATA as window.TRIAGE_DATA so the grid never carries a second, driftable copy of the same symptom text', () => {
  assert.match(TRIAGE_JS, /window\.TRIAGE_DATA = DATA;/);
});

test('the service worker cache was bumped, since /styles.css (precached) changed for the new grid styling', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 99, `expected v99 or later, got v${version}`);
});
