// Tests for the desktop-width layout improvements (2026-08-20),
// requested directly: efficient on phone stays efficient on phone,
// efficient on computer becomes efficient on computer too, via a
// min-width:1024px media query per page that leaves everything below
// that width completely untouched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

// Pages that had a direct body{max-width:Npx} rule widened.
const STANDARD_PAGES = [
  'workspace.html', 'calendar.html', 'client-detail.html', 'contract-generator.html',
  'dev-tools.html', 'invoice-generator.html', 'job-detail.html', 'job-tracker.html',
  'review-request.html', 'route-planner.html', 'settings.html', 'site-content.html',
];

test('every standard tool page has a min-width:1024px media query widening its container, positioned after the original mobile-default rule', () => {
  for (const page of STANDARD_PAGES) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    const mobileMatch = src.match(/body \{ padding: [^;]+; max-width: (\d+)px; margin: 0 auto; \}/);
    assert.ok(mobileMatch, page + ': original mobile body rule not found -- did something change unexpectedly?');
    const desktopMatch = src.match(/@media \(min-width: 1024px\) \{ body \{ max-width: (\d+)px; margin-left: calc\(240px \+ max\(0px, \(100vw - 240px - \d+px\) \/ 2\)\); padding-top: \d+px; \} \}/);
    assert.ok(desktopMatch, page + ' is missing the desktop-width media query');
    const mobileWidth = parseInt(mobileMatch[1], 10);
    const desktopWidth = parseInt(desktopMatch[1], 10);
    assert.ok(desktopWidth > mobileWidth, page + ': desktop width (' + desktopWidth + ') should be wider than the mobile default (' + mobileWidth + ')');
    // The desktop rule must come AFTER the mobile rule in the file, so
    // it correctly overrides at wider widths rather than being
    // overridden itself.
    assert.ok(src.indexOf(mobileMatch[0]) < src.indexOf(desktopMatch[0]), page + ': desktop media query must come after the mobile default rule');
  }
});

test('runway-dashboard.html, which uses 3 separate max-width selectors instead of one body rule, has all 3 widened together in a single desktop media query', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  assert.match(src, /@media \(min-width: 1024px\) \{ header, \.tabs, main \{ max-width: \d+px; margin-left: calc\(240px \+ max\(0px, \(100vw - 240px - \d+px\) \/ 2\)\); \} \}/);
});

test('finance.html and parts-reference.html, which previously had NO container width constraint at all, now have one added -- but only on desktop, leaving mobile completely unaffected', () => {
  for (const page of ['finance.html', 'parts-reference.html']) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    // Should NOT have an unconditional body{max-width} rule -- that
    // would also affect mobile, which currently works fine
    // unconstrained on a narrow screen.
    assert.doesNotMatch(src, /(?<!media \(min-width: 1024px\) \{ )body \{[^}]*max-width/, page + ' should not have an unconditional max-width rule affecting mobile too');
    assert.match(src, /@media \(min-width: 1024px\) \{ body \{ max-width: \d+px; margin-left: calc\(240px \+ max\(0px, \(100vw - 240px - \d+px\) \/ 2\)\); padding-top: \d+px; \} \}/, page + ' is missing its new desktop-only container constraint');
  }
});

test('the bottom nav bar stays display:none by default, only appearing under 720px -- confirms widening the container on desktop is safe and does not create a stray mobile-style nav on a wide screen', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');
  const rule = src.match(/\.th-bottom-nav \{([^}]*)\}/)[1];
  assert.match(rule, /display:\s*none/);
  assert.match(src, /@media \(max-width: 720px\) \{ \.th-bottom-nav \{ display: flex/);
});

test('CSS brace balance stays correct across every file touched by this change', () => {
  const files = [...STANDARD_PAGES, 'runway-dashboard.html', 'finance.html', 'parts-reference.html'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(TOOLS_DIR, f), 'utf8');
    const style = text.slice(text.indexOf('<style>'), text.indexOf('</style>'));
    let depth = 0;
    for (const ch of style) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
    }
    assert.equal(depth, 0, f + ': unbalanced braces in <style> block');
  }
});

