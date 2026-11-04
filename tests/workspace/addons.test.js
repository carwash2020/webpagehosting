// Add-ons (2026-11-04, approved "Route planner add-on" design; the owner's
// call the same day: the Appliance Wiki gets the same treatment as Route
// Planner). Two tools that are off by default and, while off, have no way
// in anywhere in the app -- not the nav, not Search, not a button. On:
//   - Route planner: exactly one "Plan today's route" button in My Day.
//   - Appliance Wiki: Look Up in Wiki in the invoice and quote line items
//     (handoff §2: "Parts lookup: only inside invoice line items ... not a
//     destination page").
// The switches live in Settings > Add-ons and sync to every device on the
// account (th_addons).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const NAV = read('tools-nav-pwa.js');
const PALETTE = read('tools-command-palette.js');
const SETTINGS = read('settings.html');
const WORKSPACE = read('workspace.html');
const INV = read('invoice-generator.html');
const SYNC = read('sync.js');

const between = (src, a, b) => {
  const i = src.indexOf(a);
  assert.ok(i >= 0, 'missing: ' + a);
  const j = src.indexOf(b, i);
  assert.ok(j >= 0, 'missing end: ' + b);
  return src.slice(i, j + b.length);
};
// The add-on store, exactly as shipped at the end of tools-nav-pwa.js.
const STORE = between(NAV, 'function thReadAddons() {', "try { window.dispatchEvent(new Event('th-addons-changed')); } catch (e) { /* old browser */ }\n}");

function withStore(html = '', { url = 'https://example.com/tools/workspace.html', addons } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><body>' + html + '</body>', { runScripts: 'outside-only', url });
  const w = dom.window;
  if (addons !== undefined) w.localStorage.setItem('th_addons', typeof addons === 'string' ? addons : JSON.stringify(addons));
  w.syncCalls = 0;
  w.eval('function scheduleSync() { window.syncCalls++; }\n' + STORE + ';Object.assign(window, { thAddonOn, thSetAddon });');
  return w;
}

test('off by default: nothing stored, an unreadable value, or anything but true all read as off', () => {
  assert.equal(withStore().thAddonOn('routePlanner'), false);
  assert.equal(withStore('', { addons: 'not json' }).thAddonOn('routePlanner'), false);
  assert.equal(withStore('', { addons: '[true]' }).thAddonOn('0'), false);
  assert.equal(withStore('', { addons: { routePlanner: 'yes', applianceWiki: 1 } }).thAddonOn('routePlanner'), false);
  assert.equal(withStore('', { addons: { routePlanner: true } }).thAddonOn('routePlanner'), true);
  assert.equal(withStore('', { addons: { routePlanner: true } }).thAddonOn('applianceWiki'), false);
});

test('a switch is saved for the whole account: written to th_addons, synced (a plain-overwrite ops key, no DB change), and announced to the page', () => {
  const w = withStore();
  let events = 0;
  w.addEventListener('th-addons-changed', () => events++);
  w.thSetAddon('applianceWiki', true);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('th_addons')), { applianceWiki: true });
  assert.equal(w.syncCalls, 1);
  assert.equal(events, 1);
  w.thSetAddon('routePlanner', true);
  w.thSetAddon('applianceWiki', false);
  assert.deepEqual(JSON.parse(w.localStorage.getItem('th_addons')), { applianceWiki: false, routePlanner: true });
  const keys = SYNC.match(/const SYNC_DATA_KEYS = \[[\s\S]*?\n\];/)[0];
  assert.match(keys, /'th_addons',/);
  const money = SYNC.match(/const SYNC_MONEY_KEYS = \[[\s\S]*?\];/)[0];
  const runway = SYNC.match(/const SYNC_RUNWAY_KEYS = \[[\s\S]*?\];/)[0];
  assert.ok(!money.includes('th_addons') && !runway.includes('th_addons'), 'an ops key, which the SQL does not list, so no DB change');
});

test('Settings > Add-ons: a Route planner and an Appliance Wiki switch, both off, each saying what it adds and that off means nowhere', () => {
  const block = between(SETTINGS, '<div class="settings-section" id="settingsAddons">', '<div class="settings-row" id="settingsWebsiteRow" hidden>');
  const rows = [...block.matchAll(/<div class="settings-row-label" id="(\w+)">([^<]+)<\/div>[\s\S]*?<button type="button" class="th-toggle" role="switch" aria-checked="false" data-addon="(\w+)"/g)].map(m => [m[2], m[3]]);
  assert.deepEqual(rows, [['Route planner', 'routePlanner'], ['Appliance Wiki', 'applianceWiki']]);
  assert.match(block, /Adds &ldquo;Plan today&rsquo;s route&rdquo; to My Day: today&rsquo;s jobs in order, mileage cost and a suggested trip charge, then open in Google Maps\./);
  assert.match(block, /Adds &ldquo;Look Up in Wiki&rdquo; to invoice and quote line items/);
  assert.equal((block.match(/Off: shown nowhere in the app, not in the menu or search either\./g) || []).length, 2);
  assert.doesNotMatch(SETTINGS, /<div class="settings-section" id="settingsAddons" hidden>/, 'the Add-ons card shows to every account');
});

