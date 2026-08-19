// Automated tests for tools/parts-reference.html (Appliance Wiki).
//
// These replace what used to be manual, one-off verification: load the
// page in a sandbox, run through the seed migrations, and click through
// the actual UI the way a person would. Runs on every push via GitHub
// Actions (see .github/workflows/test.yml) instead of relying on someone
// remembering to test by hand before pushing a change to this file.
//
// Run locally with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '..', 'tools', 'parts-reference.html');

// Loads a fresh copy of the page in an isolated jsdom environment. Each
// test gets its own window/localStorage so tests can't leak state into
// each other, same as a real fresh page load would.
function loadPage() {
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/' });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  // auth.js and tools-common.js load via relative <script src> tags that
  // don't resolve to a real server in this sandbox, so requireAuth(),
  // showToast(), and showConfirm() need stand-ins. This mirrors what
  // those functions actually do in production closely enough for testing
  // the app's own logic, which is what these tests are checking.
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.navigator.clipboard = { writeText: () => Promise.resolve() };
  // escapeHtml/money moved into tools-common.js (2026-08-18) to remove
  // 13 total duplicated function definitions across the tool suite --
  // same real implementations as tools-common.js, not simplified stand-
  // ins, so these tests still validate real escaping/formatting
  // behavior rather than a fake pass-through.
  window.escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    const div = window.document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };
  window.money = (v) => '$' + (v || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
  return window;
}

// Waits for the page's own DOMContentLoaded seeding/render logic to finish
// before a test starts interacting with it.
function ready(window) {
  return new Promise(resolve => setTimeout(() => resolve(window), 400));
}

test('page loads and seeds without throwing', async () => {
  const window = await ready(loadPage());
  const units = window.loadPrUnits();
  assert.ok(units.length > 0, 'expected seed data to be present after load');
});

test('full migration chain is idempotent -- running it twice does not duplicate data', async () => {
  const window = await ready(loadPage());
  const firstRunCount = window.loadPrUnits().length;
  // Re-run the exact same init sequence a second time, simulating a
  // second page load against localStorage that's already been seeded.
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await ready(window);
  const secondRunCount = window.loadPrUnits().length;
  assert.equal(secondRunCount, firstRunCount, 'unit count changed after re-running init -- a migration flag is not being respected');
});

test('no duplicate unit ids after all migrations', async () => {
  const window = await ready(loadPage());
  const ids = window.loadPrUnits().map(u => u.id);
  assert.equal(ids.length, new Set(ids).size, 'duplicate unit id found in seed data');
});

test('no blank-model entries with zero issues survive (the "General reference" cleanup)', async () => {
  const window = await ready(loadPage());
  const bad = window.loadPrUnits().filter(u => !u.model && (!u.issues || u.issues.length === 0));
  assert.equal(bad.length, 0, 'found a blank-model unit with no issues -- should have been pruned');
});

test('Level 1 renders a brand card per distinct brand', async () => {
  const window = await ready(loadPage());
  const doc = window.document;
  const brandCount = new Set(window.loadPrUnits().map(u => u.brand)).size;
  const cards = doc.querySelectorAll('#prUnitsList .pr-unit-card');
  assert.equal(cards.length, brandCount);
});

