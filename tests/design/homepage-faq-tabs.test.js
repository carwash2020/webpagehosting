// Homepage FAQ rebuild (2026-11-03): item 19 in docs/ACTION-ITEMS.md
// listed 6 proposed items from the "Homepage Redesign v2" handoff, 4 of
// which needed Connor's explicit sign-off before being built. Connor
// approved two of them outright: replace #faqModal (a pop-up) with an
// inline topic-tabs + accordion section, and add a prominent, live
// "big number" review rating to #reviews (see
// tests/site-content/review-stats-public.test.js for that one). The
// other two (moving #heroLeadForm into a new #schedule panel, and
// removing #honest/.stats-bar/.trust/#closing/#areas) were explicitly
// rejected and are untouched here.
//
// This file covers the real interaction behavior of the new #faq
// section: clicking a tab switches the active tab/panel, the standard
// ARIA tabs keyboard pattern (Left/Right/Home/End) works, and the
// accordion still opens/closes within a panel. The data-flow side
// (category grouping from a live site_faq fetch, the FAQPage JSON-LD
// staying in sync) is covered separately in
// tests/seo/faq-schema-sync.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX_HTML_PATH = repo('index.html');

function loadIndexDom() {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
      // Fail every live-content fetch closed so this test exercises only
      // the static fallback FAQ already in the HTML, same pattern as
      // tests/design/theme-toggle.test.js.
      window.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve([]) });
    },
  });
  return dom.window;
}

function waitForMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 50));
}

test('the FAQ section exists once, inline on the page, not inside a modal overlay', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.equal((html.match(/<section class="faq-section" id="faq"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="modal-overlay" id="faqOverlay"/);
});

test('#faq sits between #schedule and #closing, so #closing stays the final section before the footer', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const scheduleAt = html.indexOf('<section id="schedule">');
  const faqAt = html.indexOf('<section class="faq-section" id="faq"');
  const closingAt = html.indexOf('<section id="closing"');
  const footerAt = html.indexOf('<footer>');
  assert.ok(scheduleAt > 0 && faqAt > 0 && closingAt > 0 && footerAt > 0);
  assert.ok(scheduleAt < faqAt && faqAt < closingAt && closingAt < footerAt);
});

test('clicking a tab activates it and shows only its panel', async () => {
  const window = loadIndexDom();
  await waitForMicrotasks();
  const doc = window.document;

  const tab0 = doc.getElementById('faqTab-0');
  const tab1 = doc.getElementById('faqTab-1');
  const panel0 = doc.getElementById('faqPanel-0');
  const panel1 = doc.getElementById('faqPanel-1');

  assert.equal(tab0.getAttribute('aria-selected'), 'true');
  assert.equal(panel0.hidden, false);
  assert.equal(panel1.hidden, true);

  tab1.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  assert.equal(tab0.getAttribute('aria-selected'), 'false');
  assert.equal(tab0.getAttribute('tabindex'), '-1');
  assert.equal(tab1.getAttribute('aria-selected'), 'true');
  assert.equal(tab1.getAttribute('tabindex'), '0');
  assert.equal(tab1.classList.contains('is-active'), true);
  assert.equal(panel0.hidden, true);
  assert.equal(panel1.hidden, false);
});

test('ArrowRight/ArrowLeft/Home/End move both focus and the active tab, per the ARIA tabs pattern', async () => {
  const window = loadIndexDom();
  await waitForMicrotasks();
  const doc = window.document;
  const tabs = Array.from(doc.querySelectorAll('#faqTabs .faq-tab'));
  assert.ok(tabs.length >= 4, 'expected the 4 static topic tabs');

  function press(el, key) {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  press(tabs[0], 'ArrowRight');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(doc.activeElement, tabs[1]);

  press(tabs[1], 'ArrowLeft');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(doc.activeElement, tabs[0]);

  press(tabs[0], 'ArrowLeft');
  assert.equal(tabs[tabs.length - 1].getAttribute('aria-selected'), 'true', 'wraps to the last tab');

  press(tabs[tabs.length - 1], 'End');
  assert.equal(tabs[tabs.length - 1].getAttribute('aria-selected'), 'true');

  press(tabs[tabs.length - 1], 'Home');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
});

test('the accordion still opens and closes a question within the active panel', async () => {
  const window = loadIndexDom();
  await waitForMicrotasks();
  const doc = window.document;

  const firstItem = doc.querySelector('#faqPanel-0 .faq-item');
  const btn = firstItem.querySelector('.faq-question');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(firstItem.classList.contains('is-open'), false);

  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(firstItem.classList.contains('is-open'), true);

  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(firstItem.classList.contains('is-open'), false);
});

test('every FAQ question/answer from the old modal is preserved somewhere in the new tabs/panels', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const faqSection = html.slice(html.indexOf('<section class="faq-section" id="faq"'), html.indexOf('<section id="closing"'));
  const QUESTIONS = [
    'Do you offer estimates before starting work?',
    'What payment methods do you accept?',
    'Is there a trip fee?',
    'Is a deposit required to book?',
    'Do you have a referral program?',
    'How far in advance do I need to book?',
    'Can I text instead of call?',
    'Do you offer emergency or same-day service?',
    "What's the best way to schedule a job?",
    'What areas do you serve?',
    "What if the job I need isn't listed in your services?",
    'Do you guarantee your work?',
    "What's your cancellation policy?",
    'Do I need to be home while the work is being done?',
    'Should pets be put away before you arrive?',
  ];
  for (const q of QUESTIONS) {
    assert.ok(faqSection.includes(q), `expected to find preserved question: ${q}`);
  }
  assert.equal((faqSection.match(/class="faq-item"/g) || []).length, QUESTIONS.length);
});
