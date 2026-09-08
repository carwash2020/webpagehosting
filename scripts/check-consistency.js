#!/usr/bin/env node
// Checks every real tool page in /tools/ for the boilerplate every one
// of them is supposed to carry: the login gate, a CSP, the PWA manifest
// block, and a styles.css version param that matches everyone else's.
//
// This exists because every one of the bugs found in the August 2026
// site audit was exactly this kind of drift -- one page silently missing
// something its siblings all had, invisible until someone thinks to
// check by hand. This runs on every push (see .github/workflows/test.yml)
// so drift gets caught immediately instead of at the next manual audit.
//
// Run locally with: npm run check-consistency

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');
// Added 2026-09-06: the content-hash freshness check below (detectSharedScripts
// / checkVersionFreshness / fixVersions) only ever ran against tools/. portal/
// has the exact same shared-stylesheet-by-hash convention (portal-polish.css,
// portal-app.css/.js) but was never covered, and its stale stamp was found and
// fixed BY HAND twice in one session as a direct result -- exactly the kind of
// drift this whole file exists to catch automatically. The other checks below
// (requireAuth presence, CSP, PWA manifest, button-handler wiring, tour
// health, precache completeness) stay tools-only on purpose: portal uses a
// different auth model entirely (the real Supabase JS SDK's
// client.auth.getSession(), not this app's own requireAuth()/auth.js), so
// applying those checks there would mean asserting portal pages look like
// tools pages in ways they were never meant to.
const ROOT_DIR = path.join(__dirname, '..');
const PORTAL_DIR = path.join(__dirname, '..', 'portal');
// portal-app.css/.js intentionally use the SAME manual-timestamp cache-bust
// convention as the public site's styles.css (bumped by a human alongside a
// meaningful change, not derived from content), not the content-hash
// convention every other shared tools/portal file uses. Confirmed by their
// real current values: 202609042100 / 202609042200 -- a 12-digit YYYYMMDDHHMM
// timestamp, not a hex content hash, and there's no reason a real edit to
// either file would ever make its hash equal a date string. Excluded from
// the content-hash freshness check below so it doesn't flag them as "stale"
// against a hash they were never meant to match in the first place.
const PORTAL_TIMESTAMP_VERSIONED = new Set(['portal-app.css', 'portal-app.js']);

// Pages that are deliberately different, and why -- see the code review
// this checker came out of for the full reasoning on each:
const EXEMPT = {
  'login.html': 'the login gate itself -- requireAuth() would be circular here',
  'reset-password.html': "reached from a password-recovery email link before the person is logged in -- requireAuth() would lock them out of the one page meant to get them back in",
  'contact-card.html': 'retired page, just a redirect stub to job-tracker.html',
  'expense-logger.html': 'retired page, just a redirect stub to job-tracker.html',
  'job-cost-lookup.html': 'retired page, just a redirect stub to job-tracker.html',
  'runway-dashboard.html': 'has its own fully self-contained <style> block, does not load /styles.css',
};

function readTool(filename) {
  return fs.readFileSync(path.join(TOOLS_DIR, filename), 'utf8');
}

// Site audit improvement #6 (2026-08-20): confirms the app tour's own
// health automatically on every push, rather than waiting for another
// hard-to-reproduce user report to find the same class of bug again.
// Two real, confirmed failure modes from the past week: a page whose
// tour step points at a highlightSelector that doesn't actually exist
// on that page, and a page that never loaded the CSS the tour needs to
// even be visible (runway-dashboard.html's real bug, exactly).
// Site audit improvement #4 (2026-08-20): automates the exact
// detection that found 3 real, confirmed bugs this past week
// (invoice-generator.html, route-planner.html, review-request.html) --
// a function called immediately at the top level of a page's own
// script, before document.addEventListener('DOMContentLoaded') even
// registers, whose body references a function that only exists in a
// deferred script (tools-dialogs.js, tools-effects.js, etc.). Per the
// HTML spec, every inline script runs during parsing, before any
// deferred script executes -- meaning a top-level call like this is
// guaranteed to throw on every real page load, not a maybe, and
// because the throw happens before the DOMContentLoaded listener can
// even register, everything inside it (the tour, sync, error
// reporting) silently never runs either.
const DEFERRED_SCRIPT_FILES = ['tools-dialogs.js', 'tools-effects.js', 'tools-nav-pwa.js', 'tools-tour.js', 'tools-media-sharing.js'];

