// Duplicate meta description guard (2026-09-21). A static content
// audit found 9 of 16 city/service/appliance landing pages sharing an
// identical closing sentence in their meta description -- a real
// duplicate-content risk to search engines even though the opening
// sentence differed per page. Fixed by giving each page's closer a
// genuinely distinct, real fact (its own drive time from St. George,
// its own trip-fee note, or its own appliance symptoms) rather than a
// synonym swap. This test guards against that regressing -- every
// city/service/appliance landing page's <meta name="description">
// must be unique across the whole set.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

const PAGES = [
  'handyman-hurricane-ut.html', 'handyman-washington-city-ut.html',
  'handyman-santa-clara-ivins-ut.html', 'handyman-la-verkin-ut.html',
  'handyman-leeds-ut.html', 'handyman-cedar-city-ut.html', 'handyman-mesquite-nv.html',
  'handyman-st-george-ut.html', 'washer-dryer-repair.html', 'plumbing-repairs.html',
  'drywall-painting.html', 'handyman-repairs.html', 'assembly-installation.html',
  'washer-dryer-repair-st-george-ut.html', 'refrigerator-repair-st-george-ut.html',
  'dishwasher-repair-st-george-ut.html',
];

function metaDescription(file) {
  const src = fs.readFileSync(repo(file), 'utf8');
  const match = src.match(/<meta name="description" content="([^"]*)"/);
  assert.ok(match, file + ' has no meta description');
  return match[1];
}

function ogDescription(file) {
  const src = fs.readFileSync(repo(file), 'utf8');
  const match = src.match(/<meta property="og:description" content="([^"]*)"/);
  assert.ok(match, file + ' has no og:description');
  return match[1];
}

function twitterDescription(file) {
  const src = fs.readFileSync(repo(file), 'utf8');
  const match = src.match(/<meta name="twitter:description" content="([^"]*)"/);
  assert.ok(match, file + ' has no twitter:description');
  return match[1];
}

test('every city/service/appliance landing page has a unique meta description', () => {
  const seen = new Map();
  for (const file of PAGES) {
    const desc = metaDescription(file);
    const dupeOf = seen.get(desc);
    assert.ok(!dupeOf, file + ' has the exact same meta description as ' + dupeOf + ': "' + desc + '"');
    seen.set(desc, file);
  }
});

// Same duplicate-content risk applies to og:description/twitter:description
// (social share previews, and og:description in particular gets pulled by
// some crawlers too) -- a real gap this PR's first draft left behind: only
// the plain <meta name="description"> was de-duplicated, while these two
// tags on all 9 affected pages still carried the exact old shared text.
// Caught by Cursor Bugbot's own PR summary, verified, and fixed.
test('every city/service/appliance landing page has a unique og:description', () => {
  const seen = new Map();
  for (const file of PAGES) {
    const desc = ogDescription(file);
    const dupeOf = seen.get(desc);
    assert.ok(!dupeOf, file + ' has the exact same og:description as ' + dupeOf + ': "' + desc + '"');
    seen.set(desc, file);
  }
});

test('every city/service/appliance landing page has a unique twitter:description', () => {
  const seen = new Map();
  for (const file of PAGES) {
    const desc = twitterDescription(file);
    const dupeOf = seen.get(desc);
    assert.ok(!dupeOf, file + ' has the exact same twitter:description as ' + dupeOf + ': "' + desc + '"');
    seen.set(desc, file);
  }
});

test('the 6 city pages that used to share the same closing sentence now each have their own', () => {
  const closers = [
    'handyman-hurricane-ut.html', 'handyman-la-verkin-ut.html', 'handyman-leeds-ut.html',
    'handyman-santa-clara-ivins-ut.html', 'handyman-st-george-ut.html', 'handyman-washington-city-ut.html',
  ].map(f => metaDescription(f).split('. ').slice(1).join('. '));
  assert.equal(new Set(closers).size, closers.length, 'closing sentences should all differ');
});

test('the 3 appliance pages that used to share the same closing sentence now each have their own', () => {
  const closers = [
    'dishwasher-repair-st-george-ut.html', 'refrigerator-repair-st-george-ut.html', 'washer-dryer-repair-st-george-ut.html',
  ].map(f => metaDescription(f).split('. ').slice(1).join('. '));
  assert.equal(new Set(closers).size, closers.length, 'closing sentences should all differ');
});
