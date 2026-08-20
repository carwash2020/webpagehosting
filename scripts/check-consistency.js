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
const { execSync } = require('child_process');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');
const REPO_ROOT = path.join(__dirname, '..');

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

// Added 2026-08-16 after a real, costly bug: auth.js was fixed twice in
// one day, but every page still requested it as `auth.js?v=202608142300`
// -- a version string from two days earlier. Browsers correctly served
// the stale cached copy, so neither fix ever reached a real device, and
// several rounds of debugging chased phantom causes as a result.
//
// The original version of this checker verified only that all pages
// referenced the SAME version as each other, which passed happily while
// all 14 pages agreed on the same STALE version. Consistency was never
// the useful property on its own -- being current is. This compares each
// versioned script's ?v= timestamp against when git last actually
// modified that file, and fails if the file is newer than the version
// string that's supposed to be busting its cache.
//
// Bug found 2026-08-17: this worked correctly in local testing (a full
// clone) but failed on every single CI run regardless of what actually
// changed. Root cause: actions/checkout@v4 defaults to a SHALLOW clone
// (fetch-depth 1, just the triggering commit) -- and in a shallow clone,
// `git log -1 -- <path>` reports the tip commit's timestamp for ANY
// path, even one that commit never touched, because git has no earlier
// history to compare against to determine the path was untouched. That
// made every versioned script look "just modified" on every push,
// eventually flooding this check with false positives no matter how
// fresh the version strings actually were -- confirmed by reproducing
// an identical shallow clone locally (git clone --depth 1) and seeing
// the exact same false failure the CI run hit. Editing the workflow
// file to fetch full history isn't an option here (this token lacks the
// `workflow` OAuth scope needed to touch anything under
// .github/workflows/), so instead this deepens its own clone on demand
// (git fetch --unshallow) before running the check below -- CI just
// cloned from GitHub moments earlier, so the remote and network access
// are already known to work. Only falls back to skipping the check
// entirely if that fetch itself fails, rather than trusting data git
// can't actually provide. The other consistency checks below (auth
// gate, CSP, manifest, cross-file version matching) don't depend on git
// history at all and are unaffected either way.
function isShallowRepo() {
  try {
    return execSync('git rev-parse --is-shallow-repository', { cwd: REPO_ROOT, encoding: 'utf8' }).trim() === 'true';
  } catch (e) {
    return false; // git unavailable -- let the per-script checks below decide, same as before
  }
}