function getDeferredFunctionNames() {
  const names = new Set();
  for (const file of DEFERRED_SCRIPT_FILES) {
    const filePath = path.join(TOOLS_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf8');
    for (const m of src.matchAll(/function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) names.add(m[1]);
  }
  return names;
}

function findFunctionBody(src, name) {
  const m = src.match(new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!m) return null;
  const isAsync = !!m[1];
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return { body: src.slice(start, i), isAsync };
}

// Site audit improvement, requested directly (2026-08-21): a real
// functionality test across every button in the app. Manually clicking
// through hundreds of buttons isn't a repeatable, ongoing check --
// this scans every onclick/onchange/oninput/onkeydown handler on every
// page and confirms the function it actually calls is genuinely
// defined somewhere that page can reach: either inline on the page
// itself, or in one of the specific shared scripts that page actually
// loads (not just any shared script anywhere in the app, which would
// hide a real broken reference behind an unrelated file that happens
// to define a same-named function elsewhere).
const JS_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'switch', 'case', 'catch', 'function', 'return',
  'typeof', 'new', 'delete', 'void', 'in', 'of', 'instanceof', 'do', 'try', 'finally',
  'throw', 'const', 'let', 'var', 'await', 'async', 'yield',
]);
// Native browser/JS globals every page can always call, regardless of
// what it loads -- not app-defined functions, so never worth flagging.
const KNOWN_GLOBALS = new Set([
  'confirm', 'alert', 'prompt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'Boolean', 'Number', 'String', 'Array', 'Object', 'Date', 'Math', 'JSON', 'Promise',
  'fetch', 'structuredClone',
]);

function extractDefinedFunctionNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/function\s+([a-zA-Z_$][\w$]*)\s*\(/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of src.matchAll(/window\.([a-zA-Z_$][\w$]*)\s*=/g)) names.add(m[1]);
  return names;
}

function checkButtonHandlers(problems) {
  const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));
  // Cache each shared script's own defined-function set once, rather
  // than re-parsing the same file for every page that loads it.
  const sharedScriptCache = {};
  function getSharedScriptFunctions(scriptName) {
    if (sharedScriptCache[scriptName]) return sharedScriptCache[scriptName];
    const scriptPath = path.join(TOOLS_DIR, scriptName);
    const names = fs.existsSync(scriptPath) ? extractDefinedFunctionNames(fs.readFileSync(scriptPath, 'utf8')) : new Set();
    sharedScriptCache[scriptName] = names;
    return names;
  }

  for (const filename of files) {
    const src = readTool(filename);
    const availableFns = extractDefinedFunctionNames(src);
    for (const m of src.matchAll(/<script src="\/tools\/([\w-]+\.js)/g)) {
      for (const fn of getSharedScriptFunctions(m[1])) availableFns.add(fn);
    }

    const handlerValues = new Set();
    for (const m of src.matchAll(/on(?:click|change|input|keydown)=\\?"([^"]*)\\?"/g)) handlerValues.add(m[1]);

    const calledFns = new Set();
    for (const handler of handlerValues) {
      // Bare identifier immediately followed by "(" -- not preceded by
      // "." (excludes method calls like event.stopPropagation() or
      // this.closest(...), which aren't app-defined functions to check).
      for (const m of handler.matchAll(/(?<![.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)) {
        const name = m[1];
        if (JS_KEYWORDS.has(name) || KNOWN_GLOBALS.has(name)) continue;
        calledFns.add(name);
      }
    }

    const missing = [...calledFns].filter(fn => !availableFns.has(fn));
    if (missing.length) {
      problems.push(`${filename}: ${missing.length} button handler(s) call a function that isn't defined anywhere this page can reach: ${missing.join(', ')}`);
    }
  }
}

function checkTopLevelDeferredCalls(problems) {
  const deferredNames = getDeferredFunctionNames();
  const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));

  for (const filename of files) {
    const src = readTool(filename);
    const dclIndex = src.indexOf("document.addEventListener('DOMContentLoaded'");
    if (dclIndex === -1) continue; // no init handler on this page at all -- nothing to check
    const before = src.slice(0, dclIndex);

    // Real brace-depth tracking (not an indentation guess) to find
    // which lines are genuinely at the top level of the script, not
    // nested inside some other function or block that merely happens
    // to share the same indentation.
    const lines = before.split('\n');
    let depth = 0;
    const topLevelCalls = [];
    for (const line of lines) {
      const startDepth = depth;
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (startDepth !== 0) continue; // this line started inside a nested block -- not top level
      const callMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\(\s*[^)]*\)\s*;/);
      if (callMatch) topLevelCalls.push(callMatch[1]);
    }

    for (const fnName of topLevelCalls) {
      const found = findFunctionBody(before, fnName);
      if (!found) continue; // not a locally-defined function (e.g. requireAuth from auth.js) -- not what this check is for
      if (found.isAsync && /\bawait\b/.test(found.body)) continue; // an async function's own await points naturally give deferred scripts time to load first -- confirmed safe for this exact pattern on runway-dashboard.html earlier this session
      const referencedDeferred = [...deferredNames].filter(d => new RegExp('\\b' + d + '\\(').test(found.body));
      if (referencedDeferred.length) {
        problems.push(`${filename}: ${fnName}() is called at the top level of the script (before DOMContentLoaded registers), but references ${referencedDeferred.join(', ')}, which only exist in a deferred script -- guaranteed to throw on every real page load`);
      }
    }
  }
}

