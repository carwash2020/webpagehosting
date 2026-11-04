// Dev Tools sections home (Phase 4, 2026-11-04; approved "Dev Tools:
// today's sections, cleaner; tap one for its tools" design). Runs the real
// dev-tools.html in jsdom. The page now opens on tiles for the same
// sections as the tab bar; tapping one opens just that section, and "All
// sections" comes back. Search finds any tool by name; Recent remembers
// the last tools opened on this device.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'dev-tools.html'), 'utf8');

function loadAs(canAccessFull, { hash = '', storage = {} } = {}) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html' + hash,
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canAccessDevToolsFull = () => canAccessFull;
      w.escapeHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      w.escapeAttr = w.escapeHtml;
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.scrollTo = () => {};
    },
  });
  const w = dom.window;
  w.applyOwnerRestrictedView();
  w.initDevToolsTabs();
  return w;
}
const $ = (w, id) => w.document.getElementById(id);

test('it opens on the sections home: eight tiles for today\'s sections (plus Content), tab bar and panels out of sight', () => {
  const w = loadAs(true);
  assert.ok(w.document.body.classList.contains('dt-at-home'));
  assert.equal($(w, 'dtHome').hidden, false);
  assert.equal($(w, 'dtBackHome').hidden, true);
  const tiles = [...w.document.querySelectorAll('#dtTiles .dt-tile')].map((t) => t.querySelector('.dt-tile-name').textContent);
  assert.deepEqual(tiles, ['Health', 'Data', 'Sync', 'Notifications', 'Ops', 'Reports', 'Access', 'Content']);
  const tabs = [...w.document.querySelectorAll('.dev-tab-btn')].map((b) => b.getAttribute('data-tab'));
  assert.deepEqual(Array.from(w.document.querySelectorAll('[data-dt-tile]'), (t) => t.getAttribute('data-dt-tile')), tabs, 'one tile per tab, same order');
  assert.match(w.document.querySelector('[data-dt-count="health"]').textContent, /^ · \d+ tools$/);
  assert.match(w.document.querySelector('[data-dt-count="reports"]').textContent, /^ · 3 reports$/);
  assert.equal(w.document.querySelector('[data-dt-badge="health"]').hidden, true, 'no count yet is not shown as all clear');
});

test('tapping a tile opens just that section, the tab bar switches sections, and "All sections" comes back', () => {
  const w = loadAs(true);
  w.document.querySelector('[data-dt-tile="data"]').click();
  assert.ok(!w.document.body.classList.contains('dt-at-home'));
  assert.equal($(w, 'dtHome').hidden, true);
  assert.equal($(w, 'dtBackHome').hidden, false);
  assert.ok(w.document.querySelector('.dev-tab-panel[data-tab-panel="data"]').classList.contains('is-active-tab-panel'));
  assert.ok(w.document.querySelector('.dev-tab-btn[data-tab="data"]').classList.contains('is-active'));
  $(w, 'dtBackHome').click();
  assert.ok(w.document.body.classList.contains('dt-at-home'));
});

test('an account without full Dev Tools access sees only the sections it can open, and counts only the tools it can see', () => {
  const w = loadAs(false);
  const shown = [...w.document.querySelectorAll('[data-dt-tile]')].filter((t) => !t.hidden).map((t) => t.getAttribute('data-dt-tile'));
  const tabsShown = [...w.document.querySelectorAll('.dev-tab-btn')].filter((b) => b.style.display !== 'none').map((b) => b.getAttribute('data-tab'));
  assert.deepEqual(shown, tabsShown);
  for (const tab of shown) {
    const visible = [...w.document.querySelectorAll('.dev-tab-panel[data-tab-panel="' + tab + '"] .dev-panel')].filter((p) => p.style.display !== 'none').length;
    const label = w.document.querySelector('[data-dt-count="' + tab + '"]').textContent;
    assert.ok(label.includes(String(visible)), tab + ': ' + label);
  }
});

test('Find a tool: typing filters every visible tool by name, and picking one opens its section and remembers it as Recent', () => {
  const w = loadAs(true);
  const input = $(w, 'dtFind');
  input.value = 'backup';
  input.dispatchEvent(new w.Event('input'));
  const hits = [...$(w, 'dtFindResults').querySelectorAll('.dt-find-hit')].map((a) => a.firstChild.textContent);
  assert.ok(hits.includes('Backup & restore'), hits.join(', '));
  $(w, 'dtFindResults').querySelector('[data-dt-open-tool="Backup & restore"]').click();
  assert.ok(w.document.querySelector('.dev-tab-panel[data-tab-panel="data"]').classList.contains('is-active-tab-panel'));
  assert.deepEqual(JSON.parse(w.localStorage.getItem('th_dev_tools_recent')), ['Backup & restore']);
  $(w, 'dtBackHome').click();
  assert.equal($(w, 'dtRecent').hidden, false);
  assert.match($(w, 'dtRecent').textContent, /^Recent: Backup & restore$/);
  input.value = 'zzzz-nothing';
  input.dispatchEvent(new w.Event('input'));
  assert.match($(w, 'dtFindResults').textContent, /No tool matches that\./);
});

test('a link straight to a tool (#team, #backup) skips the home', () => {
  const w = loadAs(true, { hash: '#team' });
  assert.ok(!w.document.body.classList.contains('dt-at-home'));
});

test('badges: Health shows the error count, Sync shows conflicts only when there are some', () => {
  const w = loadAs(true, { storage: { th_sync_conflicts: JSON.stringify([{ a: 1 }, { b: 2 }]) } });
  $(w, 'dtHealthCount').textContent = '3';
  w.document.querySelector('[data-dt-tile="health"]').click();
  $(w, 'dtBackHome').click();
  const hb = w.document.querySelector('[data-dt-badge="health"]');
  assert.equal(hb.textContent, '3 errors');
  assert.ok(hb.classList.contains('is-warn'));
  const sb = w.document.querySelector('[data-dt-badge="sync"]');
  assert.equal(sb.hidden, false);
  assert.equal(sb.textContent, '2 conflicts');
  const clean = loadAs(true);
  assert.equal(clean.document.querySelector('[data-dt-badge="sync"]').hidden, true);
});
