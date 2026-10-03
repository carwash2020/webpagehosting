// Settings -> App version -> Update (2026-10-03, requested directly: "in
// settings it needs a update button so it can always be in the newest
// version when auto update doesn't catch one"). Asks the server for a new
// service worker now; if one installs and takes over (or the cache name
// moves on), the page reloads into it. Otherwise it says the app is current.
//
// Runs the real functions from tools/settings.html in jsdom, with fake
// caches and a fake service worker registration.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'settings.html'), 'utf8');
const SCRIPT = PAGE.match(/  async function currentAppVersion\(\) \{[\s\S]*?\n  document\.addEventListener\('DOMContentLoaded', \(\) => \{ showAppVersion\(\); \}\);\n/)[0];

function setup({ caches = ['th-workspace-v398'], newWorker = false, switches = true, online = true, noSw = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="settingsAppVersion"></div><button id="settingsUpdateBtn">Update</button></body>', { url: 'https://example.com/tools/settings.html', runScripts: 'outside-only' });
  const w = dom.window;
  const out = { toasts: [], reloads: 0, updates: 0 };
  let names = caches.slice();
  w.caches = { keys: async () => names.slice() };
  const listeners = new Set();
  const reg = {
    installing: null, waiting: null,
    update: async () => {
      out.updates++;
      if (newWorker) {
        reg.installing = {};
        if (switches) setTimeout(() => { names = ['th-workspace-v399']; listeners.forEach((fn) => fn()); }, 5);
      }
    },
  };
  if (!noSw) {
    Object.defineProperty(w.navigator, 'serviceWorker', { value: {
      getRegistration: async () => reg,
      addEventListener: (t, fn) => { if (t === 'controllerchange') listeners.add(fn); },
      removeEventListener: (t, fn) => listeners.delete(fn),
    }, configurable: true });
  }
  Object.defineProperty(w.navigator, 'onLine', { value: online, configurable: true });
  w.showToast = (m, o) => out.toasts.push({ m, type: o && o.type });
  w.eval(SCRIPT.replace(/window\.location\.reload\(\)/, 'window.__reload()') + '\nwindow.__u = { checkForAppUpdate, currentAppVersion, showAppVersion };');
  w.__reload = () => { out.reloads++; };
  const text = () => w.document.getElementById('settingsAppVersion').textContent;
  const btn = () => w.document.getElementById('settingsUpdateBtn');
  return { w, api: w.__u, out, text, btn };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('shows the installed version from the service worker cache name', async () => {
  const { api, text } = setup({ caches: ['th-workspace-v97', 'th-workspace-v398', 'other-cache'] });
  assert.equal(await api.currentAppVersion(), 'v398', 'the highest number, not the last listed');
  await api.showAppVersion();
  assert.equal(text(), 'Version v398');
});

test('a newer version on the server: it downloads, takes over, and the page reloads', async () => {
  const { api, out, text } = setup({ newWorker: true });
  await api.checkForAppUpdate();
  assert.equal(out.updates, 1);
  assert.equal(text(), 'Updated to v399. Reloading…');
  await wait(700);
  assert.equal(out.reloads, 1);
  assert.equal(out.toasts.length, 0);
});

test('already current: no reload, says so, and the button comes back', async () => {
  const { api, out, text, btn } = setup();
  await api.checkForAppUpdate();
  assert.equal(out.updates, 1);
  await wait(700);
  assert.equal(out.reloads, 0);
  assert.equal(text(), 'Up to date · Version v398');
  assert.match(out.toasts[0].m, /newest version/);
  assert.equal(btn().disabled, false);
  assert.equal(btn().textContent, 'Update');
});

test('offline: nothing is attempted', async () => {
  const { api, out } = setup({ online: false });
  await api.checkForAppUpdate();
  assert.equal(out.updates, 0);
  assert.equal(out.toasts[0].type, 'error');
  assert.match(out.toasts[0].m, /offline/);
});

test('no service worker (a plain browser tab): it reports the state instead of failing', async () => {
  const { api, out, text } = setup({ noSw: true, caches: [] });
  await api.checkForAppUpdate();
  assert.equal(out.reloads, 0);
  assert.equal(text(), 'Up to date · Version not available on this device');
});

test('the page has the App version section with the Update button wired to it', () => {
  assert.match(PAGE, /<h2>App version<\/h2>/);
  assert.match(PAGE, /id="settingsUpdateBtn" onclick="checkForAppUpdate\(\)">Update<\/button>/);
  assert.match(PAGE, /id="settingsAppVersion"/);
});
