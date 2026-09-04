// Tests for scripts/check-undefined-vars.js (2026-09-03), built as a
// direct, permanent response to a real production incident the same
// day: generatePDF() and logQuote() each referenced a variable that
// only existed in a DIFFERENT function, throwing an uncaught
// ReferenceError on every invoice/quote generation. No amount of the
// source-text-assertion tests this codebase already had would have
// caught it -- only actually executing the code, or (much cheaper,
// and now automatic on every PR) statically checking that every name
// referenced is actually in scope, catches this class of bug.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'check-undefined-vars.js');

function runChecker() {
  try {
    const stdout = execFileSync('node', [SCRIPT_PATH], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('the checker passes clean against the real, current codebase', () => {
  const result = runChecker();
  assert.equal(result.exitCode, 0, `checker should pass clean; got:\n${result.stderr}`);
  assert.match(result.stdout, /Undefined-variable check passed/);
});

test('a page redeclaring a const that a shared file it actually loads already declares is caught as a real SyntaxError', () => {
  // Regression test for the actual bug found during a full portal
  // audit (2026-09-04): portal/jobs.html and manage-booking.html each
  // redeclared MIN_LEAD_HOURS at their own top level despite loading
  // /business-hours.js, which already declares it -- a genuine
  // SyntaxError in a real browser, not a hypothetical drift risk.
  // no-undef alone could never catch this; this is the extension
  // that closes that gap.
  const targetPage = path.join(REPO_ROOT, 'portal', 'jobs.html');
  const original = fs.readFileSync(targetPage, 'utf8');
  try {
    const injected = original.replace(
      'const DEFAULT_VISIT_MINUTES = 120;',
      'const DEFAULT_VISIT_MINUTES = 120;\n  const MIN_LEAD_HOURS = 2;',
    );
    assert.notEqual(injected, original, 'expected to actually inject the redeclaration');
    fs.writeFileSync(targetPage, injected);
    const result = runChecker();
    assert.notEqual(result.exitCode, 0, 'a shared-file redeclaration should fail the check');
    assert.match(result.stderr, /portal\/jobs\.html.*Identifier 'MIN_LEAD_HOURS' has already been declared/);
    assert.match(result.stderr, /checked against business-hours\.js/);
  } finally {
    fs.writeFileSync(targetPage, original);
  }
});

test('var redeclared multiple times within a shared file is never flagged -- it is legal JS, not a SyntaxError, unlike const/let', () => {
  // Regression test for a real false-positive found while building
  // this: an earlier version of this exact check used ESLint's
  // no-redeclare RULE (real scope analysis, correct in principle),
  // which also flags var redeclared multiple times -- legal JS, just
  // discouraged style, not an actual parse failure. tools/
  // qrcode-lib.js (a third-party library) redeclares var i/row/col/
  // mod repeatedly across its own methods entirely legally, and that
  // version flagged every one of them as if it were the same bug
  // class as a real const/let conflict. The fix runs with zero lint
  // rules enabled, relying only on ESLint's own parser to surface a
  // genuine SyntaxError -- var redeclaration produces no message
  // that way, confirmed directly against ESLint's own behavior.
  const result = runChecker();
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /qrcode-lib/);
});

test('there are no tolerated redeclaration exemptions -- a real bug hid behind exactly this kind of exception before', () => {
  // Corrected 2026-09-04, after a real incident: this test used to
  // assert the OPPOSITE -- that tools/pos.html redeclaring
  // SUPABASE_URL on top of tools/auth.js's own copy was fine, "a
  // known and tolerated pattern." It was not fine. That exact
  // redeclaration is a genuine SyntaxError that silently halted
  // pos.html's entire inline script, reported directly as "the POS
  // is still not working. No manual entry button and no charge card
  // on file button pops up at all." The reasoning behind the old
  // exemption was itself a misunderstanding: it's true and harmless
  // that different, unrelated pages each keep their own local copy
  // (different pages never share a lexical scope with each other),
  // but that says nothing about whether it's safe for the SAME page
  // to declare something locally while ALSO loading a shared file
  // that already declares it -- that's exactly the bug class this
  // whole check exists to catch, and the exemption carved a hole in
  // it. tools/pos.html itself is now fixed (it relies on
  // tools/auth.js's own SUPABASE_URL/SUPABASE_ANON_KEY instead of
  // redeclaring them), confirmed directly rather than assumed.
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.match(src, /const TOLERATED_REDECLARATIONS = new Set\(\[\]\);/, 'expected no tolerated exemptions at all');

  const posHtml = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'pos.html'), 'utf8');
  const authJs = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'auth.js'), 'utf8');
  assert.match(authJs, /^const SUPABASE_URL\s*=/m, 'expected tools/auth.js to genuinely declare this, for this test to be meaningful');
  assert.doesNotMatch(posHtml, /^\s*const SUPABASE_URL\s*=/m, 'tools/pos.html must not redeclare a constant tools/auth.js (which it loads) already declares');

  const result = runChecker();
  assert.equal(result.exitCode, 0, `checker should still pass clean now that pos.html is fixed; got:\n${result.stderr}`);
});