// Rather than just disabling the freshness check in CI's shallow clone
// (which would mean it silently never catches a real stale-version bug
// there again), this fetches the missing history on demand -- CI just
// cloned from GitHub moments ago, so the remote and network access are
// already known to work. If this fails for any reason, falls back to
// skipping the check for this run rather than trusting data git can't
// actually provide, same as before.
function ensureFullHistory() {
  if (!isShallowRepo()) return true;
  try {
    execSync('git fetch --unshallow', { cwd: REPO_ROOT, stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
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

function checkVersionFreshness(problems) {
  if (!ensureFullHistory()) return; // see the long comment above -- this check cannot be trusted here
  // 2026-08-20: tools-common.js (1,447 lines, mixing dialogs/media/nav/
  // PWA concerns together) was split into 4 focused files -- updated
  // here so this check keeps tracking real files instead of one that
  // no longer exists.
  const VERSIONED_SCRIPTS = ['tools-effects.js', 'tools-dialogs.js', 'tools-media-sharing.js', 'tools-nav-pwa.js', 'sync.js', 'auth.js', 'push-notifications.js', 'styles-tools.css', 'dev-tools-shared.js'];
  const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));

  for (const script of VERSIONED_SCRIPTS) {
    if (!fs.existsSync(path.join(TOOLS_DIR, script))) continue;

    let lastModified;
    try {
      const out = execSync(`git log -1 --format=%cI -- tools/${script}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
      if (!out) continue; // never committed -- nothing to compare against
      lastModified = new Date(out);
    } catch (e) {
      continue; // git unavailable -- skip rather than fail the whole run
    }

    const escaped = script.replace('.', '\\.');
    let found = null;
    for (const f of files) {
      const m = readTool(f).match(new RegExp(escaped + '\\?v=(\\d{12})'));
      if (m) { found = m[1]; break; }
    }
    if (!found) continue;

    // Version strings are YYYYMMDDHHMM written in local time; parsed as
    // UTC here, which is close enough for a staleness check measured in
    // hours given the generous grace window below.
    const versionDate = new Date(Date.UTC(
      +found.slice(0, 4), +found.slice(4, 6) - 1, +found.slice(6, 8),
      +found.slice(8, 10), +found.slice(10, 12)
    ));

    // 12h grace absorbs timezone skew between the version string's
    // local-time origin and git's UTC timestamps, while still catching
    // a genuinely stale version (the real bug was ~2 days stale).
    const graceMs = 12 * 60 * 60 * 1000;
    if (lastModified.getTime() - versionDate.getTime() > graceMs) {
      problems.push(
        `${script} was last modified ${lastModified.toISOString()} but pages still request ?v=${found} ` +
        `-- browsers will serve a STALE cached copy. Bump the ?v= string on every page that loads it.`
      );
    }
  }
}

function main() {
  const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));
  const problems = [];
  const versions = {}; // filename -> version string, for the cross-file comparison at the end
  const jsVersions = {}; // script name -> { filename -> version string }

  checkVersionFreshness(problems);
  checkTourHealth(problems);
  checkTopLevelDeferredCalls(problems);

  files.forEach(filename => {
    if (EXEMPT[filename]) return;
    const html = readTool(filename);

    if (!/requireAuth\s*\(\s*\)/.test(html)) {
      problems.push(`${filename}: missing requireAuth() -- this page is reachable without logging in`);
    }
    if (!/<meta[^>]+Content-Security-Policy/i.test(html)) {
      problems.push(`${filename}: missing a Content-Security-Policy meta tag`);
    }
    if (!/<link[^>]+rel="manifest"/.test(html)) {
      problems.push(`${filename}: missing the PWA manifest link`);
    }
    if (!/apple-mobile-web-app-capable/.test(html)) {
      problems.push(`${filename}: missing the apple-mobile-web-app-capable meta tag`);
    }

    const versionMatch = html.match(/styles\.css\?v=(\d+)/);
    if (versionMatch) {
      versions[filename] = versionMatch[1];
    } else if (/href="\/styles\.css"/.test(html)) {
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
    ['tools-effects.js', 'tools-dialogs.js', 'tools-media-sharing.js', 'tools-nav-pwa.js', 'sync.js', 'auth.js', 'styles-tools.css', 'dev-tools-shared.js'].forEach(script => {
      const re = new RegExp(`${script.replace('.', '\\.')}(\\?v=(\\d+))?`);
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

  // All version-bearing files should be on the SAME stamp -- that's the
  // whole point of a shared cache-bust version. A page silently sitting
  // on an old stamp means its visitors may be looking at how the CSS
  // used to render, not how it renders today.
  const distinctVersions = new Set(Object.values(versions));
  if (distinctVersions.size > 1) {
    const grouped = {};
    Object.entries(versions).forEach(([file, v]) => {
      grouped[v] = grouped[v] || [];
      grouped[v].push(file);
    });
    problems.push(
      `styles.css version mismatch across tool pages: ${JSON.stringify(grouped, null, 2)}`
    );
  }

  // Same cross-file mismatch check as styles.css above, run separately
  // for each shared script -- a page that loads an old cached copy of
  // tools-common.js (say) after everyone else has moved on is exactly
  // the kind of thing this whole file exists to catch.
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

  console.log(`Consistency check passed -- ${files.length - Object.keys(EXEMPT).length} tool pages checked, all clean.`);
}

main();
