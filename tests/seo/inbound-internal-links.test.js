// SEO-4: the weakest-linked public pages must keep real, crawlable inbound
// <a href> links from other public pages (never from redirect stubs, and
// never counting self-links), and no public page may link into /tools/.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tools', 'portal', 'backups', 'docs', 'edge-functions', 'sql', 'tests', 'scripts']);

function publicPages(dir = root, rel = '') {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) Object.assign(out, publicPages(path.join(dir, e.name), r));
    } else if (e.name.endsWith('.html') && !e.name.startsWith('google')) {
      const html = fs.readFileSync(path.join(dir, e.name), 'utf8');
      if (!/http-equiv=["']refresh/i.test(html)) out[r] = html;
    }
  }
  return out;
}

function resolve(href, from) {
  let h = href.split('#')[0].split('?')[0].replace(/^https?:\/\/(www\.)?triplehenterprisesllc\.biz/, '');
  if (!h || /^[a-z]+:/i.test(h) || h.startsWith('//')) return null;
  let u = h.startsWith('/') ? h.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), h));
  if (u === '' || u === '.' || u.endsWith('/')) u += 'index.html';
  return u;
}

function inbound() {
  const pages = publicPages();
  const map = {};
  for (const [src, html] of Object.entries(pages)) {
    for (const m of html.matchAll(/<a\b[^>]*?\bhref=["']([^"']+)["']/gi)) {
      const u = resolve(m[1], src);
      if (u && u !== src) (map[u] = map[u] || new Set()).add(src);
    }
  }
  return { pages, map };
}

const WEAK_TARGETS = {
  'blog/toilet-running-flapper-valve.html': 4,
  'blog/tv-mount-drywall-anchors.html': 4,
  'blog/oven-not-heating-right.html': 4,
  'blog/drywall-crack-above-door.html': 5,
  'blog/dryer-wont-turn-on.html': 5,
  'about.html': 6,
  'careers.html': 4,
};

test('weakest-linked pages keep a healthy number of distinct inbound links', () => {
  const { map } = inbound();
  for (const [target, min] of Object.entries(WEAK_TARGETS)) {
    const n = (map[target] || new Set()).size;
    assert.ok(n >= min, `${target} has ${n} distinct inbound pages, expected at least ${min}`);
  }
});

test('homepage links the three St. George appliance pages and a guides block of 3-5 posts', () => {
  const { pages } = inbound();
  const home = pages['index.html'];
  for (const p of ['washer-dryer-repair', 'refrigerator-repair', 'dishwasher-repair']) {
    assert.match(home, new RegExp(`href="/services/${p}-st-george-ut\\.html"`), `homepage should link ${p}`);
  }
  const block = home.slice(home.indexOf('Helpful guides'));
  const posts = new Set([...block.matchAll(/href="\/blog\/([a-z0-9-]+)\.html"/g)].map((m) => m[1]));
  assert.ok(posts.size >= 3 && posts.size <= 5, `Helpful guides block should list 3-5 posts, found ${posts.size}`);
});

test('discovered-not-indexed URLs have a contextual link from a hub, outside the capped Helpful guides block', () => {
  const { pages } = inbound();
  const home = pages['index.html'];
  const services = home.slice(home.indexOf('<section id="services">'), home.indexOf('<aside class="schedule-rail"'));
  assert.match(services, /href="\/services\/washer-dryer-repair\.html"/);
  assert.match(services, /href="\/services\/plumbing-repairs\.html"/);

  const teaser = home.match(/<section id="blog-teaser">[\s\S]*?<\/section>/)[0];
  for (const post of ['washer-wont-spin', 'washer-leaking-water', 'dishwasher-not-draining', 'dishwasher-leaking', 'ice-maker-not-working']) {
    assert.match(teaser, new RegExp(`href="/blog/${post}\\.html"`), `homepage blog teaser should link ${post}`);
  }

  const about = pages['about.html'].slice(pages['about.html'].indexOf('<main'), pages['about.html'].indexOf('<footer'));
  for (const href of [
    '/services/washer-dryer-repair.html',
    '/services/washer-dryer-repair-st-george-ut.html',
    '/services/refrigerator-repair-st-george-ut.html',
    '/services/dishwasher-repair-st-george-ut.html',
    '/services/plumbing-repairs.html',
    '/services/drywall-painting.html',
    '/services/handyman-repairs.html',
    '/services/assembly-installation.html',
    '/blog/ice-maker-not-working.html',
    '/locations/handyman-hurricane-ut.html',
    '/locations/handyman-washington-city-ut.html',
    '/locations/handyman-santa-clara-ivins-ut.html',
    '/locations/handyman-leeds-ut.html',
    '/locations/handyman-la-verkin-ut.html',
    '/locations/handyman-cedar-city-ut.html',
    '/locations/handyman-mesquite-nv.html',
  ]) {
    assert.ok(about.includes(`href="${href}"`), `about.html should link ${href} in the body`);
  }

  assert.match(pages['blog/dishwasher-not-cleaning.html'], /href="\/blog\/dishwasher-leaking\.html"/);
  assert.match(pages['blog/washer-leaking-water.html'], /href="\/blog\/washer-wont-spin\.html"/);
});

test('no public page links into /tools/', () => {
  const { pages } = inbound();
  for (const [file, html] of Object.entries(pages)) {
    const hrefs = [...html.matchAll(/<a\b[^>]*?\bhref=["']([^"']+)["']/gi)].map((m) => m[1]);
    assert.deepEqual(hrefs.filter((h) => /^\/tools\//.test(h)), [], `${file} links into /tools/`);
  }
});

test('internal links never point at a redirect stub', () => {
  const { pages, map } = inbound();
  for (const target of Object.keys(map)) {
    const abs = path.join(root, target);
    if (!target.endsWith('.html') || !fs.existsSync(abs)) continue;
    if (/http-equiv=["']refresh/i.test(fs.readFileSync(abs, 'utf8'))) {
      assert.fail(`${[...map[target]].join(', ')} link to redirect stub ${target}`);
    }
  }
  assert.ok(Object.keys(pages).length > 20);
});
