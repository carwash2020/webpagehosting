// Three small reliability fixes (2026-09-30):
// - Graveyard restore puts invoices, quotes, contracts and jobs back in
//   their relational tables (deleting took them out; Finance, Runway and
//   the overdue alert read `invoices`).
// - Settings' two-factor card no longer hangs on "Loading..." when no
//   service worker ever registers.
// - The portal's Update button clears only the portal's caches, not the
//   Workspace's offline copy.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const DEV = read('tools', 'dev-tools.html');
const SETTINGS = read('tools', 'settings.html');
const PUSH = read('tools', 'push-notifications.js');
const UPDATE = read('portal', 'portal-update.js');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const head = src.slice(Math.max(0, start - 6), start) === 'async ' ? 'async ' : '';
  return head + src.slice(start, i);
}
function extractConst(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, name);
  const end = src.indexOf('\n  };', start) + 5;
  return src.slice(start, end);
}

function graveyardWindow(entry) {
  const w = new JSDOM('<!doctype html>', { runScripts: 'outside-only' }).window;
  w.__calls = [];
  w.__store = {};
  w.eval(`
    var thLoadGraveyard = () => [__entry];
    var thRead = (k, d) => __store[k] || d;
    var thWrite = (k, v) => { __store[k] = v; __calls.push(['write', k]); };
    var thWriteWiki = thWrite;
    var thLiftTombstone = (k, id) => __calls.push(['lift', k, id]);
    var thRemoveFromGraveyard = () => {};
    var renderGraveyard = () => {};
    var showToast = () => {};
    var showAlert = async () => {};
    var mirrorInvoiceToRelational = (r) => __calls.push(['mirror', 'invoices', r.id]);
    var mirrorQuoteToRelational = (r) => __calls.push(['mirror', 'quotes', r.id]);
    var mirrorContractToRelational = (r) => __calls.push(['mirror', 'contracts', r.id]);
    var mirrorJobsToRelational = (list) => __calls.push(['mirror', 'jobs', list.map((j) => j.id).join()]);
  `);
  w.__entry = entry;
  w.eval(extractConst(DEV, 'GRAVEYARD_TYPE_CONFIG') + '\n' + extractConst(DEV, 'GRAVEYARD_RELATIONAL_MIRROR') + '\n'
    + extractFn(DEV, 'restoreFromGraveyard') + '\nwindow.restoreFromGraveyard = restoreFromGraveyard;');
  return w;
}

test('Graveyard: restoring an invoice, quote, contract or job puts its relational row back', async () => {
  for (const [type, table] of [['invoice', 'invoices'], ['quote', 'quotes'], ['contract', 'contracts'], ['job', 'jobs']]) {
    const w = graveyardWindow({ graveyardId: 'g1', recordType: type, record: { id: 42, invoiceNumber: '1001' } });
    await w.restoreFromGraveyard('g1');
    const calls = w.__calls.map((c) => c.join(':'));
    assert.ok(calls.some((c) => c.startsWith('write:')), `${type} written back`);
    assert.ok(calls.includes(`mirror:${table}:42`), `${type} mirrored to ${table}: ${calls}`);
    assert.ok(calls.indexOf(`mirror:${table}:42`) > calls.findIndex((c) => c.startsWith('lift:')), 'after the tombstone is lifted');
  }
  // Types with no relational table don't call any mirror.
  const w = graveyardWindow({ graveyardId: 'g1', recordType: 'expense', record: { id: 7 } });
  await w.restoreFromGraveyard('g1');
  assert.ok(!w.__calls.some((c) => c[0] === 'mirror'));
});

test('Settings: the two-factor card is drawn before the push check', () => {
  const mfa = SETTINGS.indexOf('    await renderMfaSettingsCard();\n\n    // Notifications');
  const push = SETTINGS.indexOf('    await refreshSettingsPushState();\n  } catch (initError)');
  assert.ok(mfa > 0 && push > mfa, 'renderMfaSettingsCard() is awaited first');
});

function pushWindow(sw) {
  const w = new JSDOM('<!doctype html>', { runScripts: 'outside-only' }).window;
  Object.defineProperty(w.navigator, 'serviceWorker', { value: sw, configurable: true });
  w.PushManager = function () {};
  w.Notification = { permission: 'default', requestPermission: async () => 'granted' };
  w.eval(PUSH.replace(/^const VAPID_PUBLIC_KEY/m, 'var VAPID_PUBLIC_KEY'));
  return w;
}

test('push: reading the state never waits on a worker that never registers', async () => {
  const never = new Promise(() => {});
  const w = pushWindow({ ready: never, getRegistration: async () => undefined });
  const result = await Promise.race([
    w.eval('getExistingPushSubscription()'),
    new Promise((r) => setTimeout(() => r('HUNG'), 500)),
  ]);
  assert.equal(result, null, 'no registration, no subscription -- straight away');
  assert.equal(await w.eval('isPushEnabled()'), false);
  // With a registration it still reads the real subscription.
  const sub = { endpoint: 'https://push.example/1' };
  const w2 = pushWindow({ ready: never, getRegistration: async () => ({ pushManager: { getSubscription: async () => sub } }) });
  assert.equal(await w2.eval('isPushEnabled()'), true);
});

test('push: Enable gives up with a clear message instead of spinning forever', async () => {
  const w = pushWindow({ ready: new Promise(() => {}), getRegistration: async () => undefined });
  w.setTimeout = (fn) => { fn(); return 0; }; // the 10s wait, instantly
  const r = await w.eval('enablePushNotifications()');
  assert.equal(r.ok, false);
  assert.match(r.error, /background helper hasn't started/);
});

test('portal Update clears only th-portal-* caches, never the Workspace\'s', async () => {
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://www.triplehenterprisesllc.biz/portal/settings.html' }).window;
  const deleted = [];
  w.caches = {
    keys: async () => ['th-portal-v182', 'th-portal-v181', 'th-workspace-v379', 'something-else'],
    delete: async (n) => { deleted.push(n); return true; },
  };
  Object.defineProperty(w.navigator, 'serviceWorker', {
    value: { getRegistration: async () => null, addEventListener() {}, controller: null },
    configurable: true,
  });
  w.eval(UPDATE);
  assert.equal(typeof w.portalUpdateNow, 'function');
  w.portalUpdateNow();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(deleted.sort(), ['th-portal-v181', 'th-portal-v182']);
  w.close();
});
