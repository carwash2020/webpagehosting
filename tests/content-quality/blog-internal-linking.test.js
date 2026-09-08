// SEO fix (2026-09-08): an outside audit of the site's Google Search
// Console data found the site's 3 blog posts weren't getting indexed,
// and traced it to a real internal-linking gap -- no page on the site,
// homepage included, ever linked to an individual post. Every existing
// blog link (nav, mobile nav, footer) pointed only at /blog/ itself, so
// a post was reachable only via that index page or the sitemap, which
// reads to a search engine as a weaker "the owner doesn't specifically
// point to this" signal than a direct link from a high-authority page.
//
// The fix is two real, direct links from the homepage to each specific
// post: a "From the blog" teaser section (one card per post) and a
// contextual in-prose link from the #honest section's verdict-note to
// the appliance-repair-or-replace post specifically, since that section
// is literally making the same argument the post expands on.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');

const POSTS = [
  'appliance-repair-or-replace.html',
  'dryer-not-heating.html',
  'handyman-to-do-list.html',
];

test('every blog post file referenced actually exists on disk', () => {
  for (const post of POSTS) {
    assert.ok(fs.existsSync(repo('blog', post)), `expected blog/${post} to exist`);
  }
});

test('the homepage links directly to each individual blog post, not just to /blog/', () => {
  for (const post of POSTS) {
    assert.match(INDEX, new RegExp(`href="/blog/${post}"`), `expected a direct link to /blog/${post}`);
  }
});

test('the "From the blog" teaser section has one real card per post, each with its own title and dek text, plus a link back to the full index', () => {
  const section = INDEX.match(/<section id="blog-teaser">[\s\S]*?<\/section>/);
  assert.ok(section, 'expected a #blog-teaser section');
  const html = section[0];
  const cards = [...html.matchAll(/<a class="blog-teaser-card"[^>]*href="([^"]+)"[\s\S]*?<h3>([^<]+)<\/h3>\s*<p>([^<]+)<\/p>/g)];
  assert.equal(cards.length, 3, 'expected exactly 3 teaser cards');
  for (const [, href, title, dek] of cards) {
    assert.match(href, /^\/blog\/[a-z-]+\.html$/);
    assert.ok(title.trim().length > 0);
    assert.ok(dek.trim().length > 0);
  }
  assert.match(html, /<p class="blog-teaser-more"><a href="\/blog\/">See all posts/);
});

test('the #honest section links to the appliance-repair-or-replace post as a contextual, in-prose link (not just the teaser grid)', () => {
  const section = INDEX.match(/<section id="honest">[\s\S]*?<\/section>/);
  assert.ok(section, 'expected a #honest section');
  assert.match(section[0], /<p class="verdict-note"[^>]*>[\s\S]*?<a href="\/blog\/appliance-repair-or-replace\.html">[^<]+<\/a>/);
});

test('the blog-teaser cards and "see all posts" link have real CSS (not just bare <a> tags)', () => {
  const CSS = fs.readFileSync(repo('styles.css'), 'utf8');
  assert.match(CSS, /\.blog-teaser-grid\{/);
  assert.match(CSS, /\.blog-teaser-card\{/);
  assert.match(CSS, /\.blog-teaser-more/);
});

test('the verdict-note contextual link has real link styling, not the unstyled default', () => {
  const CSS = fs.readFileSync(repo('styles.css'), 'utf8');
  assert.match(CSS, /\.verdict-note a\{/);
});

test('the service worker cache was bumped for this homepage/styles.css change', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 111, `expected v111 or later, got v${version}`);
});
