// U02/W16 fix (High-Impact Upgrades, Master Audit, 2026-09-08):
// "Customers do not arrive thinking 'appliance repair'; they arrive
// thinking 'it won't drain'." The triage tool's entry point used to be
// an appliance-category picker (step 1) before ever showing a symptom
// -- this adds a symptom-first entry point using triage.js's own DATA,
// in plain language, as the real first thing shown.
//
// Shrink pass (2026-09-08): a separate, duplicate "appliance, then
// symptom" picker that used to sit below this was removed outright --
// it did the same job this entry point already does.
//
// Style pass (2026-09-09), direct feedback on a screenshot: rebuilt the
// entry point again, from bordered accordion cards to a single-select
// flow of pill buttons (appliance pills, then that appliance's symptoms
// as a stacked list of pills) -- still one picker, just a different
// visual language, closer to what a flat pill-button style used to look
// like before the shrink pass removed the duplicate that had it.

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

test('one pill button per appliance, sourced from triage.js\'s own DATA -- 5 appliances, nothing invented', () => {
  const window = loadTriagePage(INDEX);
  const pills = window.document.querySelectorAll('#triageSymptomGrid .triage-appliance-pill');
  assert.equal(Object.keys(window.TRIAGE_DATA).length, 5, 'sanity check: triage.js should still have exactly 5 appliances');
  assert.equal(pills.length, 5, 'expected one pill per appliance -- no more, no fewer');
});

test('no symptom pills are shown until an appliance is selected', () => {
  const window = loadTriagePage(INDEX);
  const panel = window.document.querySelector('#triageSymptomGrid .triage-symptom-pills');
  assert.ok(panel, 'expected the symptom pill panel to exist');
  assert.equal(panel.children.length, 0, 'nothing should be pre-selected');
});

test('selecting an appliance pill shows exactly its own 4 symptom pills, each naming its symptom', () => {
  const window = loadTriagePage(INDEX);
  const { document } = window;
  const pills = [...document.querySelectorAll('#triageSymptomGrid .triage-appliance-pill')];
  const washerPill = pills.find(p => p.textContent.trim() === 'Washer');
  assert.ok(washerPill, 'expected a Washer pill');

  washerPill.dispatchEvent(new window.Event('click', { bubbles: true }));

  assert.equal(washerPill.getAttribute('aria-pressed'), 'true', 'the selected appliance pill should read as pressed');
  const symptomPills = [...document.querySelectorAll('#triageSymptomGrid .triage-symptom-pill')];
  assert.equal(symptomPills.length, 4, 'expected exactly Washer\'s 4 symptoms, not some other appliance\'s or all 20');
  const expectedQs = Array.from(window.TRIAGE_DATA.washer.symptoms, s => s.q).sort();
  assert.deepEqual(symptomPills.map(p => p.textContent.trim()).sort(), expectedQs);
});

test('clicking a symptom pill shows the exact same verdict/body triage.js already had for it, with no second copy of that text', () => {
  const window = loadTriagePage(INDEX);
  const { document } = window;
  const pills = [...document.querySelectorAll('#triageSymptomGrid .triage-appliance-pill')];
  const washerPill = pills.find(p => p.textContent.trim() === 'Washer');
  washerPill.dispatchEvent(new window.Event('click', { bubbles: true }));

  const symptomPills = [...document.querySelectorAll('#triageSymptomGrid .triage-symptom-pill')];
  const drainPill = symptomPills.find(p => p.textContent.trim() === "Won't drain");
  assert.ok(drainPill, 'expected a "Won\'t drain" pill under Washer');

  drainPill.dispatchEvent(new window.Event('click', { bubbles: true }));

  const expected = window.TRIAGE_DATA.washer.symptoms.find(s => s.q === "Won't drain");
  assert.equal(document.getElementById('triageResult').hidden, false);
  assert.equal(document.getElementById('triageVerdict').textContent, expected.v);
  assert.equal(document.getElementById('triageBody').textContent, expected.a);
  assert.equal(drainPill.getAttribute('aria-pressed'), 'true', 'the selected symptom pill should read as pressed');
});

test('switching to a different appliance clears the previous one\'s symptom pills and its pressed state', () => {
  const window = loadTriagePage(INDEX);
  const { document } = window;
  const pills = [...document.querySelectorAll('#triageSymptomGrid .triage-appliance-pill')];
  const washerPill = pills.find(p => p.textContent.trim() === 'Washer');
  const dryerPill = pills.find(p => p.textContent.trim() === 'Dryer');

  washerPill.dispatchEvent(new window.Event('click', { bubbles: true }));
  dryerPill.dispatchEvent(new window.Event('click', { bubbles: true }));

  assert.equal(washerPill.getAttribute('aria-pressed'), 'false', 'only one appliance pill should read as pressed at a time');
  assert.equal(dryerPill.getAttribute('aria-pressed'), 'true');
  const symptomPills = [...document.querySelectorAll('#triageSymptomGrid .triage-symptom-pill')];
  const expectedQs = Array.from(window.TRIAGE_DATA.dryer.symptoms, s => s.q).sort();
  assert.deepEqual(symptomPills.map(p => p.textContent.trim()).sort(), expectedQs, 'switching appliances should replace the symptom list, not append to it');
});

test('the old step-by-step appliance-first picker (a separate, duplicate structure) is gone', () => {
  const window = loadTriagePage(INDEX);
  const { document } = window;
  assert.equal(document.querySelector('.triage-browse-toggle'), null, 'the demoted appliance-first disclosure should no longer exist');
  assert.equal(document.getElementById('triageAppliances'), null);
  assert.equal(document.getElementById('triageSymptomStep'), null);
  assert.equal(document.getElementById('triageSymptoms'), null);
});

test('all 5 city landing pages carry the same symptom-first triage markup as the homepage', () => {
  for (const page of LANDING_PAGES) {
    const html = fs.readFileSync(repo(page), 'utf8');
    assert.match(html, /<div class="triage-symptom-grid" id="triageSymptomGrid"/, `${page} is missing the symptom grid`);
    assert.doesNotMatch(html, /triage-browse-toggle/, `${page} should not carry the removed duplicate appliance-first picker`);
  }
});

test('triage.js exposes its DATA as window.TRIAGE_DATA so the pills never carry a second, driftable copy of the same symptom text', () => {
  assert.match(TRIAGE_JS, /window\.TRIAGE_DATA = DATA;/);
});

test('the service worker cache was bumped since /styles.css (precached) changed for the new pill-button styling', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 99, `expected v99 or later, got v${version}`);
});
