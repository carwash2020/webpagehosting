// Tests for fixing portal/login.html's robots meta tag and sitemap
// listing (audit item #20). Every other portal page is
// "noindex, nofollow" (dashboard, home, jobs, quotes, settings,
// work-orders, contracts, set-password) -- login.html was the one
// outlier, set to "index, follow" and also listed in sitemap.xml (a
// literal "please index this" signal to search engines, directly
// contradicting what every sibling page already does). A client
// portal's login page has no reason to be publicly discoverable via
// search -- it's not content anyone should land on from a search
// result, only from a direct link sent to an actual client.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);

test('portal/login.html now matches every other portal page: noindex, nofollow', () => {
  const html = fs.readFileSync(repo('portal', 'login.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(html, /<meta name="robots" content="index, follow">/);
});

test('every portal page (not just login.html) is noindex, nofollow, confirming there is no remaining outlier', () => {
  const PORTAL_DIR = repo('portal');
  const files = fs.readdirSync(PORTAL_DIR).filter((f) => f.endsWith('.html'));
  assert.ok(files.length > 0, 'expected to find portal HTML pages');
  for (const name of files) {
    const html = fs.readFileSync(path.join(PORTAL_DIR, name), 'utf8');
    const m = html.match(/<meta name="robots" content="([^"]*)">/);
    assert.ok(m, `${name}: expected a robots meta tag`);
    assert.equal(m[1], 'noindex, nofollow', `${name}: expected noindex, nofollow`);
  }
});

test('portal/login.html is no longer listed in sitemap.xml', () => {
  const sitemap = fs.readFileSync(repo('sitemap.xml'), 'utf8');
  assert.doesNotMatch(sitemap, /portal\/login\.html/);
});

test('sitemap.xml has no noindex page listed at all (every remaining <loc> is a real, indexable page)', () => {
  const sitemap = fs.readFileSync(repo('sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>https:\/\/www\.triplehenterprisesllc\.biz\/([^<]*)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length > 0, 'expected sitemap.xml to list real pages');
  for (const loc of locs) {
    if (!loc.startsWith('portal/')) continue;
    assert.fail(`sitemap.xml unexpectedly lists a portal page: ${loc} -- every portal page is noindex, nofollow and should never be in the sitemap`);
  }
});
