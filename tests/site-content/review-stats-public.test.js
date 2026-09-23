// js/review-stats.js -- the public side of the Google rating / review
// count migration (2026-09-23). The rating and count used to be typed into
// 11 places across 5 pages; they now come from site_content, edited in
// tools/site-content.html.
//
// The migration's promise is "changes WHERE the value lives, not what it
// says or how it renders", so the first tests assert exactly that: applying
// today's saved values (5.0 / 7) to each real page leaves its HTML
// byte-for-byte identical. (A real-browser before/after screenshot diff of
// all 11 spots was also byte-identical; see the PR.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'js', 'review-stats.js'), 'utf8');
const PAGES = [
  'index.html',
  'booking.html',
  'services/dishwasher-repair-st-george-ut.html',
  'services/refrigerator-repair-st-george-ut.html',
  'services/washer-dryer-repair-st-george-ut.html',
];
const PHRASE = /[1-5]\.[0-9] from [1-9][0-9]{0,4} Google reviews/g;

function pageDom(file, beforeScript) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://www.triplehenterprisesllc.biz/' + file });
  if (beforeScript) beforeScript(dom.window);
  dom.window.eval(SCRIPT);
  return dom.window;
}
function phrases(w) {
  return [...w.document.querySelectorAll('.js-review-text')].map(el => (el.textContent.match(PHRASE) || [])[0]);
}
function aggregateRatings(w) {
  return [...w.document.querySelectorAll('script[type="application/ld+json"]')]
    .map(s => { try { return JSON.parse(s.textContent).aggregateRating; } catch (e) { return undefined; } })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Identical render at today's values
// ---------------------------------------------------------------------------

for (const file of PAGES) {
  test(`${file}: applying today's saved values (5.0 / 7) leaves the page byte-for-byte unchanged`, () => {
    const w = pageDom(file);
    const before = w.document.documentElement.outerHTML;
    w.applyReviewStats({ googleRating: '5.0', googleReviewCount: '7', phone: null });
    assert.equal(w.document.documentElement.outerHTML, before);
  });
}

test('the static fallback text on every page agrees with index.html\'s JSON-LD aggregateRating', () => {
  const index = pageDom('index.html');
  const [ar] = aggregateRatings(index);
  assert.deepEqual(ar, { '@type': 'AggregateRating', ratingValue: '5.0', reviewCount: '7' });
  for (const file of PAGES) {
    const w = pageDom(file);
    const found = phrases(w);
    assert.ok(found.length >= 1, file + ' has at least one hooked phrase');
    found.forEach(p => assert.equal(p, ar.ratingValue + ' from ' + ar.reviewCount + ' Google reviews', file));
  }
});

// ---------------------------------------------------------------------------
// A new review reaches every spot
// ---------------------------------------------------------------------------

test('a new rating and count reach every hooked phrase, the stats strip, and the search data', () => {
  let total = 0;
  for (const file of PAGES) {
    const w = pageDom(file);
    w.applyReviewStats({ googleRating: '4.9', googleReviewCount: '12' });
    const found = phrases(w);
    found.forEach(p => assert.equal(p, '4.9 from 12 Google reviews', file));
    assert.doesNotMatch(w.document.body.textContent, /5\.0 from 7 Google reviews/, file + ' has no stale phrase left');
    total += found.length;
    if (file === 'index.html') {
      const ratingStat = w.document.querySelector('.js-review-rating-stat');
      const countStat = w.document.querySelector('.js-review-count-stat');
      assert.equal(ratingStat.textContent, '4.9');
      assert.equal(ratingStat.getAttribute('data-count-to'), '4.9');
      assert.equal(countStat.textContent, '12');
      assert.equal(countStat.getAttribute('data-count-to'), '12');
      assert.equal(w.document.querySelector('.js-review-star-label').textContent, 'Real Google Reviews');
      assert.deepEqual(aggregateRatings(w), [{ '@type': 'AggregateRating', ratingValue: '4.9', reviewCount: '12' }]);
    }
    w.document.querySelectorAll('.js-review-stars').forEach(el => assert.equal(el.textContent, '★★★★★', 'rounds 4.9 to 5 stars'));
  }
  assert.equal(total, 9, '9 phrases (index 2, booking 1, the 3 appliance pages 2 each), plus the 2 homepage stats and the JSON-LD above');
});

test('stars round to the nearest whole star and the "5-Star" label only shows at 5.0', () => {
  const w = pageDom('index.html');
  w.applyReviewStats({ googleRating: '4.4', googleReviewCount: '9' });
  w.document.querySelectorAll('.js-review-stars').forEach(el => assert.equal(el.textContent, '★★★★☆'));
  assert.equal(w.document.querySelector('.js-review-star-label').textContent, 'Real Google Reviews');
  w.applyReviewStats({ googleRating: '5.0', googleReviewCount: '9' });
  w.document.querySelectorAll('.js-review-stars').forEach(el => assert.equal(el.textContent, '★★★★★'));
  assert.equal(w.document.querySelector('.js-review-star-label').textContent, 'Real 5-Star Reviews');
});

test('only the count can change without the rating (and vice versa)', () => {
  const w = pageDom('booking.html');
  w.applyReviewStats({ googleReviewCount: '8' });
  assert.deepEqual(phrases(w), ['5.0 from 8 Google reviews']);
  w.applyReviewStats({ googleRating: '4.8' });
  assert.deepEqual(phrases(w), ['4.8 from 8 Google reviews']);
});

// ---------------------------------------------------------------------------
// Junk is ignored (the database refuses it too, but the page doesn't trust that)
// ---------------------------------------------------------------------------

const JUNK = [
  { googleRating: '6.0' }, { googleRating: '0.9' }, { googleRating: '5' }, { googleRating: '4.85' },
  { googleRating: 'five stars!!' }, { googleRating: '<img src=x onerror=alert(1)>' }, { googleRating: 4.9 },
  { googleReviewCount: '0' }, { googleReviewCount: '-3' }, { googleReviewCount: '07' }, { googleReviewCount: ' 12' },
  { googleReviewCount: '123456' }, { googleReviewCount: '12<script>' }, { googleReviewCount: 12 },
  null, 'nonsense', [],
];
for (const junk of JUNK) {
  test(`ignores ${JSON.stringify(junk)} and leaves the static text alone`, () => {
    for (const file of ['index.html', 'booking.html']) {
      const w = pageDom(file);
      const before = w.document.documentElement.outerHTML;
      w.applyReviewStats(junk);
      assert.equal(w.document.documentElement.outerHTML, before, file);
    }
  });
}

// ---------------------------------------------------------------------------
// Wiring: no race between the page's fetch and this deferred script
// ---------------------------------------------------------------------------

test('if the fetch lands before this deferred script runs, the script applies the values when it loads', () => {
  const w = pageDom('booking.html', win => { win.__siteContentMap = { googleRating: '4.7', googleReviewCount: '15' }; });
  assert.deepEqual(phrases(w), ['4.7 from 15 Google reviews']);
});

for (const file of PAGES) {
  test(`${file}: loads js/review-stats.js (versioned, deferred) and hands its site_content map over`, () => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(html, /<script src="\/js\/review-stats\.js\?v=[a-f0-9]{10}" defer><\/script>/);
    assert.match(html, /window\.__siteContentMap = map;\s*\n\s*if \(typeof applyReviewStats === 'function'\) applyReviewStats\(map\);/);
  });
}

