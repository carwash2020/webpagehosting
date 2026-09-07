// Every empty state on the client portal's list pages (2026-09-07) was
// plain gray text with no icon at all -- indistinguishable at a glance
// from a broken page. Each genuine "nothing here yet" state now reuses
// that page's own existing bottom-nav icon (jobs' checkmark, quotes'
// document, work-orders' "+"), rather than inventing a new icon
// language; the "couldn't load" error states share one new warning
// icon, distinct from every neutral state.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const QUOTES = fs.readFileSync(repo('portal', 'quotes.html'), 'utf8');
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

const PAGES = { jobs: JOBS, quotes: QUOTES, 'work-orders': WORK_ORDERS };

for (const [name, html] of Object.entries(PAGES)) {
  test(`${name}.html: every empty-state div is tagged is-neutral or is-error and carries an icon`, () => {
    const matches = [...html.matchAll(/<div class="empty-state(?!-icon)[^"]*"/g)];
    assert.ok(matches.length >= 2, `expected at least 2 empty-state divs in ${name}.html, found ${matches.length}`);
    for (const m of matches) {
      assert.match(m[0], /\bis-(neutral|error)\b/, `empty-state div "${m[0]}" is missing a variant class`);
    }
  });

  test(`${name}.html: the error (couldn't-load) empty state uses the shared warning icon, not the neutral nav icon`, () => {
    // Anchor on the markup usage specifically ('class="...is-error"'),
    // not the CSS rule earlier in the file (.empty-state.is-error {...}
    // has no quote character, so this string only matches the actual div).
    const anchor = 'empty-state is-error"';
    const at = html.indexOf(anchor);
    assert.ok(at >= 0, `expected to find the markup usage "${anchor}"`);
    const errorBlock = html.slice(at, at + 400);
    assert.match(errorBlock, /<circle cx="12" cy="12" r="8.5"\/><path d="M12 7.5v6"\/><circle cx="12" cy="16.75" r="0.6" fill="currentColor" stroke="none"\/>/);
  });
}

function neutralMarkupBlock(html) {
  const anchor = 'empty-state is-neutral"';
  const at = html.indexOf(anchor);
  assert.ok(at >= 0, `expected to find the markup usage "${anchor}"`);
  return html.slice(at, at + 300);
}

test('jobs.html neutral empty state reuses the exact checkmark icon already used for "Jobs" in the bottom nav', () => {
  const navIcon = JOBS.match(/href="\/portal\/jobs\.html" class="is-active"[\s\S]{0,200}?<path d="(M8\.5 12\.2[^"]+)"/)[1];
  assert.ok(neutralMarkupBlock(JOBS).includes(navIcon), 'expected the empty-state icon to reuse the exact nav icon path');
});

test('quotes.html neutral empty state reuses the exact document icon already used for "Quotes" in the bottom nav', () => {
  const navIcon = QUOTES.match(/href="\/portal\/quotes\.html"[\s\S]{0,200}?<path d="(M6 3\.5h7\.5[^"]+)"/)[1];
  assert.ok(neutralMarkupBlock(QUOTES).includes(navIcon), 'expected the empty-state icon to reuse the exact nav icon path');
});

test('work-orders.html neutral empty state reuses the exact "+" icon already used for "Request" in the bottom nav', () => {
  const navIcon = WORK_ORDERS.match(/href="\/portal\/work-orders\.html"[\s\S]{0,200}?<path d="(M12 8\.5v7[^"]+)"/)[1];
  assert.ok(neutralMarkupBlock(WORK_ORDERS).includes(navIcon), 'expected the empty-state icon to reuse the exact nav icon path');
});

test('work-orders.html sizes its empty-state icon smaller than jobs/quotes, matching its own more compact empty-state padding', () => {
  const woIconRule = WORK_ORDERS.match(/\.empty-state-icon \{ width: (\d+)px/)[1];
  const jobsIconRule = JOBS.match(/\.empty-state-icon \{ width: (\d+)px/)[1];
  assert.ok(Number(woIconRule) < Number(jobsIconRule), 'expected the work-orders icon to be smaller');
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 22, `expected v22 or later, got v${versionMatch[1]}`);
});
