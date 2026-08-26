// Tests for the Regression Checker built into Dev Tools (2026-08-20).
//
// Requested directly: a tool that compares pushes for anything
// missing, after a manual audit against an 8/14 full-site backup
// confirmed no real regressions existed but took significant manual
// effort to verify. This automates that same kind of check going
// forward: compares the current code against an earlier commit using
// GitHub's own diff (one API call, not dozens, to stay well within
// GitHub's unauthenticated rate limit), and flags any JS function,
// HTML element id, or CSS class that was removed without reappearing
// anywhere else in that same comparison.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DEV_TOOLS_PATH = path.join(__dirname, '..', '..', 'tools', 'dev-tools.html');
const DEV_TOOLS_SHARED_PATH = path.join(__dirname, '..', '..', 'tools', 'dev-tools-shared.js');

function loadDevToolsWindow() {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const sharedSrc = fs.readFileSync(DEV_TOOLS_SHARED_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html' });
  const { window } = dom;
  window.escapeHtml = (s) => String(s == null ? '' : s);
  const s = window.document.createElement('script');
  s.textContent = sharedSrc;
  window.document.head.appendChild(s);
  return window;
}

test('the Regression Checker panel and its info-bubble entry both exist', () => {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  assert.match(html, /Regression checker/);
  assert.match(html, /id="regressionFromCommit"/);
  assert.match(html, /id="regressionCheckBtn"/);
  assert.match(html, /onclick="runRegressionCheck\(\)"/);

  const shared = fs.readFileSync(DEV_TOOLS_SHARED_PATH, 'utf8');
  assert.match(shared, /regressioncheck:\s*\{/);
});

test('a removed function that never reappears anywhere in the comparison is correctly flagged', async () => {
  const window = loadDevToolsWindow();
  window.fetchWithTimeout = async () => ({
    json: async () => ({
      files: [{ filename: 'tools/job-tracker.html', patch: '@@ -1,1 +1,0 @@\n-function trulyGoneFunction() { return 1; }' }],
    }),
  });
  window.document.getElementById('regressionFromCommit').innerHTML = '<option value="abc123" selected>test</option>';
  await window.runRegressionCheck();
  const result = window.document.getElementById('regressionCheckResult').innerHTML;
  assert.match(result, /trulyGoneFunction/);
  assert.match(result, /worth a look/);
});

test('a function that moved from one changed file to another changed file in the same comparison is correctly NOT flagged', async () => {
  const window = loadDevToolsWindow();
  window.fetchWithTimeout = async () => ({
    json: async () => ({
      files: [
        { filename: 'tools/old-home.html', patch: '@@ -1,1 +1,0 @@\n-function movedElsewhere() { return 1; }' },
        { filename: 'tools/new-home.html', patch: '@@ -1,0 +1,1 @@\n+function movedElsewhere() { return 1; }' },
      ],
    }),
  });
  window.document.getElementById('regressionFromCommit').innerHTML = '<option value="abc123" selected>test</option>';
  await window.runRegressionCheck();
  const result = window.document.getElementById('regressionCheckResult').innerHTML;
  assert.doesNotMatch(result, /movedElsewhere/);
  assert.match(result, /Nothing flagged/);
});

test('a file GitHub returns without a patch (too large to diff) is listed separately as needing a manual look, not silently skipped', async () => {
  const window = loadDevToolsWindow();
  window.fetchWithTimeout = async () => ({
    json: async () => ({ files: [{ filename: 'tools/enormous-file.html' }] }),
  });
  window.document.getElementById('regressionFromCommit').innerHTML = '<option value="abc123" selected>test</option>';
  await window.runRegressionCheck();
  const result = window.document.getElementById('regressionCheckResult').innerHTML;
  assert.match(result, /enormous-file\.html/);
  assert.match(result, /Couldn.t auto-check/);
});

test('an added-only symbol (never removed anywhere) is correctly not flagged -- only removed symbols are checked at all', async () => {
  const window = loadDevToolsWindow();
  window.fetchWithTimeout = async () => ({
    json: async () => ({
      files: [{ filename: 'tools/job-tracker.html', patch: '@@ -1,0 +1,1 @@\n+function brandNewFunction() { return 1; }' }],
    }),
  });
  window.document.getElementById('regressionFromCommit').innerHTML = '<option value="abc123" selected>test</option>';
  await window.runRegressionCheck();
  const result = window.document.getElementById('regressionCheckResult').innerHTML;
  assert.doesNotMatch(result, /brandNewFunction/);
  assert.match(result, /Nothing flagged/);
});

test('an HTML element id and a CSS class are extracted and checked the same way a function is', async () => {
  const window = loadDevToolsWindow();
  window.fetchWithTimeout = async () => ({
    json: async () => ({
      files: [{
        filename: 'tools/some-page.html',
        patch: '@@ -1,2 +1,0 @@\n-<div id="goneElementId"></div>\n-.goneCssClass{color:red;}',
      }],
    }),
  });
  window.document.getElementById('regressionFromCommit').innerHTML = '<option value="abc123" selected>test</option>';
  await window.runRegressionCheck();
  const result = window.document.getElementById('regressionCheckResult').innerHTML;
  assert.match(result, /goneElementId/);
  assert.match(result, /goneCssClass/);
});

test('picking no commit shows a clear message instead of attempting a request', async () => {
  const window = loadDevToolsWindow();
  window.document.getElementById('regressionFromCommit').innerHTML = '<option value="" selected>none</option>';
  await window.runRegressionCheck();
  const result = window.document.getElementById('regressionCheckResult').innerHTML;
  assert.match(result, /Pick a commit/);
});