// Requested directly ("what else could this same bug class be
// hiding"), right after fixing the cache-bust version list's own
// hardcoded-list problem: service-worker.js's PRECACHE_URLS is a
// SEPARATE hardcoded list with the identical shape, and its own
// comments already admit this exact class of drift happened at least
// 4 times before ("was missing, found and fixed" appears 4 times in
// that file's history). Checked directly rather than assuming it was
// now complete: tools-tour.js -- the same file already found missing
// from the cache-bust list earlier -- is ALSO missing here, and
// reset-password.html is missing entirely, meaning a password-reset
// link opened with no connectivity would fail to load at all. Unlike
// the cache-bust list, this can't be auto-derived from inside
// service-worker.js itself (a service worker has no filesystem access
// at runtime to discover new files), so this check instead verifies
// completeness at dev/CI time, against the real, current file list.
function checkPrecacheCompleteness(problems) {
  const swPath = path.join(__dirname, '..', 'service-worker.js');
  if (!fs.existsSync(swPath)) return;
  const swSrc = fs.readFileSync(swPath, 'utf8');
  const arrayMatch = swSrc.match(/const PRECACHE_URLS = \[([\s\S]*?)\n\];/);
  if (!arrayMatch) {
    problems.push('service-worker.js: could not find a PRECACHE_URLS array to check');
    return;
  }
  const precached = new Set((arrayMatch[1].match(/'\/tools\/[^']+'/g) || []).map(s => s.slice(1, -1)));

  const realHtmlFiles = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));
  const realScriptFiles = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.js') || f.endsWith('.css'));

  for (const f of [...realHtmlFiles, ...realScriptFiles]) {
    const url = '/tools/' + f;
    if (!precached.has(url)) {
      problems.push(`service-worker.js: ${url} is a real file but missing from PRECACHE_URLS -- won't be available offline, and cache.addAll() aborts atomically on any 404, so a stale/retired reference elsewhere in the list is just as dangerous as a missing real one`);
    }
  }

  // The reverse direction matters just as much: a precached URL for a
  // file that's since been deleted or renamed causes cache.addAll() to
  // 404 and abort the ENTIRE precache atomically -- exactly what
  // happened for real when tools-common.js was split into 4 files but
  // the old reference was left behind, silently breaking offline
  // support for every other file in the list too, not just the one.
  // Scans every real file in tools/ regardless of extension (not just
  // .html/.js/.css) -- manifest.json, for instance, is real and
  // precached but neither of those two extensions, and would
  // otherwise show up here as a false "doesn't exist" positive.
  const allRealFiles = new Set(fs.readdirSync(TOOLS_DIR).map(f => '/tools/' + f));
  for (const url of precached) {
    if (!allRealFiles.has(url)) {
      problems.push(`service-worker.js: PRECACHE_URLS references ${url}, but that file doesn't exist -- cache.addAll() will 404 and abort precaching for EVERY file in the list, not just this one`);
    }
  }
}