test('booking.html (which had no site_content fetch) asks only for the fields it shows', () => {
  // Widened 2026-09-23 from the two review fields to phone + email too,
  // when booking.html started following the saved number
  // (contact-hooks-public.test.js).
  const html = fs.readFileSync(path.join(ROOT, 'booking.html'), 'utf8');
  assert.match(html, /\/rest\/v1\/site_content\?select=key,value&key=in\.\(googleRating,googleReviewCount,phone,email\)'/);
});

test('the homepage count-up reads data-count-to on every frame, so a value arriving mid-animation still wins', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const step = html.match(/\(function step\(now\) \{[\s\S]*?\}\)\(start\);/g).find(s => s.includes('origins.forEach'));
  assert.match(step, /const to = parseFloat\(el\.dataset\.countTo\);/);
});

// ---------------------------------------------------------------------------
// Nothing hardcoded comes back
// ---------------------------------------------------------------------------

function publicHtmlFiles() {
  const out = [];
  for (const dir of ['', 'services', 'locations', 'blog']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (f.endsWith('.html')) out.push(path.join(dir, f));
    }
  }
  return out;
}

test('no public page shows a "X.X from N Google reviews" phrase outside a .js-review-text hook', () => {
  const offenders = [];
  for (const file of publicHtmlFiles()) {
    const doc = new JSDOM(fs.readFileSync(path.join(ROOT, file), 'utf8')).window.document;
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/[1-5]\.[0-9] from [0-9]+ Google reviews/.test(n.nodeValue)) continue;
      if (n.parentElement.closest('script, style')) continue;
      if (!n.parentElement.closest('.js-review-text')) offenders.push(file + ': ' + n.nodeValue.trim().slice(0, 60));
    }
  }
  assert.deepEqual(offenders, [], 'a new page repeating the rating/count must use the .js-review-text hook (and load js/review-stats.js) so it stays in step with site_content');
});

test('the review-count stat and the rating stat are hooked on the homepage', () => {
  const w = pageDom('index.html');
  assert.equal(w.document.querySelectorAll('.js-review-rating-stat').length, 1);
  assert.equal(w.document.querySelectorAll('.js-review-count-stat').length, 1);
  assert.equal(w.document.querySelectorAll('.js-review-star-label').length, 1);
  assert.equal(w.document.querySelectorAll('.js-review-stars').length, 2);
});
