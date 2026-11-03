/* app-freshness.js -- keeps every installed or open copy of the Workspace
   (/tools/) and the client portal (/portal/) on the newest version, on
   every device (2026-11-03). Loaded by both surfaces, before their own
   update scripts (tools-nav-pwa.js, portal-update.js).

   WHAT IT DOES
   1. Re-registers the page's existing service worker with
      updateViaCache: 'none', so the browser's update check for
      service-worker.js always goes to the network instead of the HTTP
      cache. (GitHub Pages can't send per-file no-cache headers, so this is
      the client-side half of that.)
   2. Checks for a new version when the app comes back: visibilitychange,
      focus, pageshow (including a page restored from the back/forward
      cache, which runs no scripts on its own), coming back online, and
      every 30 minutes while it stays open and visible. iOS home-screen
      apps are resumed rather than reloaded and don't always fire
      visibilitychange, which is why focus and pageshow are covered too.
      Each check asks the worker to update and fires 'th-app-check' so the
      surface's own "is this page behind the live one" comparison runs.
   3. A server-side minimum version: /version.json (fetched no-store) holds
      minBuild. If this running copy's BUILD is lower, the page is stale no
      matter what the browser thinks. Bump BUILD here and minBuild there in
      the same PR to force everyone past a release.
   4. Stale page policy (same as the Workspace since 2026-11-02): nothing
      typed on the page -> reload into the new version straight away.
      Something typed -> never reload; the surface's ask-first prompt
      (registered through onStale) shows instead, so no form data is lost.
      A reload guard stops a reload loop if the server is somehow behind.

   Safe by construction: if anything is unsupported it quietly does less. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.thAppFreshness) return;

  var BUILD = 1; // version.json's minBuild must never be higher than this in the same commit
  var CHECK_EVERY_MS = 30 * 60 * 1000;
  var MIN_GAP_MS = 60 * 1000;
  var RELOAD_GUARD = 'th-fresh-reloaded-at';
  var RELOAD_GUARD_MS = 60 * 1000;

  var sw = navigator.serviceWorker;
  var scope = location.pathname.indexOf('/portal/') === 0 ? '/portal/' : '/';
  var dirty = false;
  var lastCheck = 0;
  var staleHandlers = [];
  var staleNotified = false;

  // Typing into a real field means there is work on the page to protect.
  // Search boxes don't count: losing a half-typed search costs nothing.
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || t.type === 'search' || t.type === 'hidden') return;
    dirty = true;
  }, true);

  function isDirty() { return dirty; }

  function reloadNow() {
    try {
      var last = Number(sessionStorage.getItem(RELOAD_GUARD) || 0);
      if (Date.now() - last < RELOAD_GUARD_MS) return false; // just reloaded for this -- don't loop
      sessionStorage.setItem(RELOAD_GUARD, String(Date.now()));
    } catch (e) { /* private mode: no guard, still reload */ }
    location.reload();
    return true;
  }

  // A surface calls this when it has confirmed its page is behind.
  function stale(reason) {
    if (!dirty) { if (reloadNow()) return 'reloaded'; }
    if (staleNotified) return 'prompted';
    staleNotified = true;
    staleHandlers.forEach(function (fn) { try { fn(reason); } catch (e) { /* ignore */ } });
    return 'prompted';
  }

  function onStale(fn) { if (typeof fn === 'function') staleHandlers.push(fn); }

  function checkMinVersion() {
    if (!window.fetch) return Promise.resolve();
    return fetch('/version.json', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && typeof data.minBuild === 'number' && data.minBuild > BUILD) stale('min-version');
      })
      .catch(function () { /* offline or blocked -- stay quiet */ });
  }

  function check(force) {
    if (document.visibilityState === 'hidden') return;
    if (navigator.onLine === false) return;
    if (!force && Date.now() - lastCheck < MIN_GAP_MS) return;
    lastCheck = Date.now();
    if (sw && sw.getRegistration) {
      sw.getRegistration(scope)
        .then(function (reg) { return reg && reg.update(); })
        .catch(function () { /* offline, or nothing new */ });
    }
    checkMinVersion();
    try { window.dispatchEvent(new Event('th-app-check')); } catch (e) { /* ignore */ }
  }

  // Point the existing registration at the network for its update checks.
  // Only touches a registration the page already has; never creates one.
  if (sw && sw.getRegistration && sw.register) {
    sw.getRegistration(scope).then(function (reg) {
      var active = reg && (reg.active || reg.waiting || reg.installing);
      if (!active || reg.updateViaCache === 'none') return;
      return sw.register(new URL(active.scriptURL).pathname, { scope: reg.scope, updateViaCache: 'none' });
    }).catch(function () { /* ignore */ });
  }

  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(false); });
  window.addEventListener('focus', function () { check(false); });
  window.addEventListener('online', function () { check(true); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) check(true); });
  setInterval(function () { check(true); }, CHECK_EVERY_MS);
  lastCheck = Date.now(); // this load came from the network already
  checkMinVersion();

  window.thAppFreshness = { BUILD: BUILD, isDirty: isDirty, stale: stale, onStale: onStale, check: check, reloadNow: reloadNow };
})();
