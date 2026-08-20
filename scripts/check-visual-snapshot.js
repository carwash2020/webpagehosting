#!/usr/bin/env node
// Lightweight visual-regression checker (site audit improvement #7,
// 2026-08-20). Deliberately NOT built on a full headless browser
// (Puppeteer/Playwright) -- the audit specifically asked for something
// lightweight, and jsdom is already a dependency here with zero new
// packages needed. This can't catch everything a real pixel screenshot
// would (font rendering, real layout overflow), but it catches the
// exact class of thing that actually broke this past week: a CSS rule
// that used to set position:fixed no longer does, a color that used to
// come from a theme variable is now hardcoded, a background that used
// to live on the right element moved somewhere else.
//
// Snapshots a curated set of computed-style values for the specific
// elements that had real, confirmed visual bugs this week, and
// compares against a committed baseline (visual-snapshot-baseline.json).
// A mismatch fails the check -- if the change is intentional, rerun
// with --update-baseline to accept the new values as the baseline
// going forward.
//
// Run locally with: node scripts/check-visual-snapshot.js
// Accept an intentional visual change: node scripts/check-visual-snapshot.js --update-baseline

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPO_ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'visual-snapshot-baseline.json');
const UPDATE_MODE = process.argv.includes('--update-baseline');

function loadPublicSitePage(htmlFile) {
  const html = fs.readFileSync(path.join(REPO_ROOT, htmlFile), 'utf8');
  const css = fs.readFileSync(path.join(REPO_ROOT, 'styles.css'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  const styleEl = window.document.createElement('style');
  styleEl.textContent = css;
  window.document.head.appendChild(styleEl);
  return window;
}

function loadToolPage(htmlFile, extraCssFile) {
  const html = fs.readFileSync(path.join(REPO_ROOT, 'tools', htmlFile), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/' + htmlFile,
    beforeParse(window) {
      window.requireAuth = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.getCurrentUserEmail = () => null;
    },
  });
  const { window } = dom;
  if (extraCssFile) {
    const css = fs.readFileSync(path.join(REPO_ROOT, 'tools', extraCssFile), 'utf8');
    const styleEl = window.document.createElement('style');
    styleEl.textContent = css;
    window.document.head.insertBefore(styleEl, window.document.head.firstChild);
  }
  return window;
}

// Each target: a label, how to load the page, a selector, and which
// computed-style properties to snapshot. Deliberately narrow and
// specific to real, past bugs rather than an attempt at exhaustive
// coverage -- broad, generic snapshots go stale and get ignored;
// specific ones tied to a real incident stay meaningful.
const TARGETS = [
  {
    label: 'public site: header (backdrop-filter must live on ::before, not the sticky element itself -- the WebKit ghosting bug)',
    // getComputedStyle can't reliably report backdrop-filter in jsdom
    // (returns "undefined" either way) and jsdom can't query ::before
    // pseudo-elements at all -- checking the raw CSS text directly
    // instead, same technique as the tour card target below.
    selector: 'RAW_CSS:styles.css',
    props: null,
  },
  {
    label: 'public site: footer brand name (must use the theme-aware --white variable, not hardcoded white -- the invisible-in-light-mode bug)',
    load: () => loadPublicSitePage('index.html'),
    selector: '.footer-brand .brand-name',
    props: ['color'],
  },
  {
    label: 'public site: header brand name (deliberately stays hardcoded white -- the header background never changes with theme)',
    load: () => loadPublicSitePage('index.html'),
    selector: 'header .brand-name',
    props: ['color', 'whiteSpace'],
  },
  {
    label: 'public site: logo/brand block (must never shrink below its natural width -- the subtitle-wrapping bug)',
    load: () => loadPublicSitePage('index.html'),
    selector: '.brand',
    props: ['flexShrink'],
  },
  {
    label: 'public site: hours list row (must be a real flex row with a gap -- the "Mon7:00 AM" zero-space bug)',
    load: () => loadPublicSitePage('index.html'),
    selector: '.hours-row',
    props: ['display', 'gap'],
  },
  {
    label: 'internal tools: app tour card (must be position:fixed with a real background -- the invisible-tour-card bug, twice)',
    load: () => loadToolPage('workspace.html'),
    selector: null, // rendered dynamically by tools-tour.js, not present in the static HTML -- checked separately below
  },
];

function normalize(value) {
  return String(value).trim();
}

function snapshotHeaderCss() {
  const css = fs.readFileSync(path.join(REPO_ROOT, 'styles.css'), 'utf8');
  const headerRule = css.match(/(?<!:)header\{([^}]*)\}/);
  const headerBeforeRule = css.match(/header::before\{([^}]*)\}/);
  return {
    headerItselfHasBackdropFilter: headerRule ? /backdrop-filter/.test(headerRule[1]) : null,
    headerBeforeHasBackdropFilter: headerBeforeRule ? /backdrop-filter/.test(headerBeforeRule[1]) : null,
  };
}

function snapshotTarget(target) {
  if (target.selector === null) return null; // handled specially, not via computed style
  if (target.selector === 'RAW_CSS:styles.css') return snapshotHeaderCss();
  const window = target.load();
  const el = window.document.querySelector(target.selector);
  if (!el) return { error: 'selector not found: ' + target.selector };
  const cs = window.getComputedStyle(el);
  const result = {};
  for (const prop of target.props) result[prop] = normalize(cs[prop]);
  return result;
}

function snapshotTourCard() {
  // The tour card doesn't exist in any page's static HTML -- it's
  // created by tools-tour.js at runtime. Snapshotting its real CSS
  // rule text directly (from styles-tools.css) rather than trying to
  // render the full tour flow here -- checkTourHealth in
  // check-consistency.js already verifies every page's tour setup
  // separately; this specifically watches the rule's own key
  // properties for silent drift.
  const css = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'styles-tools.css'), 'utf8');
  const rule = css.match(/\.onboarding-card\s*\{([^}]*)\}/);
  if (!rule) return { error: '.onboarding-card rule not found in styles-tools.css' };
  const body = rule[1];
  const positionMatch = body.match(/position:\s*([a-z]+)/);
  const zIndexMatch = body.match(/z-index:\s*(\d+)/);
  return {
    position: positionMatch ? positionMatch[1] : null,
    zIndex: zIndexMatch ? zIndexMatch[1] : null,
    hasBackground: /background:/.test(body),
  };
}

function main() {
  const current = {};
  for (const target of TARGETS) {
    current[target.label] = target.selector === null ? snapshotTourCard() : snapshotTarget(target);
  }

  if (UPDATE_MODE || !fs.existsSync(BASELINE_PATH)) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
    console.log((UPDATE_MODE ? 'Baseline updated' : 'No baseline existed yet -- created one now') + ': ' + BASELINE_PATH);
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const problems = [];
  for (const target of TARGETS) {
    const label = target.label;
    const before = JSON.stringify(baseline[label]);
    const after = JSON.stringify(current[label]);
    if (before !== after) {
      problems.push(`${label}\n    was: ${before}\n    now: ${after}`);
    }
  }

  if (problems.length) {
    console.error(`\nVisual snapshot check FAILED -- ${problems.length} change(s) detected:\n`);
    problems.forEach(p => console.error('  - ' + p + '\n'));
    console.error('If this change is intentional, run: node scripts/check-visual-snapshot.js --update-baseline\n');
    process.exit(1);
  }

  console.log(`Visual snapshot check passed -- ${TARGETS.length} target(s) checked, all match the baseline.`);
}

main();
