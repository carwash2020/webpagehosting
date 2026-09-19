// runway-dashboard.html loaded tools-dialogs.js for other things but
// never actually used its own showConfirm() dialog -- all 6 delete/
// reset actions on this page still popped the browser's own native
// confirm(), the last spots on this page still looking like that
// instead of matching the rest of this dark-themed app (2026-09-19).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RUNWAY = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'runway-dashboard.html'), 'utf8');

test('no native confirm() calls remain on this page', () => {
  const codeOnly = RUNWAY.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const bareConfirmCalls = (codeOnly.match(/[^a-zA-Z.]confirm\(/g) || []).filter((m) => !m.includes('showConfirm'));
  assert.deepEqual(bareConfirmCalls, []);
});

for (const phrase of [
  'Delete this debt?',
  'Delete this income source?',
  'Delete this expense?',
  'Delete ALL personal expenses? This cannot be undone.',
  'Reset ALL data',
]) {
  test(`"${phrase}" now goes through showConfirm(), with danger styling`, () => {
    const re = new RegExp('await showConfirm\\(\'' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\']*\', \\{ danger: true');
    assert.match(RUNWAY, re);
  });
}

test('the restore-from-backup confirm also uses showConfirm(), not native confirm()', () => {
  assert.match(RUNWAY, /await showConfirm\('Restore from this file\? This replaces everything currently on this device/);
});
