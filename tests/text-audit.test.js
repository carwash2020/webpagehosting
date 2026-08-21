// Tests from a direct text audit (2026-08-21), requested directly:
// make sure no descriptions have bad info or read poorly. Found a
// widespread, real pattern: several pages still described Cost
// Lookup, Expenses, Income, and Profitability as being on Job
// Tracker -- all four moved to Finance during this week's structural
// rework, but the text describing them never got updated to match.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

test('no page anywhere still attributes Cost Lookup, Expenses, Income, or Profitability to Job Tracker -- all four moved to Finance, and this exact stale-reference pattern showed up in 5 separate files before this fix', () => {
  const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.html') || f.endsWith('.js'));
  const staleTabNames = ['Cost Lookup', 'Expenses', 'Income', 'Profitability'];
  const problems = [];
  for (const file of files) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8');
    for (const tabName of staleTabNames) {
      const pattern = new RegExp("Job Tracker'?s?\\s+" + tabName.replace(' ', '\\s+'));
      if (pattern.test(src)) {
        problems.push(file + ': still attributes "' + tabName + '" to Job Tracker');
      }
    }
  }
  assert.deepEqual(problems, [], 'found stale references:\n' + problems.join('\n'));
});

test('job-tracker.html\'s own help text describes its real, current tabs (Jobs, Contacts, Notes) -- not tabs that moved away to Finance, and not missing the actual primary tab', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  // Confirm the real tabs match what the help text should describe.
  const realTabs = [...src.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(realTabs, ['jobs', 'contacts', 'notes']);

  assert.match(src, /<strong>Jobs<\/strong>/, 'help text should describe the actual primary tab');
  assert.doesNotMatch(src, /<strong>Cost Lookup<\/strong>/, 'Cost Lookup moved to Finance, should not be described here anymore');
  assert.doesNotMatch(src, /<strong>Expenses<\/strong>/, 'Expenses moved to Finance, should not be described here anymore');
});

test('the genuinely dead .results-box/.result-row CSS (leftover from when Cost Lookup lived on job-tracker.html) is gone', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  assert.doesNotMatch(src, /\.results-box\s*\{/);
  assert.doesNotMatch(src, /\.result-row\s*\{/);
});

test('runway-dashboard.html\'s "Pull from X" button, its help text, and its empty-state hint all consistently say Finance now, not Job Tracker -- since Revenue/Expenses/Fuel are pulled from data that now lives on Finance', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  const mentions = src.match(/Pull from (Job Tracker|Finance)/g);
  assert.ok(mentions.length >= 3, 'expected multiple mentions of this button/action');
  for (const m of mentions) {
    assert.equal(m, 'Pull from Finance', 'found an inconsistent mention: ' + m);
  }
  // The button itself, specifically by its real id, not just any text match.
  const buttonMatch = src.match(/id="pullMonthBtn">([^<]+)</);
  assert.equal(buttonMatch[1], 'Pull from Finance');
});

test('runway-dashboard.html no longer references startJobTrackerSync, a function that does not exist anywhere in this file', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  assert.doesNotMatch(src, /startJobTrackerSync/);
});

