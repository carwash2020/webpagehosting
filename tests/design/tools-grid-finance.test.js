// Tests for the mobile Tools grid gaining Finance and Settings tiles
// (2026-08-21), requested directly: Finance had no way to reach it
// from here at all (only the bottom nav had it). Also fixes 2 more
// stale text references found while investigating this same area,
// missed by the earlier text audit since their phrasing didn't match
// that search's exact pattern.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WORKSPACE_PATH = path.join(__dirname, '..', '..', 'tools', 'workspace.html');

function loadWorkspace() {
  const html = fs.readFileSync(WORKSPACE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.openInfoModal = (title, body) => { w.__modal = { title, body }; };
    },
  });
  return dom.window;
}

test('the mobile Tools grid has a real Finance tile linking to finance.html', () => {
  const window = loadWorkspace();
  const tile = window.document.querySelector('.tools-grid a[href="/tools/finance.html"]');
  assert.ok(tile, 'Finance tile not found in the Tools grid');
  assert.equal(tile.querySelector('.tool-tile-label').textContent, 'Finance');
});

test('the mobile Tools grid also gained a Settings tile, since it was missing from here too', () => {
  const window = loadWorkspace();
  const tile = window.document.querySelector('.tools-grid a[href="/tools/settings.html"]');
  assert.ok(tile, 'Settings tile not found in the Tools grid');
});

test('the Finance tile\'s info bubble opens with accurate content describing its real tabs', () => {
  const window = loadWorkspace();
  window.openCardInfo('tool-finance');
  assert.equal(window.__modal.title, 'Finance');
  for (const tab of ['Cost Lookup', 'Profitability', 'Income', 'Expenses']) {
    assert.match(window.__modal.body, new RegExp(tab));
  }
});

test('Job Tracker\'s own info bubble no longer describes Cost Lookup or Expenses as being on this page -- both moved to Finance, a stale reference missed by the earlier text audit since this phrasing (describing its own tile) didn\'t match that search\'s pattern', () => {
  const window = loadWorkspace();
  window.openCardInfo('tool-jobtracker');
  assert.doesNotMatch(window.__modal.body, /Cost Lookup/);
  assert.doesNotMatch(window.__modal.body, /Expenses/);
  assert.match(window.__modal.body, /Jobs, contacts, and notes/);
});

test('Runway Dashboard\'s info bubble now says it pulls from Finance, not Job Tracker -- another stale reference missed by the earlier audit since it lacked the possessive \'s pattern that search looked for', () => {
  const window = loadWorkspace();
  window.openCardInfo('tool-runway');
  assert.match(window.__modal.body, /straight from Finance/);
  assert.doesNotMatch(window.__modal.body, /from Job Tracker/);
});

test('Settings\' new info bubble opens with real, accurate content', () => {
  const window = loadWorkspace();
  window.openCardInfo('tool-settings');
  assert.equal(window.__modal.title, 'Settings');
  assert.match(window.__modal.body, /Cloud Sync/);
});
