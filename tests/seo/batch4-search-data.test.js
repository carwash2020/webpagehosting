// Batch 4 (2026-09-30): search-data fixes from the 2026-09-25 SEO audit,
// plus the link checker and Lighthouse drift the automation lane logged.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const SITE = 'https://www.triplehenterprisesllc.biz';

function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

test('the homepage business lists every town it has a standard-coverage page for', () => {
  const biz = jsonLd(read('index.html')).find((d) => d.areaServed);
  for (const town of ['St. George, UT', 'Hurricane, UT', 'Washington, UT', 'Santa Clara, UT', 'Ivins, UT', 'La Verkin, UT', 'Leeds, UT', 'Cedar City, UT', 'Mesquite, NV']) {
    assert.ok(biz.areaServed.includes(town), town);
  }
});

test('the careers JobPosting uses only real Google values and has a postal code and breadcrumb', () => {
  const blocks = jsonLd(read('careers.html'));
  const job = blocks.find((d) => d['@type'] === 'JobPosting');
  assert.equal(job.jobLocationType, undefined, 'TELECOMMUTE is the only valid value; an on-site job omits it');
  assert.equal(job.jobLocation.address.postalCode, '84790');
  const crumbs = blocks.find((d) => d['@type'] === 'BreadcrumbList');
  assert.deepEqual(crumbs.itemListElement.map((i) => i.item), [`${SITE}/`, `${SITE}/careers.html`]);
});

test('every blog Article names its image and the page it belongs to', () => {
  const posts = fs.readdirSync(repo('blog')).filter((f) => f.endsWith('.html') && f !== 'index.html');
  assert.equal(posts.length, 16);
  for (const f of posts) {
    const html = read('blog', f);
    const art = jsonLd(html).find((d) => d['@type'] === 'Article');
    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)[1];
    const ogImage = html.match(/<meta property="og:image" content="([^"]+)">/)[1];
    assert.equal(art.image, ogImage, `${f}: the post's own share card`);
    assert.ok(fs.existsSync(repo(art.image.replace(SITE + '/', ''))), `${f}: image file exists`);
    assert.deepEqual(art.mainEntityOfPage, { '@type': 'WebPage', '@id': canonical }, f);
  }
});

test('blog index and booking carry a large twitter card like every other public page', () => {
  for (const f of ['blog/index.html', 'booking.html']) {
    assert.match(read(f), /<meta name="twitter:card" content="summary_large_image">/, f);
  }
});

test('the sitemap dates for the homepage and booking page reflect their recent redesigns', () => {
  const sm = read('sitemap.xml');
  assert.match(sm, /<loc>https:\/\/www\.triplehenterprisesllc\.biz\/<\/loc>\n\s*<lastmod>2026-09-29<\/lastmod>/);
  assert.match(sm, /<loc>https:\/\/www\.triplehenterprisesllc\.biz\/booking\.html<\/loc>\n\s*<lastmod>2026-09-30<\/lastmod>/);
});

test('each AI answer bot is kept out of the internal paths too (it reads only its own group)', () => {
  const robots = read('robots.txt');
  for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User']) {
    const block = robots.match(new RegExp(`User-agent: ${bot}\\n([\\s\\S]*?)(?:\\n\\n|$)`))[1];
    assert.match(block, /^Allow: \/$/m, bot);
    for (const p of ['/.claude/', '/tools/', '/portal/']) assert.ok(block.includes(`Disallow: ${p}`), `${bot} ${p}`);
  }
});

test('Lighthouse audits the real Hurricane page, not the redirect stub', () => {
  const lh = read('.github', 'workflows', 'lighthouse.yml');
  assert.match(lh, /https:\/\/www\.triplehenterprisesllc\.biz\/locations\/handyman-hurricane-ut\.html/);
  assert.doesNotMatch(lh, /triplehenterprisesllc\.biz\/handyman-hurricane-ut\.html/);
});

test('the link checker reports a proxy refusal as unverifiable and describes its real page list', () => {
  const src = read('scripts', 'check-links.py');
  assert.match(src, /if 'Tunnel connection failed' in str\(e\):\n[\s\S]*?unverifiable\.append/);
  assert.doesNotMatch(src, /the 7 landing\s+pages/);
  assert.doesNotMatch(read('.github', 'workflows', 'check-links.yml'), /6 public pages/);
});
