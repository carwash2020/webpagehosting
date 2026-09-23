// Security audit (2026-09-23): both service workers opened whatever URL a
// push payload carried when its notification was clicked. Every real
// sender passes a same-origin path, but until the same audit Send-Push
// accepted the public anon key, so anyone could have pushed a client a
// notification that opened an arbitrary site (a phishing page wearing
// the Triple H app's own notification). The caller check is fixed; this
// pins the worker-side guard: a click only ever opens a page on this site.
//
// These run each real service worker file in a sandbox with a stubbed
// `self`, fire a notificationclick at it, and record what it opens.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const ORIGIN = 'https://www.triplehenterprisesllc.biz';

const WORKERS = [
  { file: 'service-worker.js', fallback: '/tools/workspace.html', legit: '/tools/review-request.html' },
  { file: 'portal/service-worker.js', fallback: '/portal/home.html', legit: '/portal/jobs.html' },
];

function loadWorker(file, openClients = []) {
  const handlers = {};
  const opened = [];
  const focused = [];
  const self = {
    location: new URL(`${ORIGIN}/${file}`),
    addEventListener: (type, fn) => { handlers[type] = fn; },
    clients: {
      matchAll: async () => openClients.map((url) => ({ url, focus: async () => { focused.push(url); } })),
      openWindow: async (url) => { opened.push(url); },
    },
    registration: { showNotification: async () => {} },
    skipWaiting: () => {},
  };
  const context = vm.createContext({ self, URL, caches: {}, fetch: async () => new Response(''), Response, console });
  vm.runInContext(fs.readFileSync(repo(file), 'utf8'), context, { filename: file });
  assert.equal(typeof handlers.notificationclick, 'function', `${file} must register a notificationclick handler`);

  async function click(data) {
    let pending;
    handlers.notificationclick({
      notification: { data, close() {} },
      waitUntil: (p) => { pending = p; },
    });
    await pending;
  }
  return { click, opened, focused };
}

for (const w of WORKERS) {
  test(`${w.file}: a same-origin path from a real sender still opens that page`, async () => {
    const { click, opened } = loadWorker(w.file);
    await click({ url: w.legit });
    assert.deepEqual(opened, [w.legit]);
  });

  test(`${w.file}: an absolute URL on this site is kept, reduced to its path`, async () => {
    const { click, opened } = loadWorker(w.file);
    await click({ url: `${ORIGIN}${w.legit}?tab=2#latest` });
    assert.deepEqual(opened, [`${w.legit}?tab=2#latest`]);
  });

  test(`${w.file}: no url falls back to the default landing page`, async () => {
    const { click, opened } = loadWorker(w.file);
    await click(undefined);
    await click({});
    assert.deepEqual(opened, [w.fallback, w.fallback]);
  });

  for (const hostile of [
    'https://evil.example/login',
    '//evil.example/login',
    'http://www.triplehenterprisesllc.biz/portal/home.html',
    'https://www.triplehenterprisesllc.biz.evil.example/',
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
  ]) {
    test(`${w.file}: a push carrying ${JSON.stringify(hostile)} opens the default page instead`, async () => {
      const { click, opened } = loadWorker(w.file);
      await click({ url: hostile });
      assert.deepEqual(opened, [w.fallback]);
    });
  }

  test(`${w.file}: an already-open tab on the target page is focused rather than a new one opened`, async () => {
    const { click, opened, focused } = loadWorker(w.file, [`${ORIGIN}${w.legit}`]);
    await click({ url: w.legit });
    assert.deepEqual(focused, [`${ORIGIN}${w.legit}`]);
    assert.deepEqual(opened, []);
  });

  test(`${w.file}: a hostile url can't be used to focus an open tab on another site either`, async () => {
    const { click, opened, focused } = loadWorker(w.file, ['https://evil.example/login']);
    await click({ url: 'https://evil.example/login' });
    assert.deepEqual(focused, []);
    assert.deepEqual(opened, [w.fallback]);
  });
}

// Every sender in the repo uses a same-origin path, so the guard can't
// turn a real notification into the fallback.
test('every push url set by an edge function is a same-origin path', () => {
  const dir = repo('edge-functions');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\burl:\s*"([^"]*)"/g)) {
      if (!m[1].startsWith('/') || m[1].startsWith('//')) offenders.push(`${f}: ${m[1]}`);
    }
    for (const m of src.matchAll(/sendClientPush\([^)]*?,\s*"([^"]+)"\s*\)/g)) {
      if (!m[1].startsWith('/') || m[1].startsWith('//')) offenders.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
