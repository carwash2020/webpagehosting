// U04/W17 fix (High-Impact Upgrades, Master Audit, 2026-09-08): "A site
// that says 'next opening Thursday 9:00 AM' feels staffed and organised
// in a way almost no trade site does." This locks in the homepage-side
// half: triage.js's new IIFE reads business-hours.js's
// findNextAvailableSlot() and renders it beside the pill, but only ever
// as an ADDITION -- a failed/slow lookup must never touch the pill's
// own already-working text.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const TRIAGE_JS = fs.readFileSync(repo('triage.js'), 'utf8');
const BUSINESS_HOURS_JS = fs.readFileSync(repo('business-hours.js'), 'utf8');

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForCondition(conditionFn, { timeout = 5000, interval = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (conditionFn()) return;
    await waitFor(interval);
  }
  throw new Error('waitForCondition: condition never became true within ' + timeout + 'ms');
}

function loadPage(mockFetch) {
  // business-hours.js loads before triage.js on the real page (a plain
  // blocking <script>, ahead of triage.js's own deferred one) -- inline
  // both, in that same order, in place of their <script src> tags so
  // jsdom (which never fetches external scripts) sees the same globals
  // triage.js's new IIFE depends on.
  let html = INDEX.replace(
    /<script src="\/business-hours\.js\?v=[a-z0-9.]+"><\/script>/,
    `<script>${BUSINESS_HOURS_JS}</script>`
  );
  html = html.replace(
    /<script src="\/triage\.js\?v=[a-f0-9]+" defer><\/script>/,
    `<script>${TRIAGE_JS}</script>`
  );
  assert.doesNotMatch(html, /business-hours\.js\?v=|triage\.js\?v=/, 'expected both script tags to be inlined');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    beforeParse(w) { if (mockFetch) w.fetch = mockFetch; },
  });
  return dom.window;
}

test('a successful lookup shows the real next opening beside the pill, linking to that exact service/date', async () => {
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) return { ok: true, json: async () => [] };
    return { ok: false };
  });
  await waitForCondition(() => window.document.getElementById('nextOpening').hidden === false);

  const el = window.document.getElementById('nextOpening');
  assert.match(el.innerHTML, /Next opening:/);
  const link = el.querySelector('a');
  assert.ok(link, 'expected a book-this-slot link');
  assert.match(link.getAttribute('href'), /^\/booking\.html\?service=inspection&date=\d{4}-\d{2}-\d{2}$/);

  // The pill itself is untouched -- this is an addition, not a replacement.
  assert.equal(window.document.getElementById('openStatus').hidden, false);
});

test('a failed lookup leaves #nextOpening hidden and never touches the pill\'s own text', async () => {
  const window = loadPage(async (url) => {
    if (String(url).includes('get_booking_availability')) throw new Error('network down');
    return { ok: false };
  });
  await waitForCondition(() => window.document.getElementById('openStatus').hidden === false);
  await waitFor(150); // give the failed lookup's rejection a moment to (not) do anything

  assert.equal(window.document.getElementById('nextOpening').hidden, true);
  assert.match(window.document.getElementById('openStatusText').innerHTML, /Open now|Closed right now/);
});

test('nothing opening within the search horizon (findNextAvailableSlot resolves null) also leaves #nextOpening hidden, not a broken promise', async () => {
  const window = loadPage(async (url) => {
    // Every day "fully booked" -- a single booking spanning a huge
    // range is enough to blank out the whole 14-day search horizon.
    if (String(url).includes('get_booking_availability')) {
      return { ok: true, json: async () => ([{ start_at: '2020-01-01T00:00:00Z', end_at: '2030-01-01T00:00:00Z' }]) };
    }
    return { ok: false };
  });
  await waitForCondition(() => window.document.getElementById('openStatus').hidden === false);
  await waitFor(300);

  assert.equal(window.document.getElementById('nextOpening').hidden, true);
});

test('the shortest service (Inspection, 45 min) is what the lookup searches for -- the earliest slot that could fit any visit, not one specific service', () => {
  assert.match(TRIAGE_JS, /NEXT_OPENING_DURATION_MINUTES = 45/);
  assert.match(TRIAGE_JS, /NEXT_OPENING_SERVICE_KEY = 'inspection'/);
});

test('the tools service worker cache was bumped, since /styles.css (precached) changed again for the new-opening line styling', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 100, `expected v100 or later, got v${version}`);
});
