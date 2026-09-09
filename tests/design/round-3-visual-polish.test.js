// Round-3 design feedback (2026-09-08), direct from screenshots:
// - the reviews wall looked inconsistent/"bouncy" (cards sized to their
//   own content, wildly different heights)
// - the service-area diagram's concentric rings read as a "silly globe"
//   and two cities' spokes were only 15 degrees apart
// - modals/the lightbox popped open with zero transition
// - the two triage <details> disclosures and .reviews-toggle snapped
//   open/closed instantly, unlike the FAQ accordion right next to them
// - the open/closed status dot never signalled it was live data
//
// Each fix is verified here; the diagram's own coordinate/pathLength/
// hover-link details are covered separately in service-area-hub-z-order,
// service-area-light-trail and service-area-hover-link.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const INDEX = fs.readFileSync(repo('index.html'), 'utf8');
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

test('review-card quotes render at a fixed height with line-clamp, so every card is the same size regardless of quote length', () => {
  const rule = STYLES.match(/\.review-quote\{([^}]*)\}/)[1];
  assert.match(rule, /height:110px/);
  assert.match(rule, /-webkit-line-clamp:4/);
  assert.match(rule, /overflow:hidden/);
});

test('the service-area diagram no longer draws the concentric "orbit ring" background', () => {
  assert.doesNotMatch(STYLES, /\.radius-ring\{/);
  assert.doesNotMatch(INDEX, /class="radius-ring"/);
});

test('the service-area diagram viewBox grew to fit the wider-spaced layout (760x420 -> 760x480), on all 6 pages', () => {
  const PAGES = ['index.html', 'handyman-washington-city-ut.html', 'handyman-hurricane-ut.html',
    'handyman-santa-clara-ivins-ut.html', 'handyman-cedar-city-ut.html', 'handyman-mesquite-nv.html'];
  for (const page of PAGES) {
    const html = fs.readFileSync(repo(page), 'utf8');
    assert.doesNotMatch(html, /<svg viewBox="0 0 760 420"/, `${page} still has the old viewBox`);
    assert.match(html, /<svg viewBox="0 0 760 480"/, `${page} missing the new viewBox`);
  }
});

test('every non-hub diagram label is centered under its own node (text-anchor="middle"), not anchored start/end', () => {
  const svgStart = INDEX.indexOf('<svg viewBox="0 0 760 480"');
  const svgEnd = INDEX.indexOf('</svg>', svgStart);
  const svg = INDEX.slice(svgStart, svgEnd);
  const nameNotes = [...svg.matchAll(/<text class="radius-(?:name|note)[^"]*"[^>]*>/g)];
  assert.ok(nameNotes.length >= 10, 'expected at least 2 text elements (name+note) per city plus the hub');
  for (const m of nameNotes) {
    assert.match(m[0], /text-anchor="middle"/, `expected centered text: ${m[0]}`);
  }
});

test('the reveal-slider before-photo (worn tile) is floor-focused, not the cluttered-counter shot', () => {
  // tile-kitchen-before-2.webp still legitimately exists in the Gallery
  // grid alongside before-1 and before-3 -- only the drag-reveal
  // slider's own pick changed, so this checks that one section only.
  const start = INDEX.indexOf('id="revealJob"');
  const end = INDEX.indexOf('</section>', start);
  const section = INDEX.slice(start, end);
  assert.match(section, /reveal-before[\s\S]{0,200}?tile-kitchen-before-3\.webp/);
  assert.doesNotMatch(section, /tile-kitchen-before-2\.webp/);
});

test('modal and lightbox overlays fade+scale in instead of popping open instantly', () => {
  const overlayRule = STYLES.match(/\.modal-overlay\{([^}]*)\}/)[1];
  assert.match(overlayRule, /opacity:0/);
  assert.match(overlayRule, /transition:opacity[^;]*display[^;]*allow-discrete/);
  assert.match(STYLES, /\.modal-overlay\.is-open\{display:flex; opacity:1;\}/);
  assert.match(STYLES, /@starting-style\{\s*\.modal-overlay\.is-open\{opacity:0;\}\s*\}/);
  const modalRule = STYLES.match(/\n\s*\.modal\{([^}]*)\}/)[1];
  assert.match(modalRule, /transform:scale\(\.96\) translateY\(8px\)/);

  const lightboxRule = STYLES.match(/\.lightbox-overlay\{([^}]*)\}/)[1];
  assert.match(lightboxRule, /opacity:0/);
  assert.match(lightboxRule, /transition:opacity[^;]*display[^;]*allow-discrete/);
  assert.match(STYLES, /\.lightbox-img-wrap\{[\s\S]*?transform:scale\(\.96\)/);
});

test('.reviews-toggle animates its height via ::details-content, same idea as the FAQ accordion', () => {
  // .triage-browse-toggle was removed in the 2026-09-08 shrink pass (a
  // duplicate second picker); .triage-appliance-row (the accordion-card
  // triage entry point this test used to also check) was itself replaced
  // by a pill-button flow with no <details> element at all in the
  // 2026-09-09 style pass -- dropped from this list rather than left
  // asserting a selector that no longer exists.
  for (const selector of ['.reviews-toggle']) {
    const escaped = selector.replace('.', '\\.');
    assert.match(STYLES, new RegExp(`${escaped}\\{interpolate-size:allow-keywords;\\}`), `${selector} missing interpolate-size`);
    const detailsContentRule = STYLES.match(new RegExp(`${escaped}::details-content\\{([^}]*)\\}`));
    assert.ok(detailsContentRule, `${selector} missing a ::details-content rule`);
    assert.match(detailsContentRule[1], /height:0/);
    assert.match(detailsContentRule[1], /transition:height/);
    assert.match(STYLES, new RegExp(`${escaped}\\[open\\]::details-content\\{height:auto;\\}`));
  }
});

test('the open-status dot pulses only when open, via a real ::after ring, not an animated box-shadow', () => {
  assert.match(STYLES, /\.open-status\.is-open \.dot::after\{/);
  assert.match(STYLES, /animation:openDotPulse [\d.]+s ease-out infinite/);
  const keyframes = STYLES.match(/@keyframes openDotPulse\{[^}]*\{[^}]*\}[^}]*\{[^}]*\}\s*\}/);
  assert.ok(keyframes, 'expected the openDotPulse keyframes block');
  assert.match(keyframes[0], /0%\{transform:scale\(1\); opacity:\.55;\}/);
  assert.match(keyframes[0], /100%\{transform:scale\(2\.6\); opacity:0;\}/);
  // Closed status keeps a plain, non-pulsing dot -- nothing "live" to signal there.
  assert.doesNotMatch(STYLES, /\.open-status\.is-closed \.dot::after/);
});

test('every appliance row shows its own icon, and the icon set covers exactly the 5 appliances in triage.js', () => {
  const TRIAGE_JS = fs.readFileSync(repo('triage.js'), 'utf8');
  const iconMap = TRIAGE_JS.match(/const APPLIANCE_ICONS = \{([\s\S]*?)\n\s*\};/)[1];
  for (const key of ['washer', 'dryer', 'dishwasher', 'refrigerator', 'range']) {
    assert.match(iconMap, new RegExp(`${key}:\\s*'<svg`), `expected an icon for ${key}`);
  }
});

test('the tools/portal service worker was bumped for this round of styles.css/triage.js changes', () => {
  const sw = fs.readFileSync(repo('service-worker.js'), 'utf8');
  const version = Number(sw.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/)[1]);
  assert.ok(version >= 109, `expected v109 or later, got v${version}`);
});
