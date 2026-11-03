// app-freshness.js (2026-11-03): one shared module keeps the Workspace and
// the client portal on the newest version on every device. These tests
// play it in jsdom: when it checks, what it does with a page that's too
// old (reload if nothing's typed, ask first if something is), and that
// it can't reload-loop.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'app-freshness.js'), 'utf8');
const BUILD = Number(SRC.match(/var BUILD = (\d+);/)[1]);
const opened = [];
after(() => opened.forEach((w) => w.close()));
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function boot({ minBuild = BUILD, path: pagePath = '/portal/home.html', reloadedAt = null } = {}) {
  let reloadCount = 0;
  const vc = new VirtualConsole();
  // jsdom can't navigate; location.reload() reports exactly this instead.
  vc.on('jsdomError', (e) => { if (/navigation/i.test(e.message)) reloadCount++; });
  const dom = new JSDOM('<!DOCTYPE html><body><input id="name"><input id="q" type="search"></body>', {
    url: 'https://example.test' + pagePath, runScripts: 'outside-only', virtualConsole: vc,
  });
  const w = dom.window;
  opened.push(w);
  const calls = { reloads: 0, fetches: [], updates: 0, registers: [], checks: 0 };
  const reg = { scope: 'https://example.test' + (pagePath.startsWith('/portal/') ? '/portal/' : '/'), updateViaCache: 'imports',
    active: { scriptURL: 'https://example.test/portal/service-worker.js' }, update: () => { calls.updates++; return Promise.resolve(); } };
  Object.defineProperty(w.navigator, 'serviceWorker', { value: {
    getRegistration: (scope) => { calls.scope = scope; return Promise.resolve(reg); },
    register: (url, opts) => { calls.registers.push([url, opts]); return Promise.resolve(reg); },
  } });
  w.fetch = (url, opts) => { calls.fetches.push([url, opts]); return Promise.resolve({ ok: true, json: () => Promise.resolve({ minBuild: state.minBuild }) }); };
  const state = { minBuild };
  if (reloadedAt) w.sessionStorage.setItem('th-fresh-reloaded-at', String(reloadedAt));
  w.addEventListener('th-app-check', () => { calls.checks++; });
  try { w.eval(SRC); } catch (e) { throw e; }
  return { w, calls, state, reloads: () => reloadCount };
}

test('version.json never asks for a newer build than the code ships (no reload loop in production)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  assert.equal(typeof v.minBuild, 'number');
  assert.ok(v.minBuild <= BUILD, `version.json minBuild ${v.minBuild} > app-freshness.js BUILD ${BUILD}`);
});

test('every Workspace and portal page loads app-freshness.js before its own update script', () => {
  const pages = [];
  for (const dir of ['tools', 'portal']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
      const own = html.search(/\/(tools\/tools-nav-pwa|portal\/portal-update)\.js\?v=/);
      if (own === -1) continue;
      pages.push(f);
      const fresh = html.search(/<script src="\/js\/app-freshness\.js\?v=[a-z0-9]+" defer><\/script>/);
      assert.ok(fresh !== -1 && fresh < own, `${dir}/${f} must load /js/app-freshness.js before its update script`);
    }
  }
  assert.ok(pages.length >= 20, 'expected the Workspace and portal pages to be found');
  for (const sw of ['service-worker.js', 'portal/service-worker.js']) {
    assert.match(fs.readFileSync(path.join(ROOT, sw), 'utf8'), /'\/js\/app-freshness\.js'/, `${sw} precaches the module`);
  }
});

test('both workers take over at once on a new version (skipWaiting + clients.claim)', () => {
  for (const sw of ['service-worker.js', 'portal/service-worker.js']) {
    const s = fs.readFileSync(path.join(ROOT, sw), 'utf8');
    assert.match(s, /self\.skipWaiting\(\)/);
    assert.match(s, /self\.clients\.claim\(\)/);
  }
});

test('the existing registration is switched to updateViaCache none, scoped to the surface', async () => {
  const { calls } = boot();
  await tick();
  assert.equal(calls.scope, '/portal/');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.registers)), [['/portal/service-worker.js', { scope: 'https://example.test/portal/', updateViaCache: 'none' }]]);
  assert.equal(boot({ path: '/tools/workspace.html' }).calls.scope, '/');
});

test('version.json is fetched no-store on load; a current build does nothing', async () => {
  const { calls, reloads } = boot();
  await tick();
  assert.equal(calls.fetches[0][0], '/version.json');
  assert.equal(calls.fetches[0][1].cache, 'no-store');
  assert.equal(reloads(), 0);
});

test('a build older than minBuild reloads straight away when nothing is typed', async () => {
  const { reloads } = boot({ minBuild: BUILD + 1 });
  await tick();
  assert.equal(reloads(), 1);
});

test('a build older than minBuild never reloads over typed work -- it asks first', async () => {
  const { w, reloads } = boot();
  const prompts = [];
  w.thAppFreshness.onStale((reason) => prompts.push(reason));
  const input = w.document.getElementById('name');
  input.value = 'half a work order';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(w.thAppFreshness.isDirty(), true);
  assert.equal(w.thAppFreshness.stale('min-version'), 'prompted');
  assert.equal(w.thAppFreshness.stale('min-version'), 'prompted');
  assert.equal(reloads(), 0);
  assert.deepEqual(prompts, ['min-version'], 'one prompt per page');
});

test('typing in a search box is not unsaved work', () => {
  const { w } = boot();
  w.document.getElementById('q').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(w.thAppFreshness.isDirty(), false);
});

test('a reload within the last minute is not repeated (no loop if the server lags)', async () => {
  const { reloads } = boot({ minBuild: BUILD + 1, reloadedAt: Date.now() - 1000 });
  await tick();
  assert.equal(reloads(), 0);
});

test('resume, focus, bfcache restore and coming online all check for updates; plain focus is throttled', async () => {
  const { w, calls } = boot();
  await tick();
  w.dispatchEvent(new w.Event('focus'));
  assert.equal(calls.checks, 0, 'just loaded: focus inside a minute is throttled');
  const ps = new w.Event('pageshow'); ps.persisted = true;
  w.dispatchEvent(ps);
  assert.equal(calls.checks, 1, 'bfcache restore always checks (iOS resume)');
  w.dispatchEvent(new w.Event('online'));
  assert.equal(calls.checks, 2);
  await tick();
  assert.ok(calls.updates >= 2, 'each check asks the worker to update');
  assert.ok(calls.fetches.length >= 3, 'each check re-reads version.json');
});

test('it checks every 30 minutes while open', () => {
  assert.match(SRC, /CHECK_EVERY_MS = 30 \* 60 \* 1000/);
  assert.match(SRC, /setInterval\(function \(\) \{ check\(true\); \}, CHECK_EVERY_MS\)/);
});

test('portal and Workspace both hook in: auto-update when clean, prompt when typed', () => {
  const portal = fs.readFileSync(path.join(ROOT, 'portal', 'portal-update.js'), 'utf8');
  assert.match(portal, /fresh && !fresh\.isDirty\(\)\) \{ window\.portalUpdateNow\(\)/);
  assert.match(portal, /addEventListener\('th-app-check'/);
  assert.match(portal, /thAppFreshness\.onStale/);
  const tools = fs.readFileSync(path.join(ROOT, 'tools', 'tools-nav-pwa.js'), 'utf8');
  assert.match(tools, /addEventListener\('th-app-check'/);
  assert.match(tools, /thAppFreshness\.onStale/);
});
