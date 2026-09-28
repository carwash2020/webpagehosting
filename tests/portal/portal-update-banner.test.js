// Portal "update available" banner (portal-update.js, 2026-09-28).
// Reported: "the portal needs the same fix for updates we did for the
// tools, it also pops up every time" -- the same bug tools-nav-pwa.js had
// and fixed on 2026-09-24 (see tests/tools/app-update-card.test.js and
// that file's own header comment for the full original story).
//
// Root cause here was the same shape: the portal service worker's
// CACHE_NAME is re-stamped by `npm run fix-versions` whenever any
// precached file changes, several times a day -- so `reg.waiting` or a
// newly-installed worker was true on almost every open or foreground,
// even though the page that just loaded came from the network (HTML is
// network-first, ?v= stamps are fresh) and was already current. The old
// code treated "a waiting/installed worker exists" as "show the banner",
// with no check that THIS page actually needed it.
//
// Now that's only a cue to verify: the page records the scripts/
// stylesheets it actually loaded, fetches its own URL fresh, and compares
// -- the banner shows only when the live copy has something this page
// doesn't.
//
// The harness below plays one device across several portal opens, the
// same shape as the tools test: `server` is what's deployed (the
// worker's CACHE_NAME and login.html's own markup); `device` is what
// persists between opens (the active worker + whether it already
// controlled a page before this open, since the portal worker calls
// self.skipWaiting() on install exactly like the tools worker does).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PORTAL = path.join(ROOT, 'portal');
const UPDATE_JS = fs.readFileSync(path.join(PORTAL, 'portal-update.js'), 'utf8');
const PAGE_PATH = '/portal/login.html';
const PAGE_HTML = fs.readFileSync(path.join(PORTAL, 'login.html'), 'utf8');
const LIVE_CACHE_NAME = fs.readFileSync(path.join(PORTAL, 'service-worker.js'), 'utf8').match(/const CACHE_NAME = '([^']+)'/)[1];

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const openWindows = [];

function makeServer() {
  return { cacheName: LIVE_CACHE_NAME, pages: { [PAGE_PATH]: PAGE_HTML }, online: true, fetches: 0 };
}
function makeDevice() {
  return { activeWorker: null };
}

// A real shared-file change as fix-versions ships it: new ?v= on the
// page's own script reference, and (because the file is precached) a new
// CACHE_NAME.
function shipSharedFileChange(server, stamp) {
  server.pages[PAGE_PATH] = server.pages[PAGE_PATH].replace(/portal-app\.js\?v=[a-z0-9]+/, 'portal-app.js?v=' + stamp);
  server.cacheName = server.cacheName.replace(/-v(\d+)$/, (m, n) => '-v' + (Number(n) + 1));
}
// A worker bump with nothing this page loads changing (another portal
// page, or a precached image, changed).
function shipWorkerOnlyBump(server) {
  server.cacheName = server.cacheName.replace(/-v(\d+)$/, (m, n) => '-v' + (Number(n) + 1));
}

// Models the portal service worker's own self.skipWaiting() on install
// (see portal/service-worker.js): an update installs and takes over
// without a visible "waiting" phase -- statechange fires 'installed' with
// the OLD controller still in place (an update), or with none yet (a
// first-ever install), and the new worker claims immediately after.
function installFakeServiceWorker(w, device, server) {
  const container = new w.EventTarget();
  const alreadyControlled = !!device.activeWorker;
  container.controller = alreadyControlled ? { scriptURL: '/portal/service-worker.js' } : null;
  const reg = new w.EventTarget();
  reg.scope = '/portal/';
  reg.waiting = null;
  reg.installing = null;
  function checkForNewWorker() {
    if (device.activeWorker === server.cacheName) return Promise.resolve();
    // Async, like a real network round trip: lets the caller finish
    // wiring its 'updatefound' listener (as reg.update().catch(...);
    // reg.addEventListener('updatefound', ...) does) before it fires.
    return new Promise((resolve) => {
      setTimeout(() => {
        const incoming = new w.EventTarget();
        incoming.state = 'installing';
        reg.installing = incoming;
        reg.dispatchEvent(new w.Event('updatefound'));
        incoming.state = 'installed';
        incoming.dispatchEvent(new w.Event('statechange'));
        device.activeWorker = server.cacheName;
        reg.installing = null;
        if (!alreadyControlled) container.controller = { scriptURL: '/portal/service-worker.js' };
        resolve();
      }, 5);
    });
  }
  reg.update = () => checkForNewWorker();
  container.register = () => {
    if (!device.activeWorker) {
      device.activeWorker = server.cacheName;
      container.controller = { scriptURL: '/portal/service-worker.js' };
    }
    return Promise.resolve(reg);
  };
  container.getRegistration = () => Promise.resolve(device.activeWorker || reg.installing ? reg : undefined);
  Object.defineProperty(w.navigator, 'serviceWorker', { value: container, configurable: true });
  w.fetch = (url) => {
    server.fetches++;
    if (!server.online) return Promise.reject(new TypeError('Failed to fetch'));
    const html = server.pages[new URL(url, w.location.href).pathname];
    return Promise.resolve({
      ok: !!html,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: () => Promise.resolve(html || ''),
    });
  };
  return container;
}