function checkTourHealth(problems) {
  const tourSrc = fs.readFileSync(path.join(TOOLS_DIR, 'tools-tour.js'), 'utf8');
  const stepPattern = /\{ page: '\/tools\/([\w-]+\.html)', highlightSelector: '([^']+)'/g;
  const steps = [...tourSrc.matchAll(stepPattern)];
  if (!steps.length) {
    problems.push('checkTourHealth: found zero steps in tools-tour.js -- did its step format change?');
    return;
  }

  for (const [, filename, selector] of steps) {
    let pageSrc;
    try {
      pageSrc = readTool(filename);
    } catch (e) {
      problems.push(`tour step references ${filename}, but that file doesn't exist`);
      continue;
    }

    // The tour needs .onboarding-card's real CSS to be visible at
    // all -- either via the shared stylesheet, or (runway-dashboard.html's
    // exact situation) copied in directly for a page that's deliberately
    // self-contained.
    const hasSharedStylesheet = /<link[^>]*styles-tools\.css/.test(pageSrc);
    const hasOwnCopy = /\.onboarding-card\s*\{/.test(pageSrc);
    if (!hasSharedStylesheet && !hasOwnCopy) {
      problems.push(`${filename}: has a tour step, but never loads styles-tools.css and has no local .onboarding-card rule -- the tour card would be invisible, unstyled content (this exact bug happened for real on runway-dashboard.html)`);
    }

    // Confirm the highlightSelector actually resolves to something
    // real. Same selector-to-substring conversion already proven
    // correct in the test suite: an id selector, a compound class
    // selector (every class name must be present), or a single
    // attribute-value selector (including the *= substring operator).
    let selectorFound;
    if (selector.startsWith('#')) {
      selectorFound = pageSrc.includes('id="' + selector.slice(1) + '"');
    } else if (selector.startsWith('.')) {
      const classNames = selector.slice(1).split('.');
      selectorFound = classNames.every(c => new RegExp('class="[^"]*\\b' + c + '\\b[^"]*"').test(pageSrc));
    } else {
      const attrMatch = selector.match(/\[([^*=]+)\*?="([^"]+)"\]/);
      selectorFound = attrMatch ? new RegExp(attrMatch[1] + '="[^"]*' + attrMatch[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^"]*"').test(pageSrc) : false;
    }
    if (!selectorFound) {
      problems.push(`${filename}: tour step's highlightSelector "${selector}" does not match anything in this page's real HTML`);
    }
  }
}

// Real, deterministic cache-bust versioning: the ?v= string on every
// page loading a shared file is its own content hash, not a
// human/AI-chosen timestamp. Replaces a time-based heuristic (the
// file's last-commit time compared against the version string's
// encoded date, inside a 12-hour grace window meant to absorb
// timezone skew) that let the exact bug it existed to catch through
// three times in one day -- a real function added to sync.js, with
// the ?v= string never bumped to match, sat within the grace window
// and was never flagged, while real users' browsers kept serving the
// stale, function-missing copy regardless. A content hash has no
// grace window and no judgment call to get wrong.
//
// "Which files need this" is ALSO derived automatically now, rather
// than a hardcoded list -- found by asking exactly this question
// ("what else could let this class of bug through") that
// data-layer.js and tools-tour.js, genuinely shared by 9 and 11 pages,
// were both missing from the old hardcoded list entirely, so neither
// had any cache-bust monitoring at all. data-layer.js was already
// sitting on a real, ~4-day-stale version as a direct result, caught
// only by asking this question, not by any check. A .js/.css file in
// tools/ referenced by 2 or more real pages is "shared" and gets
// checked -- computed fresh every run, so a brand new shared file is
// covered automatically the moment a second page loads it, with
// nothing to remember to add anywhere.
function detectSharedScripts(dir) {
  const htmlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
  const candidates = fs.readdirSync(dir).filter(f => f.endsWith('.js') || f.endsWith('.css'));
  const shared = [];

  for (const candidate of candidates) {
    if (dir === PORTAL_DIR && PORTAL_TIMESTAMP_VERSIONED.has(candidate)) continue;
    const escaped = candidate.replace('.', '\\.');
    const pattern = new RegExp(escaped + '(\\?v=[a-zA-Z0-9]+)?["\']');
    const referencingPages = htmlFiles.filter(f => pattern.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    if (referencingPages.length >= 2) shared.push(candidate);
  }
  return shared;
}

function currentContentHash(dir, script) {
  const scriptPath = path.join(dir, script);
  if (!fs.existsSync(scriptPath)) return null;
  const content = fs.readFileSync(scriptPath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
}

function checkVersionFreshness(dir, problems) {
  const VERSIONED_SCRIPTS = detectSharedScripts(dir);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

  for (const script of VERSIONED_SCRIPTS) {
    const realHash = currentContentHash(dir, script);
    if (realHash === null) continue;

    const escaped = script.replace('.', '\\.');
    const pattern = new RegExp(escaped + '\\?v=([a-zA-Z0-9]+)');
    for (const f of files) {
      const m = fs.readFileSync(path.join(dir, f), 'utf8').match(pattern);
      if (!m) continue; // this page doesn't load this script at all
      if (m[1] !== realHash) {
        problems.push(
          `${f} requests ${script}?v=${m[1]}, but ${script}'s real content hash right now is ${realHash} -- ` +
          `these don't match, so browsers may serve a STALE cached copy. Run "npm run fix-versions" to correct every reference automatically.`
        );
      }
    }
  }
}

// Companion to the check above -- rewrites every ?v= reference to
// each shared file's real, current content hash, across every page
// that loads it. Run directly with `npm run fix-versions` any time a
// file shared by 2+ pages changes, removing the "remember to bump it
// by hand, and compute the right value" step entirely.
function fixVersions(dir) {
  const VERSIONED_SCRIPTS = detectSharedScripts(dir);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
  let changedCount = 0;

  for (const script of VERSIONED_SCRIPTS) {
    const realHash = currentContentHash(dir, script);
    if (realHash === null) continue;

    const escaped = script.replace('.', '\\.');
    const pattern = new RegExp(escaped + '\\?v=([a-zA-Z0-9]+)', 'g');

    for (const f of files) {
      const filePath = path.join(dir, f);
      const content = fs.readFileSync(filePath, 'utf8');
      if (!pattern.test(content)) continue;
      pattern.lastIndex = 0; // reset after .test() above, since this regex has the g flag
      const updated = content.replace(pattern, script + '?v=' + realHash);
      if (updated !== content) {
        fs.writeFileSync(filePath, updated);
        console.log(`  ${f}: ${script}?v=... -> ${realHash}`);
        changedCount++;
      }
    }
  }

  return changedCount;
}

// ---------------------------------------------------------------------------
// GLOBAL SHARED FILES (root-level, referenced by absolute path from all of
// root/, tools/, and portal/) -- styles.css, triage.js, business-hours.js,
// site-motion.js.
//
// detectSharedScripts()/checkVersionFreshness()/fixVersions() above only
// ever look for a shared file's references WITHIN the one directory being
// scanned, because every other shared file (tools-effects.js, sync.js,
// portal-app.js, ...) only lives in, and is only referenced from, tools/ OR
// portal/, never both and never root. styles.css breaks that assumption --
// it's loaded from root pages, every tools/ page, and every portal/ page
// all at once -- and it was, until this fix, the ONE meaningfully-shared
// file on the whole site with NO automatic freshness check at all: it used
// a human-picked timestamp instead of a content hash specifically so it
// could be bumped once and referenced identically everywhere, but nothing
// ever confirmed that stamp actually matched the file's real content, only
// that every tools/ page agreed with every other tools/ page (portal/ and
// root weren't even compared). triage.js/business-hours.js/site-motion.js
// were worse off still: root-only files with zero coverage of any kind.
//
// This closes that gap by hashing each of these four files once and
// rewriting every reference to it, in any of the three directories, to
// that one real hash -- the same automatic, no-judgment-call mechanism
// every other shared file already gets, just no longer scoped to a single
// directory.
const GLOBAL_SHARED_FILES = ['styles.css', 'triage.js', 'business-hours.js', 'site-motion.js'];
const BLOG_DIR = path.join(__dirname, '..', 'blog');
const SCAN_DIRS = [ROOT_DIR, TOOLS_DIR, PORTAL_DIR, BLOG_DIR];

function htmlFilesIn(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => path.join(dir, f));
}

function checkGlobalSharedFileFreshness(problems) {
  for (const file of GLOBAL_SHARED_FILES) {
    const realHash = currentContentHash(ROOT_DIR, file);
    if (realHash === null) continue; // file doesn't exist -- not this check's job to notice that
    const pattern = new RegExp(file.replace('.', '\\.') + '\\?v=([a-zA-Z0-9]+)');
    for (const dir of SCAN_DIRS) {
      for (const htmlPath of htmlFilesIn(dir)) {
        const m = fs.readFileSync(htmlPath, 'utf8').match(pattern);
        if (!m) continue; // this page doesn't load this file at all
        if (m[1] !== realHash) {
          problems.push(
            `${path.relative(ROOT_DIR, htmlPath)} requests ${file}?v=${m[1]}, but ${file}'s real content hash right now is ${realHash} -- ` +
            `these don't match, so browsers may serve a STALE cached copy. Run "npm run fix-versions" to correct every reference automatically.`
          );
        }
      }
    }
  }
}

function fixGlobalSharedFiles() {
  let changedCount = 0;
  for (const file of GLOBAL_SHARED_FILES) {
    const realHash = currentContentHash(ROOT_DIR, file);
    if (realHash === null) continue;
    const pattern = new RegExp(file.replace('.', '\\.') + '\\?v=([a-zA-Z0-9]+)', 'g');
    for (const dir of SCAN_DIRS) {
      for (const htmlPath of htmlFilesIn(dir)) {
        const content = fs.readFileSync(htmlPath, 'utf8');
        if (!pattern.test(content)) continue;
        pattern.lastIndex = 0;
        const updated = content.replace(pattern, file + '?v=' + realHash);
        if (updated !== content) {
          fs.writeFileSync(htmlPath, updated);
          console.log(`  ${path.relative(ROOT_DIR, htmlPath)}: ${file}?v=... -> ${realHash}`);
          changedCount++;
        }
      }
    }
  }
  return changedCount;
}

// ---------------------------------------------------------------------------
// SERVICE WORKER CACHE_NAME AUTO-BUMP
//
// The other half of the "3 manual bump-or-fail steps" this project has been
// bitten by repeatedly (see CONTINUE-HERE.md): both service workers precache
// a fixed file list cache-first with no revalidation, so a real edit to any
// precached file requires bumping CACHE_NAME too, or every installed app
// stays pinned to the old copy of that file forever, with no error and no
// visible signal. Historically that bump was entirely a human's job to
// remember, one at a time, by hand -- the git history above this point is
// literally dozens of "Bumped vNN -> vNN+1: X changed" comments, each one a
// real point where forgetting would have shipped nothing.
//
// This computes a real fingerprint (a hash of every precached file's actual
// current content, in list order) and stores it in a trailing comment right
// after CACHE_NAME. A mismatch between the stored and real fingerprint means
// a precached file changed since the fingerprint was last recorded --
// exactly the condition that used to require a human to notice and bump the
// version by hand. `npm run fix-versions` now does that bump automatically,
// the same command already run for the shared-file hashes above.
function resolvePrecacheUrl(url) {
  return path.join(ROOT_DIR, url.replace(/^\//, ''));
}

function computePrecacheFingerprint(swPath) {
  const swSrc = fs.readFileSync(swPath, 'utf8');
  const arrayMatch = swSrc.match(/const PRECACHE_URLS = \[([\s\S]*?)\n\];/);
  if (!arrayMatch) return null;
  const urls = (arrayMatch[1].match(/'\/[^']+'/g) || []).map(s => s.slice(1, -1));
  const combined = urls.map(url => {
    const filePath = resolvePrecacheUrl(url);
    if (!fs.existsSync(filePath)) return url + ':MISSING';
    return url + ':' + crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }).join('|');
  return crypto.createHash('sha256').update(combined).digest('hex').slice(0, 12);
}

const CACHE_NAME_PATTERN = /const CACHE_NAME = '([a-zA-Z0-9-]+)-v(\d+)';(?: \/\/ precache-fingerprint:([a-f0-9]+))?/;

function checkCacheFingerprint(swPath, label, problems) {
  if (!fs.existsSync(swPath)) return;
  const swSrc = fs.readFileSync(swPath, 'utf8');
  const m = swSrc.match(CACHE_NAME_PATTERN);
  if (!m) {
    problems.push(`${label}: could not find a CACHE_NAME = '<prefix>-v<N>'; declaration to check`);
    return;
  }
  const storedFingerprint = m[3];
  const realFingerprint = computePrecacheFingerprint(swPath);
  if (realFingerprint === null) {
    problems.push(`${label}: could not find a PRECACHE_URLS array to fingerprint`);
    return;
  }
  if (!storedFingerprint || storedFingerprint !== realFingerprint) {
    problems.push(
      `${label}: precached file contents don't match the fingerprint recorded next to CACHE_NAME ` +
      `(recorded: ${storedFingerprint || 'none yet'}, real: ${realFingerprint}) -- a precached file changed ` +
      `and CACHE_NAME was never bumped, so installed app users would stay pinned to the stale copy indefinitely. ` +
      `Run "npm run fix-versions" to bump it automatically.`
    );
  }
}

function fixCacheFingerprint(swPath) {
  if (!fs.existsSync(swPath)) return false;
  const swSrc = fs.readFileSync(swPath, 'utf8');
  const m = swSrc.match(CACHE_NAME_PATTERN);
  if (!m) return false;
  const [, prefix, verNum, storedFingerprint] = m;
  const realFingerprint = computePrecacheFingerprint(swPath);
  if (realFingerprint === null || storedFingerprint === realFingerprint) return false;
  const newVersion = parseInt(verNum, 10) + 1;
  const newDeclaration = `const CACHE_NAME = '${prefix}-v${newVersion}'; // precache-fingerprint:${realFingerprint}`;
  const updated = swSrc.replace(CACHE_NAME_PATTERN, newDeclaration);
  fs.writeFileSync(swPath, updated);
  console.log(`  ${path.relative(ROOT_DIR, swPath)}: CACHE_NAME '${prefix}-v${verNum}' -> '${prefix}-v${newVersion}'`);
  return true;
}

if (require.main === module && process.argv.includes('--fix-versions')) {
  const changedCount = fixVersions(TOOLS_DIR) + fixVersions(PORTAL_DIR) + fixGlobalSharedFiles() +
    (fixCacheFingerprint(path.join(ROOT_DIR, 'service-worker.js')) ? 1 : 0) +
    (fixCacheFingerprint(path.join(PORTAL_DIR, 'service-worker.js')) ? 1 : 0);
  if (changedCount === 0) {
    console.log('All cache-bust versions already match their real content hashes -- nothing to fix.');
  } else {
    console.log(`\nUpdated ${changedCount} reference(s) across the affected pages.`);
  }
  process.exit(0);
}

function main() {
  const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));
  const problems = [];
  const jsVersions = {}; // script name -> { filename -> version string }
  const sharedScripts = detectSharedScripts(TOOLS_DIR);

  checkVersionFreshness(TOOLS_DIR, problems);
  checkVersionFreshness(PORTAL_DIR, problems);
  checkGlobalSharedFileFreshness(problems);
  checkCacheFingerprint(path.join(ROOT_DIR, 'service-worker.js'), 'service-worker.js', problems);
  checkCacheFingerprint(path.join(PORTAL_DIR, 'service-worker.js'), 'portal/service-worker.js', problems);
  checkPrecacheCompleteness(problems);
  checkTourHealth(problems);
  checkTopLevelDeferredCalls(problems);
  checkButtonHandlers(problems);

  files.forEach(filename => {
    if (EXEMPT[filename]) return;
    const html = readTool(filename);

    if (!/requireAuth\s*\(\s*\)/.test(html)) {
      problems.push(`${filename}: missing requireAuth() -- this page is reachable without logging in`);
    }
    if (!/<meta[^>]+Content-Security-Policy/i.test(html)) {
      problems.push(`${filename}: missing a Content-Security-Policy meta tag`);
    }
    // Added 2026-09-02 after a real, hard-to-find bug: review-request.html
    // had `connect-src 'self'` with no Supabase origin, so the browser
    // silently blocked auth.js's own permission check before it ever hit
    // the network -- surfacing only as a generic "Failed to fetch" and a
    // "not part of your role's access" screen, on every device and
    // network, for an account whose permissions were completely correct.
    // It went unnoticed because the page's own source never mentions
    // Supabase at all (grepping it for SUPABASE_URL finds nothing) --
    // the call comes from auth.js, which every gated page loads. So the
    // rule is keyed on loading auth.js, not on referencing Supabase
    // directly: if a page can run a permission check, it must be allowed
    // to actually reach Supabase to do it.
    if (/<script[^>]+src="\/tools\/auth\.js/.test(html)) {
      const connectSrc = (html.match(/connect-src([^;"]*)/) || [])[1] || '';
      if (!/supabase\.co/.test(connectSrc)) {
        problems.push(
          `${filename}: loads auth.js (so it can run a permission check) but its CSP connect-src does not allow https://*.supabase.co -- ` +
          `the browser will block that check before it reaches the network, showing a false "not part of your role's access" screen`
        );
      }
    }
    if (!/<link[^>]+rel="manifest"/.test(html)) {
      problems.push(`${filename}: missing the PWA manifest link`);
    }
    // Added 2026-09-02 after a real bug: dev-tools.html called
    // confirmDevPassword() from many places (permission toggles, Add
    // account, both notification test buttons) via dev-tools-shared.js,
    // but never had the #devPasswordOverlay/#devPasswordInput modal
    // markup that function's showDevPasswordPrompt() actually needs --
    // only site-content.html did. It stayed hidden because
    // confirmDevPassword() has a sessionStorage-cached "already
    // confirmed" fast path that skips the modal entirely once used
    // once in a session -- so it only threw the FIRST time a fresh
    // session genuinely needed to show the prompt, not on every call.
    if (/confirmDevPassword\s*\(/.test(html) && !/id="devPasswordOverlay"/.test(html)) {
      problems.push(`${filename}: calls confirmDevPassword() but is missing the #devPasswordOverlay/#devPasswordInput modal markup it depends on -- this throws "Cannot set properties of null" the first time a session actually needs to show the prompt, rather than using its cached fast path`);
    }
    if (!/apple-mobile-web-app-capable/.test(html)) {
      problems.push(`${filename}: missing the apple-mobile-web-app-capable meta tag`);
    }

    // Real hash-vs-reference freshness (not just "do all tool pages agree
    // with each other") is checkGlobalSharedFileFreshness()'s job now, run
    // once above across root/tools/portal together -- this just catches
    // the narrower case of the ?v= param being dropped entirely.
    if (!/styles\.css\?v=[a-zA-Z0-9]+/.test(html) && /href="\/styles\.css"/.test(html)) {
      problems.push(`${filename}: loads /styles.css with no ?v= cache-busting param`);
    }

    // Added 2026-08-14: the styles.css check above existed, but nothing
    // checked the shared JS includes -- which is exactly how most tool
    // pages ended up loading tools-common.js, sync.js, and auth.js with
    // NO cache-busting at all until the August 2026 audit caught it by
    // hand. This closes that gap so the same drift can't happen silently
    // again. Each script is optional per-page (not every tool loads all
    // three), but whichever ones a page DOES load must carry a matching
    // ?v= version, and that version must match every other page's.
    //
    // Uses the same detectSharedScripts() as checkVersionFreshness --
    // this used to be its own, separately hardcoded list, which had
    // already drifted from the other one (missing push-notifications.js
    // entirely). One derived source of truth can't disagree with itself.
    // Anchored to a real src="..." or href="..." attribute (2026-09-03)
    // -- found building tools/clients.html, whose own explanatory
    // comment mentioned "dev-tools-shared.js" by name (with no ?v=
    // immediately after it, since the comment kept going in plain
    // English) BEFORE the real <script src="..."> tag later in the
    // file. The old regex had no such anchor and matched that bare
    // mention first, reporting a false "no ?v=" failure on a tag that
    // was already correctly versioned. Any future comment mentioning a
    // shared script's filename would have hit the exact same false
    // positive.
    //
    // Both attribute names are needed, not just src= -- sharedScripts
    // includes .css files too (loaded via <link href="...">), and an
    // src=-only regex silently never matches those at all. Found by
    // direct inspection after the src-only version of this fix passed
    // every existing test anyway (none of them happens to exercise
    // this exact code path for a .css file) -- worth being honest that
    // the tests alone would not have caught this one.
    sharedScripts.forEach(script => {
      const re = new RegExp(`(?:src|href)="/tools/${script.replace('.', '\\.')}(\\?v=([a-zA-Z0-9]+))?"`);
      const m = html.match(re);
      if (!m) return; // page doesn't load this script at all -- fine
      if (!m[2]) {
        problems.push(`${filename}: loads ${script} with no ?v= cache-busting param`);
        return;
      }
      jsVersions[script] = jsVersions[script] || {};
      jsVersions[script][filename] = m[2];
    });
  });

  // styles.css freshness/mismatch across every page in root/tools/portal is
  // checkGlobalSharedFileFreshness()'s job (run above, against the real
  // content hash directly, not just cross-file agreement) -- no separate
  // check needed here.

  // Same idea as checkGlobalSharedFileFreshness() above (styles.css), run
  // separately here for each tools-only shared script -- a page that loads
  // an old cached copy of tools-common.js (say) after everyone else has
  // moved on is exactly the kind of thing this whole file exists to catch.
  Object.entries(jsVersions).forEach(([script, fileVersions]) => {
    const distinct = new Set(Object.values(fileVersions));
    if (distinct.size > 1) {
      const grouped = {};
      Object.entries(fileVersions).forEach(([file, v]) => {
        grouped[v] = grouped[v] || [];
        grouped[v].push(file);
      });
      problems.push(
        `${script} version mismatch across tool pages: ${JSON.stringify(grouped, null, 2)}`
      );
    }
  });

  if (problems.length) {
    console.error(`\nConsistency check FAILED -- ${problems.length} issue(s):\n`);
    problems.forEach(p => console.error('  - ' + p));
    console.error('');
    process.exit(1);
  }

  const portalFileCount = fs.readdirSync(PORTAL_DIR).filter(f => f.endsWith('.html')).length;
  console.log(`Consistency check passed -- ${files.length - Object.keys(EXEMPT).length} tool pages checked (full checks) plus ${portalFileCount} portal pages (cache-bust freshness only), all clean.`);
}

main();