test('a page loading no shared scripts at all is never checked for redeclarations against anything', () => {
  const fnMatch = fs.readFileSync(SCRIPT_PATH, 'utf8').match(/function findSharedScriptRedeclarations\(rel, html, inlineCode\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate findSharedScriptRedeclarations()');
  assert.match(fnMatch[0], /if \(!loadedSharedFiles\.length\) return \[\];/);
});

test('an uppercase SCRIPT tag is scanned the same as a lowercase one', () => {
  // Real bug flagged by CodeQL ("Bad HTML filtering regexp", 2026-09-03):
  // the regex extracting inline script blocks was case-sensitive, so an
  // uppercase <SCRIPT> tag -- which browsers execute identically to a
  // lowercase one -- would silently skip this checker's own coverage
  // entirely. Proven directly by injecting one with a genuine
  // undefined-variable reference and confirming it's still caught.
  const targetPage = path.join(REPO_ROOT, 'tools', 'dev-tools.html');
  const original = fs.readFileSync(targetPage, 'utf8');
  try {
    const injected = original.replace(
      '</body>',
      '<SCRIPT>function thisFunctionHasAnUppercaseTagBug() { return someUndefinedVariableForTheUppercaseTagTest; }</SCRIPT></body>',
    );
    assert.notEqual(injected, original, 'expected to actually inject the test script block');
    fs.writeFileSync(targetPage, injected);
    const result = runChecker();
    assert.notEqual(result.exitCode, 0, 'the uppercase-tag script block should be scanned and its undefined variable caught');
    assert.match(result.stdout + result.stderr, /someUndefinedVariableForTheUppercaseTagTest/);
  } finally {
    fs.writeFileSync(targetPage, original);
  }
});

test('a closing script tag with whitespace before the > is scanned the same as a normal one', () => {
  // Real bug flagged by CodeQL in a SECOND pass ("Bad HTML filtering
  // regexp" again, 2026-09-03) on the very fix for the first one: the
  // closing tag pattern required </script> with the > immediately
  // after, but real, valid HTML like </script > (a space before the
  // >) parses identically in a browser. The opening tag already
  // tolerated this via [^>]* -- only the closing tag needed the fix.
  // Proven the same way as the uppercase-tag test: inject a genuine
  // undefined-variable reference inside a script block closed this
  // way, and confirm it's still caught.
  const targetPage = path.join(REPO_ROOT, 'tools', 'dev-tools.html');
  const original = fs.readFileSync(targetPage, 'utf8');
  try {
    const injected = original.replace(
      '</body>',
      '<script>function thisFunctionHasASpacedClosingTagBug() { return someUndefinedVariableForTheSpacedClosingTagTest; }</script ></body>',
    );
    assert.notEqual(injected, original, 'expected to actually inject the test script block');
    fs.writeFileSync(targetPage, injected);
    const result = runChecker();
    assert.notEqual(result.exitCode, 0, 'the spaced-closing-tag script block should be scanned and its undefined variable caught');
    assert.match(result.stdout + result.stderr, /someUndefinedVariableForTheSpacedClosingTagTest/);
  } finally {
    fs.writeFileSync(targetPage, original);
  }
});

test('a closing script tag with garbage content before the > is scanned the same as a normal one', () => {
  // CodeQL's own follow-up alert on the whitespace-only fix above,
  // demonstrating a broader real bypass: </script followed by tab and
  // newline characters and a stray token ("bar") before the > still
  // closes a script element in a real browser, per the actual HTML5
  // end-tag parsing rule -- anything up to the next > closes the tag,
  // not just plain whitespace. Fixed with [^>]* (mirroring the
  // opening tag's own already-correct pattern) rather than a narrower
  // whitespace-only allowance, and proven here with the same kind of
  // input CodeQL itself flagged as unmatched.
  const targetPage = path.join(REPO_ROOT, 'tools', 'dev-tools.html');
  const original = fs.readFileSync(targetPage, 'utf8');
  try {
    const injected = original.replace(
      '</body>',
      '<script>function thisFunctionHasAGarbageClosingTagBug() { return someUndefinedVariableForTheGarbageClosingTagTest; }</script\t\n bar></body>',
    );
    assert.notEqual(injected, original, 'expected to actually inject the test script block');
    fs.writeFileSync(targetPage, injected);
    const result = runChecker();
    assert.notEqual(result.exitCode, 0, 'the garbage-closing-tag script block should be scanned and its undefined variable caught');
    assert.match(result.stdout + result.stderr, /someUndefinedVariableForTheGarbageClosingTagTest/);
  } finally {
    fs.writeFileSync(targetPage, original);
  }
});

test('the checker genuinely detects an injected undefined-variable reference', () => {
  // Mutates a real page temporarily, in a try/finally that restores
  // it unconditionally -- even if this assertion itself fails, the
  // repo must never be left with the injected bug still in place.
  const targetPage = path.join(REPO_ROOT, 'tools', 'dev-tools.html');
  const original = fs.readFileSync(targetPage, 'utf8');
  try {
    const mutated = original.replace(
      '<script>',
      '<script>\n  console.log(thisIsDefinitelyNotARealVariableForTesting.property);\n',
      1
    );
    assert.notEqual(mutated, original, 'expected the injection to actually change the file');
    fs.writeFileSync(targetPage, mutated);

    const result = runChecker();
    assert.equal(result.exitCode, 1, 'the checker should fail when a real undefined variable is present');
    assert.match(result.stderr, /thisIsDefinitelyNotARealVariableForTesting/);
  } finally {
    fs.writeFileSync(targetPage, original);
  }
});

test('the checker fails loudly, not silently, if a listed shared script file no longer exists', () => {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  assert.match(src, /no longer exists/,
    'a renamed/removed shared script should be a hard error, not a silent globals-list gap');
});

test('every shared script file the checker relies on for its globals list actually exists', () => {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const listMatch = src.match(/const SHARED_SCRIPT_FILES = \[([\s\S]*?)\];/);
  assert.ok(listMatch, 'expected to find SHARED_SCRIPT_FILES');
  const files = [...listMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.ok(files.length >= 10, 'expected a substantial list of shared script files');
  for (const rel of files) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} should exist`);
  }
});

test('two shared files that conflict with each other are caught even when no page currently loads both', () => {
  // Regression test for the extension requested directly: "we want
  // to make sure we are catching every bug, every error, every
  // glitch. before it happens." The per-page check alone only ever
  // sees whatever combination of shared files a REAL page happens to
  // load today -- a conflict between two shared files that simply
  // aren't loaded together by any page yet would pass clean there,
  // right up until the moment a future page (or an added script tag
  // on an existing one) combines them, breaking with no warning.
  // Confirmed directly (not assumed) that these two files are not
  // currently loaded together by any page, so this genuinely
  // exercises the new, page-independent check rather than the
  // existing per-page one.
  const qrcodePath = path.join(REPO_ROOT, 'tools', 'qrcode-lib.js');
  const original = fs.readFileSync(qrcodePath, 'utf8');
  const pushNotifSrc = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'push-notifications.js'), 'utf8');
  const conflictingName = pushNotifSrc.match(/^const ([A-Za-z_$][A-Za-z0-9_$]*)\s*=/m)[1];
  assert.ok(conflictingName, 'expected to find a real top-level const in push-notifications.js to conflict with');

  const allHtmlFiles = [
    ...fs.readdirSync(REPO_ROOT).filter(f => f.endsWith('.html')).map(f => path.join(REPO_ROOT, f)),
    ...fs.readdirSync(path.join(REPO_ROOT, 'tools')).filter(f => f.endsWith('.html')).map(f => path.join(REPO_ROOT, 'tools', f)),
    ...fs.readdirSync(path.join(REPO_ROOT, 'portal')).filter(f => f.endsWith('.html')).map(f => path.join(REPO_ROOT, 'portal', f)),
  ];
  const noPageLoadsBoth = allHtmlFiles.every((p) => {
    const src = fs.readFileSync(p, 'utf8');
    return !(src.includes('qrcode-lib.js') && src.includes('push-notifications.js'));
  });
  assert.ok(noPageLoadsBoth, 'expected these two files to genuinely not be combined by any page, so this test exercises the new check, not the existing per-page one');

  try {
    fs.writeFileSync(qrcodePath, `const ${conflictingName} = "test";\n` + original);
    const result = runChecker();
    assert.notEqual(result.exitCode, 0, 'a conflict between two shared files should fail the check even with no page combining them');
    assert.match(result.stderr, new RegExp(`tools/qrcode-lib\\.js \\+ tools/push-notifications\\.js.*Identifier '${conflictingName}' has already been declared`));
  } finally {
    fs.writeFileSync(qrcodePath, original);
  }
});

test('the pairwise check runs once per pair, not once per page -- confirmed by its own function existing separately from the per-page loop', () => {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const fnMatch = src.match(/function findAllSharedFilePairConflicts\(\)[\s\S]*?\n\}\n/);
  assert.ok(fnMatch, 'expected to isolate findAllSharedFilePairConflicts()');
  assert.match(fnMatch[0], /for \(let i = 0; i < SHARED_SCRIPT_FILES\.length; i\+\+\)/);
  assert.match(fnMatch[0], /for \(let j = i \+ 1; j < SHARED_SCRIPT_FILES\.length; j\+\+\)/);
  // Called once, outside the per-page for-loop, not inside it.
  const mainFn = src.match(/function main\(\)[\s\S]*?\n  for \(const rel of pages\) \{/);
  assert.ok(mainFn, 'expected to isolate main() up through the start of the per-page loop');
  assert.match(mainFn[0], /findAllSharedFilePairConflicts\(\)/);
});