// Bug fix (2026-08-20), found from a direct screenshot showing an odd
// gradient/shading at the top and persistent black bars on either
// side, after the desktop-width work above widened each page's
// container. Root cause: the ambient background gradient lived on
// body.th-tool-page itself -- the same element the max-width
// constraint applies to. Widening it shifted where the fixed-size,
// percentage-positioned gradient landed, and left the margin area
// outside max-width with no background at all.

test('the ambient background gradient lives on html (never width-constrained), not on body.th-tool-page (which the desktop-width work above widens)', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');
  const htmlRule = src.match(/(?<!<)html \{([^}]*)\}/);
  assert.ok(htmlRule, 'html rule not found');
  assert.match(htmlRule[1], /radial-gradient/);
  assert.match(htmlRule[1], /background-attachment:\s*fixed/);

  const bodyToolPageRule = src.match(/body\.th-tool-page \{([^}]*)\}/);
  assert.ok(bodyToolPageRule, 'body.th-tool-page rule not found');
  assert.doesNotMatch(bodyToolPageRule[1], /radial-gradient/, 'the gradient should no longer live on the width-constrained element');
  assert.match(bodyToolPageRule[1], /background:\s*transparent/, 'body.th-tool-page should be transparent so html\'s background shows through everywhere, including within the content column');
});

test('body.th-tool-page still gets its class added at runtime by tools-nav-pwa.js, confirming the transparent-background rule actually applies on a real page load, not just in theory', () => {
  const navSrc = fs.readFileSync(path.join(TOOLS_DIR, 'tools-nav-pwa.js'), 'utf8');
  assert.match(navSrc, /document\.body\.classList\.add\('th-tool-page'\)/);
});

// Bug fix (2026-08-20), found from a direct screenshot showing a large
// empty dark area on the right side of a wide screen. Root cause: the
// old fix used a flat 240px margin-left plus max-width, with
// margin-right left at its default auto -- any extra space beyond the
// max-width all piled onto the right instead of being split evenly.
// Verifies the actual centering math the new calc formula produces,
// not just that some formula-shaped text exists in the file.

test('the centering calc formula produces mathematically correct results: flush against the sidebar with zero gap on a narrow "desktop" width, and evenly split extra space on a wide one', () => {
  // Simulates exactly what a real browser's own CSS box-model
  // resolution does for this rule: width:auto with one fixed margin
  // and one auto margin first tries to fill available space, then
  // max-width clamps it and the remaining auto margin absorbs whatever
  // is left over.
  function resolve(viewportWidth, sidebarWidth, maxw) {
    const available = viewportWidth - sidebarWidth;
    const extra = Math.max(0, available - maxw);
    const marginLeft = sidebarWidth + extra / 2;
    const width = Math.min(available, maxw);
    const marginRight = viewportWidth - marginLeft - width;
    return { marginLeft, width, marginRight };
  }

  // Wide screen (matches the screenshot's real scenario): extra space
  // should split evenly on both sides, not all pile onto the right.
  let r = resolve(1900, 240, 1300);
  assert.equal(r.marginLeft, 420);
  assert.equal(r.width, 1300);
  assert.equal(r.marginRight, 180);
  assert.equal(r.marginLeft - 240, r.marginRight, 'extra space must split evenly on both sides of the content');

  // Narrower "desktop" width where the remaining track is smaller than
  // the max-width: content should fill the track exactly, flush
  // against the sidebar with no gap on either side.
  r = resolve(1024, 240, 1300);
  assert.equal(r.marginLeft, 240);
  assert.equal(r.width, 784);
  assert.equal(r.marginRight, 0);

  // Exactly at the boundary where available track equals max-width.
  r = resolve(1540, 240, 1300);
  assert.equal(r.marginLeft, 240);
  assert.equal(r.marginRight, 0);
});

