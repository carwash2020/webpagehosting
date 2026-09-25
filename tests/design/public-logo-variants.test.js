// Public-page logo variants (2026-09-25). The header/footer logo was a
// 51-57KB webp at 531-550px, drawn at 38-44px. Public pages now use a
// 176px copy of the same crop (covers 44px up to 4x), and the two larger
// slots -- the homepage hero badge (96px on phones, ~420px on desktop) and
// the 404 mark (100px) -- pick between 176/288/550 with srcset.
//
// tools/ and portal/ are out of scope and keep the full-size file.
//
// 288 is 96 x 3 on purpose. A 300px file drawn at 288 device pixels on a
// 3x phone was a 0.96 resample, and it visibly smeared the rivets and
// texture. At exactly 3x it is drawn 1:1.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const repo = (...p) => path.join(ROOT, ...p);
const SKIP = new Set(['tools', 'portal', 'backups', 'node_modules', 'tests', 'docs', '.git', '.claude']);

function publicHtml(dir = ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : publicHtml(path.join(dir, e.name));
    return e.name.endsWith('.html') ? [path.relative(ROOT, path.join(dir, e.name))] : [];
  });
}

// Canvas size from a webp's VP8X chunk (all logo files carry alpha, so they have one).
function webpSize(file) {
  const b = fs.readFileSync(repo(file));
  assert.equal(b.toString('ascii', 12, 16), 'VP8X', `${file}: expected a VP8X webp`);
  return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
}

const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
const fileOf = (url) => url.replace(/^\//, '').replace(/\?.*$/, '');

const TAGS = publicHtml().flatMap((file) => {
  const src = fs.readFileSync(repo(file), 'utf8');
  return [...src.matchAll(/<img\b[^>]*logo-signature[^>]*>/g)].map((m) => ({ file, tag: m[0], before: src.slice(Math.max(0, m.index - 400), m.index) }));
});
const slotOf = ({ file, before }) => {
  const last = (s) => before.lastIndexOf(s);
  if (file === '404.html') return '404';
  const hero = last('class="hero-badge"'), brand = last('class="brand"'), footer = last('class="footer-brand"');
  const top = Math.max(hero, brand, footer);
  return top === -1 ? 'unknown' : top === hero ? 'hero' : top === footer ? 'footer' : 'brand';
};

const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const px = (css, re) => Number((css.match(re) || [])[1]);

test('the variant files exist, keep their source crop, and are much smaller', () => {
  for (const [variant, source, width] of [
    ['images/logo-signature-176.webp', 'images/logo-signature.webp', 176],
    ['images/logo-signature-288.webp', 'images/logo-signature.webp', 288],
    ['images/logo-signature-orange-176.webp', 'images/logo-signature-orange.webp', 176],
  ]) {
    const v = webpSize(variant), s = webpSize(source);
    assert.equal(v.w, width, `${variant} width`);
    assert.ok(Math.abs(v.w / v.h - s.w / s.h) < 0.005, `${variant} has a different aspect ratio from ${source}`);
    assert.ok(fs.statSync(repo(variant)).size < fs.statSync(repo(source)).size / 2, `${variant} is not meaningfully smaller`);
  }
});

test('every public logo tag sits in a known slot and uses a small variant', () => {
  assert.ok(TAGS.length >= 70, `expected ~71 public logo tags, found ${TAGS.length}`);
  for (const t of TAGS) {
    const slot = slotOf(t);
    assert.notEqual(slot, 'unknown', `${t.file}: logo tag outside the header, footer, hero or 404 slot -- decide its size and add it here`);
    const candidates = [attr(t.tag, 'src'), ...(attr(t.tag, 'srcset') || '').split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean)];
    assert.ok(candidates.some((u) => /-(176|288)\.webp/.test(u)), `${t.file} ${slot}: still only offers the full-size logo`);
  }
});

test('every logo URL carries a ?v= stamp, so the service worker serves it cache-first', () => {
  for (const t of TAGS) {
    for (const u of [attr(t.tag, 'src'), ...(attr(t.tag, 'srcset') || '').split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean)]) {
      assert.match(u, /\?v=\w+$/, `${t.file}: ${u} has no ?v= stamp`);
      assert.ok(fs.existsSync(repo(fileOf(u))), `${t.file}: ${u} does not exist`);
    }
  }
});

