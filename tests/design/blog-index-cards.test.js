// Blog index visual upgrade (2026-09-07): the 3 posts were plain
// stacked linked-title + dek text with no card treatment, icon, or
// hover state -- a noticeably plainer treatment than the rest of the
// site. Converts each into a full-card link reusing the exact
// hover-lift/icon-badge vocabulary already established by index.html's
// own .service-card/.service-icon, and an icon already used elsewhere
// on the site for that post's subject (not a new icon language).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('blog', 'index.html'), 'utf8');
const BLOG_CSS = fs.readFileSync(repo('blog', 'blog.css'), 'utf8');

const POST_PAGES = ['dryer-not-heating.html', 'handyman-to-do-list.html', 'appliance-repair-or-replace.html', 'washer-wont-drain.html', 'dishwasher-not-cleaning.html', 'fridge-not-cooling.html'];

test('the whole card is a single link per post, not just the title', () => {
  const items = [...INDEX.matchAll(/<a class="blog-index-item" href="\/blog\/([a-z-]+\.html)" data-reveal>/g)];
  assert.equal(items.length, 6, 'expected exactly 6 blog-index-item cards');
  assert.deepEqual(items.map((m) => m[1]).sort(), [...POST_PAGES].sort());
});

test('each card carries an icon badge and a "Read the post" tag with the shared arrow glyph', () => {
  const cards = [...INDEX.matchAll(/<a class="blog-index-item"[\s\S]*?<\/a>/g)].map((m) => m[0]);
  assert.equal(cards.length, 6);
  cards.forEach((card) => {
    assert.match(card, /<div class="blog-index-item-icon"><svg viewBox="0 0 24 24"/);
    assert.match(card, /<span class="blog-index-item-tag">Read the post <svg viewBox="0 0 24 24"[^>]*><path d="M9 18l6-6-6-6"\/><\/svg><\/span>/);
  });
});

test('the two appliance posts reuse the exact appliance icon already used by the homepage service card, not a new shape', () => {
  const applianceIconPath = '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><circle cx="12" cy="15" r="3"/>';
  const dryerCard = INDEX.slice(INDEX.indexOf('dryer-not-heating.html'), INDEX.indexOf('handyman-to-do-list.html'));
  const repairOrReplaceCard = INDEX.slice(INDEX.indexOf('appliance-repair-or-replace.html'));
  assert.ok(dryerCard.includes(applianceIconPath));
  assert.ok(repairOrReplaceCard.includes(applianceIconPath));
});

test('the general-repairs post reuses the exact handyman icon already used by the homepage service card', () => {
  const handymanIconPath = '<path d="M14.7 6.3a4 4 0 1 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2.1-2.1z"/>';
  const todoCard = INDEX.slice(INDEX.indexOf('handyman-to-do-list.html'), INDEX.indexOf('appliance-repair-or-replace.html'));
  assert.ok(todoCard.includes(handymanIconPath));
});

test('the card hover-lift reuses the exact transform/shadow values already established by .service-card, not new invented numbers', () => {
  assert.match(BLOG_CSS, /\.blog-index-item:hover, \.blog-index-item:focus-visible \{\s*transform: translateY\(-4px\);\s*border-color: var\(--blue-text\);\s*box-shadow: 0 14px 28px rgba\(0,0,0,0\.14\);\s*\}/);
});

test('each item is revealed via the shared site-wide [data-reveal] mechanism, with a stagger between cards', () => {
  assert.match(BLOG_CSS, /html\.reveal-ready \.blog-index-list \[data-reveal\]:nth-child\(2\) \{ transition-delay: \.08s; \}/);
  assert.match(BLOG_CSS, /html\.reveal-ready \.blog-index-list \[data-reveal\]:nth-child\(3\) \{ transition-delay: \.16s; \}/);
});

test('blog.css version stamp matches across the index page and all individual post pages', () => {
  const versions = new Set();
  for (const page of ['index.html', ...POST_PAGES]) {
    const html = fs.readFileSync(repo('blog', page), 'utf8');
    const m = html.match(/blog\/blog\.css\?v=([a-zA-Z0-9]+)/);
    assert.ok(m, `${page} should load /blog/blog.css with a ?v= cache-bust param`);
    versions.add(m[1]);
  }
  assert.equal(versions.size, 1, `expected one shared blog.css version, got ${[...versions].join(', ')}`);
});