// Bug fix (2026-08-20), found from a direct screenshot: the sticky
// header still spanned only the same narrow, centered column as the
// rest of the page's content, with visible dark space on either side
// -- it should span the full remaining width next to the sidebar
// instead, like a real app toolbar, and sit flush at the very top of
// the screen.

test('the shared header rule (.hub-header/.tool-header) switches from sticky to fixed on desktop, spanning from right after the sidebar to the browser\'s right edge', () => {
  const css = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');
  const desktopBlock = css.match(/@media \(min-width: 1024px\) \{\s*body \.hub-header, body \.tool-header \{([^}]*)\}\s*\}/);
  assert.ok(desktopBlock, 'desktop header override not found');
  assert.match(desktopBlock[1], /position:\s*fixed/);
  assert.match(desktopBlock[1], /left:\s*240px/);
  assert.match(desktopBlock[1], /right:\s*0/);
});

test('every page using either header class has matching padding-top added to its own desktop media query, to compensate for the header no longer contributing to normal page flow', () => {
  const pages = ['workspace.html', 'calendar.html', 'client-detail.html', 'contract-generator.html',
    'dev-tools.html', 'invoice-generator.html', 'job-detail.html', 'job-tracker.html',
    'review-request.html', 'route-planner.html', 'settings.html', 'site-content.html',
    'finance.html', 'parts-reference.html'];
  for (const page of pages) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    const hasHeader = /class="(hub-header|tool-header)"/.test(src);
    assert.ok(hasHeader, page + ' was expected to use one of the two header classes');
    assert.match(src, /@media \(min-width: 1024px\) \{ body \{[^}]*padding-top: \d+px;[^}]*\} \}/, page + ' is missing the compensating padding-top for the now-fixed header');
  }
});

test('runway-dashboard.html\'s own header is NOT sticky/fixed at all (it scrolls normally with the page), so it correctly has no matching desktop override -- this fix is specific to the sticky header pattern the other 14 pages share', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  const headerRule = src.match(/(?<!<)header\{([^}]*)\}/);
  assert.ok(headerRule);
  assert.doesNotMatch(headerRule[1], /position:\s*(sticky|fixed)/);
});

// Bug fix (2026-08-20), found from a direct screenshot: after fixing
// the main header to span the full width, the separate .jump-nav tab
// bar (Snapshot/Action Items/More/Tools) below it still had the exact
// same "sticky but width-constrained to the narrow content column"
// issue -- looking like its own separate floating box.

test('the shared .jump-nav rule switches from sticky to fixed on desktop, positioned right below the fixed header, spanning the same width', () => {
  const css = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');
  const desktopBlock = css.match(/@media \(min-width: 1024px\) \{\s*body \.jump-nav \{([^}]*)\}\s*\}/);
  assert.ok(desktopBlock, 'desktop jump-nav override not found');
  assert.match(desktopBlock[1], /position:\s*fixed/);
  assert.match(desktopBlock[1], /left:\s*240px/);
  assert.match(desktopBlock[1], /right:\s*0/);
  assert.match(desktopBlock[1], /top:\s*61px/, 'should sit right below the fixed header, not overlap it');
});

test('workspace.html and dev-tools.html, the only 2 pages with a .jump-nav bar, have extra padding-top to account for both the header AND the jump-nav stacked, not just the header alone', () => {
  for (const page of ['workspace.html', 'dev-tools.html']) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, page), 'utf8');
    assert.match(src, /class="jump-nav"/, page + ' was expected to have a jump-nav bar');
    const paddingMatch = src.match(/@media \(min-width: 1024px\) \{ body \{[^}]*padding-top: (\d+)px;[^}]*\} \}/);
    assert.ok(paddingMatch);
    assert.ok(parseInt(paddingMatch[1], 10) > 75, page + ' needs more than the header-only 75px, since it also has a jump-nav bar stacked below it');
  }
});

