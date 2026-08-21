// Tests for the Client Registry delete button (2026-08-21), requested
// directly: the registry had a ton of duplicates and no way to remove
// one. thDeleteClient() removes only the registry record itself --
// never the underlying jobs/invoices/quotes, which are separate, real
// records matched by name independently of any specific registry
// entry, so nothing else is affected by removing a duplicate.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');
const DEV_TOOLS_PATH = path.join(TOOLS_DIR, 'dev-tools.html');

function loadDevTools(clients) {
  const html = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const dataLayerSrc = fs.readFileSync(path.join(TOOLS_DIR, 'data-layer.js'), 'utf8');
  const dialogsSrc = fs.readFileSync(path.join(TOOLS_DIR, 'tools-dialogs.js'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.localStorage.setItem('th_clients', JSON.stringify(clients));
      w.localStorage.setItem('th_tracker_jobs', '[]');
    },
  });
  const { window } = dom;
  for (const src of [dataLayerSrc, dialogsSrc]) {
    const s = window.document.createElement('script');
    s.textContent = src;
    window.document.head.appendChild(s);
  }
  window.showToast = () => {};
  return window;
}

test('thDeleteClient removes only the matching record by id, leaving every other record untouched', () => {
  const window = loadDevTools([
    { id: 'c1', name: 'Bob Smith' },
    { id: 'c2', name: 'bob smith' },
    { id: 'c3', name: 'Carla Diaz' },
  ]);
  const remaining = window.thDeleteClient('c1');
  assert.equal(JSON.stringify(remaining.map(c => c.id)), JSON.stringify(['c2', 'c3']));
  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_clients')).map(c => c.id), ['c2', 'c3']);
});

test('thDeleteClient calls thSaveClients (which calls thWrite internally, already handling the sync push) rather than a direct localStorage call -- avoiding the exact "cleared locally but never pushed" mistake already found and fixed on the Client Errors log', () => {
  const src = fs.readFileSync(path.join(TOOLS_DIR, 'data-layer.js'), 'utf8');
  const fnMatch = src.match(/function thDeleteClient\(id\)[\s\S]*?\n}/);
  assert.ok(fnMatch, 'thDeleteClient not found');
  assert.doesNotMatch(fnMatch[0], /localStorage\.(setItem|removeItem)/, 'should go through thSaveClients, not touch localStorage directly');
  assert.match(fnMatch[0], /thSaveClients/);
});

test('the Client Registry UI shows a real Delete button per client, and clicking it (after confirming) genuinely removes that client and re-renders the list', async () => {
  const window = loadDevTools([
    { id: 'c1', name: 'Bob Smith' },
    { id: 'c2', name: 'bob smith' },
  ]);
  window.showConfirm = async () => true;

  window.renderClientRegistry();
  assert.equal(window.document.querySelectorAll('[data-client-id]').length, 2);

  await window.deleteClientFromRegistry('c1');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_clients')).map(c => c.id), ['c2']);
  assert.equal(window.document.querySelectorAll('[data-client-id]').length, 1);
});

test('declining the confirmation dialog does NOT delete anything -- a destructive action should never proceed without a real yes', async () => {
  const window = loadDevTools([{ id: 'c1', name: 'Bob Smith' }]);
  window.showConfirm = async () => false; // simulates the user clicking Cancel

  await window.deleteClientFromRegistry('c1');
  assert.deepEqual(JSON.parse(window.localStorage.getItem('th_clients')).map(c => c.id), ['c1'], 'should not have deleted anything after a declined confirmation');
});

test('deleteClientFromRegistry uses showConfirm (the app\'s shared custom modal), not a plain window.confirm(), matching the established pattern used elsewhere (e.g. deleteJob on job-tracker.html)', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const fnMatch = src.match(/async function deleteClientFromRegistry\(id\)[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'deleteClientFromRegistry not found');
  assert.match(fnMatch[0], /showConfirm\(/);
  assert.doesNotMatch(fnMatch[0], /window\.confirm\(/);
});
