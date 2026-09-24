// "Update ready" card (tools-nav-pwa.js, 2026-09-24). Reported: the
// update banner appeared on nearly every open of the installed app.
//
// Root cause, reproduced in real Chromium with a persistent profile that
// was closed and reopened between steps: a reopen with nothing deployed
// never showed it (the hadControllerAtScriptStart guard holds), but a
// reopen after ANY deploy did. CACHE_NAME is re-stamped by
// `npm run fix-versions` whenever a precached file changes (5-22 times a
// day in mid-September), so the navigation's own update check almost
// always found a new worker, which took over (skipWaiting + claim) and
// fired controllerchange -- on a page that had just been fetched from the
// network and was already current. Reloading changed nothing.
//
// Now a controllerchange only starts a check: the card shows when the live
// copy of this page has a script or stylesheet the running page doesn't.
//
// The harness below plays one device across several app opens. `server`
// is what's deployed (the worker's CACHE_NAME and each page's HTML);
// `device` is what persists between opens (the active worker). Each open
// is a fresh window: controller present iff a worker is already active,
// and -- as in Chromium -- the open's update check installs a changed
// worker, which claims the page and fires controllerchange.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'tools');
const NAV = fs.readFileSync(path.join(TOOLS, 'tools-nav-pwa.js'), 'utf8');
const CSS = fs.readFileSync(path.join(TOOLS, 'styles-tools.css'), 'utf8');
const PAGE_PATH = '/tools/login.html';
const PAGE_HTML = fs.readFileSync(path.join(TOOLS, 'login.html'), 'utf8');
const LIVE_CACHE_NAME = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8').match(/const CACHE_NAME = '([^']+)'/)[1];

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const openWindows = [];

function makeServer() {
  return { cacheName: LIVE_CACHE_NAME, pages: { [PAGE_PATH]: PAGE_HTML }, online: true, fetches: 0 };
}
function makeDevice() {
  return { activeWorker: null };
}

// A real shared-file change as fix-versions ships it: new ?v= on the page,
// and (because the file is precached) a new CACHE_NAME.
function shipSharedFileChange(server, stamp) {
  server.pages[PAGE_PATH] = server.pages[PAGE_PATH].replace(/tools-effects\.js\?v=[a-z0-9]+/, 'tools-effects.js?v=' + stamp);
  server.cacheName = server.cacheName.replace(/-v(\d+)$/, (m, n) => '-v' + (Number(n) + 1));
}
// A worker bump with nothing this page loads changing (another page, or a
// precached image, changed).
function shipWorkerOnlyBump(server) {
  server.cacheName = server.cacheName.replace(/-v(\d+)$/, (m, n) => '-v' + (Number(n) + 1));
}

function installFakeServiceWorker(w, device, server) {
  const container = new w.EventTarget();
  container.controller = device.activeWorker ? { scriptURL: '/service-worker.js' } : null;
  function checkForNewWorker() {
    if (device.activeWorker === server.cacheName) return;
    device.activeWorker = server.cacheName; // install -> skipWaiting -> activate -> clients.claim
    container.controller = { scriptURL: '/service-worker.js' };
    setTimeout(() => container.dispatchEvent(new w.Event('controllerchange')), 5);
  }
  const reg = { update: () => { checkForNewWorker(); return Promise.resolve(); } };
  container.register = () => { checkForNewWorker(); return Promise.resolve(reg); };
  container.getRegistration = () => Promise.resolve(reg);
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

// One app open: the page as the network serves it right now, then
// tools-nav-pwa.js, then the load-time register() (tools-media-sharing.js).
async function openApp(device, server) {
  // jsdom can't navigate; a reload shows up as a "Not implemented:
  // navigation" error, which is how the tests count reloads.
  const virtualConsole = new VirtualConsole();
  const reloads = [];
  virtualConsole.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) reloads.push(e.message); });
  const dom = new JSDOM(server.pages[PAGE_PATH], {
    url: 'https://example.com' + PAGE_PATH,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(w) {
      w.hasValidSession = () => false; // auth.js isn't loaded; login.html's inline code asks it
      installFakeServiceWorker(w, device, server);
    },
  });
  const w = dom.window;
  w.__reloads = reloads;
  openWindows.push(w);
  const s = w.document.createElement('script');
  s.textContent = NAV;
  w.document.head.appendChild(s);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.navigator.serviceWorker.register('/service-worker.js');
  await tick();
  return w;
}
const card = (w) => w.document.querySelector('.th-update-card');
// "Nothing shown" means no banner of any kind -- before this fix the
// update message used the install bar (.th-install-banner), which jsdom's
// non-iOS, no-beforeinstallprompt browser otherwise never shows.
const anyBanner = (w) => w.document.querySelector('.th-update-card, .th-install-banner');

