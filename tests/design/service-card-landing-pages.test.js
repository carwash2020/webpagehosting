// Service cards on the landing pages keep their own layout (2026-09-25, bug lane).
//
// Homepage v2 (#440) turned .service-card into a two-column grid (a 46px
// icon column, then the text) for the homepage's six icon cards. The same
// classes are shared with the 16 service/city landing pages, whose cards are
// text only (h3 + p, no .service-icon). Unscoped, every one of those cards
// got an empty 46px column: text started 85px in instead of 25px and lost
// about a fifth of its width, and the heading lost its 8px gap. The row
// layout now applies only to cards that have an icon.
//
// Text-only cards: the real styles.css is run against every page that uses
// .service-card, in jsdom, and the computed layout is checked. Icon cards:
// jsdom's CSS parser drops :has() rules, so the homepage half is checked
// in the stylesheet itself (the Chromium before/after is in bugfix.md).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const CSS = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const PAGES = ['index.html', 'about.html', 'our-work.html']
  .concat(['services', 'locations'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.html')).map((f) => d + '/' + f)))
  .filter((p) => fs.readFileSync(path.join(ROOT, p), 'utf8').includes('class="service-card'));

function cards(page) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8')
    .replace(/<link[^>]+href="\/styles\.css[^"]*"[^>]*>/, '<style>' + CSS + '</style>');
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  const win = dom.window;
  // jsdom never executes <script> content (runScripts is unset), so these are
  // inert either way; removed from the DOM rather than string-stripped before
  // parsing so there's no HTML-filtering regex to get wrong.
  win.document.querySelectorAll('script').forEach((s) => s.remove());
  return Array.from(win.document.querySelectorAll('.service-card')).map((el) => {
    const cs = win.getComputedStyle(el);
    const h3 = el.querySelector('h3');
    return {
      hasIcon: !!el.querySelector(':scope > .service-icon'),
      display: cs.display,
      columns: cs.gridTemplateColumns,
      h3MarginBottom: h3 ? win.getComputedStyle(h3).marginBottom : null,
    };
  });
}

test('the page set covers the homepage and the landing pages', () => {
  assert.ok(PAGES.includes('index.html'));
  assert.ok(PAGES.filter((p) => p.startsWith('services/') || p.startsWith('locations/')).length >= 16, PAGES.join(', '));
});

for (const page of PAGES) {
  test(`${page}: text-only service cards stay block with an 8px heading gap`, () => {
    const list = cards(page);
    assert.ok(list.length > 0);
    for (const c of list.filter((x) => !x.hasIcon)) {
      assert.equal(c.display, 'block', 'a text-only card became a ' + c.display + ' (' + c.columns + ')');
      assert.equal(c.h3MarginBottom, '8px');
    }
  });
}

// Top-level rules of styles.css as [selector, body] pairs.
function rules(css) {
  const out = [];
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) out.push([m[1].trim(), m[2]]);
  return out;
}

test('the homepage six are icon cards, and the row grid is scoped to icon cards', () => {
  assert.equal(cards('index.html').filter((c) => c.hasIcon).length, 6);
  const all = rules(CSS);
  const unscoped = all.filter(([sel, body]) => sel.split(',').some((s) => /^\.service-card$/.test(s.trim())) && /display\s*:\s*grid|grid-template-columns/.test(body));
  assert.equal(unscoped.length, 0, 'an unscoped .service-card rule sets a grid: ' + unscoped.map((r) => r[0]).join(' | '));
  const scoped = all.find(([sel]) => sel === '.service-card:has(> .service-icon)');
  assert.ok(scoped, 'no .service-card:has(> .service-icon) rule');
  assert.match(scoped[1], /display\s*:\s*grid/);
  assert.match(scoped[1], /grid-template-columns\s*:\s*46px 1fr/);
});
