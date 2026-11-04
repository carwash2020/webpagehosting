// Handoff 2026-11-03 §5: "Portal shows a persistent 'You're offline.
// Showing saved data.' banner even while online. Fix: the banner must
// reflect actual connectivity, and must not persist when online." Runs the
// real portal-app.js in jsdom with navigator.onLine and the network stubbed.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'portal', 'portal-app.js'), 'utf8');
const windows = [];
after(() => { for (const w of windows) { try { w.close(); } catch (e) { /* closed */ } } });

function page({ onLine, network }) {
  const probes = [];
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only', url: 'https://www.triplehenterprisesllc.biz/portal/home.html',
    beforeParse(w) {
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => onLine.value });
      w.fetch = (url, init) => { probes.push({ url: String(url), init }); return network.up ? Promise.resolve({ type: 'opaque' }) : Promise.reject(new TypeError('Failed to fetch')); };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    },
  });
  windows.push(dom.window);
  dom.window.eval(APP);
  return { w: dom.window, probes, banner: () => dom.window.document.getElementById('offlinePortalBanner') };
}
const tick = () => new Promise((r) => setTimeout(r, 10));

test('online: no banner, and no probe needed', async () => {
  const p = page({ onLine: { value: true }, network: { up: true } });
  await tick();
  assert.equal(p.banner().hidden, true);
  assert.equal(p.probes.length, 0);
});

test('the browser SAYS offline but the network works (the audit\'s case): a real request succeeds, so no banner', async () => {
  const p = page({ onLine: { value: false }, network: { up: true } });
  await tick();
  assert.equal(p.probes.length, 1);
  assert.match(p.probes[0].url, /^https:\/\/csvfqdjuobylgafgolho\.supabase\.co\/auth\/v1\/health\?ping=\d+$/);
  assert.equal(p.probes[0].init.mode, 'no-cors');
  assert.equal(p.probes[0].init.cache, 'no-store');
  assert.equal(p.banner().hidden, true);
  assert.equal(p.w.portalIsReallyOffline(), false);
});

test('really offline: the banner shows, says only what is true, and goes the moment the browser is back online', async () => {
  const onLine = { value: false };
  const p = page({ onLine, network: { up: false } });
  await tick();
  assert.equal(p.banner().hidden, false);
  assert.equal(p.banner().textContent, "You're offline. New information won't load until you're back online.");
  assert.doesNotMatch(p.banner().textContent, /saved data/, 'nothing "saved" is being shown: Supabase data is never cached');
  assert.equal(p.w.portalIsReallyOffline(), true);
  onLine.value = true;
  p.w.dispatchEvent(new p.w.Event('online'));
  assert.equal(p.banner().hidden, true);
  assert.equal(p.w.portalIsReallyOffline(), false);
});

test('the status dot uses the same confirmed state and the same honest words', () => {
  assert.match(APP, /if \(typeof portalIsReallyOffline === 'function' && portalIsReallyOffline\(\)\) return 'offline';/);
  assert.doesNotMatch(APP, /Showing saved data/);
});
