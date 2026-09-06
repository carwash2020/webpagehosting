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
   workers are unavailable the file does nothing at all. */
(function () {
  if (!('serviceWorker' in navigator)) return;

  var SCOPE = '/portal/';
  var BANNER_ID = 'portalUpdateBanner';
  var RELOAD_GUARD = 'th-portal-updating';

  function getRegistration() {
    return navigator.serviceWorker.getRegistration(SCOPE);
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
    dismiss.addEventListener('click', function () { bar.remove(); });

    bar.appendChild(text);
    bar.appendChild(update);
    bar.appendChild(dismiss);
    document.body.appendChild(bar);
  }

  /* Clears every cache this origin holds, tells any waiting worker to take
     over, then reloads. Deliberately does the cache clear itself rather
     than trusting the worker swap alone: a ?v= URL that has not changed
     would otherwise still be served from the old cache-first entry. */
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
            return Promise.all(names.map(function (n) { return caches.delete(n); }));
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
    getRegistration().then(function (reg) {
      if (!reg) return;

      if (reg.waiting && navigator.serviceWorker.controller) {
        showBanner();
        return;
      }

      reg.update().catch(function () { /* offline, or nothing new */ });

      reg.addEventListener('updatefound', function () {
        var incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', function () {
          // controller present means this is an update, not a first install
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            showBanner();
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

  // An installed app is usually resumed, not reloaded, so this is the
  // check that actually catches new versions in practice.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
})();
