// 2026-09-29: the header's Services and Areas menus, restyled after Claude
// Design's first homepage prototype. Three of the changes fix real bugs,
// and this pins them:
// - St. George was missing from the Areas lists (desktop menu and mobile
//   sublist) on every page but the homepage: 7 towns instead of 8, so the
//   St. George page was unreachable from the nav on 38 pages.
// - The menu used the page's panel tokens but hardcoded #d8d8d8 rows, so
//   the light theme drew near-white rows on a white panel. It now pins the
//   dark theme's values, like the header it hangs from and the mobile menu.
// - The menu opens 14px below its link. Without a bridge across that gap,
//   a slow pointer moving down left the hover and the menu closed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const AREA_LINKS = [
  '/locations/handyman-st-george-ut.html',
  '/locations/handyman-washington-city-ut.html',
  '/locations/handyman-hurricane-ut.html',
  '/locations/handyman-santa-clara-ivins-ut.html',
  '/locations/handyman-leeds-ut.html',
  '/locations/handyman-la-verkin-ut.html',
  '/locations/handyman-cedar-city-ut.html',
  '/locations/handyman-mesquite-nv.html',
];

const PAGES = ['', 'locations', 'services', 'blog']
  .flatMap((dir) => fs.readdirSync(repo(dir)).filter((f) => f.endsWith('.html')).map((f) => (dir ? `${dir}/${f}` : f)))
  .filter((p) => fs.readFileSync(repo(p), 'utf8').includes('<li class="nav-dropdown">'));

function list(html, opener) {
  const at = html.indexOf(opener);
  assert.ok(at !== -1, `missing ${opener}`);
  return html.slice(at, html.indexOf('</ul>', at));
}

test('the header menus are on every public page that has a nav (39 of them)', () => {
  assert.ok(PAGES.length >= 39, `found ${PAGES.length} pages with the menus`);
});

for (const page of PAGES) {
  test(`${page}: both Areas lists carry all 8 towns, St. George first`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    const nav = html.slice(html.indexOf('<ul class="nav-links">'), html.indexOf('class="mobile-menu"'));
    const areasAt = nav.lastIndexOf('<li class="nav-dropdown">');
    const desktop = list(nav.slice(areasAt), '<ul class="nav-dropdown-menu">');
    const mobile = list(html, '<ul class="mobile-areas-sublist"');
    for (const [where, block] of [['desktop menu', desktop], ['mobile sublist', mobile]]) {
      const hrefs = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(hrefs, AREA_LINKS, `${page} ${where}`);
    }
  });
}

test('the menu pins the dark theme values, so light mode has no white-on-white rows', () => {
  const m = STYLES.match(/\.nav-links \.nav-dropdown-menu\{([^}]*)\}/);
  assert.ok(m, 'expected a .nav-links .nav-dropdown-menu rule');
  assert.match(m[1], /--bg-panel:#141414;/);
  assert.match(m[1], /--text:#e8e8e8;/);
  const rows = STYLES.match(/\.nav-links \.nav-dropdown-menu a\{([^}]*)\}/);
  assert.ok(rows, 'expected a .nav-links .nav-dropdown-menu a rule');
  assert.match(rows[1], /color:var\(--text\);/, 'rows take the pinned token, not a hardcoded grey');
  // the base rule still carries the theme-aware shadow the older test reads
  assert.match(STYLES.match(/\.nav-dropdown-menu\{([\s\S]*?)\}/)[1], /box-shadow:var\(--shadow-hover\)/);
});

test('a hover bridge spans the gap between each link and its menu', () => {
  const bridge = STYLES.match(/\.nav-dropdown::after\{([^}]*)\}/);
  assert.ok(bridge, 'expected a .nav-dropdown::after bridge');
  assert.match(bridge[1], /position:absolute;/);
  assert.match(bridge[1], /top:100%;/);
  const gap = Number(STYLES.match(/\.nav-links \.nav-dropdown-menu\{[^}]*margin-top:(\d+)px/)[1]);
  const height = Number(bridge[1].match(/height:(\d+)px/)[1]);
  assert.ok(height >= gap, `bridge ${height}px must cover the ${gap}px gap`);
});

