// Cross-surface visual consistency, Phase 1 (2026-09-25, visual lane).
// See docs/specialist-logs/visual.md and docs/ACTION-ITEMS.md
// ("Cross-surface visual consistency plan").
//
// 1. Portal pages load /tools/styles-tools.css by absolute path. The tools/
//    freshness check never saw those references, so all 9 sat on a stale
//    stamp (a494344e8c) while tools/ moved on. It is a global shared file now.
// 2. The phone bottom nav measures 85px. Everything that clears it must
//    reserve at least that much (it was 76, so ~9px sat under the bar).
// 3. styles.css styles every bare <header> as the public site's sticky glass
//    header (sticky, z-index 60, a rgba(10,10,10,.88) ::before). A tool page
//    that uses <header> for a sub-heading gets a black sticky bar in light
//    mode. Workspace's lane headers are <div>s now.
// 4. portal-polish.css loads after styles-tools.css, so its unconditional
//    .small-btn 38px beat the 44px phone rule. Phones get 44px again.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const hash = (p) => crypto.createHash('sha256').update(read(p)).digest('hex').slice(0, 10);
const PORTAL_PAGES = fs.readdirSync(path.join(ROOT, 'portal')).filter((f) => f.endsWith('.html'));

test('tools/styles-tools.css is tracked as a global shared file by check-consistency.js', () => {
  const src = read('scripts/check-consistency.js');
  const list = src.match(/const GLOBAL_SHARED_FILES = \[([^\]]*)\]/);
  assert.ok(list, 'GLOBAL_SHARED_FILES not found');
  assert.match(list[1], /'tools\/styles-tools\.css'/);
});

test('every portal page that loads styles-tools.css requests its current content hash', () => {
  const real = hash('tools/styles-tools.css');
  let seen = 0;
  for (const page of PORTAL_PAGES) {
    const m = read('portal/' + page).match(/\/tools\/styles-tools\.css\?v=([a-zA-Z0-9]+)/);
    if (!m) continue;
    seen++;
    assert.equal(m[1], real, `portal/${page} requests styles-tools.css?v=${m[1]}, real hash is ${real}`);
  }
  assert.ok(seen >= 9, `expected the 9 portal pages to load styles-tools.css, found ${seen}`);
});

const BOTTOMNAV_MIN = 85;
for (const file of ['tools/styles-tools.css', 'tools/runway-dashboard.html']) {
  test(`${file}: everything that clears the phone bottom nav reserves at least ${BOTTOMNAV_MIN}px`, () => {
    const css = read(file);
    // Rules scoped to body.th-has-bottomnav that offset by "calc(Npx + env(safe-area-inset-bottom".
    // The job-clock variant (158px) stacks the clock bar on top and is excluded by its own class.
    const re = /body\.th-has-bottomnav(?!\.th-has-clock)[^{]*\{[^}]*?calc\((\d+)px \+ env\(safe-area-inset-bottom/g;
    let m, count = 0;
    while ((m = re.exec(css))) {
      count++;
      assert.ok(Number(m[1]) >= BOTTOMNAV_MIN, `${file}: "${m[0].slice(0, 90)}..." reserves ${m[1]}px, under the bar's ${BOTTOMNAV_MIN}px`);
    }
    assert.ok(count >= 2, `${file}: expected bottom-nav clearance rules, found ${count}`);
  });
}

test('tool pages do not use a bare <header> for sub-headings (styles.css makes every <header> the sticky public header)', () => {
  // runway-dashboard.html never loads styles.css (it's self-contained), so
  // its <header> never got the public bar (checked 2026-09-25, X4). It stays
  // a <header>: the shell pins Search/More to header#mainContent.
  const ALLOW = { 'runway-dashboard.html': /<header id="mainContent">/g };
  for (const page of fs.readdirSync(path.join(ROOT, 'tools')).filter((f) => f.endsWith('.html'))) {
    let src = read('tools/' + page);
    if (ALLOW[page]) src = src.replace(ALLOW[page], '');
    assert.doesNotMatch(src, /<header[\s>]/, `tools/${page} has a <header>; use a <div> (or reset the public header styles for it)`);
  }
  assert.equal((read('tools/workspace.html').match(/<div class="ops-lane-header">/g) || []).length, 4);
});

test('portal .small-btn is at least 44px tall on phones, and that rule comes after the 38px default', () => {
  const css = read('portal/portal-polish.css');
  const base = css.indexOf('.small-btn { min-height: 38px; }');
  const phone = css.indexOf('@media (max-width: 760px) { .small-btn { min-height: 44px; } }');
  assert.ok(base >= 0 && phone > base, 'expected the 44px phone rule after the 38px default in portal-polish.css');
  const later = css.slice(phone + 10).match(/\.small-btn\s*\{[^}]*min-height:\s*(\d+)px/g) || [];
  for (const r of later) assert.ok(Number(r.match(/(\d+)px/)[1]) >= 44, 'a later .small-btn rule drops below 44px: ' + r);
});

