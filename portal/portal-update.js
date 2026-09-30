/* portal-update.js -- lets someone running the INSTALLED portal app pick
   up a new version without deleting and reinstalling it (2026-09-06).

   WHY THIS IS NEEDED
   The portal service worker serves any URL carrying a ?v= parameter
   cache-first and never revalidates it, on the reasoning that a content
   change always ships a new version string. That holds for the site, but
   an installed PWA can sit unopened for weeks and then reopen straight
   from cache, and until now the only user-facing way out of a stale copy
   was to delete the app and install it again.

   WHAT IT DOES
   1. Asks the browser to check for a new service worker on load, and
      again whenever an installed app is brought back to the foreground
      (the case that matters most -- these apps are rarely reloaded).
   2. When a new version is genuinely waiting, shows a dismissible banner
      offering to update. It never updates on its own: someone could be
      halfway through paying an invoice, and yanking the page out from
      under them to install a stylesheet change would be worse than the
      staleness it fixes.
   3. Exposes portalUpdateNow() for the explicit "Update app" button in
      Settings, which works even when no new worker was detected -- it
      clears every cache and reloads, so it is a reliable "give me the
      current version" regardless of what the browser thinks.

   Safe by construction: everything is inside try/catch, and if service
   workers are unavailable the file does nothing at all.

   REPEATING-BANNER FIX (2026-09-28) -- reported: "it pops up every time",
   the same bug the tools app had and fixed on 2026-09-24 (see
   tools-nav-pwa.js's "APP UPDATE AVAILABLE" comment for the full story).
   Root cause here was the same shape: the portal service worker's
   CACHE_NAME is re-stamped by `npm run fix-versions` whenever any
   precached file changes -- several times a day, same as the tools
   worker -- so `reg.waiting` or an `updatefound` -> installed worker was
   true on almost every open or foreground, even though the page that
   just loaded came from the network (HTML is network-first, ?v= stamps
   are fresh) and was already current. A waiting/installed worker was
   treated as "show the banner," with no check that THIS page actually
   needs it.

   Now a waiting/newly-installed worker is only a cue to CHECK: the page
   records the scripts/stylesheets it actually loaded, fetches its own
   URL fresh, and compares. The banner shows only when the live copy has
   something this page doesn't -- a real update this page is missing.
   Once shown or dismissed, this page load never checks again (the new
   version arrives on the next natural navigation anyway), and a
   foreground resume is throttled the same way the tools app throttles
   it, so this does not hammer the network on every tab switch. */
