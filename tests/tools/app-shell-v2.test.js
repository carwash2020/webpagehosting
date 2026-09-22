// App shell v2 (2026-09-22): the bottom bar is Home / Jobs / (+) / Clients /
// Money; (+) opens a Create sheet of every "start something" action; Money
// is one tab over Invoices and Finance (last-used, with a two-segment
// switch on both pages); Search and More moved into the header; nothing
// floats over page content on a phone. Desktop keeps the sidebar and gains
// a New button (and the N key) for the same Create sheet.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const NAV = read('tools-nav-pwa.js');
const STYLES = read('styles-tools.css');
const RUNWAY = read('runway-dashboard.html');

// Loads a real tool page, stubs the auth checks with the given
// permissions, runs the shell script, and fires DOMContentLoaded.
function shellOn(page, { perms = {}, storage = {} } = {}) {
  const html = read(page);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/' + page,
    beforeParse(w) {
      w.requireAuth = () => {};
      w.initAppTour = () => {};
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
      for (const fn of ['canManageInvoices', 'canViewFinance', 'canViewRunway', 'canManageContracts', 'canManageReviews', 'hasDevToolsAccess']) {
        w[fn] = () => !!perms[fn];
      }
      w.getCurrentUserRole = () => ({ roleName: 'Test' });
    },
  });
  const { window } = dom;
  const s = window.document.createElement('script');
  s.textContent = NAV;
  window.document.head.appendChild(s);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return window;
}
const ALL = { canManageInvoices: true, canViewFinance: true, canViewRunway: true, canManageContracts: true, canManageReviews: true, hasDevToolsAccess: true };

test('the bar is four links around a (+) Create button, in that order', () => {
  const w = shellOn('job-tracker.html', { perms: ALL });
  const bar = w.document.querySelector('.th-bottom-nav');
  const items = [...bar.children].map(el => el.tagName === 'BUTTON' ? '+' : el.textContent.trim());
  assert.deepEqual(items, ['Home', 'Jobs', '+', 'Clients', 'Money']);
  assert.equal(bar.querySelector('.th-bn-create').getAttribute('aria-controls'), 'thCreateSheet');
  assert.ok(bar.querySelector('a[href="/tools/job-tracker.html"]').classList.contains('is-active'));
});

