// A "light trail" animation for the service-area diagram (2026-09-07),
// requested directly: lines connecting out to each city at different
// times, not everything appearing at once. Reuses the existing
// [data-reveal]/.is-visible mechanism (a single IntersectionObserver,
// already wired site-wide) rather than adding a second one just for
// this diagram, and the existing global prefers-reduced-motion rule
// (every animation-duration/transition-duration zeroed) already
// collapses this to its finished state instantly with no extra code.
// The diagram is identical markup on index.html and all 5 satellite
// landing pages, so this is checked on all 6.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');

const PAGES = {
  'index.html': fs.readFileSync(repo('index.html'), 'utf8'),
  'handyman-cedar-city-ut.html': fs.readFileSync(repo('handyman-cedar-city-ut.html'), 'utf8'),
  'handyman-hurricane-ut.html': fs.readFileSync(repo('handyman-hurricane-ut.html'), 'utf8'),
  'handyman-mesquite-nv.html': fs.readFileSync(repo('handyman-mesquite-nv.html'), 'utf8'),
  'handyman-santa-clara-ivins-ut.html': fs.readFileSync(repo('handyman-santa-clara-ivins-ut.html'), 'utf8'),
  'handyman-washington-city-ut.html': fs.readFileSync(repo('handyman-washington-city-ut.html'), 'utf8'),
  'handyman-la-verkin-ut.html': fs.readFileSync(repo('handyman-la-verkin-ut.html'), 'utf8'),
  'handyman-leeds-ut.html': fs.readFileSync(repo('handyman-leeds-ut.html'), 'utf8'),
};

for (const [name, html] of Object.entries(PAGES)) {
  test(`${name}: the 5 solid spokes carry pathLength="1" for the stroke-draw trick, the 2 dashed "by request" spokes do not`, () => {
    const solidSpokes = [...html.matchAll(/<line class="radius-spoke" pathLength="1"[^/]*\/>/g)];
    const dashedSpokes = [...html.matchAll(/<line class="radius-spoke is-request"[^/]*\/>/g)];
    assert.equal(solidSpokes.length, 5, `expected 5 solid spokes with pathLength="1" in ${name}`);
    assert.equal(dashedSpokes.length, 2, `expected 2 dashed "is-request" spokes in ${name}`);
    // None of the dashed spokes should carry pathLength -- doing so would
    // reinterpret their real stroke-dasharray:5 5 in a 0-1 coordinate
    // space and break the dash pattern entirely.
    dashedSpokes.forEach((m) => assert.doesNotMatch(m[0], /pathLength/));
  });

  test(`${name}: every city group is present for the per-city animation-timing selectors to target`, () => {
    ['washington-city', 'hurricane', 'santa-clara-ivins', 'la-verkin', 'leeds', 'cedar-city', 'mesquite'].forEach((city) => {
      assert.match(html, new RegExp(`data-city="${city}"`));
    });
  });
}

test('the solid spokes start hidden (dashoffset 1) and draw in only once revealed', () => {
  assert.match(STYLES, /\.radius-figure \.radius-spoke:not\(\.is-request\)\{\s*stroke-dasharray:1;\s*stroke-dashoffset:1;\s*\}/);
  assert.match(STYLES, /html\.reveal-ready \.radius-figure\.is-visible \.radius-spoke:not\(\.is-request\)\{\s*stroke-dashoffset:0;/);
});

test('the dashed "by request" spokes start invisible and fade in rather than using the stroke-draw trick', () => {
  assert.match(STYLES, /\.radius-figure \.radius-spoke\.is-request\{opacity:0;\}/);
  assert.match(STYLES, /html\.reveal-ready \.radius-figure\.is-visible \.radius-spoke\.is-request\{\s*opacity:1;/);
});

test('each city has its own transition-delay, so spokes draw at different times rather than all at once', () => {
  const delays = [...STYLES.matchAll(/g\[data-city="([a-z-]+)"\] \.radius-spoke\{transition-delay:([\d.]+)s;\}/g)]
    .map((m) => ({ city: m[1], delay: Number(m[2]) }));
  assert.equal(delays.length, 7, 'expected a transition-delay rule for all 7 cities');
  const uniqueDelays = new Set(delays.map((d) => d.delay));
  assert.equal(uniqueDelays.size, 7, `expected 7 distinct delays, got ${[...uniqueDelays].join(', ')}`);
  // Nearer/standard-coverage cities should arrive before the two
  // "by request" cities, matching their already-established visual
  // secondary treatment (dashed, orange).
  const byCity = Object.fromEntries(delays.map((d) => [d.city, d.delay]));
  assert.ok(byCity['washington-city'] < byCity['cedar-city']);
  assert.ok(byCity['washington-city'] < byCity['mesquite']);
});

test('each node pulses once its own spoke has actually finished arriving, not before', () => {
  const spokeTiming = {}; // city -> delay + duration
  const delayRe = /g\[data-city="([a-z-]+)"\] \.radius-spoke\{transition-delay:([\d.]+)s;\}/g;
  for (const m of STYLES.matchAll(delayRe)) spokeTiming[m[1]] = Number(m[2]);
  const isRequest = new Set(['cedar-city', 'mesquite']);
  const solidDuration = Number(STYLES.match(/\.radius-spoke:not\(\.is-request\)\{\s*stroke-dashoffset:0;\s*transition:stroke-dashoffset ([\d.]+)s/)[1]);
  const dashedDuration = Number(STYLES.match(/\.radius-spoke\.is-request\{\s*opacity:1;\s*transition:opacity ([\d.]+)s/)[1]);

  const pulseRe = /g\[data-city="([a-z-]+)"\] \.radius-node\{animation:radiusPulse [\d.]+s ease-out ([\d.]+)s backwards;\}/g;
  for (const m of STYLES.matchAll(pulseRe)) {
    const city = m[1];
    const pulseDelay = Number(m[2]);
    const expectedArrival = spokeTiming[city] + (isRequest.has(city) ? dashedDuration : solidDuration);
    assert.ok(
      pulseDelay >= expectedArrival - 0.01,
      `${city}: node pulse (${pulseDelay}s) fires before its own spoke finishes arriving (${expectedArrival}s)`
    );
  }
});

test('the pulse keyframe returns to a neutral resting state, not a permanently enlarged node', () => {
  const kf = STYLES.match(/@keyframes radiusPulse\{[^}]*\{[^}]*\}[^}]*\{[^}]*\}[^}]*\{[^}]*\}\s*\}/);
  assert.ok(kf, 'expected the radiusPulse keyframes block');
  assert.match(kf[0], /0%\{transform:scale\(1\)/);
  assert.match(kf[0], /100%\{transform:scale\(1\)/);
});
