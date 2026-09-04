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
//
// Extended 2026-09-04, found during a full portal audit, to catch a
// second, related class of scoping bug: a page redeclaring a
// top-level const/let/function name that a shared file it actually
// loads already declares. portal/jobs.html and manage-booking.html
// both had this -- each loaded /business-hours.js (which declares
// MIN_LEAD_HOURS and others) while ALSO redeclaring the same names in
// their own inline script. Classic (non-module) <script> tags on one
// page share a single lexical environment for top-level const/let/
// class, so this is a genuine SyntaxError ("Identifier has already
// been declared") the instant a real browser loads the page -- not
// a milder shadowing, and not something no-undef could ever catch
// (a redeclared name is, if anything, MORE defined than before).

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

function extractTopLevelNamesFromSource(src) {
  const names = new Set();
  for (const line of src.split('\n')) {
    const m = line.match(DECL_PATTERN);
    if (m) names.add(m[1] || m[2]);
  }
  return names;
}

function extractTopLevelNames(absPath) {
  return extractTopLevelNamesFromSource(fs.readFileSync(absPath, 'utf8'));
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
  // Case-insensitive AND tolerant of anything up to the closing >
  // (2026-09-03, three CodeQL "Bad HTML filtering regexp" passes on
  // this one regex): browsers treat <SCRIPT> the same as <script>,
  // and per the real HTML5 end-tag parsing rule, </script followed by
  // ANYTHING up to the next > -- whitespace, a stray attribute-looking
  // token, garbage -- still closes the script element. A narrower
  // pattern (first just case-insensitive, then tolerating only plain
  // whitespace) kept missing further real, valid-per-spec variations.
  // [^>]* is the actual correct rule, not an incremental patch on top
  // of it -- and it's the exact same pattern the opening tag already
  // used correctly from the start (<script([^>]*)>), just applied to
  // the closing tag too.
  const re = /<script([^>]*)>([\s\S]*?)<\/script[^>]*>/gi;
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

// Catches a real bug found during a full portal audit (2026-09-04):
// portal/jobs.html and manage-booking.html each redeclared the same
// top-level const names (MIN_LEAD_HOURS and friends) that
// business-hours.js -- a real <script src> they both actually load --
// already declares. Classic (non-module) <script> tags on one page
// share a single lexical environment for top-level const/let/class,
// so this is a genuine SyntaxError ("Identifier has already been
// declared") the moment a real browser loads the page, not a milder
// shadowing or a hypothetical drift risk. no-undef alone can never
// catch this -- a redeclared name is, if anything, MORE defined than
// before, not less.
//
// Deliberately uses NO lint rules at all -- just ESLint's own parser,
// relying on it to surface a genuine SyntaxError as a fatal parse
// message. Two earlier versions of this check got this wrong:
//   1. A loose regex guessing at "is this genuinely top-level"
//      (matching buildGlobals()'s own leniency, safe there since
//      being too generous only pads an allowlist) produced hundreds
//      of false positives -- ordinary function-local variables named
//      res/row/el/container/data are extremely common across this
//      codebase, and a text pattern can't tell "inside a function"
//      from "genuinely top-level."
//   2. Using ESLint's no-redeclare RULE (real scope analysis, correct
//      in principle) still produced real false positives: it flags
//      var redeclared multiple times too, which is legal JS and not
//      a SyntaxError at all -- just discouraged style. tools/
//      qrcode-lib.js (a third-party library) redeclares var i/row/
//      col/mod repeatedly across its own methods, entirely legally,
//      and no-redeclare flagged every one of those as if it were the
//      same class of bug.
// Running with zero rules enabled sidesteps both: var redeclaration
// produces no message at all this way (confirmed directly against
// ESLint's own behavior before relying on it), while const/let/class
// redeclaration is an actual parse failure ESLint always reports
// regardless of which rules are configured -- exactly the one real
// distinction this check needs and nothing else.
//
// Only checks shared files THIS SPECIFIC page actually loads, not
// every shared file that exists in the repo -- two shared files that
// merely coexist in the project but are never loaded together on one
// page can never conflict in a real browser, so checking that would
// just be noise for a risk that doesn't exist.
//
// SUPABASE_URL/SUPABASE_ANON_KEY are excluded, matching EXTRA_GLOBALS'
// own established exception above: many pages deliberately keep their
// own local copy of these two specific credential constants rather
// than relying on tools/auth.js's copy, a known and tolerated pattern
// across this project already, not the bug class this check targets.
const TOLERATED_REDECLARATIONS = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY']);

function findSharedScriptRedeclarations(rel, html, inlineCode) {
  const loadedSharedFiles = SHARED_SCRIPT_FILES.filter((sharedRel) => {
    // Matches src="/<file>" or src="/<file>?v=...", the only two real
    // shapes used anywhere in this project -- anchored to a real src=
    // attribute for the same reason check-consistency.js's own
    // shared-script regex was fixed to do (2026-09-03): a bare
    // filename mention in an explanatory comment must never count as
    // "this page loads it."
    //
    // Escapes every regex metacharacter, not just the dot (flagged by
    // CodeQL, 2026-09-04): SHARED_SCRIPT_FILES is a hardcoded,
    // developer-controlled list with no real injection risk today,
    // but an escape helper that only handles one character is
    // genuinely incomplete regardless -- a future entry containing
    // any other special character (backslash included) would have
    // built a subtly wrong or broken pattern.
    const escaped = sharedRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`src="/${escaped}(\\?[^"]*)?"`).test(html);
  });
  if (!loadedSharedFiles.length) return [];

  const sharedSources = loadedSharedFiles.map((sharedRel) =>
    fs.readFileSync(path.join(REPO_ROOT, sharedRel), 'utf8')
  );
  const combined = [...sharedSources, inlineCode].join('\n;\n');

  const linter = new Linter();
  const config = {
    parserOptions: { ecmaVersion: 2021, sourceType: 'script' },
    env: { es2021: true },
    rules: {},
  };

  const messages = linter.verify(combined, config, { filename: rel });
  return messages
    .filter((msg) => msg.fatal && /Identifier '([^']+)' has already been declared/.test(msg.message))
    .filter((msg) => {
      const name = msg.message.match(/Identifier '([^']+)' has already been declared/)[1];
      return !TOLERATED_REDECLARATIONS.has(name);
    })
    .map((msg) =>
      `${rel}: ${msg.message} (checked against ${loadedSharedFiles.join(', ')})`
    );
}

