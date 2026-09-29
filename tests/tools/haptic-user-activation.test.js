// haptic() before the first tap (2026-09-29 bugfix pass). The v2 form
// sheets (#451) buzz when a sheet opens, and a sheet opened from a link --
// job-tracker.html#add-job from the + Job button, a client's New job, the
// command palette -- opens on a page nobody has tapped yet. Chrome refuses
// vibrate() there and logs "Blocked call to navigator.vibrate because user
// hasn't tapped on the frame..." as a console error on every such open.
// haptic() now skips the call until the page has had a tap, and still buzzes
// after one. Runs both copies: tools-dialogs.js and runway-dashboard.html's.
//
// Found alongside it: job-tracker.html wired pull-to-refresh twice (the
// 2026-08-27 fix moved the call above the sync await but left the old one
// after it), so each pull re-rendered and buzzed twice.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

function extractFn(src, name) {
  const start = src.search(new RegExp('function ' + name + '\\('));
  assert.ok(start >= 0, 'expected function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const COPIES = {
  'tools/tools-dialogs.js': extractFn(read('tools', 'tools-dialogs.js'), 'haptic'),
  'tools/runway-dashboard.html': extractFn(read('tools', 'runway-dashboard.html'), 'haptic'),
};

function run(src, userActivation, type) {
  const calls = [];
  const navigator = { vibrate: (p) => { calls.push(p); return true; } };
  if (userActivation !== undefined) navigator.userActivation = userActivation;
  const ctx = vm.createContext({ navigator });
  vm.runInContext(src + ';haptic(' + JSON.stringify(type) + ');', ctx);
  return JSON.parse(JSON.stringify(calls)); // out of the vm realm, so deepEqual compares values
}

for (const [file, src] of Object.entries(COPIES)) {
  test(`${file}: haptic() does not call vibrate() before the page has had a tap`, () => {
    assert.deepEqual(run(src, { hasBeenActive: false, isActive: false }, 'light'), []);
    assert.deepEqual(run(src, { hasBeenActive: false, isActive: false }, 'success'), []);
  });

  test(`${file}: haptic() still buzzes once the page has had a tap`, () => {
    assert.deepEqual(run(src, { hasBeenActive: true, isActive: false }, 'light'), [12]);
    assert.deepEqual(run(src, { hasBeenActive: true, isActive: true }, 'success'), [[10, 40, 10]]);
    assert.deepEqual(run(src, { hasBeenActive: true, isActive: true }, 'error'), [[20, 60, 20, 60, 20]]);
  });

  test(`${file}: a browser without navigator.userActivation keeps the old behavior`, () => {
    assert.deepEqual(run(src, undefined, 'warning'), [[15, 50, 15]]);
  });
}

test('the two haptic() copies stay in step', () => {
  const [a, b] = Object.values(COPIES);
  assert.equal(a, b);
});

test('job-tracker.html wires pull-to-refresh once (a second call stacks a second set of touch listeners)', () => {
  const jt = read('tools', 'job-tracker.html');
  const calls = jt.match(/setupPullToRefresh\(/g) || [];
  assert.equal(calls.length, 1, 'setupPullToRefresh( appears ' + calls.length + ' times in job-tracker.html');
  // ...and it is the one above the blocking sync await.
  assert.ok(jt.indexOf('setupPullToRefresh(') < jt.indexOf('await initSyncOnLoad();'), 'the call must stay ahead of await initSyncOnLoad()');
});