test('the Create sheet deep-links into forms that already open themselves from their hash', () => {
  const w = shellOn('workspace.html', { perms: ALL });
  const tiles = [...w.document.querySelectorAll('#thCreateSheet .th-create-tile')];
  assert.equal(tiles.length, 9);
  const hrefs = tiles.map(t => t.getAttribute('href'));
  assert.deepEqual(hrefs, [
    '/tools/job-tracker.html#add-job',
    '/tools/invoice-generator.html#invoice',
    '/tools/invoice-generator.html#quote',
    '/tools/invoice-generator.html#pos',
    '/tools/finance.html#expenses',
    '/tools/finance.html#income',
    '/tools/clients.html#new',
    '/tools/contract-generator.html',
    '/tools/review-request.html',
  ]);
  // Each hash is one the target page actually handles.
  assert.match(read('job-tracker.html'), /'add-job'|#add-job/);
  for (const tab of ['invoice', 'quote', 'pos']) assert.ok(read('invoice-generator.html').includes('data-tab="' + tab + '"'), 'invoice tab ' + tab);
  for (const tab of ['expenses', 'income']) assert.ok(read('finance.html').includes('data-tab="' + tab + '"'), 'finance tab ' + tab);
  assert.match(read('clients.html'), /if \(location\.hash === '#new'\) openAddClient\(\);/);
  assert.ok(tiles.every(t => !t.hidden), 'an account with every permission sees every tile');
});

test('Create tiles follow the same permission checks as the nav: gated forms are hidden, ungated ones stay', () => {
  const w = shellOn('workspace.html', { perms: {} });
  const visible = [...w.document.querySelectorAll('#thCreateSheet .th-create-tile')].filter(t => !t.hidden).map(t => t.querySelector('.th-create-label').textContent);
  assert.deepEqual(visible, ['Job', 'Client']);
});

test('opening and closing the Create sheet: the (+) toggles it, Esc closes it, focus returns to the button', () => {
  const w = shellOn('workspace.html', { perms: ALL });
  const btn = w.document.querySelector('.th-bn-create');
  const sheet = w.document.getElementById('thCreateSheet');
  assert.ok(sheet.hasAttribute('hidden'));
  btn.click();
  assert.ok(!sheet.hasAttribute('hidden'));
  assert.ok(w.document.body.classList.contains('th-create-open'));
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(sheet.hasAttribute('hidden'));
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(w.document.activeElement, btn);
  btn.click(); btn.click();
  assert.ok(sheet.hasAttribute('hidden'), 'a second tap on (+) closes it again');
});

test('N opens the Create sheet from anywhere, but never while typing in a field', () => {
  const w = shellOn('job-tracker.html', { perms: ALL });
  const sheet = w.document.getElementById('thCreateSheet');
  const input = w.document.querySelector('input[type="text"]');
  input.focus();
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
  assert.ok(sheet.hasAttribute('hidden'), 'typing an n into a field is just typing');
  input.blur();
  w.document.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
  assert.ok(!sheet.hasAttribute('hidden'));
});

test('the desktop sidebar has a New button above Search that opens the same sheet', () => {
  const w = shellOn('finance.html', { perms: ALL });
  const side = w.document.querySelector('.th-desktop-sidebar');
  const kids = [...side.children].map(el => el.className.split(' ')[0]);
  assert.deepEqual(kids.slice(0, 3), ['th-sidebar-brand', 'th-sidebar-new', 'th-sidebar-link']);
  side.querySelector('.th-sidebar-new').click();
  assert.ok(!w.document.getElementById('thCreateSheet').hasAttribute('hidden'));
});

test('Money opens Invoices by default, then whichever Money page was used last on this device', () => {
  let w = shellOn('workspace.html', { perms: ALL });
  assert.equal(w.document.querySelector('.th-bn-money').getAttribute('href'), '/tools/invoice-generator.html');
  w = shellOn('workspace.html', { perms: ALL, storage: { th_money_last: '/tools/finance.html' } });
  assert.equal(w.document.querySelector('.th-bn-money').getAttribute('href'), '/tools/finance.html');
  w = shellOn('workspace.html', { perms: ALL, storage: { th_money_last: '/tools/settings.html' } });
  assert.equal(w.document.querySelector('.th-bn-money').getAttribute('href'), '/tools/invoice-generator.html', 'anything else stored is ignored');
  w = shellOn('finance.html', { perms: ALL });
  assert.equal(w.localStorage.getItem('th_money_last'), '/tools/finance.html', 'visiting a Money page records it');
  assert.ok(w.document.querySelector('.th-bn-money').classList.contains('is-active'));
});

test('on both Money pages a two-segment Invoices | Finance switch joins the header, shown only to accounts that can open both', () => {
  let w = shellOn('invoice-generator.html', { perms: ALL });
  w.dispatchEvent(new w.CustomEvent('th-role-loaded'));
  const sw = w.document.querySelector('.hub-header-left .th-money-switch');
  assert.ok(sw && !sw.hidden);
  assert.deepEqual([...sw.querySelectorAll('a')].map(a => [a.textContent, a.classList.contains('is-active')]), [['Invoices', true], ['Finance', false]]);
  assert.ok(w.document.body.classList.contains('th-money-switch-on'));

  w = shellOn('finance.html', { perms: { canViewFinance: true } });
  w.dispatchEvent(new w.CustomEvent('th-role-loaded'));
  assert.ok(w.document.querySelector('.th-money-switch').hidden, 'finance-only: no switch');
  assert.equal(w.document.querySelector('.th-bn-money').getAttribute('href'), '/tools/finance.html', 'finance-only: Money goes to Finance');
  assert.notEqual(w.document.querySelector('.th-bn-money').style.display, 'none');

  w = shellOn('workspace.html', { perms: {} });
  w.dispatchEvent(new w.CustomEvent('th-role-loaded'));
  assert.equal(w.document.querySelector('.th-bn-money').style.display, 'none', 'no money permissions: no Money tab');
  assert.equal(shellOn('job-tracker.html', { perms: ALL }).document.querySelector('.th-money-switch'), null, 'not a Money page: no switch');
});

test('Search and More are header buttons on every page; runway (no shared header) gets them pinned to its own header', () => {
  const w = shellOn('parts-reference.html', { perms: ALL });
  const actions = w.document.querySelector('.hub-header-right > .th-hdr-actions');
  assert.ok(actions);
  let opened = 0;
  w.openCommandPalette = () => { opened++; };
  actions.querySelector('.th-hdr-search').click();
  assert.equal(opened, 1);
  actions.querySelector('.th-hdr-menu').click();
  assert.ok(!w.document.getElementById('thMoreSheet').hasAttribute('hidden'));
  assert.ok(actions.querySelector('.th-hdr-menu').classList.contains('is-active'), 'the Wiki lives in More, so the More button carries the you-are-here dot');

  const r = shellOn('runway-dashboard.html', { perms: ALL });
  assert.ok(r.document.querySelector('header#mainContent > .th-hdr-actions.is-floating'));
});

test('the More drawer is an app grid of the remaining pages plus two utility rows: this page\'s help, and Flag this page', () => {
  const w = shellOn('job-tracker.html', { perms: ALL });
  const sheet = w.document.getElementById('thMoreSheet');
  const labels = [...sheet.querySelectorAll('.th-more-sheet-link')].map(a => a.textContent.trim());
  assert.deepEqual(labels, ['Route Planner', 'Runway Dashboard', 'Contracts', 'Reviews', 'Appliance Wiki', 'Dev Tools', 'Settings']);
  let helped = 0;
  w.openHelpModal = () => { helped++; };
  sheet.querySelector('[data-th-util="help"]').click();
  assert.equal(helped, 1, 'the help row presses the page\'s own ? button');
  let flagged = null;
  w.showFlagDialog = (label) => { flagged = label; return new Promise(() => {}); };
  sheet.querySelector('[data-th-util="flag"]').click();
  assert.ok(flagged, 'the flag row opens the same flag dialog the old floating button did');
  assert.ok(sheet.hasAttribute('hidden'), 'either row closes the drawer first');
});

test('a restricted page is still hidden in the drawer and sidebar once the role loads, as before', () => {
  const w = shellOn('workspace.html', { perms: {} });
  w.dispatchEvent(new w.CustomEvent('th-role-loaded'));
  for (const href of ['/tools/contract-generator.html', '/tools/review-request.html', '/tools/dev-tools.html']) {
    for (const a of w.document.querySelectorAll('a[href="' + href + '"]')) assert.equal(a.style.display, 'none', href);
  }
});

test('styles: the (+) is a lifted orange hexagon that turns into an x while its sheet is open, the bar stays above the Create backdrop on a phone, and runway mirrors the shell', () => {
  assert.match(STYLES, /\.th-bn-create-disc \{[^}]*clip-path: var\(--hex\);/);
  assert.match(STYLES, /body\.th-create-open \.th-bn-create-disc \{ transform: rotate\(45deg\); \}/);
  assert.match(STYLES, /body\.th-create-open \.th-bottom-nav \{ z-index: 960; \}/);
  assert.match(STYLES, /@media \(min-width: 1024px\) \{\s*\.th-create-sheet \{ display: flex;/);
  assert.match(STYLES, /@keyframes th-sheet-up/);
  assert.match(STYLES, /@media \(prefers-reduced-motion: reduce\) \{\s*\.th-sheet-backdrop, \.th-sheet-panel \{ animation: none; \}/);
  for (const rule of [/\.th-bn-create-disc \{/, /\.th-create-grid \{/, /\.th-more-sheet-links \{ display: grid;/, /\.th-hdr-actions\.is-floating \{/, /\.th-sidebar-new \{/]) {
    assert.match(RUNWAY, rule, 'runway-dashboard.html mirrors ' + rule);
  }
  assert.match(RUNWAY, /--bg-panel: var\(--bg-card\);/, 'runway aliases the panel colour the copied CSS uses');
  assert.doesNotMatch(RUNWAY.match(/<style>[\s\S]*<\/style>/)[0], /\.th-bn-more/);
});

test('the sprite carries every new shell icon', () => {
  for (const id of ['plus', 'grid', 'users', 'card', 'flag', 'help']) {
    assert.match(NAV, new RegExp('<symbol id="icon-' + id + '"'), id);
  }
});
