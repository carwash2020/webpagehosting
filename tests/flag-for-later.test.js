// Tests for "Flag this page for later" (2026-08-21), requested
// directly (suggestion #2): a quick way to flag something to come
// back to later without writing a full message. A floating button on
// every real tool page opens a small dialog (page + optional note),
// logs it to a synced queue, and it's reviewed later in Dev Tools'
// new Flagged Pages panel.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

function loadPageWithFlagButton(pageFile) {
  const html = fs.readFileSync(path.join(TOOLS_DIR, pageFile), 'utf8');
  const navSrc = fs.readFileSync(path.join(TOOLS_DIR, 'tools-nav-pwa.js'), 'utf8');
  const dialogsSrc = fs.readFileSync(path.join(TOOLS_DIR, 'tools-dialogs.js'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/' + pageFile,
    beforeParse(w) { w.requireAuth = () => {}; },
  });
  const { window } = dom;
  for (const src of [dialogsSrc, navSrc]) {
    const s = window.document.createElement('script');
    s.textContent = src;
    window.document.head.appendChild(s);
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return window;
}

test('the flag button is injected on a real tool page, with a clear accessible label', () => {
  const window = loadPageWithFlagButton('job-tracker.html');
  const btn = window.document.querySelector('.th-flag-btn');
  assert.ok(btn, 'flag button not found');
  assert.equal(btn.getAttribute('aria-label'), 'Flag this page for later');
});

test('clicking the flag button, entering a note, and submitting stores the flag and triggers a sync push', async () => {
  const window = loadPageWithFlagButton('job-tracker.html');
  window.document.title = 'Job Tracker \u00b7 Triple H Enterprises';
  let syncCalled = false;
  window.scheduleSync = () => { syncCalled = true; };
  window.showToast = () => {};

  window.document.querySelector('.th-flag-btn').click();
  assert.match(window.document.getElementById('customDialogMessage').textContent, /Flag Job Tracker for later/);

  window.document.getElementById('customDialogTextarea').value = 'the sidebar looks wrong here';
  const flagItBtn = [...window.document.querySelectorAll('.dialog-btn')].find(b => b.textContent === 'Flag it');
  flagItBtn.click();
  await Promise.resolve(); // let the dialog's resolved-promise .then() callback (where the actual write happens) run

  const stored = JSON.parse(window.localStorage.getItem('th_flagged_items'));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].page, 'Job Tracker');
  assert.equal(stored[0].note, 'the sidebar looks wrong here');
  assert.equal(stored[0].resolved, false);
  assert.equal(syncCalled, true, 'a real flag should trigger an immediate sync push, the same lesson learned from the Client Errors log bug earlier this session');
});

test('cancelling the flag dialog stores nothing and does not trigger a sync push', () => {
  const window = loadPageWithFlagButton('job-tracker.html');
  let syncCalled = false;
  window.scheduleSync = () => { syncCalled = true; };

  window.document.querySelector('.th-flag-btn').click();
  window.document.getElementById('customDialogCancelAction').click();

  const stored = JSON.parse(window.localStorage.getItem('th_flagged_items') || '[]');
  assert.equal(stored.length, 0);
  assert.equal(syncCalled, false);
});

test('th_flagged_items is a real synced key, merged by id like every other record array -- not a per-device-only list', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'sync.js'), 'utf8');
  assert.match(src, /'th_flagged_items'/);
  assert.match(src, /th_flagged_items:\s*'id'/);
});

test('Dev Tools has a real Flagged Pages panel, marked dev-owner-hidden like every other developer-facing triage panel', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'dev-tools.html'), 'utf8');
  assert.match(src, /class="dev-panel dev-owner-hidden dev-panel-wide">\s*<div class="dev-panel-heading">\s*<h2>Flagged pages<\/h2>/);
});

test('the Dev Tools panel renders flagged items, and Resolve/Delete actually work end to end', () => {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'dev-tools.html'), 'utf8');
  const dialogsSrc = fs.readFileSync(path.join(TOOLS_DIR, 'tools-dialogs.js'), 'utf8');
  const items = [
    { id: 'f1', page: 'Job Tracker', note: 'header looks off', time: '2026-08-21T10:00:00Z', resolved: false },
    { id: 'f2', page: 'Finance', note: '', time: '2026-08-21T09:00:00Z', resolved: false },
  ];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.localStorage.setItem('th_flagged_items', JSON.stringify(items));
    },
  });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = dialogsSrc;
  window.document.head.appendChild(s);
  window.scheduleSync = () => {};

  window.renderFlaggedItems();
  assert.equal(window.document.querySelectorAll('#flaggedItemsList .dev-issue-row').length, 2);

  window.resolveFlaggedItem('f1');
  const afterResolve = JSON.parse(window.localStorage.getItem('th_flagged_items'));
  assert.equal(afterResolve.find(i => i.id === 'f1').resolved, true);

  window.deleteFlaggedItem('f2');
  const afterDelete = JSON.parse(window.localStorage.getItem('th_flagged_items'));
  assert.equal(afterDelete.length, 1);
});

test('the Flagged Pages panel shows an empty-state message rather than silently blank when nothing is flagged', () => {
  const html = fs.readFileSync(path.join(TOOLS_DIR, 'dev-tools.html'), 'utf8');
  const dialogsSrc = fs.readFileSync(path.join(TOOLS_DIR, 'tools-dialogs.js'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html', beforeParse(w) { w.requireAuth = () => {}; } });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = dialogsSrc;
  window.document.head.appendChild(s);
  window.renderFlaggedItems();
  assert.match(window.document.getElementById('flaggedItemsList').innerHTML, /Nothing flagged right now/);
});
