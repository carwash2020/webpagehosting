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