test('add / edit / delete a model works end to end', async () => {
  const window = await ready(loadPage());
  const doc = window.document;

  const whirlpoolCard = Array.from(doc.querySelectorAll('#prUnitsList .pr-unit-card')).find(c => c.dataset.prBrand === 'Whirlpool');
  assert.ok(whirlpoolCard, 'expected a Whirlpool card to exist in seed data');
  whirlpoolCard.dispatchEvent(new window.Event('click', { bubbles: true }));

  const fridgeCard = Array.from(doc.querySelectorAll('#prBrandTypeList .pr-unit-card')).find(c => c.dataset.prDetailType === 'Refrigerator');
  assert.ok(fridgeCard, 'expected Whirlpool to have a Refrigerator type');
  fridgeCard.dispatchEvent(new window.Event('click', { bubbles: true }));

  const before = doc.querySelectorAll('#prTypeSectionsList .pr-type-section').length;
  window.toggleAddModelInType();
  doc.getElementById('prNewModelInType').value = 'TEST_AUTOMATED_MODEL';
  window.saveNewModelInType();
  assert.equal(doc.querySelectorAll('#prTypeSectionsList .pr-type-section').length, before + 1, 'add did not create a new section');

  const section = Array.from(doc.querySelectorAll('.pr-type-section')).find(s => s.textContent.includes('TEST_AUTOMATED_MODEL'));
  const editBtn = section.querySelector('.pr-row-icon-btn[title="Edit"]');
  editBtn.click();
  assert.ok(doc.getElementById('prEditModel'), 'edit form did not open');
  doc.getElementById('prEditModel').value = 'TEST_AUTOMATED_MODEL_EDITED';
  Array.from(doc.querySelectorAll('button')).find(b => b.textContent === 'Save Changes').click();
  assert.ok(
    Array.from(doc.querySelectorAll('.pr-type-section-name')).some(el => el.textContent.includes('TEST_AUTOMATED_MODEL_EDITED')),
    'edit did not persist'
  );

  const delSection = Array.from(doc.querySelectorAll('.pr-type-section')).find(s => s.textContent.includes('TEST_AUTOMATED_MODEL_EDITED'));
  delSection.querySelector('.pr-row-icon-btn.danger').click();
  await new Promise(r => setTimeout(r, 100));
  assert.equal(doc.querySelectorAll('#prTypeSectionsList .pr-type-section').length, before, 'delete did not remove the section');
});

test('duplicate model add is caught and can be cancelled', async () => {
  const window = await ready(loadPage());
  window.showConfirm = () => Promise.resolve(false); // simulate clicking Cancel
  const doc = window.document;

  const whirlpoolCard = Array.from(doc.querySelectorAll('#prUnitsList .pr-unit-card')).find(c => c.dataset.prBrand === 'Whirlpool');
  whirlpoolCard.dispatchEvent(new window.Event('click', { bubbles: true }));
  const washerCard = Array.from(doc.querySelectorAll('#prBrandTypeList .pr-unit-card')).find(c => c.dataset.prDetailType === 'Washer');
  washerCard.dispatchEvent(new window.Event('click', { bubbles: true }));

  const existingModel = window.loadPrUnits().find(u => u.brand === 'Whirlpool' && u.type === 'Washer' && u.model).model;
  const before = window.loadPrUnits().length;
  window.toggleAddModelInType();
  doc.getElementById('prNewModelInType').value = existingModel;
  window.saveNewModelInType();
  await new Promise(r => setTimeout(r, 100));
  assert.equal(window.loadPrUnits().length, before, 'a duplicate was added even though the confirm dialog was cancelled');
});

test('search matches issue text, not just brand/type/model', async () => {
  const window = await ready(loadPage());
  const doc = window.document;
  const anyIssue = window.loadPrUnits().flatMap(u => u.issues)[0];
  assert.ok(anyIssue, 'expected at least one seeded issue to search for');

  const searchTerm = anyIssue.symptom.split(' ').slice(0, 3).join(' ');
  doc.getElementById('prSearchInput').value = searchTerm;
  window.renderUnits();
  const results = doc.querySelectorAll('#prUnitsList .pr-unit-card');
  assert.ok(results.length > 0, `expected a search hit for "${searchTerm}"`);
});

test('copy-all builds text containing every issue on that unit', async () => {
  const window = await ready(loadPage());
  let copiedText = null;
  window.navigator.clipboard = { writeText: (t) => { copiedText = t; return Promise.resolve(); } };

  const unitWithIssues = window.loadPrUnits().find(u => u.issues.length > 1);
  assert.ok(unitWithIssues, 'expected at least one unit with multiple issues in seed data');
  window.copyAllPrIssuesText(unitWithIssues.id);
  assert.ok(copiedText, 'copyAllPrIssuesText did not write to the clipboard');
  unitWithIssues.issues.forEach(iss => {
    assert.ok(copiedText.includes(iss.symptom), `copied text missing symptom: ${iss.symptom}`);
  });
});
