// runway-dashboard.html had 3 validation prompts (naming a debt,
// expense, or income source) still going through the browser's own
// bare alert() (2026-09-07, found during a codebase survey) -- it
// never loaded /tools/tools-dialogs.js, despite two of its own
// comments already referencing that file as the source of its
// escapeHtml()/haptic() helper copies. Every other tool page with any
// alert() at all already uses tools-dialogs.js's showAlert() for this.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const RUNWAY = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('service-worker.js'), 'utf8');

test('no bare alert() calls remain in runway-dashboard.html', () => {
  assert.doesNotMatch(RUNWAY, /[^.]\balert\(/, 'expected zero bare alert() calls (a "Show" reference or similar prefix would be fine, but there should be none at all here)');
});

test('all 3 validation prompts (debt, expense, income) now use showAlert()', () => {
  assert.match(RUNWAY, /if\(!name\)\{ showAlert\('Give this debt a name\.'\); return; \}/);
  assert.match(RUNWAY, /if\(!name\)\{ showAlert\('Give this expense a name\.'\); return; \}/);
  assert.match(RUNWAY, /if\(!name\)\{ showAlert\('Give this income source a name\.'\); return; \}/);
});

test('the page now actually loads tools-dialogs.js (previously only mentioned in comments, never imported)', () => {
  assert.match(RUNWAY, /<script src="\/tools\/tools-dialogs\.js\?v=[a-zA-Z0-9]+" defer><\/script>/);
});

test('tools-dialogs.js is loaded with the real, current content hash as its ?v= -- not a stale or invented one', () => {
  const dialogsJs = fs.readFileSync(repo('tools', 'tools-dialogs.js'), 'utf8');
  const realHash = crypto.createHash('sha256').update(dialogsJs).digest('hex').slice(0, 10);
  const m = RUNWAY.match(/tools-dialogs\.js\?v=([a-zA-Z0-9]+)/);
  assert.ok(m, 'expected to find the tools-dialogs.js script tag');
  assert.equal(m[1], realHash, `runway-dashboard.html's tools-dialogs.js ?v= (${m[1]}) does not match its real content hash (${realHash})`);
});

test('the tools service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-workspace-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-workspace-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 78, `expected v78 or later, got v${versionMatch[1]}`);
});
