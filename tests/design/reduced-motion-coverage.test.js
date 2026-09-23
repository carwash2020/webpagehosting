// Reduced-motion coverage (2026-09-23). The global prefers-reduced-motion
// rule in styles.css targeted `*` only, which never matches ::before or
// ::after. So for reduced-motion visitors the homepage "open now" dot
// pulsed forever, the process timeline still drew in over 0.9s, and the
// blog/about h2 underlines over 0.8s. It zeroed durations but not delays,
// so the service-area diagram's spokes and nodes sat hidden for up to
// 1.15s and then popped in. And an explicit behavior:'smooth' in script
// overrides the CSS scroll-behavior reset, so back-to-top and the triage
// result still smooth-scrolled. Measured in Chromium with
// document.getAnimations() under emulated reduced motion: 5 perceptible
// animations on the homepage before, 0 after.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (p) => fs.readFileSync(repo(p), 'utf8');
const CSS = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('the global reduced-motion rule reaches ::before/::after and zeroes delays as well as durations', () => {
  const m = CSS.match(/@media \(prefers-reduced-motion: reduce\)\{\s*html\{scroll-behavior:auto;\}\s*([^{]+)\{([^}]*)\}/);
  assert.ok(m, 'expected the global reduced-motion block near the top of styles.css');
  const selectors = m[1].split(',').map((s) => s.trim());
  assert.deepEqual(selectors, ['*', '*::before', '*::after']);
  for (const decl of ['animation-duration:0.001ms', 'animation-iteration-count:1', 'animation-delay:0s', 'transition-duration:0.001ms', 'transition-delay:0s']) {
    assert.ok(m[2].includes(`${decl} !important`), `missing "${decl} !important" in: ${m[2]}`);
  }
});

test('the pseudo-element motion this was found on is still there to be reached (the fix is not vacuous)', () => {
  assert.match(CSS, /\.open-status\.is-open \.dot::after\{[^}]*animation:openDotPulse [^}]*infinite/);
  assert.match(CSS, /\.process::before\{[^}]*transition:transform \.9s/);
  assert.match(CSS, /\.blog-article h2::before\{[^}]*transition:transform \.8s/);
  assert.match(CSS, /\.radius-node\{animation:radiusPulse \.5s ease-out [0-9.]+s backwards;\}/);
});

// Public-site files in this lane's scope. Every explicit smooth scroll
// must fall back to 'auto' for reduced-motion visitors.
const PUBLIC_FILES = [
  'index.html', 'about.html', 'our-work.html', 'terms.html', '404.html',
  ...fs.readdirSync(repo('blog')).filter((f) => f.endsWith('.html')).map((f) => `blog/${f}`),
  ...fs.readdirSync(repo('locations')).filter((f) => f.endsWith('.html')).map((f) => `locations/${f}`),
  ...fs.readdirSync(repo('services')).filter((f) => f.endsWith('.html')).map((f) => `services/${f}`),
  'js/site-motion.js', 'js/promo-banner.js', 'js/hiring-banner.js', 'js/analytics-events.js', 'js/triage.js', 'js/business-hours.js', 'js/utm-tracking.js',
];
// Owned by the booking lane (index.html's service modal -> #schedule
// form hand-off), logged for them rather than changed here. If they fix
// it, this entry simply stops matching -- the test doesn't require it.
const BOOKING_LANE = [/document\.getElementById\('schedule'\)\.scrollIntoView\(\{behavior:'smooth'\}\)/];

test('every explicit smooth scroll on the public site falls back to auto under reduced motion', () => {
  const unguarded = [];
  for (const f of PUBLIC_FILES) {
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      if (!/behavior\s*:\s*'smooth'/.test(line)) return;
      if (/^\s*\/\//.test(line)) return; // a comment, not a call
      if (/reduced \? 'auto' : 'smooth'/.test(line)) return;
      if (BOOKING_LANE.some((re) => re.test(line))) return;
      unguarded.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(unguarded, []);
});

function stubMotion(window, reduce) {
  window.matchMedia = (q) => ({ matches: reduce && /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

test('triage: picking a symptom scrolls the answer into view smoothly, or instantly under reduced motion', () => {
  const TRIAGE_JS = read('js/triage.js');
  const html = read('index.html').replace(/<script src="\/js\/triage\.js\?v=[a-f0-9]+" defer><\/script>/, () => `<script>${TRIAGE_JS}</script>`);
  for (const reduce of [false, true]) {
    const calls = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'https://www.triplehenterprisesllc.biz/',
      beforeParse(window) {
        stubMotion(window, reduce);
        window.HTMLElement.prototype.scrollIntoView = function (opts) { calls.push(opts); };
      },
    });
    const doc = dom.window.document;
    doc.querySelector('#triageSymptomGrid .triage-appliance-pill').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    doc.querySelector('#triageSymptomGrid .triage-symptom-pill').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(calls.length, 1, `reduce=${reduce}: expected one scrollIntoView`);
    assert.equal(calls[0].behavior, reduce ? 'auto' : 'smooth', `reduce=${reduce}`);
    assert.equal(calls[0].block, 'center');
  }
});

test('back to top: smooth normally, instant under reduced motion', () => {
  const html = read('index.html');
  const start = html.lastIndexOf('<script>', html.indexOf("const backToTopBtn = document.getElementById('backToTopBtn');"));
  const script = html.slice(start + '<script>'.length, html.indexOf('</script>', start));
  for (const reduce of [false, true]) {
    const calls = [];
    const dom = new JSDOM('<!DOCTYPE html><body><button id="backToTopBtn"></button></body>', {
      runScripts: 'outside-only',
      url: 'https://www.triplehenterprisesllc.biz/',
    });
    stubMotion(dom.window, reduce);
    dom.window.scrollTo = (opts) => calls.push(opts);
    dom.window.eval(script);
    dom.window.document.getElementById('backToTopBtn').dispatchEvent(new dom.window.Event('click'));
    // JSON round-trip: the options object comes from the JSDOM realm.
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ top: 0, behavior: reduce ? 'auto' : 'smooth' }], `reduce=${reduce}`);
  }
});
