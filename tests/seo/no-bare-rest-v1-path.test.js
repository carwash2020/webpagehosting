// Guard against a real indexing bug (2026-10-26): Google Search Console
// crawled https://www.triplehenterprisesllc.biz/rest/v1/site_terms?
// select=heading,body&order=sort_order.asc and indexed it as a 404
// (first detected 2026-10-23). That URL isn't a real page -- it's the
// literal text TERMS_SUPABASE_URL + '/rest/v1/site_terms?...' from
// index.html's (and terms.html's) own page source, where the Supabase
// project's real origin and the '/rest/v1/...' path sat in two
// different places in the source text (an identifier, then a separate
// string literal). A crawler extracting "URL-looking" quoted strings
// out of raw HTML/JS text has no way to resolve that identifier, so it
// read the bare '/rest/v1/...' string as if it were a path on THIS
// site and crawled it against this site's own host.
//
// The fix: every endpoint that matters gets written as one absolute
// string literal (the real https://xxxxx.supabase.co host directly,
// inseparably adjacent to '/rest/v1/' in the same literal), so there's
// never a bare '/rest/v1/...' substring in public page source for a
// crawler to mistake for a same-host relative path.
//
// Scope: this guards the files fixed in that same pass (index.html,
// terms.html, js/booking-flow.js, js/business-hours.js) plus any new
// public file -- regressing one of those, or introducing the same
// bare-concatenation shape anywhere new, fails this test. It does NOT
// yet cover the many OTHER public pages (every blog post, service
// page, city page, booking.html, manage-booking.html, manage-job.html,
// 404.html, about.html, our-work.html, careers.html, privacy.html)
// that build their own site_content fetch the exact same
// concatenated way -- a real, pre-existing, site-wide instance of this
// same pattern, found while fixing the site_terms 404 but out of scope
// for that specific fix. KNOWN_PRE_EXISTING_DEBT names them explicitly
// so this test can still fail on any NEW or REGRESSED bare path without
// blocking on fixing the whole site in one pass. Shrinking this list
// as pages get fixed is encouraged; growing it should raise an eyebrow.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Every public HTML file (root, services, locations, blog) plus every
// public shared JS file -- NOT tools/, portal/, or .claude/, which are
// internal surfaces already blocked from crawlers (robots.txt) and
// noindexed on-page.
function publicFiles() {
  const out = [];
  for (const dir of ['', 'services', 'locations', 'blog']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (f.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(f)) out.push(path.posix.join(dir, f));
    }
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'js'))) {
    if (f.endsWith('.js')) out.push(path.posix.join('js', f));
  }
  return out.filter((f) => f !== '.html' && f !== 'index.html.bak');
}

// A bare '/rest/v1/' is one not immediately preceded by the real
// Supabase host in the same piece of source text -- i.e. not part of
// an already-absolute 'https://xxxxx.supabase.co/rest/v1/...' literal.
function bareRestV1Occurrences(src) {
  const bad = [];
  const re = /\/rest\/v1\//g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 40), m.index);
    if (!/supabase\.co$/i.test(before)) {
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(line);
    }
  }
  return bad;
}

// Pre-existing instances of this same concatenation shape, found
// site-wide while fixing the site_terms 404 but left alone as out of
// scope for that fix (2026-10-26) -- see header comment.
const KNOWN_PRE_EXISTING_DEBT = [
  '404.html',
  'about.html',
  'booking.html',
  'careers.html',
  'manage-booking.html',
  'manage-job.html',
  'our-work.html',
  'privacy.html',
  'blog/appliance-repair-or-replace.html',
  'blog/dishwasher-leaking.html',
  'blog/dishwasher-not-cleaning.html',
  'blog/dishwasher-not-draining.html',
  'blog/drywall-crack-above-door.html',
  'blog/dryer-not-heating.html',
  'blog/dryer-wont-turn-on.html',
  'blog/fridge-not-cooling.html',
  'blog/handyman-to-do-list.html',
  'blog/ice-maker-not-working.html',
  'blog/index.html',
  'blog/oven-not-heating-right.html',
  'blog/toilet-running-flapper-valve.html',
  'blog/tv-mount-drywall-anchors.html',
  'blog/washer-leaking-water.html',
  'blog/washer-wont-drain.html',
  'blog/washer-wont-spin.html',
  'locations/handyman-cedar-city-ut.html',
  'locations/handyman-hurricane-ut.html',
  'locations/handyman-la-verkin-ut.html',
  'locations/handyman-leeds-ut.html',
  'locations/handyman-mesquite-nv.html',
  'locations/handyman-santa-clara-ivins-ut.html',
  'locations/handyman-st-george-ut.html',
  'locations/handyman-washington-city-ut.html',
  'services/assembly-installation.html',
  'services/dishwasher-repair-st-george-ut.html',
  'services/drywall-painting.html',
  'services/handyman-repairs.html',
  'services/plumbing-repairs.html',
  'services/refrigerator-repair-st-george-ut.html',
  'services/washer-dryer-repair-st-george-ut.html',
  'services/washer-dryer-repair.html',
].sort();

test('no public HTML/JS file outside the known pre-existing debt list has a bare /rest/v1/ path', () => {
  const files = publicFiles();
  const violating = files.filter((f) => bareRestV1Occurrences(read(f)).length > 0).sort();
  assert.deepEqual(violating, KNOWN_PRE_EXISTING_DEBT,
    'a new or regressed bare /rest/v1/ path was found (or a debt-listed file is now actually clean -- shrink the list)');
});

test('index.html, terms.html, js/booking-flow.js, and js/business-hours.js are fully clean', () => {
  for (const f of ['index.html', 'terms.html', 'js/booking-flow.js', 'js/business-hours.js']) {
    assert.deepEqual(bareRestV1Occurrences(read(f)), [], f);
  }
});
