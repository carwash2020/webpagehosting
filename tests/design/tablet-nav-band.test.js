// Tablet band + header chrome (2026-09-21), from the "make the tools
// suite simpler and more app-like" pass.
//
// 1. The phone bottom bar used to stop at 720px and the desktop sidebar
//    only starts at 1024px, so any window in between -- an iPad, a
//    half-screen desktop browser -- had NO navigation on any tool page;
//    the only way out was the browser's own back button. The bar (and
//    its More sheet, and the body padding that clears it) now run right
//    up to the sidebar's breakpoint, so the two are complementary and
//    exactly one is on screen at every width. runway-dashboard.html
//    keeps its own copy of the shared nav CSS, so it is checked too.
// 2. With Home always one tap away in the bar or the sidebar, the header
//    back-to-Workspace arrow on eleven pages was a third copy of the
//    same link. One shared rule hides it wherever the nav shell is
//    present; the markup stays (other tests read it, and a page that
//    ever loads without the shell keeps its way home).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
const STYLES = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');
const RUNWAY = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');

function breakpoints(css, label) {
  const bar = css.match(/@media \(max-width: (\d+)px\) \{ \.th-bottom-nav \{ display: flex/);
  const sidebar = css.match(/@media \(min-width: (\d+)px\) \{ \.th-desktop-sidebar \{ display: flex/);
  const sheet = css.match(/@media \(min-width: (\d+)px\) \{ \.th-more-sheet \{ display: none !important; \} \}/);
  const pad = css.match(/@media \(max-width: (\d+)px\) \{ body\.th-has-bottomnav \{ padding-bottom: calc\(76px \+ env\(safe-area-inset-bottom, 0px\)\); \} \}/);
  assert.ok(bar && sidebar && sheet && pad, label + ': expected the four breakpoint rules to be present in their exact one-line form');
  return { bar: Number(bar[1]), sidebar: Number(sidebar[1]), sheet: Number(sheet[1]), pad: Number(pad[1]) };
}

for (const [label, css] of [['styles-tools.css', STYLES], ['runway-dashboard.html', RUNWAY]]) {
  test(`${label}: the bottom bar shows at every width below the sidebar's breakpoint -- no band is left with neither nav`, () => {
    const bp = breakpoints(css, label);
    assert.equal(bp.sidebar, 1024, 'the sidebar breakpoint is the fixed point every other rule keys off');
    assert.equal(bp.bar, bp.sidebar - 1, 'the bar must run right up to the sidebar breakpoint');
    assert.equal(bp.sheet, bp.sidebar, 'the More sheet must stay usable wherever the bar (and its More button) is shown');
    assert.equal(bp.pad, bp.bar, 'content must clear the fixed bar wherever the bar is shown');
  });

  test(`${label}: the view-transition-name for the bar is scoped to the same complementary breakpoint as its display rule`, () => {
    assert.match(css, /@media \(max-width: 1023px\) \{ \.th-bottom-nav \{ view-transition-name: th-app-bottomnav; \} \}/);
    assert.match(css, /@media \(min-width: 1024px\) \{ \.th-desktop-sidebar \{ view-transition-name: th-app-sidebar; \} \}/);
  });

  test(`${label}: in the tablet band the five bar items cluster at the centre and the More sheet becomes a centred card`, () => {
    const band = css.match(/@media \(min-width: 721px\) and \(max-width: 1023px\) \{([\s\S]*?)\n\s*\}/);
    assert.ok(band, 'expected a tablet-band block');
    assert.match(band[1], /\.th-bottom-nav \{ justify-content: center; gap: 24px; \}/);
    assert.match(band[1], /\.th-bottom-nav a, \.th-bottom-nav \.th-bn-more \{ max-width: 96px; \}/);
    assert.match(band[1], /\.th-more-sheet-panel \{ max-width: 560px; margin: 0 auto; \}/);
  });
}

test('the phone-only block no longer carries the body bottom padding (it moved to the bar\'s own breakpoint), but keeps its phone typography and gutter rules', () => {
  const mobileBlock = STYLES.match(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/);
  assert.ok(mobileBlock);
  assert.doesNotMatch(mobileBlock[1], /th-has-bottomnav/);
  assert.match(mobileBlock[1], /body\.th-tool-page \{ padding-left: 12px; padding-right: 12px; padding-top: 12px; \}/);
  assert.match(mobileBlock[1], /body \.hub-title \{ font-size: 20px; \}/);
});

test('the floating flag and search buttons already sat above a bar that was not there in the tablet band -- their offsets key off the same 1024px, so they now line up with a real bar', () => {
  assert.match(STYLES, /@media \(min-width: 1024px\) \{ \.th-flag-btn \{ bottom: 16px; \} \}/);
  assert.match(STYLES, /@media \(min-width: 1024px\) \{ \.th-cmdk-btn \{ display: none; \} \}/);
  const flag = STYLES.match(/\.th-flag-btn \{([^}]*)\}/)[1];
  assert.match(flag, /bottom: calc\(76px \+ env\(safe-area-inset-bottom, 0px\) \+ 16px\);/);
});

// Eight pages label it "Back to Workspace", three "Back to Dashboard";
// the shared rule keys off href + class, so the label does not matter.
const ARROW = /<a href="\/tools\/workspace\.html" class="help-btn" aria-label="Back to (Workspace|Dashboard)"/;
const PAGES_WITH_ARROW = [
  'client-detail.html', 'clients.html', 'contract-generator.html', 'dev-tools.html',
  'finance.html', 'invoice-generator.html', 'job-tracker.html', 'parts-reference.html',
  'review-request.html', 'route-planner.html', 'settings.html',
];

test('runway-dashboard.html hides its own text "Back to Workspace" link the same way (it has no .hub-header, so it needs its own rule)', () => {
  assert.match(RUNWAY, /<a href="\/tools\/workspace\.html" class="back-link">&larr; Back to Workspace<\/a>/, 'markup stays');
  assert.match(RUNWAY, /body\.th-has-bottomnav \.back-link \{ display: none; \}/);
});

test('one shared rule hides the header back-to-Workspace arrow wherever the nav shell (bar or sidebar, which always carries Home) is present', () => {
  // !important: the anchor has an inline display:inline-flex on every page.
  assert.match(STYLES, /body\.th-has-bottomnav \.hub-header-right > a\.help-btn\[href="\/tools\/workspace\.html"\] \{ display: none !important; \}/);
  for (const page of PAGES_WITH_ARROW) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.match(src, /<a href="\/tools\/workspace\.html" class="help-btn"[^>]*style="[^"]*display:inline-flex/, `${page}: the inline display the rule has to beat`);
  }
  // The two body classes the rule relies on are set together, unconditionally, by inject().
  const NAV = fs.readFileSync(path.join(TOOLS_DIR, 'tools-nav-pwa.js'), 'utf8');
  const injectFn = NAV.slice(NAV.indexOf('function inject()'), NAV.indexOf('function inject()') + 400);
  assert.match(injectFn, /document\.body\.classList\.add\('th-has-bottomnav'\);\s*injectSidebar\(\);/);
});

test('the arrow markup itself stays on every page that had it, so nothing is lost if a page ever renders without the shell', () => {
  for (const page of PAGES_WITH_ARROW) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.match(src, ARROW, `${page} should keep its back-arrow markup`);
  }
  const workspace = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.doesNotMatch(workspace, ARROW, 'the dashboard never had an arrow to itself');
  // Real "up one level" arrows are not Home and stay visible: the rule's
  // attribute selector only matches the Workspace href.
  assert.match(fs.readFileSync(path.join(TOOLS_DIR, 'job-detail.html'), 'utf8'), /<a href="\/tools\/job-tracker\.html" class="help-btn" aria-label="Back to Job Tracker"/);
  assert.match(fs.readFileSync(path.join(TOOLS_DIR, 'site-content.html'), 'utf8'), /<a href="\/tools\/dev-tools\.html" class="help-btn" aria-label="Back to Dev Tools"/);
});