// A device that already has the app: opened once before, then closed.
async function installedDevice(server) {
  const device = makeDevice();
  (await openApp(device, server)).close();
  return device;
}

test.afterEach(() => { while (openWindows.length) openWindows.pop().close(); });

test('cold repeat-opens with nothing deployed in between never show the card', async () => {
  const server = makeServer();
  const device = makeDevice();
  for (let i = 0; i < 4; i++) {
    const w = await openApp(device, server);
    assert.equal(anyBanner(w), null, 'open #' + (i + 1));
    w.close();
  }
});

test('the first-ever open (the worker installing for the first time) shows nothing', async () => {
  const w = await openApp(makeDevice(), makeServer());
  assert.equal(anyBanner(w), null);
});

test('a cold open AFTER a deploy shows nothing: the page just came from the network and already runs the new version (the reported bug)', async () => {
  const server = makeServer();
  const device = makeDevice();
  (await openApp(device, server)).close();
  shipSharedFileChange(server, 'aaaa111111');
  const w = await openApp(device, server);
  assert.equal(device.activeWorker, server.cacheName, 'the new worker did take over during this open');
  assert.equal(server.fetches, 1, 'the takeover was checked against the live page');
  assert.equal(anyBanner(w), null);
  w.close();
  const again = await openApp(device, server);
  assert.equal(anyBanner(again), null, 'and the open after that stays quiet too');
});

test('a worker-only CACHE_NAME bump never shows the card, open or not', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  shipWorkerOnlyBump(server);
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.equal(anyBanner(w), null, 'page left open');
  shipWorkerOnlyBump(server);
  const reopened = await openApp(device, server);
  assert.equal(anyBanner(reopened), null, 'cold open');
});

test('a real new version (new CACHE_NAME + changed page) shipped while the page is open DOES show the card, once', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  shipSharedFileChange(server, 'bbbb222222');
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.ok(card(w), 'card shown');
  assert.match(card(w).textContent, /Update ready/);
  assert.ok(card(w).querySelector('.th-update-now'), 'explicit Update action');

  shipSharedFileChange(server, 'cccc333333');
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.equal(w.document.querySelectorAll('.th-update-card').length, 1, 'a second deploy does not stack a second card');
});

test('an inline-script-only change to the open page counts as a real update', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  server.pages[PAGE_PATH] = server.pages[PAGE_PATH].replace('</body>', '<script>/* hotfix */ void 0;</script></body>');
  shipWorkerOnlyBump(server);
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.ok(card(w));
});

test('coming back to the app asks for a new worker (throttled) and shows the card when one is really newer', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  shipSharedFileChange(server, 'dddd444444');
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await tick();
  assert.equal(anyBanner(w), null, 'within 5 minutes of the open, resuming does not re-check');

  const realNow = w.Date.now;
  w.Date.now = () => realNow() + 6 * 60 * 1000;
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await tick();
  assert.ok(card(w), 'after 5 minutes it does, and finds the new version');
});