test('the Settings switches flip the add-on, and follow a change made on another device', () => {
  const block = between(SETTINGS, '<div class="settings-section" id="settingsAddons">', "if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', paint); else paint();\n    })();\n  </script>");
  const dom = new JSDOM('<!DOCTYPE html><body>' + block + '</body>', { runScripts: 'dangerously', url: 'https://example.com/tools/settings.html',
    beforeParse(w) { w.eval('function scheduleSync() {}\n' + STORE + ';Object.assign(window, { thAddonOn, thSetAddon });'); } });
  const w = dom.window;
  const sw = (n) => w.document.querySelector('.th-toggle[data-addon="' + n + '"]');
  assert.equal(sw('routePlanner').getAttribute('aria-checked'), 'false');
  sw('routePlanner').click();
  assert.equal(sw('routePlanner').getAttribute('aria-checked'), 'true');
  assert.equal(w.thAddonOn('routePlanner'), true);
  sw('routePlanner').click();
  assert.equal(w.thAddonOn('routePlanner'), false);
  // Another device turned the Wiki on; the sync wrote th_addons here.
  w.localStorage.setItem('th_addons', JSON.stringify({ applianceWiki: true }));
  w.dispatchEvent(new w.StorageEvent('storage', { key: 'th_addons' }));
  assert.equal(sw('applianceWiki').getAttribute('aria-checked'), 'true');
});

function palette(addons) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/tools/job-tracker.html', runScripts: 'dangerously' });
  const w = dom.window;
  for (const f of ['canViewFinance', 'canManageInvoices', 'canManageContracts', 'canManageReviews', 'canViewRunway', 'hasDevToolsAccess', 'canManageSiteContent']) w[f] = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  if (addons) w.localStorage.setItem('th_addons', JSON.stringify(addons));
  w.eval('function scheduleSync() {}\n' + STORE + ';Object.assign(window, { thAddonOn, thSetAddon });');
  const s = w.document.createElement('script'); s.textContent = PALETTE; w.document.head.appendChild(s);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.openCommandPalette();
  const input = w.document.getElementById('thCmdkInput');
  const hrefs = (q) => { input.value = q; input.dispatchEvent(new w.Event('input')); return [...w.document.querySelectorAll('#thCmdkResults a')].map(a => a.getAttribute('href')); };
  return { hrefs };
}

test('Search never lists Route Planner or the Appliance Wiki, on or off: each add-on has one way in (My Day; the invoice line items)', () => {
  for (const addons of [null, { routePlanner: true, applianceWiki: true }]) {
    const p = palette(addons);
    for (const q of ['', 'route', 'rout', 'directions', 'mileage', 'part', 'wiki', 'manual', 'appliance']) {
      assert.ok(!p.hrefs(q).some(h => /route-planner|parts-reference/.test(h)), JSON.stringify(addons) + ' "' + q + '"');
    }
  }
});

test('My Day: exactly one "Plan today\'s route", hidden unless the add-on is on and jobs are left today; it opens Route Planner on today\'s jobs', () => {
  assert.equal((WORKSPACE.match(/route-planner\.html/g) || []).length, 1, 'the only link from the Dashboard into Route Planner');
  assert.match(WORKSPACE, /<a href="\/tools\/route-planner\.html#today" class="dash-route-btn" id="dashRouteBtn" hidden>/);
  assert.match(WORKSPACE, /routeBtn\.hidden = !\(todaysJobs\.length > 0 && typeof thAddonOn === 'function' && thAddonOn\('routePlanner'\)\);/);
  assert.match(WORKSPACE, /window\.addEventListener\('th-addons-changed', \(\) => renderTodayHero\(\)\);/);
  // It sits right under the Next Job card, as designed.
  assert.ok(WORKSPACE.indexOf('id="dashRouteBtn"') > WORKSPACE.indexOf('<div class="today-hero" id="todayHero">'));
  assert.ok(WORKSPACE.indexOf('id="dashRouteBtn"') < WORKSPACE.indexOf('<nav class="dash-primary-strip"'));
  assert.match(read('route-planner.html'), /if \(window\.location\.hash === '#today'\) pullTodaysJobs\(\);/);
});

test('the invoice and quote forms\' Look Up in Wiki buttons are hidden unless the Appliance Wiki add-on is on', () => {
  const buttons = INV.match(/<button[^>]*onclick="openWikiLookup\('\w+'\)">Look Up in Wiki<\/button>/g);
  assert.equal(buttons.length, 2);
  for (const b of buttons) assert.match(b, /data-addon-wiki hidden/);
  const fn = between(INV, '  function showWikiButtons() {', '\n  }');
  const html = buttons.join('');
  for (const [addons, hidden] of [[null, true], [{ applianceWiki: true }, false], [{ routePlanner: true }, true]]) {
    const w = withStore(html, { addons: addons || undefined });
    w.eval(fn + ';showWikiButtons();');
    for (const b of w.document.querySelectorAll('[data-addon-wiki]')) assert.equal(b.hidden, hidden, JSON.stringify(addons));
  }
});

test('while off, nowhere: no other page, nav entry or Search action links into Route Planner or the Appliance Wiki', () => {
  const pages = fs.readdirSync(TOOLS).filter(f => /\.(html|js)$/.test(f) && !['route-planner.html', 'parts-reference.html'].includes(f));
  const found = [];
  for (const f of pages) {
    const src = read(f);
    for (const m of src.matchAll(/(?:href=["']|href: ')\/tools\/(route-planner|parts-reference)\.html[^"']*/g)) found.push(f + ': ' + m[0]);
  }
  assert.deepEqual(found, ['workspace.html: href="/tools/route-planner.html#today'], 'behind its add-on (checked above); anything new here needs the same gate');
  // openWikiLookup builds its URL in script; its buttons are gated above.
  assert.match(INV, /const url = '\/tools\/parts-reference\.html' \+/);
  const sidebar = NAV.slice(NAV.indexOf('var SIDEBAR_DESTS = ['), NAV.indexOf('];', NAV.indexOf('var SIDEBAR_DESTS = [')));
  assert.doesNotMatch(sidebar, /route-planner|parts-reference/);
});
