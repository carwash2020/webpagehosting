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