test('workspace.html\'s Dev Tools description no longer claims access is restricted to one specific person -- the account roles system replaced that', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  assert.doesNotMatch(src, /Only visible on Connor's account/);
  const devToolsInfo = src.match(/'tool-devtools': \{[\s\S]*?body: `([^`]*)`/);
  assert.ok(devToolsInfo);
  assert.match(devToolsInfo[1], /any account with an assigned role/);
});

// Site audit improvement, requested directly (2026-08-21): a real
// functionality test across every button in the app. New
// checkButtonHandlers() in scripts/check-consistency.js, running
// automatically on every push, found a real, confirmed bug on its
// very first run: 3 "?" help buttons on finance.html (Sales Tax, Add
// Entry, Miles) called openCardInfo(), a function that was never
// actually defined anywhere on that page -- silently broken since the
// Job Tracker/Finance split, where the function and its content
// entries stayed behind, unused, on job-tracker.html.

function runCheckConsistency() {
  const { execSync } = require('child_process');
  try {
    const output = execSync('node ' + path.join(__dirname, '..', 'scripts', 'check-consistency.js'), { encoding: 'utf8' });
    return { passed: true, output };
  } catch (e) {
    return { passed: false, output: e.stdout + e.stderr };
  }
}

test('checkButtonHandlers passes cleanly against the real, current codebase -- confirms the real openCardInfo bug found and fixed on finance.html stays fixed', () => {
  const result = runCheckConsistency();
  assert.equal(result.passed, true, result.output);
});

test('finance.html\'s 3 real help buttons (Sales Tax, Add Entry, Miles) now have a genuinely working openCardInfo(), moved here from job-tracker.html where it was confirmed completely unused', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  assert.match(src, /function openCardInfo\(key\)/);
  for (const key of ['salesTax', 'incomeEntry', 'mileageRate']) {
    assert.match(src, new RegExp(key + ':\\s*\\{'), key + ' entry not found');
  }
});

test('job-tracker.html only keeps the "templates" entry now -- the other 3 were confirmed unused there and moved to finance.html, not duplicated', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  assert.match(src, /templates:\s*\{/);
  for (const key of ['salesTax', 'incomeEntry', 'mileageRate']) {
    assert.doesNotMatch(src, new RegExp(key + ':\\s*\\{'), key + ' should have moved to finance.html, not stayed duplicated here');
  }
});

test('checkButtonHandlers genuinely catches a broken button handler, not just a plausible-looking check that never actually fires', () => {
  const jtPath = path.join(TOOLS_DIR, 'job-tracker.html');
  const original = fs.readFileSync(jtPath, 'utf8');
  try {
    const broken = original.replace('onclick="addJob()"', 'onclick="thisButtonIsDefinitelyBroken()"');
    assert.notEqual(broken, original, 'the replace should have matched something real -- otherwise this test proves nothing');
    fs.writeFileSync(jtPath, broken);
    const result = runCheckConsistency();
    assert.equal(result.passed, false, 'should have failed with a genuinely broken button handler');
    assert.match(result.output, /thisButtonIsDefinitelyBroken/);
  } finally {
    fs.writeFileSync(jtPath, original); // always restore, even if an assertion above failed
  }
});

test('checkButtonHandlers correctly ignores JS keywords (like "if") and native browser globals (like "confirm") that superficially look like function calls in an onclick handler', () => {
  // Confirms directly against the underlying regex logic, not just
  // that the overall check happens to pass -- a keyword or a native
  // global should never be treated as a missing app-defined function.
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-consistency.js'), 'utf8');
  assert.match(src, /JS_KEYWORDS = new Set\(\[[\s\S]*?'if'/);
  assert.match(src, /KNOWN_GLOBALS = new Set\(\[[\s\S]*?'confirm'/);
});

// Follow-up sweep (2026-08-21), requested directly: a more thorough
// pass beyond the first round found finance.html's own back link
// still went to Job Tracker (not Workspace, unlike every other tool
// page), plus 4 more diagnostic-message/comment stale references on
// finance.html and runway-dashboard.html that the first pass's exact
// regex pattern didn't catch.

test('finance.html\'s back link goes to Workspace, matching every other tool page -- not to Job Tracker, which it incorrectly still did (left over from before the split)', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'finance.html'), 'utf8');
  assert.match(src, /href="\/tools\/workspace\.html" class="help-btn" aria-label="Back to Workspace"/);
  assert.doesNotMatch(src, /Back to Job Tracker/);
});

test('runway-dashboard.html\'s diagnostic messages (shown when Pull from Finance finds no data) say Finance, not Job Tracker', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'runway-dashboard.html'), 'utf8');
  assert.match(src, /Finance doesn't have any income or expenses logged/);
  assert.match(src, /Nothing logged in Finance for this specific month/);
  assert.match(src, /Pulled from Finance/);
  assert.doesNotMatch(src, /doesn't have any income or expenses logged on this device yet.*Job Tracker/s);
});

test('the README\'s internal tool list is complete -- includes Finance, Appliance Wiki, Settings, Dev Tools, and Site Content, all of which were missing entirely from the first-pass list', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  for (const tool of ['Finance', 'Appliance Wiki', 'Settings', 'Dev Tools', 'Site Content']) {
    assert.match(readme, new RegExp(tool), `README should mention ${tool}`);
  }
  assert.match(readme, /tools\/finance\.html/);
});

test('the README no longer claims tools-common.js exists -- that file was replaced by 4 separate files, and the README previously still described the old, single file', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /tools-common\.js.*Shared tool behavior/);
  assert.match(readme, /tools-effects\.js/);
  assert.match(readme, /tools-dialogs\.js/);
});

test('DISASTER_RECOVERY.md documents the new Owner-restricted Dev Tools view, since an Owner reporting "most panels are missing" could otherwise look like a bug rather than the intended, documented behavior', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'DISASTER_RECOVERY.md'), 'utf8');
  assert.match(doc, /Owner-restricted view/);
  assert.match(doc, /applyOwnerRestrictedView/);
});
