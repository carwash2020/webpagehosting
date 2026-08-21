// Service worker for the Triple H Workspace PWA.
//
// This project deliberately had NO caching before -- a styles.css update
// once looked like the whole site was broken purely from a stale cached
// copy, and the fix at the time was to cache nothing at all. That's
// being reversed here now that the project is more stable, but the
// SAME underlying risk still needs guarding against, so requests are
// split into two different strategies depending on what's being asked
// for:
//
//   - Versioned assets (any URL with a ?v= param -- every shared JS/CSS
//     file): cache-first. These are IMMUTABLE once published -- the
//     whole point of the version string is that a content change always
//     comes with a NEW version, so the exact same URL never needs
//     re-fetching to pick up fresh content. A cache hit here needs zero
//     network round-trip at all, which matters more than it used to:
//     most tool pages went from ~5-6 shared-file requests to 9-10 after
//     splitting tools-common.js and styles.css into focused pieces
//     (2026-08-20), and forcing every one of those onto the network on
//     every single page load was a real, compounding slowdown.
//   - Everything else (HTML pages, anything without a ?v=): network-
//     first, same as before this fix. Online, every request still goes
//     to the network first -- you always get the current version, and
//     the cache only updates as a side effect of a successful fetch,
//     never served ahead of one. Offline (a dead zone on a job site, no
//     signal), only THEN does this fall back to whatever was last
//     successfully cached, so the app can still open and show existing
//     local data instead of failing to load entirely.
//
// Cross-origin requests (Supabase API calls) are never touched here --
// those always go straight to the network with no caching, since
// serving stale business data as if it were current would be actively
// misleading, not helpful. If Supabase is unreachable, those calls
// should keep failing exactly as they already did; this only helps the
// app SHELL (the pages themselves) still open.