test('the caret flips on hover only behind (hover:hover), and on keyboard focus always', () => {
  assert.match(STYLES, /\.nav-dropdown:focus-within > a::after\{[^}]*rotate\(225deg\)/);
  const hoverAt = STYLES.indexOf('.nav-dropdown:hover > a::after{');
  assert.ok(hoverAt !== -1);
  const before = STYLES.slice(0, hoverAt);
  const open = before.lastIndexOf('@media');
  assert.ok(open !== -1 && before.slice(open).startsWith('@media (hover:hover){'), 'the hover flip must sit inside @media (hover:hover)');
  assert.ok(before.slice(open).split('{').length - before.slice(open).split('}').length > 0, 'and still be inside it');
});

// 2026-09-29, later: the booking flow's three focused headers (logo and
// phone only, their own inline CSS, no styles.css) get the same two menus,
// as <details> disclosures between the logo and the phone number. On the
// booking form the links open in a new tab, because the form keeps
// nothing that has been typed if the page is left.
const SERVICE_LINKS = [
  '/services/washer-dryer-repair.html',
  '/services/plumbing-repairs.html',
  '/services/drywall-painting.html',
  '/services/handyman-repairs.html',
  '/services/assembly-installation.html',
];
const BOOKING_PAGES = ['booking.html', 'manage-booking.html', 'manage-job.html'];

for (const page of BOOKING_PAGES) {
  test(`${page}: the focused header carries the Services and Areas menus, and keeps its phone link`, () => {
    const html = fs.readFileSync(repo(page), 'utf8');
    const start = html.indexOf('<header class="site-header">');
    const header = html.slice(start, html.indexOf('</header>', start));
    const menus = [...header.matchAll(/<details class="bk-menu">\s*<summary>(\w+)<\/summary>([\s\S]*?)<\/details>/g)];
    assert.deepEqual(menus.map((m) => m[1]), ['Services', 'Areas']);
    const hrefs = (block) => [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(hrefs(menus[0][2]), SERVICE_LINKS, `${page} Services menu`);
    assert.deepEqual(hrefs(menus[1][2]), AREA_LINKS, `${page} Areas menu`);
    assert.match(header, /<a href="\/" class="brand">/, 'the logo still links home');
    assert.ok(header.indexOf('class="bk-menus"') < header.indexOf('class="phone-link'), 'menus sit between the logo and the phone link');
    assert.match(header, /class="phone-link js-phone-link js-phone-text"/, 'the phone link keeps its hooks');
    // styled on the page itself: these pages don't load styles.css
    assert.match(html, /\.bk-menu > summary::-webkit-details-marker\{display:none;\}/);
    assert.match(html, /\.bk-menu\[open\] > summary::after\{[^}]*rotate\(225deg\)/);
    assert.match(html, /@media \(max-width:379px\)\{[\s\S]*?\.bk-menus\{order:3; flex-basis:100%;/, 'narrow phones put the menus on their own row');
    assert.match(html, /<script>\n\/\/ Header menus \(2026-09-29\)[\s\S]*?e\.key !== 'Escape'/, 'Escape closes an open menu');
    const newTab = [...header.matchAll(/<a href="\/(?:services|locations)\/[^"]+"([^>]*)>/g)].map((m) => m[1]);
    assert.equal(newTab.length, 13);
    if (page === 'booking.html') {
      assert.ok(newTab.every((a) => a === ' target="_blank" rel="noopener"'), 'booking form links open in a new tab');
      assert.match(header, /Opens in a new tab, so your booking stays here\./);
    } else {
      assert.ok(newTab.every((a) => a === ''), `${page} links open in place`);
    }
  });
}