// Extends the check above to a second, related risk (2026-09-04),
// requested directly: "we want to make sure we are catching every
// bug, every error, every glitch. before it happens."
// findSharedScriptRedeclarations() above only checks a shared file
// against the ONE PAGE that loads it -- so two shared files that
// conflict with EACH OTHER, but happen not to be loaded together by
// any page TODAY, would pass clean. That's a real, standing landmine:
// the moment anyone adds a second shared-script tag to an existing
// page, or builds a new page that loads both, it breaks immediately
// with no warning at build time -- exactly the shape of bug this
// tooling exists to catch before it ships, not after.
//
// Checked once per run, not once per page: every pair of files in
// SHARED_SCRIPT_FILES is combined and parsed together, regardless of
// whether any current page actually loads both. Pairs are
// mathematically sufficient here, not just convenient -- a
// redeclaration conflict is fundamentally about two declarations of
// the same name colliding, so if no pair conflicts, no combination of
// any size can conflict either.
function findAllSharedFilePairConflicts() {
  const problems = [];
  const linter = new Linter();
  const config = {
    parserOptions: { ecmaVersion: 2021, sourceType: 'script' },
    env: { es2021: true },
    rules: {},
  };

  for (let i = 0; i < SHARED_SCRIPT_FILES.length; i++) {
    for (let j = i + 1; j < SHARED_SCRIPT_FILES.length; j++) {
      const relA = SHARED_SCRIPT_FILES[i];
      const relB = SHARED_SCRIPT_FILES[j];
      const combined = [
        fs.readFileSync(path.join(REPO_ROOT, relA), 'utf8'),
        fs.readFileSync(path.join(REPO_ROOT, relB), 'utf8'),
      ].join('\n;\n');

      const messages = linter.verify(combined, config, { filename: `${relA} + ${relB}` });
      for (const msg of messages) {
        if (!msg.fatal || !/Identifier '([^']+)' has already been declared/.test(msg.message)) continue;
        const name = msg.message.match(/Identifier '([^']+)' has already been declared/)[1];
        if (TOLERATED_REDECLARATIONS.has(name)) continue;
        problems.push(
          `${relA} + ${relB}: ${msg.message} -- these two shared files conflict with each other. ` +
          `No page may currently load both, but the instant one does (or a third file bridges them), ` +
          `this becomes a real SyntaxError with no warning otherwise.`
        );
      }
    }
  }
  return problems;
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

  for (const problem of findAllSharedFilePairConflicts()) {
    totalProblems++;
    failures.push(problem);
  }

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

    for (const problem of findSharedScriptRedeclarations(rel, html, code)) {
      totalProblems++;
      failures.push(problem);
    }
  }

  if (totalProblems > 0) {
    console.error(`\nUndefined-variable check FAILED -- ${totalProblems} problem(s):\n`);
    for (const f of failures) console.error('  ' + f);
    console.error(
      `\nThree related classes of scoping bug, all caught the same way (knowing what's ` +
      `genuinely in scope, without needing to execute anything):\n\n` +
      `  1. A variable referenced that isn't actually in scope -- either a typo, or (the real bug ` +
      `this check was originally built for) a value that only exists inside a DIFFERENT function ` +
      `and was never passed in or returned. This exact shape caused a real production incident on ` +
      `2026-09-03: every single invoice generation threw an uncaught error for this reason before ` +
      `it was caught and fixed.\n\n` +
      `  2. A page redeclaring a name that a shared file it actually loads (via <script src>) ` +
      `already declares -- classic <script> tags on one page share a single lexical scope for ` +
      `top-level const/let/class, so this is a real SyntaxError in a real browser, not a milder ` +
      `shadowing. Found during a full portal audit on 2026-09-04: portal/jobs.html and ` +
      `manage-booking.html both had this, and it would have broken either page completely on a ` +
      `real client's next visit.\n\n` +
      `  3. Two shared files that conflict with EACH OTHER, independent of any page -- checked ` +
      `once across every pair in SHARED_SCRIPT_FILES regardless of current usage, so a landmine ` +
      `like this is caught before any page ever combines them, not after.\n\n` +
      `If this is a genuine new shared global (a function/const a script file exports for other ` +
      `pages to use), add that file to SHARED_SCRIPT_FILES in scripts/check-undefined-vars.js.\n`
    );
    process.exit(1);
  }

  console.log(`Undefined-variable check passed -- ${pages.length} pages checked, all clean.`);
}

main();
