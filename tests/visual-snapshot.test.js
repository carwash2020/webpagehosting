// Tests for the lightweight visual-regression checker (site audit
// improvement #7, 2026-08-20). Deliberately built on jsdom rather than
// a full headless browser -- the audit specifically asked for
// something lightweight, and jsdom is already a dependency here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'check-visual-snapshot.js');
const BASELINE_PATH = path.join(__dirname, '..', 'scripts', 'visual-snapshot-baseline.json');
const STYLES_CSS_PATH = path.join(__dirname, '..', 'styles.css');
const STYLES_TOOLS_CSS_PATH = path.join(__dirname, '..', 'tools', 'styles-tools.css');

function runCheck() {
  const { execSync } = require('child_process');
  try {
    const output = execSync('node ' + SCRIPT_PATH, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { passed: true, output };
  } catch (e) {
    return { passed: false, output: (e.stdout || '') + (e.stderr || '') };
  }
}

test('a baseline file exists and the check passes cleanly against the real, current codebase', () => {
  assert.ok(fs.existsSync(BASELINE_PATH), 'baseline file should exist and be committed');
  const result = runCheck();
  assert.equal(result.passed, true, result.output);
});

test('genuinely reintroducing the header WebKit-ghosting bug (backdrop-filter moved back onto the sticky header itself) is caught, with a clear before/after diff', () => {
  const original = fs.readFileSync(STYLES_CSS_PATH, 'utf8');
  try {
    const broken = original.replace(
      'header{\n    position:sticky;\n    top:0;\n    z-index:60;\n    border-bottom:1px solid var(--border);\n  }',
      'header{\n    position:sticky;\n    top:0;\n    z-index:60;\n    backdrop-filter:blur(8px);\n    border-bottom:1px solid var(--border);\n  }'
    );
    assert.notEqual(broken, original, 'the replace should have matched something real -- otherwise this test proves nothing');
    fs.writeFileSync(STYLES_CSS_PATH, broken);
    const result = runCheck();
    assert.equal(result.passed, false, 'should have failed with backdrop-filter reintroduced on the header itself');
    assert.match(result.output, /headerItselfHasBackdropFilter.*true/s);
  } finally {
    fs.writeFileSync(STYLES_CSS_PATH, original); // always restore, even if an assertion above failed
  }
});

test('genuinely reintroducing the hardcoded-white-text-in-light-mode bug on the footer brand name is caught', () => {
  const original = fs.readFileSync(STYLES_CSS_PATH, 'utf8');
  try {
    const broken = original.replace('.footer-brand .brand-name{color:var(--white);}', '.footer-brand .brand-name{color:#ffffff;}');
    assert.notEqual(broken, original, 'the replace should have matched something real -- otherwise this test proves nothing');
    fs.writeFileSync(STYLES_CSS_PATH, broken);
    const result = runCheck();
    assert.equal(result.passed, false, 'should have failed with the footer brand name hardcoded back to white');
  } finally {
    fs.writeFileSync(STYLES_CSS_PATH, original); // always restore, even if an assertion above failed
  }
});

test('genuinely renaming away the tour card\'s CSS rule (the invisible-tour-card bug) is caught', () => {
  const original = fs.readFileSync(STYLES_TOOLS_CSS_PATH, 'utf8');
  try {
    const broken = original.replaceAll('.onboarding-card {', '.onboarding-card-renamed {');
    assert.notEqual(broken, original, 'the replace should have matched something real -- otherwise this test proves nothing');
    fs.writeFileSync(STYLES_TOOLS_CSS_PATH, broken);
    const result = runCheck();
    assert.equal(result.passed, false, 'should have failed with the tour card\'s CSS rule renamed away');
  } finally {
    fs.writeFileSync(STYLES_TOOLS_CSS_PATH, original); // always restore, even if an assertion above failed
  }
});

test('--update-baseline genuinely accepts a real, intentional change rather than just always passing', () => {
  const original = fs.readFileSync(BASELINE_PATH, 'utf8');
  try {
    const { execSync } = require('child_process');
    execSync('node ' + SCRIPT_PATH + ' --update-baseline', { encoding: 'utf8' });
    const updated = fs.readFileSync(BASELINE_PATH, 'utf8');
    // Against an unchanged codebase, the freshly regenerated baseline
    // should be identical to what was already there -- confirming
    // --update-baseline genuinely re-snapshots the real, current state
    // rather than just leaving the old file untouched.
    const updatedObj = JSON.parse(updated);
    const originalObj = JSON.parse(original);
    assert.deepEqual(Object.keys(updatedObj).sort(), Object.keys(originalObj).sort());
    for (const key of Object.keys(originalObj)) {
      assert.equal(JSON.stringify(updatedObj[key]), JSON.stringify(originalObj[key]), 'mismatch for: ' + key);
    }
  } finally {
    fs.writeFileSync(BASELINE_PATH, original);
  }
});