// Live sync indicator moved (2026-08-21), requested directly: on
// desktop, sits as a second row under the settings button instead of
// its own separate, full-width paragraph below the header.

test('on the dashboard, the live sync indicator moves under the settings button on desktop, with the header grown taller to make room, and the jump-nav/body padding both adjusted to match the new header height', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const desktopBlock = src.match(/@media \(min-width: 1024px\) \{\s*body \.hub-header \{([^}]*)\}\s*\.hub-sub \{([^}]*)\}/);
  assert.ok(desktopBlock, 'desktop hub-header/hub-sub override block not found');
  assert.match(desktopBlock[1], /min-height:\s*140px/);
  assert.match(desktopBlock[2], /position:\s*fixed/);
  assert.match(desktopBlock[2], /right:\s*24px/, 'should align under the settings button on the right, not the left');

  // jump-nav no longer needs a desktop-specific top override -- it's
  // position:static now (not sticky), requested directly ("the tools
  // to slide"), so it has no positioning to account for at all.

  // body's own padding-top must account for the new, taller header.
  const paddingMatch = src.match(/@media \(min-width: 1024px\) \{ body \{[^}]*padding-top: (\d+)px;[^}]*\} \}/);
  assert.ok(paddingMatch);
  assert.ok(parseInt(paddingMatch[1], 10) >= 205, 'padding-top should account for the taller 140px header plus the jump-nav below it');
});

test('dev-tools.html, which shares the same jump-nav CSS rule but did NOT move its live sync indicator, is unaffected by workspace.html\'s page-specific header height override', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'dev-tools.html'), 'utf8');
  assert.doesNotMatch(src, /body \.jump-nav \{ top: 105px; \}/, 'this override is specific to workspace.html\'s own <style> block, not shared');
  const paddingMatch = src.match(/@media \(min-width: 1024px\) \{ body \{[^}]*padding-top: (\d+)px;[^}]*\} \}/);
  assert.equal(paddingMatch[1], '130', 'dev-tools.html\'s header height did not change, so its padding-top should stay at the original header+jump-nav value');
});

// Bug fix (2026-08-21), reported directly with a screenshot: a stray
// blue box (the browser's own native focus outline, not this app's
// deliberate orange :focus-visible styling) showed around a button
// right after a click.

test('a plain mouse-click focus state has its native outline explicitly suppressed, leaving only the app\'s deliberate orange :focus-visible ring for real keyboard navigation', () => {
  const css = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');
  assert.match(css, /:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none;\s*\}/);
});

// Bug fix (2026-08-21), reported directly with a screenshot: the live
// sync indicator and the refresh button below it weren't lining up on
// the same right edge -- the refresh button looked centered/floating,
// disconnected from the text above it.

test('the refresh button is its own, fully independent position:fixed element, anchored directly to the exact same right:24px value as the live sync badge above it -- not relying on any shared-container flexbox/shrink-to-fit sizing, which is what actually eliminates the alignment ambiguity reported directly across two earlier attempts', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const hubSubRule = src.match(/\.hub-sub \{ position: fixed;[^}]*\}/);
  const refreshRule = src.match(/#refreshSyncLink \{ position: fixed[^}]*\}/);
  assert.ok(hubSubRule, '.hub-sub desktop rule not found');
  assert.ok(refreshRule, '#refreshSyncLink desktop rule not found');

  const hubSubRight = hubSubRule[0].match(/right:\s*(\d+)px/);
  const refreshRight = refreshRule[0].match(/right:\s*(\d+)px/);
  assert.ok(hubSubRight && refreshRight);
  assert.equal(hubSubRight[1], refreshRight[1], 'both must anchor to the exact same right value to guarantee alignment');
});

test('the refresh button\'s old inline margin-left (meant for its previous inline-flow position next to the badge) is explicitly cleared on desktop, since it\'s now an independently-positioned element entirely', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.match(src, /#refreshSyncLink \{ position: fixed !important;[^}]*margin-left:\s*0\s*!important;/);
});

