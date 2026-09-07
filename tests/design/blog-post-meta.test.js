// Published date + reading time on individual blog posts (2026-09-07).
// blog.css already had a real .blog-meta rule (padding, font-size,
// color) that was never actually used anywhere -- dead CSS, found by
// grepping for its selector across the blog pages. The publish date
// already existed as schema.org datePublished in each post's own
// JSON-LD block (for SEO) but was never shown to a human reader. This
// reads that same value rather than duplicating it as a second date
// that could drift, and pairs it with a real reading-time estimate
// computed from the post's own actual word count (200wpm), not an
// invented number.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const POSTS = ['dryer-not-heating.html', 'appliance-repair-or-replace.html', 'handyman-to-do-list.html'];

for (const post of POSTS) {
  const html = fs.readFileSync(repo('blog', post), 'utf8');

  test(`${post}: has a #blogMeta element right after the dek, and the computing script`, () => {
    assert.match(html, /<p class="blog-dek">[^<]*<\/p>\s*<p class="blog-meta" id="blogMeta"><\/p>/);
    assert.match(html, /document\.getElementById\('blogMeta'\)/);
  });

  test(`${post}: real end-to-end render produces a date and a plausible read time from the post's own content`, () => {
    const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'https://example.com/blog/' + post });
    return new Promise((resolve, reject) => {
      dom.window.addEventListener('load', () => {
        try {
          const metaEl = dom.window.document.getElementById('blogMeta');
          assert.ok(metaEl, 'expected #blogMeta to exist');
          const text = metaEl.textContent;
          assert.match(text, /^[A-Z][a-z]+ \d{1,2}, \d{4} · \d+ min read$/, `unexpected blogMeta text: "${text}"`);

          const ld = JSON.parse(dom.window.document.querySelector('script[type="application/ld+json"]').textContent);
          const expectedDate = new dom.window.Date(ld.datePublished + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
          assert.ok(text.startsWith(expectedDate), `expected blogMeta to start with the real datePublished (${expectedDate}), got "${text}"`);

          const article = dom.window.document.querySelector('.blog-article');
          const wordCount = article.textContent.trim().split(/\s+/).filter(Boolean).length;
          const expectedMinutes = Math.max(1, Math.round(wordCount / 200));
          assert.ok(text.includes(expectedMinutes + ' min read'), `expected ${expectedMinutes} min read (word count ${wordCount}) in "${text}"`);

          dom.window.close();
          resolve();
        } catch (e) {
          dom.window.close();
          reject(e);
        }
      });
    });
  });
}