// One portal open: the real login.html as the network serves it right
// now (its own inline script registers the service worker), then
// portal-update.js runs exactly as its own <script defer> tag would once
// the page finishes loading.
async function openApp(device, server) {
  const virtualConsole = new VirtualConsole();
  const reloads = [];
  virtualConsole.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) reloads.push(e.message); });
  const dom = new JSDOM(server.pages[PAGE_PATH], {
    url: 'https://example.com' + PAGE_PATH,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(w) {
      installFakeServiceWorker(w, device, server);
    },
  });
  const w = dom.window;
  w.__reloads = reloads;
  openWindows.push(w);
  const s = w.document.createElement('script');
  s.textContent = UPDATE_JS;
  w.document.body.appendChild(s);
  await tick();
  return w;
}
const banner = (w) => w.document.getElementById('portalUpdateBanner');

// A device that already has the app: opened once before, then closed.
async function installedDevice(server) {
  const device = makeDevice();
  (await openApp(device, server)).close();
  return device;
}

test.afterEach(() => { while (openWindows.length) openWindows.pop().close(); });

test('the first-ever open (the worker installing for the first time) shows nothing', async () => {
  const w = await openApp(makeDevice(), makeServer());
  assert.equal(banner(w), null);
});

test('a cold open AFTER a deploy shows nothing: the page just came from the network and already runs the new version (the reported bug)', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  shipSharedFileChange(server, 'aaaa111111');
  const w = await openApp(device, server);
  assert.equal(device.activeWorker, server.cacheName, 'the new worker did take over during this open');
  assert.ok(server.fetches >= 1, 'the takeover was checked against the live page');
  assert.equal(banner(w), null);
  w.close();
  const again = await openApp(device, server);
  assert.equal(banner(again), null, 'and the open after that stays quiet too');
});

test('a worker-only CACHE_NAME bump never shows the banner', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  shipWorkerOnlyBump(server);
  const w = await openApp(device, server);
  assert.equal(banner(w), null);
});

test('a real new version shipped while the page is open DOES show the banner, once', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  shipSharedFileChange(server, 'bbbb222222');
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.ok(banner(w), 'banner shown');
  assert.match(banner(w).textContent, /new version of the portal/);
  assert.ok(banner(w).querySelector('.portal-update-btn'), 'explicit Update action');

  shipSharedFileChange(server, 'cccc333333');
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.equal(w.document.querySelectorAll('#portalUpdateBanner').length, 1, 'a second deploy does not stack a second banner');
});

test('offline never shows the banner -- it does not guess', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  shipSharedFileChange(server, 'dddd444444');
  server.online = false;
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.equal(banner(w), null);
});

test('never reloads on its own; the dismiss button closes it and does not ask again this page load', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  shipSharedFileChange(server, 'eeee555555');
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.ok(banner(w));
  assert.equal(w.__reloads.length, 0, 'showing the banner does not reload');

  banner(w).querySelector('.portal-update-dismiss').click();
  assert.equal(banner(w), null, 'dismiss removes it');

  shipSharedFileChange(server, 'ffff666666');
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.equal(banner(w), null, 'once dismissed, this page does not ask again');
});

test('coming back to the app is throttled: a resume within 5 minutes does not re-check, one after does', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  shipSharedFileChange(server, 'gggg777777');
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await tick();
  assert.equal(banner(w), null, 'within 5 minutes of the open, resuming does not re-check');

  const realNow = w.Date.now;
  w.Date.now = () => realNow() + 6 * 60 * 1000;
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await tick();
  assert.ok(banner(w), 'after 5 minutes it does, and finds the new version');
});