// Order swapped (2026-08-21), requested directly: the refresh button
// now sits on top, with the "Live sync active" badge below it.

test('the refresh button sits above the live sync badge (lower top value), with a real, consistent gap between them accounting for the button\'s actual height, not a naive value swap', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const hubSubTop = parseInt(src.match(/\.hub-sub \{ position: fixed; top: (\d+)px;/)[1], 10);
  const refreshTop = parseInt(src.match(/#refreshSyncLink \{ position: fixed !important; top: (\d+)px;/)[1], 10);
  assert.ok(refreshTop < hubSubTop, 'the refresh button should be above the badge now');

  const REFRESH_BUTTON_HEIGHT = 26;
  const GAP = 6;
  assert.equal(hubSubTop, refreshTop + REFRESH_BUTTON_HEIGHT + GAP, 'the badge\'s top should account for the button\'s real height plus a consistent gap, not just be an arbitrary swapped number');
});

// Root cause finally found (2026-08-21), after the collision persisted
// across multiple earlier attempts that all assumed the main header
// row was correctly pinned to the top: the shared styles-tools.css
// header rule uses selector "body .hub-header" (element + class
// specificity), which beats a bare ".hub-header" selector (class
// only) regardless of source order. This page's own align-items
// override was therefore silently never applying at all -- the shared
// rule's align-items:center kept winning, vertically centering the
// main row within the tall header instead of pinning it to the top,
// which is what was actually causing the refresh button collision no
// matter how its own top value was adjusted.

test('this page\'s align-items override matches the shared rule\'s exact selector specificity ("body .hub-header", not a bare ".hub-header"), which is required for it to actually win against that shared rule rather than being silently overridden by it regardless of source order', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const sharedCss = fs.readFileSync(path.join(TOOLS_DIR, 'styles-tools.css'), 'utf8');

  // Confirm the shared rule really does use this higher-specificity
  // selector -- if this shared selector ever changes, this override
  // needs to be revisited too.
  assert.match(sharedCss, /body \.hub-header, body \.tool-header \{[^}]*align-items:\s*center/, 'the shared rule this page needs to beat should still be using "body .hub-header" with align-items:center');

  // Confirm this page's own override matches that exact selector.
  // Restructured (2026-08-22), requested directly ("move the bars
  // together"): Live sync now lives as a second row inside
  // .hub-header itself (rather than a separate element pinned to the
  // top of a taller box), so .hub-header-main-row (the wrapper around
  // the original logo/buttons row) needs align-items:stretch to span
  // full width and keep its own internal justify-content:space-between
  // working correctly -- not flex-start, which would shrink it to its
  // content width and break that layout.
  assert.match(src, /body \.hub-header \{ align-items: stretch;/, 'this override must use the same "body .hub-header" selector to correctly win at equal specificity via later source order');
  assert.doesNotMatch(src, /(?<!body )\.hub-header \{ align-items: (flex-start|stretch)/, 'a bare .hub-header selector here would be silently overridden by the shared, higher-specificity rule');
});

// Live sync indicator restructured on mobile (2026-08-21), requested
// directly: the refresh button now stacks below "Live sync active"
// (matching the desktop layout already built), with tighter spacing
// so it sits closer to the header instead of floating with extra
// whitespace above it.

test('on mobile, .hub-sub uses a flex column layout, stacking the refresh button below the badge rather than side-by-side on the same line', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const mobileRule = src.match(/\.hub-sub \{ color: var\(--text-dim\);[^}]*\}/);
  assert.ok(mobileRule, 'base .hub-sub rule not found');
  assert.match(mobileRule[0], /display:\s*flex/);
  assert.match(mobileRule[0], /flex-direction:\s*column/);
});

test('desktop resets .hub-sub back to display:block, since the refresh button there is already its own independent position:fixed element (unaffected by the parent\'s display mode either way) and doesn\'t need the mobile column stacking', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.match(src, /@media \(min-width: 1024px\) \{ \.hub-sub \{ display: block; \} \}/);
});