// Bumped 2026-08-16: auth.js has had two real fixes since the last
// bump (2026-08-14) -- the session-refresh race that intermittently
// hid the Dev Tools tile, and the getAuthToken() hardening against a
// malformed stored token -- and CACHE_NAME was never bumped for
// either one. auth.js is in the precache list below, so every device
// that installed the service worker before either fix could still be
// silently running the OLD cached copy indefinitely, no matter how
// many times the page itself is refreshed -- refreshing a page doesn't
// bypass a service worker's own cache the way a hard cache-clear does.
// This is exactly the trigger that forces every client to actually
// fetch fresh files instead of continuing to serve what they already
// have stored.
// Bumped 2026-08-16 (again, same day): dev-tools.html changed again
// (added exact-value diagnostic logging to the advisor-health request,
// after a fix confirmed via cache-bump v3 didn't resolve the reported
// error) -- and dev-tools.html is also in the precache list below.
// Same reasoning as the v2->v3 bump just above: without bumping this
// again, THIS change would hit the identical "device never actually
// gets it" problem it was meant to help diagnose.
// Bumped 2026-08-16 (third time today): dev-tools.html changed again --
// found the diagnostic added in v4 WAS actually firing correctly, but
// the Client errors panel display only renders once at page load and
// wasn't refreshing itself after a new entry got logged mid-session.
// Screenshots confirmed the new code was already live (a new hint line
// in the error text was showing) but the panel still only showed old
// entries from before -- not a caching problem this time, a real bug
// in the render logic, now fixed by calling renderClientErrorLog()
// immediately after logging. Still bumping this so that fix reaches
// devices without needing yet another round-trip to explain why it
// didn't show up.
// Bumped again (2026-08-20): light mode for the internal tools app,
// tucked into Settings -- 17 HTML pages changed (the anti-flash theme
// snippet on all of them, plus the toggle itself on settings.html and
// its own separate light override on runway-dashboard.html). Also
// fixing a genuine, pre-existing gap found while already touching this
// list: settings.html itself was never added to the precache list at
// all, unlike every other real app page -- same class of oversight
// already documented and fixed twice above for other pages.
// Bumped again (2026-08-20): desktop-width layout improvements across
// 15 HTML pages -- efficient on phone stays exactly as it was,
// efficient on computer gets more room to use.
// Bumped again (2026-08-20): moved the ambient background gradient
// from body.th-tool-page to html, fixing the black-bar/gradient-
// positioning bug found right after the desktop-width work above.
// Bumped again (2026-08-20): desktop sidebar navigation, requested
// directly -- runway-dashboard.html (precached) gained its own static
// copy of the sidebar.
// Bumped again (2026-08-20): desktop board/table view added to Job
// Tracker, requested directly following the sidebar work above.
// Bumped again (2026-08-20): fixed the black-bar-on-the-right bug
// found from a direct screenshot -- 16 HTML pages plus
// styles-tools.css (all precached) genuinely changed.
// Bumped again (2026-08-20): header now spans the full width next to
// the sidebar on desktop, requested directly from a screenshot -- 14
// HTML pages plus styles-tools.css (all precached) genuinely changed.
const CACHE_NAME = 'th-workspace-v18';
const PRECACHE_URLS = [
  '/tools/workspace.html', '/tools/job-tracker.html', '/tools/invoice-generator.html', '/tools/contract-generator.html',
  '/tools/calendar.html', '/tools/route-planner.html', '/tools/review-request.html', '/tools/contact-card.html',
  '/tools/job-cost-lookup.html', '/tools/expense-logger.html', '/tools/login.html',
  // Added 2026-08-14 -- these 3 pages existed before but were never added
  // to the precache list, so they wouldn't open at all with no signal.
  // The Appliance Wiki (parts-reference.html) in particular is exactly
  // the kind of page worth having offline -- looking up a part number
  // in a basement with no signal is the scenario this cache exists for.
  '/tools/dev-tools.html', '/tools/site-content.html', '/tools/parts-reference.html', '/tools/runway-dashboard.html',
  // Added 2026-08-20 -- same gap as above, these 3 pages (all from the
  // structural rework's Client/Job Detail views and the Finance split)
  // existed live but were never added here either.
  '/tools/finance.html', '/tools/client-detail.html', '/tools/job-detail.html',
  // Added 2026-08-20 -- same gap yet again, found while already
  // touching this list for the light-mode work above.
  '/tools/settings.html',
  // Bug fix (2026-08-20): tools-common.js no longer exists -- it was
  // split into 4 focused files (structural item #42). cache.addAll()
  // fails ATOMICALLY: if even one URL in this list 404s, NONE of the
  // files get precached, not just the missing one. Leaving a reference
  // to a retired file here would have silently broken offline support
  // for this entire app, not just for that one script. data-layer.js
  // (added in an earlier push) was also missing from this list --
  // found and fixed at the same time, while already touching this list
  // for the same reason.
  '/styles.css', '/tools/styles-tools.css', '/tools/dev-tools-shared.js', '/tools/sync.js', '/tools/auth.js', '/tools/data-layer.js',
  '/tools/tools-effects.js', '/tools/tools-dialogs.js', '/tools/tools-media-sharing.js', '/tools/tools-nav-pwa.js',
  '/tools/manifest.json',
  // Added 2026-08-14 -- same gap as above, these 2 scripts were live but unlisted.
  '/tools/qrcode-lib.js', '/tools/push-notifications.js',
  '/images/logo-signature-orange.webp', '/images/icon-192.png', '/images/icon-512.png', '/images/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => { /* a page not being reachable at install time shouldn't block install */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never intercept Supabase or other cross-origin calls

  // Performance fix (2026-08-20): a request carrying a ?v= cache-bust
  // param is for an IMMUTABLE resource -- the whole point of that param
  // is that a content change always comes with a NEW version string, so
  // the exact same URL never needs re-fetching to pick up fresh content.
  // These are safe (and much faster) to serve cache-first: a cache hit
  // needs zero network round-trip at all. Only requests WITHOUT a ?v=
  // (HTML pages, and anything else) still need the network-first-with-
  // reload behavior below, since guaranteeing fresh HTML after a deploy
  // is what that behavior exists to protect -- an HTML page's own URL
  // doesn't change when its content does.
  if (url.searchParams.has('v')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((networkResponse) => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        });
      })
    );
    return;
  }

  // Bug fix (2026-08-20): fetch(event.request) alone does NOT guarantee
  // the network-first behavior described in the comment above -- it's
  // still subject to the browser's own HTTP cache underneath this
  // service worker, and could be silently satisfied from disk with no
  // real round-trip to the server at all, depending on what cache
  // headers the response happened to carry. { cache: 'reload' } forces
  // an actual revalidation with the server on every request, which is
  // what "network-first" was always meant to guarantee here. Found
  // after a page failed to show new content despite a confirmed-live
  // deploy -- exactly the failure mode this whole file exists to
  // prevent.
  const networkRequest = new Request(event.request, { cache: 'reload' });

  event.respondWith(
    fetch(networkRequest)
      .then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// ---------- push notifications ----------
self.addEventListener('push', (event) => {
  let data = { title: 'Triple H Workspace', body: 'You have a new notification.' };
  try { if (event.data) data = event.data.json(); } catch (e) { /* fall back to the default above */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/images/icon-192.png',
      badge: '/images/icon-192.png',
      data: { url: data.url || '/tools/workspace.html' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/tools/workspace.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
