// Public pages and the Workspace service worker (2026-09-25).
//
// /service-worker.js is the Workspace tools' worker (scope /). Public pages
// used to register it too, so every customer's browser precached the whole
// tools app (~3.3MB, 48 URLs) in the background, then again on every
// CACHE_NAME bump. Public pages now don't register it, and on devices with
// no sign of Workspace use they remove the copy earlier pages installed.
//
// Also here: each worker's activate step used to delete every cache except
// its own CACHE_NAME. Both apps share one Cache Storage, so on a device with
// both (the owner's phone after opening the portal) every update of one
// wiped the other's offline copy. Each now deletes only its own old caches.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const repo = (...p) => path.join(ROOT, ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const SKIP = new Set(['tools', 'portal', 'backups', 'node_modules', 'tests', 'docs', '.git', '.claude']);

function publicHtml(dir = ROOT) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : publicHtml(path.join(dir, e.name));
    return e.name.endsWith('.html') ? [path.relative(ROOT, path.join(dir, e.name))] : [];
  });
}

// The whole <script>...</script> block holding the cleanup, found by its
// opening comment. Plain string search, not a tag regex.
const OPEN = '<script>', CLOSE = '</script>';
function cleanupOf(src) {
  const at = src.indexOf("// Public pages don't register a service worker");
  if (at === -1) return undefined;
  return src.slice(src.lastIndexOf(OPEN, at), src.indexOf(CLOSE, at) + CLOSE.length);
}
const CLEANUP = cleanupOf(read('index.html'));
const keysMatch = (CLEANUP || '').match(/const TOOLS_KEYS = (\[[^\]]*\]);/);
const TOOLS_KEYS = keysMatch ? JSON.parse(keysMatch[1].replace(/'/g, '"')) : null;

// The full-layout pages that used to register the worker.
const FULL_PAGES = publicHtml().filter((f) =>
  /^(services|locations|blog)\//.test(f) || ['index.html', 'about.html', 'careers.html', 'our-work.html', 'privacy.html', 'terms.html'].includes(f));

test('no public page registers a service worker', () => {
  for (const file of publicHtml()) {
    assert.doesNotMatch(read(file), /serviceWorker\.register\(/, `${file} registers a service worker`);
  }
});

test('every full-layout public page carries the same cleanup script', () => {
  assert.ok(CLEANUP, 'cleanup script not found in index.html');
  assert.ok(FULL_PAGES.length >= 36, `expected 36+ pages, found ${FULL_PAGES.length}`);
  for (const file of FULL_PAGES) {
    assert.equal(cleanupOf(read(file)), CLEANUP, `${file}: cleanup script missing or different from index.html's`);
  }
});

test('the "uses the Workspace" keys are real tools keys that no public page writes', () => {
  assert.ok(Array.isArray(TOOLS_KEYS) && TOOLS_KEYS.length >= 3);
  const auth = read('tools', 'auth.js'), sync = read('tools', 'sync.js'), layer = read('tools', 'data-layer.js');
  assert.ok(TOOLS_KEYS.includes(auth.match(/const AUTH_SESSION_KEY = '([^']+)'/)[1]), 'the tools login key moved');
  for (const k of TOOLS_KEYS) {
    const writtenByTools = auth.includes(`'${k}'`) || sync.includes(`'${k}'`) || new RegExp(`:\\s*'${k}'`).test(layer);
    assert.ok(writtenByTools, `${k} is no longer a tools storage key`);
  }
  const publicSrc = [...publicHtml().map((f) => read(f).replace(CLEANUP || '', '')), ...fs.readdirSync(repo('js')).map((f) => read('js', f))].join('\n');
  for (const k of TOOLS_KEYS) assert.ok(!publicSrc.includes(`'${k}'`), `a public page or js/ file uses ${k}, so a customer's browser could look like a tools device`);
});

// Runs the real cleanup script against a fake browser.
async function runCleanup({ local = {}, session = {}, reg = 'root', push = false, cacheNames = [], storageThrows = false }) {
  const calls = { unregister: 0, deleted: [] };
  const store = (data) => ({ getItem: (k) => (k in data ? data[k] : null) });
  const registration = reg && {
    scope: reg === 'root' ? 'https://example.com/' : 'https://example.com/portal/',
    pushManager: { getSubscription: async () => (push ? { endpoint: 'x' } : null) },
    unregister: async () => { calls.unregister++; return true; },
  };
  let onLoad;
  const win = {
    navigator: { serviceWorker: { getRegistration: async () => registration || undefined } },
    caches: { keys: async () => cacheNames, delete: async (n) => { calls.deleted.push(n); return true; } },
    location: { origin: 'https://example.com' },
    addEventListener: (type, fn) => { if (type === 'load') onLoad = fn; },
  };
  Object.defineProperty(win, 'localStorage', { get() { if (storageThrows) throw new Error('blocked'); return store(local); } });
  Object.defineProperty(win, 'sessionStorage', { get() { return store(session); } });
  win.window = win;
  vm.runInNewContext(CLEANUP.slice(OPEN.length, -CLOSE.length), win);
  assert.ok(onLoad, 'cleanup should wait for load');
  onLoad();
  await new Promise((r) => setTimeout(r, 20));
  return calls;
}

const BOTH = ['th-workspace-v324', 'th-workspace-v320', 'th-portal-v139'];

test('a customer device: the worker is unregistered and only th-workspace caches are deleted', async () => {
  const c = await runCleanup({ cacheNames: BOTH });
  assert.equal(c.unregister, 1);
  assert.deepEqual(c.deleted, ['th-workspace-v324', 'th-workspace-v320']);
});

test('no worker left: leftover th-workspace caches are still cleared, portal caches kept', async () => {
  const c = await runCleanup({ reg: null, cacheNames: BOTH });
  assert.equal(c.unregister, 0);
  assert.deepEqual(c.deleted, ['th-workspace-v324', 'th-workspace-v320']);
});

test('a device that uses the Workspace keeps everything', async () => {
  for (const k of TOOLS_KEYS) {
    for (const where of ['local', 'session']) {
      const c = await runCleanup({ [where]: { [k]: '{}' }, cacheNames: BOTH });
      assert.deepEqual(c, { unregister: 0, deleted: [] }, `${where}Storage ${k}`);
    }
  }
});

test('a device with a push subscription keeps its worker and caches', async () => {
  assert.deepEqual(await runCleanup({ push: true, cacheNames: BOTH }), { unregister: 0, deleted: [] });
});

test('only the root registration is ever removed', async () => {
  const c = await runCleanup({ reg: 'portal', cacheNames: BOTH });
  assert.equal(c.unregister, 0);
});

test('blocked storage: does nothing', async () => {
  assert.deepEqual(await runCleanup({ storageThrows: true, cacheNames: BOTH }), { unregister: 0, deleted: [] });
});

// Runs a worker's real activate handler against a fake Cache Storage.
async function activate(file, names) {
  const handlers = {};
  const deleted = [];
  const self = {
    addEventListener: (t, fn) => { handlers[t] = fn; },
    clients: { claim: async () => {} },
    registration: {},
    skipWaiting: () => {},
    location: { origin: 'https://example.com' },
  };
  const ctx = { self, caches: { keys: async () => names, delete: async (n) => { deleted.push(n); return true; }, open: async () => ({}) }, URL, Promise, console };
  vm.runInNewContext(read(file), ctx);
  let done;
  handlers.activate({ waitUntil: (p) => { done = p; } });
  await done;
  return { deleted, cacheName: vm.runInNewContext('CACHE_NAME', ctx) };
}

test('the Workspace worker deletes only its own old caches when it activates', async () => {
  const { cacheName } = await activate('service-worker.js', []);
  const { deleted } = await activate('service-worker.js', [cacheName, 'th-workspace-v1', 'th-portal-v139', 'th-portal-v2']);
  assert.deepEqual(deleted, ['th-workspace-v1']);
});

test('the portal worker deletes only its own old caches when it activates', async () => {
  const { cacheName } = await activate(path.join('portal', 'service-worker.js'), []);
  const { deleted } = await activate(path.join('portal', 'service-worker.js'), [cacheName, 'th-portal-v1', 'th-workspace-v324']);
  assert.deepEqual(deleted, ['th-portal-v1']);
});