test('width/height match the src file and srcset widths match the real files', () => {
  for (const t of TAGS) {
    const s = webpSize(fileOf(attr(t.tag, 'src')));
    assert.equal(`${attr(t.tag, 'width')}x${attr(t.tag, 'height')}`, `${s.w}x${s.h}`, `${t.file}: width/height don't match ${attr(t.tag, 'src')}`);
    const srcset = attr(t.tag, 'srcset');
    if (!srcset) continue;
    assert.ok(attr(t.tag, 'sizes'), `${t.file}: srcset without sizes`);
    for (const c of srcset.split(',')) {
      const [u, d] = c.trim().split(/\s+/);
      assert.equal(d, `${webpSize(fileOf(u)).w}w`, `${t.file}: ${u} is listed as ${d}`);
    }
  }
});

test('fixed-size header/footer slots get at least 3x their CSS size from a plain src', () => {
  const header = px(STYLES, /\.brand img\{height:(\d+)px; width:\1px;/);
  const footer = px(STYLES, /\.footer-brand img\{height:(\d+)px; width:\1px;/);
  assert.equal(header, 44);
  assert.equal(footer, 38);
  for (const page of ['booking.html', 'manage-booking.html', 'manage-job.html']) {
    assert.equal(px(fs.readFileSync(repo(page), 'utf8'), /\.brand img\{width:(\d+)px; height:auto;\}/), 38, `${page} header logo size changed`);
  }
  for (const t of TAGS.filter((x) => ['brand', 'footer'].includes(slotOf(x)))) {
    const need = (slotOf(t) === 'footer' ? footer : t.file.endsWith('booking.html') || t.file === 'manage-job.html' ? 38 : header) * 3;
    assert.ok(webpSize(fileOf(attr(t.tag, 'src'))).w >= need, `${t.file}: ${attr(t.tag, 'src')} is under ${need}px`);
  }
});

test('the hero badge sizes match styles.css, with an exact 3x candidate for the phone size', () => {
  const phone = px(STYLES, /@media \(max-width:860px\)\{[\s\S]*?\.hero-badge img\{width:(\d+)px;/);
  const desktop = px(STYLES, /\.hero-badge img\{\s*width:min\((\d+)px, 100%\);/);
  assert.equal(phone, 96);
  assert.equal(desktop, 440);
  const hero = TAGS.filter((t) => slotOf(t) === 'hero');
  assert.equal(hero.length, 1);
  assert.equal(attr(hero[0].tag, 'sizes'), `(max-width: 860px) ${phone}px, ${desktop}px`);
  assert.match(attr(hero[0].tag, 'srcset'), new RegExp(`\\s${phone * 3}w`), 'no candidate drawn 1:1 on a 3x phone');
  assert.match(attr(hero[0].tag, 'src'), /logo-signature\.webp/, 'desktop fallback should stay the full-size file');
});

test('the homepage header and footer switch to the hero file above 860px instead of adding a second download', () => {
  const home = TAGS.filter((t) => t.file === 'index.html' && ['brand', 'footer'].includes(slotOf(t)));
  assert.equal(home.length, 2);
  const heroFull = attr(TAGS.find((t) => slotOf(t) === 'hero').tag, 'src');
  for (const t of home) {
    assert.match(attr(t.tag, 'sizes'), /^\(max-width: 860px\) \d+px, 440px$/);
    assert.ok(attr(t.tag, 'srcset').includes(`${heroFull} 550w`), 'must list the exact same URL as the hero, or the browser downloads both');
  }
});

test('the 404 mark sizes match its own inline CSS', () => {
  const page = fs.readFileSync(repo('404.html'), 'utf8');
  const width = px(page, /\n\s*img\{width:(\d+)px; height:auto;/);
  assert.equal(width, 100);
  const t = TAGS.find((x) => x.file === '404.html');
  assert.equal(attr(t.tag, 'sizes'), `${width}px`);
});
