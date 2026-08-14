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

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

// Pages that are deliberately different, and why -- see the code review
// this checker came out of for the full reasoning on each:
const EXEMPT = {
  'login.html': 'the login gate itself -- requireAuth() would be circular here',
  'contact-card.html': 'retired page, just a redirect stub to job-tracker.html',
  'expense-logger.html': 'retired page, just a redirect stub to job-tracker.html',
  'job-cost-lookup.html': 'retired page, just a redirect stub to job-tracker.html',
  'runway-dashboard.html': 'has its own fully self-contained <style> block, does not load /styles.css',
};

function readTool(filename) {
  return fs.readFileSync(path.join(TOOLS_DIR, filename), 'utf8');
}

function main() {
  const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html'));
  const problems = [];
  const versions = {}; // filename -> version string, for the cross-file comparison at the end
  const jsVersions = {}; // script name -> { filename -> version string }

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
    ['tools-common.js', 'sync.js', 'auth.js'].forEach(script => {
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
