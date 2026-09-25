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

const POST_PAGES = ['dryer-not-heating.html', 'handyman-to-do-list.html', 'appliance-repair-or-replace.html', 'washer-wont-drain.html', 'dishwasher-not-cleaning.html', 'fridge-not-cooling.html', 'toilet-running-flapper-valve.html', 'drywall-crack-above-door.html', 'tv-mount-drywall-anchors.html', 'oven-not-heating-right.html', 'washer-leaking-water.html', 'dryer-wont-turn-on.html', 'dishwasher-not-draining.html', 'washer-wont-spin.html', 'dishwasher-leaking.html', 'ice-maker-not-working.html'];

test('the whole card is a single link per post, not just the title', () => {
  const items = [...INDEX.matchAll(/<a class="blog-index-item" href="\/blog\/([a-z-]+\.html)" data-reveal>/g)];
  assert.equal(items.length, 16, 'expected exactly 16 blog-index-item cards');
  assert.deepEqual(items.map((m) => m[1]).sort(), [...POST_PAGES].sort());
});

test('each card carries an icon badge and a "Read the post" tag with the shared arrow glyph', () => {
  const cards = [...INDEX.matchAll(/<a class="blog-index-item"[\s\S]*?<\/a>/g)].map((m) => m[0]);
  assert.equal(cards.length, 16);
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
  // Since 2026-09-23 the hover half sits behind @media (hover: hover) (no
  // sticky hover after a tap on phones) and keyboard focus has its own
  // rule -- both with the same values.
  const lift = 'transform: translateY\\(-4px\\);\\s*border-color: var\\(--blue-text\\);\\s*box-shadow: 0 14px 28px rgba\\(0,0,0,0\\.14\\);';
  assert.match(BLOG_CSS, new RegExp(`@media \\(hover: hover\\) \\{\\s*\\.blog-index-item:hover \\{\\s*${lift}\\s*\\}`));
  assert.match(BLOG_CSS, new RegExp(`\\n\\.blog-index-item:focus-visible \\{\\s*${lift}\\s*\\}`));
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

// 2026-09-23: the card markup is also reused outside /blog/ (service
// pages' "Recent Notes From the Shop"), but its styles live only in
// blog.css. Four service pages reused the markup without loading that
// file, and each card's inline SVG icon and arrow grew to fill the
// page (820x820px on desktop). Any public page that uses the markup
// has to load blog.css, at the same version the blog itself uses.
test('every public page that uses the blog card markup also loads blog.css at the shared version', () => {
  const blogVersion = INDEX.match(/blog\/blog\.css\?v=([a-zA-Z0-9]+)/)[1];
  const pages = [
    ...fs.readdirSync(repo()).filter((f) => f.endsWith('.html')),
    ...['locations', 'services', 'blog'].flatMap((dir) =>
      fs.readdirSync(repo(dir)).filter((f) => f.endsWith('.html')).map((f) => `${dir}/${f}`)),
  ];
  const users = pages.filter((p) => /class="blog-index-/.test(fs.readFileSync(repo(p), 'utf8')));
  assert.ok(users.length >= 9, `expected the blog index plus the service pages, found ${users.join(', ')}`);
  for (const page of users) {
    const html = fs.readFileSync(repo(page), 'utf8');
    const m = html.match(/<link rel="stylesheet" href="\/blog\/blog\.css\?v=([a-zA-Z0-9]+)">/);
    assert.ok(m, `${page} uses .blog-index-* markup but never loads /blog/blog.css`);
    assert.equal(m[1], blogVersion, `${page} loads blog.css?v=${m[1]}, the blog uses ?v=${blogVersion}`);
  }
});
