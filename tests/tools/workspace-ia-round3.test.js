// Workspace IA round 3 (2026-09-22): the leftovers from the two IA
// passes, done in one go -- a search-first Appliance Wiki, a Runway
// Dashboard that remembers its tab, and a login return-path allowlist
// that covers every gated page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const TOOLS = path.join(__dirname, '..', '..', 'tools');
const WIKI = fs.readFileSync(path.join(TOOLS, 'parts-reference.html'), 'utf8');
const RUNWAY = fs.readFileSync(path.join(TOOLS, 'runway-dashboard.html'), 'utf8');
const LOGIN = fs.readFileSync(path.join(TOOLS, 'login.html'), 'utf8');

test('Appliance Wiki: the search box is the first thing in the list view, above the quick-access strip; the disclaimer moved into the help modal', () => {
  const view = WIKI.slice(WIKI.indexOf('<div id="prListView">'));
  const search = view.indexOf('id="prSearchInput"');
  const strip = view.indexOf('id="prQuickAccessStrip"');
  const names = view.indexOf('id="prDisplayNameRow"');
  const list = view.indexOf('<h3 style="margin:0;">Appliances</h3>');
  assert.ok(search > 0 && search < strip && strip < names && names < list, 'search, then chips, then names, then the list');
  assert.doesNotMatch(WIKI, /class="pr-confidence-note"/, 'no disclaimer block above the search any more');
  assert.match(WIKI, /help-modal[\s\S]*pre-loaded with major brands/);
});

test('Appliance Wiki: search takes focus on load, except when ?search= already filled it or the tour is running', () => {
  const init = WIKI.slice(WIKI.indexOf("const presetSearch = new URLSearchParams"));
  assert.match(init, /if \(!presetSearch && !localStorage\.getItem\('th_app_tour_step'\)\) \{\s*try \{ document\.getElementById\('prSearchInput'\)\.focus\(\{ preventScroll: true \}\); \}/);
  assert.match(WIKI, /id="prSearchInput"[^>]*enterkeyhint="search"/);
});

test('Runway Dashboard: remembers the last tab per device and honors a #hash, defaulting to Personal Budget', () => {
  assert.match(RUNWAY, /const RUNWAY_TAB_KEY = 'th_runway_tab';/);
  assert.match(RUNWAY, /localStorage\.setItem\(RUNWAY_TAB_KEY, tabKey\)/);
  assert.match(RUNWAY, /const initial = TAB_ORDER\.includes\(fromHash\) \? fromHash : \(TAB_ORDER\.includes\(remembered\) \? remembered : 'personal'\);/);
  assert.match(RUNWAY, /<button class="rw-tab-btn is-active" data-tab="personal">/, 'markup default untouched');
  assert.match(RUNWAY, /if \(initial === 'personal'\) \{ document\.getElementById\('panel-personal'\)\.classList\.add\('active'\); return; \}/);
});

test('login: every real, gated tool page is an allowed return path (clients.html and pos.html were missing)', () => {
  const list = LOGIN.match(/const ALLOWED_RETURN_PATHS = new Set\(\[([\s\S]*?)\]\);/)[1];
  for (const page of ['clients', 'pos', 'invoice-generator', 'job-tracker', 'finance', 'settings', 'workspace']) {
    assert.ok(list.includes("'/tools/" + page + ".html'"), page + ' should be an allowed return path');
  }
});
