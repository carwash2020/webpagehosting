// Skip links and a <main> landmark on every public page (2026-09-23).
// index, the city/service pages, terms and privacy already had a "Skip to
// main content" link; about, our-work and all 11 blog pages didn't, so a
// keyboard user tabbed through 11-12 header/nav stops (desktop) before
// reaching the content. The standalone 404 page had no <main> at all
// (axe: landmark-one-main + region), and its Anton "404" rendered in a
// browser-synthesized bold, because Anton ships only a 400 weight and the
// page never reset h1's default bold.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (p) => fs.readFileSync(repo(p), 'utf8');

// Pages with a real header, i.e. something to skip past. Redirect stubs
// and search-console verification files have no <header> and drop out.
const ALL = [
  ...fs.readdirSync(repo('.')).filter((f) => f.endsWith('.html')),
  ...['blog', 'locations', 'services'].flatMap((d) => fs.readdirSync(repo(d)).filter((f) => f.endsWith('.html')).map((f) => `${d}/${f}`)),
].filter((p) => /<header[\s>]/.test(read(p)));

const NOT_THIS_LANE = {
  'booking.html': 'booking lane',
  'manage-booking.html': 'booking lane',
  'manage-job.html': 'booking lane',
  'careers.html': 'waiting on a scope decision (logged in docs/specialist-logs/visual.md)',
};

test('the scan finds the public pages it should (so an exclusion typo cannot empty it)', () => {
  for (const p of ['index.html', 'about.html', 'our-work.html', 'terms.html', 'blog/index.html', 'locations/handyman-hurricane-ut.html', 'services/plumbing-repairs.html']) {
    assert.ok(ALL.includes(p), `${p} should be scanned`);
  }
  for (const p of Object.keys(NOT_THIS_LANE)) assert.ok(fs.existsSync(repo(p)), `stale exclusion: ${p}`);
});

for (const page of ALL.filter((p) => !NOT_THIS_LANE[p])) {
  test(`${page}: a skip link before <header> that targets the page's <main>`, () => {
    const html = read(page);
    const m = html.match(/<a href="#([\w-]+)" class="skip-link">Skip to main content<\/a>/);
    assert.ok(m, 'missing <a href="#..." class="skip-link">Skip to main content</a>');
    assert.ok(html.indexOf(m[0]) < html.search(/<header[\s>]/), 'the skip link must come before <header>, so it is the first Tab stop');
    const mains = html.match(/<main\b[^>]*>/g) || [];
    assert.equal(mains.length, 1, 'exactly one <main>');
    assert.match(mains[0], new RegExp(`\\bid="${m[1]}"`), `the skip link's #${m[1]} should be the <main> itself`);
    assert.equal((html.match(new RegExp(`\\bid="${m[1]}"`, 'g')) || []).length, 1, `id="${m[1]}" should be unique`);
  });
}

test('404.html: content sits in a <main>, laid out as the same centred column as before', () => {
  const html = read('404.html');
  const body = html.slice(html.indexOf('<body>'), html.indexOf('</body>'));
  assert.match(body, /^<body>\s*<main>[\s\S]*<h1>404<\/h1>[\s\S]*<\/main>\s*$/);
  assert.match(html, /\bmain\{display:flex; flex-direction:column; align-items:center;\}/);
});

test('404.html: the Anton heading asks for weight 400, the only weight Anton has', () => {
  const css = read('404.html').replace(/\/\*[\s\S]*?\*\//g, '');
  const h1 = css.match(/\bh1\{([^}]*)\}/);
  assert.ok(h1, 'missing the h1 rule');
  assert.match(h1[1], /font-family:var\(--font-display\);/);
  assert.match(h1[1], /font-weight:400;/);
});
