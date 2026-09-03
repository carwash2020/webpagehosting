#!/usr/bin/env node
// scripts/check-undefined-vars.js
//
// Catches exactly the class of bug behind a real production emergency
// (2026-09-03): generatePDF() referenced `newEntry`, a variable that
// only ever existed inside the separate logInvoice() function, never
// passed in or returned. It threw an uncaught ReferenceError on every
// single invoice generation. logQuote() had the identical shape with
// a DIFFERENT variable (`shouldSend`, referenced inside logQuote()
// where only generatePDF() actually had it in scope) -- confirmed as
// the real, live error Connor hit, straight from the client error
// log. Both were fixed the same day, and both are exactly the shape
// this script is built to catch automatically, before either one
// would have ever shipped.
//
// No unit test, however thorough, would have caught this without
// actually EXECUTING the function with every dependency mocked --
// expensive to do exhaustively for every function on every page.
// ESLint's no-undef rule does the same job at a fraction of the cost,
// checking every function on every page in about a second, because it
// doesn't need to run the code at all -- it only needs to know which
// names are legitimately in scope.
//
// The one real cost of that approach: ESLint's no-undef needs to be
// TOLD which names are legitimate globals, or it floods with false
// positives for every function one script file expects another
// script file (loaded separately via <script src>) to provide. This
// script builds that globals list automatically from the actual
// shared script files, rather than maintaining a hand-written list
// that would silently drift out of date as those files change.
//
// Deliberately covers ONLY inline <script> blocks in each page, never
// the shared files' own internal cross-references -- a shared file
// calling its own sibling function is a same-file concern already
// caught by node --check's syntax validation and this project's
// extensive functional test suite; what this catches is specifically
// a PAGE referencing something that was never actually given to it.

const fs = require('fs');
const path = require('path');
const { Linter } = require('eslint');

const REPO_ROOT = path.join(__dirname, '..');

// Every shared script loaded via <script src="..."> by at least one
// tool or portal page. Adding a new shared file to the project means
// adding it here too -- there is no way to auto-discover this list
// from the HTML without re-implementing half of what this script
// already does, and an explicit list is easy to audit at a glance.
const SHARED_SCRIPT_FILES = [
  'tools/auth.js',
  'tools/data-layer.js',
  'tools/tools-effects.js',
  'tools/tools-dialogs.js',
  'tools/tools-media-sharing.js',
  'tools/tools-nav-pwa.js',
  'tools/sync.js',
  'tools/tools-tour.js',
  'tools/dev-tools-shared.js',
  'tools/qrcode-lib.js',
  'tools/push-notifications.js',
  // Public, root-level shared file (2026-09-03) -- booking.html and
  // portal/work-orders.html both load this for the real business
  // hours and timezone-safe date math, so it needs to be on this list
  // too or every page loading it would show as a flood of false
  // "not defined" positives.
  'business-hours.js',
];

// Third-party globals from CDN-loaded scripts (Supabase, Stripe,
// jsPDF, analytics), plus the two constants that individual pages
// define locally as `const` but this checker treats as pre-existing
// globals since some pages redeclare them and ESLint would otherwise
// flag every subsequent inline <script> block on the same page as a
// redeclaration -- not the class of bug this script exists to catch.
const EXTRA_GLOBALS = ['supabase', 'Stripe', 'gtag', 'dataLayer', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];

// Matches a top-level (optionally indented -- some shared files are
// stylistically indented despite being syntactically flat, so this
// deliberately does not anchor to column 0) function or const/let/var
// declaration. Not a full JS parser -- a function nested inside an
// if-block or another function would also match, which only makes
// the globals list slightly too generous, never too strict, so it
// cannot cause a false negative for the actual bug class this exists
// to catch.
const DECL_PATTERN = /^\s*(?:(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(|(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=)/;

function extractTopLevelNames(absPath) {
  const src = fs.readFileSync(absPath, 'utf8');
  const names = new Set();
  for (const line of src.split('\n')) {
    const m = line.match(DECL_PATTERN);
    if (m) names.add(m[1] || m[2]);
  }
  return names;
}

function extractInlineScripts(html) {
  // Only scripts with no src attribute -- exactly what actually
  // executes in this page's own scope, joined the same way the real
  // browser would run them (one shared global scope, in document order).
  // Explicitly excludes non-JavaScript script blocks (application/
  // ld+json structured data in particular) -- those aren't executable
  // code at all, and trying to parse JSON as JS produces a real but
  // meaningless "Unexpected token" error, not an undefined-variable
  // finding this checker actually cares about.
  const blocks = [];
  // Case-insensitive (2026-09-03, flagged by CodeQL as "Bad HTML
  // filtering regexp"): browsers treat <SCRIPT> and <script>
  // identically, but this regex previously didn't -- an uppercase
  // script tag would silently skip this checker's own coverage
  // entirely, exactly the kind of gap a security-scanning tool
  // shouldn't have in itself.
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc=/i.test(attrs)) continue;
    if (/\btype\s*=\s*["'](?!(?:text\/javascript|module)["'])[^"']*["']/i.test(attrs)) continue;
    blocks.push(m[2]);
  }
  return blocks.join('\n;\n');
}

function buildGlobals() {
  const globals = {};
  for (const g of EXTRA_GLOBALS) globals[g] = 'writable';
  for (const rel of SHARED_SCRIPT_FILES) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `check-undefined-vars: ${rel} is listed in SHARED_SCRIPT_FILES but no longer exists. ` +
        `Update the list in scripts/check-undefined-vars.js.`
      );
    }
    for (const name of extractTopLevelNames(abs)) globals[name] = 'readonly';
  }
  return globals;
}

