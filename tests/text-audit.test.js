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