test('offline, or an unreadable live page, never shows the card -- it does not guess', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  shipSharedFileChange(server, 'eeee555555');
  server.online = false;
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.equal(anyBanner(w), null, 'offline');

  const w2 = await openApp(makeDevice(), server);
  server.online = true;
  server.pages[PAGE_PATH] = undefined;
  w2.navigator.serviceWorker.controller = {};
  w2.navigator.serviceWorker.dispatchEvent(new w2.Event('controllerchange'));
  await tick();
  assert.equal(anyBanner(w2), null, 'a 404 is not a newer page');
});

test('never reloads on its own; Later and the close button dismiss, Update reloads', async () => {
  const server = makeServer();
  const device = await installedDevice(server);
  const w = await openApp(device, server);
  shipSharedFileChange(server, 'ffff666666');
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.ok(card(w));
  assert.equal(w.__reloads.length, 0, 'showing the card does not reload');
  card(w).querySelector('.th-update-later').click();
  await tick(300);
  assert.equal(anyBanner(w), null, 'Later dismisses');
  assert.equal(w.__reloads.length, 0);

  shipSharedFileChange(server, 'ffff777777');
  await w.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  assert.equal(anyBanner(w), null, 'once dismissed, this page does not ask again');

  const w2 = await openApp(device, server);
  shipSharedFileChange(server, 'ffff888888');
  await w2.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  card(w2).querySelector('.th-update-close').click();
  await tick(300);
  assert.equal(anyBanner(w2), null, 'the close button dismisses');
  assert.equal(w2.__reloads.length, 0);

  const w3 = await openApp(device, server);
  shipSharedFileChange(server, 'ffff999999');
  await w3.navigator.serviceWorker.getRegistration().then((r) => r.update());
  await tick();
  const btn = card(w3).querySelector('.th-update-now');
  btn.click();
  assert.equal(w3.__reloads.length, 1, 'Update reloads');
  assert.equal(btn.disabled, true, 'and shows it is working');
  assert.match(btn.textContent, /Updating/);
});

test('the update card has its own look, not the install bar', () => {
  assert.doesNotMatch(NAV.match(/function showThUpdateCard[\s\S]*?\n}\n/)[0], /th-install-banner/);
  for (const sel of ['.th-update-card {', '.th-update-card.is-shown', '.th-update-mark', '.th-update-now', '.th-update-later', '.th-update-close']) {
    assert.ok(CSS.includes(sel), sel + ' is styled');
  }
  assert.match(CSS, /body\.th-has-bottomnav \.th-update-card \{ bottom: calc\(85px \+ env\(safe-area-inset-bottom, 0px\) \+ 12px\); \}/, 'clears the phone bottom nav (85px measured)');
  const reduced = CSS.slice(CSS.indexOf('.th-update-close:hover'));
  assert.match(reduced, /@media \(prefers-reduced-motion: reduce\) \{\s*\.th-update-card \{ transform: none;/, 'reduced motion drops the rise and the turning icon');
});

test('the build comparison is one-way and ignores scripts added at runtime', () => {
  const dom = new JSDOM('<!doctype html><script src="/a.js?v=1"></script><link rel="stylesheet" href="/s.css?v=1"><style>p{}</style><script>x()</script>', { url: 'https://example.com/tools/p.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(NAV.match(/function thBuildHash[\s\S]*?\n}\n/)[0] + NAV.match(/function thPageBuildParts[\s\S]*?\n}\n/)[0] + NAV.match(/function thPageIsBehind[\s\S]*?\n}\n/)[0]);
  const running = w.thPageBuildParts(w.document, w.location.href);
  assert.equal(running.length, 4);
  const extra = w.document.createElement('script'); extra.src = 'https://cdn.example/x.js'; w.document.head.appendChild(extra);
  const runningWithExtra = w.thPageBuildParts(w.document, w.location.href);
  assert.equal(w.thPageIsBehind(runningWithExtra, running), false, 'a runtime-added script is not a missing update');
  assert.equal(w.thPageIsBehind(running, running.map((p) => p.replace('a.js?v=1', 'a.js?v=2'))), true);
  assert.equal(w.thPageIsBehind(running, []), false, 'nothing readable: not behind');
  w.close();
});