function main() {
  const globals = buildGlobals();
  const linter = new Linter();
  const config = {
    parserOptions: { ecmaVersion: 2021, sourceType: 'script' },
    env: { es2021: true },
    globals: {
      ...globals,
      // Standard browser globals -- listed explicitly rather than
      // pulling in ESLint's own "browser" env preset, since the goal
      // is a small, auditable set this script owns completely rather
      // than trusting an external package's idea of what a browser
      // provides.
      window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
      localStorage: 'readonly', sessionStorage: 'readonly', history: 'readonly',
      fetch: 'readonly', console: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
      setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
      requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
      Blob: 'readonly', File: 'readonly', FileReader: 'readonly', FormData: 'readonly', URL: 'readonly',
      URLSearchParams: 'readonly', CustomEvent: 'readonly', Event: 'readonly',
      MutationObserver: 'readonly', IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
      Notification: 'readonly', Worker: 'readonly', WebSocket: 'readonly', AbortController: 'readonly',
      crypto: 'readonly', performance: 'readonly', matchMedia: 'readonly', getComputedStyle: 'readonly',
      atob: 'readonly', btoa: 'readonly', structuredClone: 'readonly', queueMicrotask: 'readonly',
      globalThis: 'readonly', self: 'readonly',
      Intl: 'readonly', caches: 'readonly', Image: 'readonly',
    },
    rules: { 'no-undef': 'error' },
  };

  const pages = [
    ...fs.readdirSync(REPO_ROOT).filter(f => f.endsWith('.html')).map(f => f),
    ...fs.readdirSync(path.join(REPO_ROOT, 'tools')).filter(f => f.endsWith('.html')).map(f => `tools/${f}`),
    ...fs.readdirSync(path.join(REPO_ROOT, 'portal')).filter(f => f.endsWith('.html')).map(f => `portal/${f}`),
  ];

  let totalProblems = 0;
  const failures = [];

  for (const rel of pages) {
    const abs = path.join(REPO_ROOT, rel);
    const html = fs.readFileSync(abs, 'utf8');
    const code = extractInlineScripts(html);
    if (!code.trim()) continue;

    let messages;
    try {
      messages = linter.verify(code, config, { filename: rel });
    } catch (e) {
      failures.push(`${rel}: parse error -- ${e.message}`);
      totalProblems++;
      continue;
    }

    for (const msg of messages) {
      totalProblems++;
      failures.push(`${rel}:${msg.line}:${msg.column} -- ${msg.message}`);
    }
  }

  if (totalProblems > 0) {
    console.error(`\nUndefined-variable check FAILED -- ${totalProblems} problem(s):\n`);
    for (const f of failures) console.error('  ' + f);
    console.error(
      `\nEach of these is a variable referenced in a page's own inline <script> that isn't ` +
      `actually in scope there -- either a typo, or (the real bug this check exists to catch) a ` +
      `value that only exists inside a DIFFERENT function and was never passed in or returned. ` +
      `This exact shape caused a real production incident on 2026-09-03: every single invoice ` +
      `generation threw an uncaught error for this reason before it was caught and fixed.\n\n` +
      `If this is a genuine new shared global (a function/const a script file exports for other ` +
      `pages to use), add that file to SHARED_SCRIPT_FILES in scripts/check-undefined-vars.js.\n`
    );
    process.exit(1);
  }

  console.log(`Undefined-variable check passed -- ${pages.length} pages checked, all clean.`);
}

main();