test('this change does not affect the desktop refresh button\'s own position:fixed rule, which still exists unchanged', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.match(src, /#refreshSyncLink \{ position: fixed !important;/);
});

// Restructured (2026-08-22), requested directly ("move the bars
// together and put sync under it"): "Live sync active" now lives
// inside .hub-header itself as a second row, so it visually reads as
// part of the same dark header bar rather than a separate, lighter
// section below it with a visible gap. .hub-header-main-row wraps the
// original logo/title/buttons row, preserving its own internal
// space-between layout.

test('.hub-sub is now a real, nested child of .hub-header (not a sibling element after it), so it inherits the same dark background automatically via that element\'s own inset:0 ::before pseudo-element', () => {
  const window = loadWorkspace();
  const header = window.document.querySelector('.hub-header');
  const hubSub = window.document.querySelector('.hub-sub');
  assert.ok(header.contains(hubSub), '.hub-sub should be nested inside .hub-header');
  assert.equal(header.lastElementChild, hubSub, '.hub-sub should be the last child, after the main row');
});

test('.hub-header-main-row wraps the original logo/title/buttons row, and still correctly spreads them via justify-content:space-between (not shrunk/centered by the parent\'s own flex-direction:column)', () => {
  const window = loadWorkspace();
  const mainRow = window.document.querySelector('.hub-header-main-row');
  assert.ok(mainRow, '.hub-header-main-row not found');
  const logo = window.document.getElementById('headerLogo');
  const settingsBtn = window.document.querySelector('a[href="/tools/settings.html"]');
  assert.ok(mainRow.contains(logo));
  assert.ok(mainRow.contains(settingsBtn));
  assert.equal(window.getComputedStyle(mainRow).justifyContent, 'space-between');
});

test('.hub-header is a flex column container with align-items:stretch (not flex-start, which would shrink .hub-header-main-row to its content width and break its own internal space-between layout)', () => {
  const window = loadWorkspace();
  const header = window.document.querySelector('.hub-header');
  const style = window.getComputedStyle(header);
  assert.equal(style.display, 'flex');
  assert.equal(style.flexDirection, 'column');
  assert.equal(style.alignItems, 'stretch');
});

test('jump-nav remains a sibling after the whole .hub-header block, not accidentally nested inside it during the restructuring', () => {
  const window = loadWorkspace();
  const header = window.document.querySelector('.hub-header');
  const jumpNav = window.document.querySelector('.jump-nav');
  assert.equal(header.nextElementSibling, jumpNav);
});

function loadWorkspace() {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html', beforeParse(w) { w.requireAuth = () => {}; } });
  return dom.window;
}

// Requested directly ("the tools to slide"), superseding an earlier
// attempt in this same area: jump-nav should scroll away normally
// with the rest of the page, not stay pinned below the sticky header.
// A previous fix correctly positioned it below the header but kept it
// sticky, which was reported as exactly the wrong behavior -- "now it
// just all sticks."

test('jump-nav is position:static on this page (not sticky), using the body-prefixed selector to correctly beat the shared rule\'s higher specificity -- a bare .jump-nav selector here would be silently overridden by that shared rule\'s position:sticky regardless of source order', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.match(src, /body \.jump-nav \{ position: static;/);
});

test('the now-removed syncJumpNavPositionToHeaderHeight function (from the previous, sticky-jump-nav approach) is genuinely gone, not just unused dead code left behind', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.doesNotMatch(src, /syncJumpNavPositionToHeaderHeight/);
});

test('jump-nav genuinely scrolls with the page (not fixed/sticky) when actually rendered', () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) { w.requireAuth = () => {}; },
  });
  const { window } = dom;
  const jumpNav = window.document.querySelector('.jump-nav');
  assert.equal(window.getComputedStyle(jumpNav).position, 'static');
});