(function () {
  if (!('serviceWorker' in navigator)) return;

  var SCOPE = '/portal/';
  var BANNER_ID = 'portalUpdateBanner';
  var RELOAD_GUARD = 'th-portal-updating';
  var CHECK_THROTTLE_MS = 5 * 60 * 1000;

  var runningParts = null;
  var shown = false; // shown or dismissed: this page asks once
  var verifying = false;
  var lastCheckAt = 0;

  function getRegistration() {
    return navigator.serviceWorker.getRegistration(SCOPE);
  }

  // FNV-1a, 32-bit. Identity only, not security. Mirrors tools-nav-pwa.js's
  // thBuildHash so an inline script/style change (no URL change) still
  // counts as a real update.
  function buildHash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  // What a page document runs: its scripts and stylesheets. Works on the
  // live document and on one parsed from fetched HTML (DOMParser, where
  // nothing executes), so refs are resolved by hand against the page URL
  // rather than read from the resolved src/href properties.
  function pageBuildParts(doc, baseHref) {
    var parts = [];
    var els = doc.querySelectorAll('script, style, link[rel~="stylesheet"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var tag = el.tagName.toLowerCase();
      var ref = tag === 'link' ? el.getAttribute('href') : (tag === 'script' ? el.getAttribute('src') : null);
      if (ref) {
        try {
          var u = new URL(ref, baseHref);
          parts.push((tag === 'link' ? 'css:' : 'js:') + u.origin + u.pathname + u.search);
        } catch (e) { /* unparseable URL -- nothing to compare */ }
        continue;
      }
      var text = (el.textContent || '').trim();
      if (text) parts.push((tag === 'style' ? 'style:' : 'inline:') + buildHash(text));
    }
    return parts;
  }

  // True only when the live page has something this page didn't load.
  // Extras on this side are fine (scripts added at runtime), so this is
  // a one-way check.
  function pageIsBehind(running, live) {
    if (!live.length) return false; // not a page we can read -- don't guess
    var runningSet = {};
    for (var i = 0; i < running.length; i++) runningSet[running[i]] = true;
    for (var j = 0; j < live.length; j++) {
      if (!runningSet[live[j]]) return true;
    }
    return false;
  }

  function captureRunningParts() {
    if (!runningParts) runningParts = pageBuildParts(document, location.href);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', captureRunningParts);
  else captureRunningParts();

  function fetchLiveParts() {
    var url = location.pathname + location.search;
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (res) {
      var type = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || type.indexOf('text/html') === -1) return [];
      return res.text().then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        return pageBuildParts(doc, location.href);
      });
    });
  }

  // A waiting/newly-installed worker is only a cue to verify -- see the
  // header comment. Shows the banner only if this page is genuinely
  // behind the live copy.
  function verifyAndMaybeShow() {
    if (shown || verifying) return;
    captureRunningParts();
    verifying = true;
    fetchLiveParts()
      .then(function (liveParts) {
        if (shown || !pageIsBehind(runningParts, liveParts)) return;
        shown = true;
        showBanner();
      })
      .catch(function () { /* offline or blocked -- stay quiet */ })
      .then(function () { verifying = false; });
  }

  function showBanner() {
    if (document.getElementById(BANNER_ID)) return;

    var bar = document.createElement('div');
    bar.className = 'portal-update-banner';
    bar.id = BANNER_ID;
    bar.setAttribute('role', 'status');

    var text = document.createElement('span');
    text.className = 'portal-update-text';
    text.textContent = 'A new version of the portal is available.';

    var update = document.createElement('button');
    update.type = 'button';
    update.className = 'btn blue portal-update-btn';
    update.textContent = 'Update';
    update.addEventListener('click', function () {
      update.disabled = true;
      update.textContent = 'Updating...';
      window.portalUpdateNow();
    });

    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'portal-update-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss update notice');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', function () { shown = true; bar.remove(); });

    bar.appendChild(text);
    bar.appendChild(update);
    bar.appendChild(dismiss);
    document.body.appendChild(bar);
  }

  /* Clears the portal's own caches, tells any waiting worker to take
     over, then reloads. Deliberately does the cache clear itself rather
     than trusting the worker swap alone: a ?v= URL that has not changed
     would otherwise still be served from the old cache-first entry.
     Only th-portal-* (2026-09-30): it used to delete every cache on the
     origin, which threw away the Workspace's offline copy (th-workspace-*)
     on any device used for both. */
  window.portalUpdateNow = function portalUpdateNow() {
    var done = function () {
      try { sessionStorage.setItem(RELOAD_GUARD, '1'); } catch (e) { /* private mode */ }
      window.location.reload();
    };

    var work = [];

    if (window.caches && caches.keys) {
      work.push(
        caches.keys()
          .then(function (names) {
            return Promise.all(names
              .filter(function (n) { return n.indexOf('th-portal-') === 0; })
              .map(function (n) { return caches.delete(n); }));
          })
          .catch(function () { /* proceed regardless -- a reload still helps */ })
      );
    }

    work.push(
      getRegistration()
        .then(function (reg) {
          if (reg && reg.waiting) {
            try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* ignore */ }
          }
        })
        .catch(function () { /* ignore */ })
    );

    // Never let a hung promise strand someone on "Updating..."
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 2500); });
    Promise.race([Promise.all(work), timeout]).then(done, done);
  };

  function checkForUpdate() {
    if (shown) return;
    getRegistration().then(function (reg) {
      if (!reg) return;

      if (reg.waiting && navigator.serviceWorker.controller) {
        verifyAndMaybeShow();
        return;
      }

      reg.update().catch(function () { /* offline, or nothing new */ });

      reg.addEventListener('updatefound', function () {
        var incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', function () {
          // controller present means this is an update, not a first install
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            verifyAndMaybeShow();
          }
        });
      });
    }).catch(function () { /* ignore */ });
  }

  // Skip the check on the load immediately following an update, so the
  // banner cannot reappear on the very page the update produced.
  var justUpdated = false;
  try {
    justUpdated = sessionStorage.getItem(RELOAD_GUARD) === '1';
    if (justUpdated) sessionStorage.removeItem(RELOAD_GUARD);
  } catch (e) { /* private mode */ }

  if (!justUpdated) {
    if (document.readyState === 'complete') checkForUpdate();
    else window.addEventListener('load', checkForUpdate);
  }
  lastCheckAt = Date.now(); // this load's own check just ran (or was skipped)

  // An installed app is usually resumed, not reloaded, so this is the
  // check that actually catches new versions in practice. Throttled the
  // same way the tools app throttles its own foreground check, so
  // switching tabs/apps repeatedly does not re-fetch on every switch.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || shown) return;
    if (Date.now() - lastCheckAt < CHECK_THROTTLE_MS) return;
    lastCheckAt = Date.now();
    checkForUpdate();
  });
})();
