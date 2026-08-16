// Service worker for the Triple H Workspace PWA.
//
// This project deliberately had NO caching before -- a styles.css update
// once looked like the whole site was broken purely from a stale cached
// copy, and the fix at the time was to cache nothing at all. That's
// being reversed here now that the project is more stable, but the
// SAME underlying risk still needs guarding against, so this uses a
// network-first strategy rather than cache-first:
//
//   - Online: every request still goes to the network first, exactly
//     like before this file existed. You always get the current
//     version. The cache is only ever updated as a side effect of a
//     successful network fetch, never served ahead of one.
//   - Offline (a dead zone on a job site, no signal): only THEN does
//     this fall back to whatever was last successfully cached, so the
//     app can still open and show existing local data instead of
//     failing to load entirely.
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
const CACHE_NAME = 'th-workspace-v5';
const PRECACHE_URLS = [
  '/tools/workspace.html', '/tools/job-tracker.html', '/tools/invoice-generator.html', '/tools/contract-generator.html',
  '/tools/calendar.html', '/tools/route-planner.html', '/tools/review-request.html', '/tools/contact-card.html',
  '/tools/job-cost-lookup.html', '/tools/expense-logger.html', '/tools/login.html',
  // Added 2026-08-14 -- these 3 pages existed before but were never added
  // to the precache list, so they wouldn't open at all with no signal.
  // The Appliance Wiki (parts-reference.html) in particular is exactly
  // the kind of page worth having offline -- looking up a part number
  // in a basement with no signal is the scenario this cache exists for.
  '/tools/dev-tools.html', '/tools/parts-reference.html', '/tools/runway-dashboard.html',
  '/styles.css', '/tools/sync.js', '/tools/auth.js', '/tools/tools-common.js', '/tools/manifest.json',
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

  event.respondWith(
    fetch(event.request)
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
      data: { url: data.url || '/workspace.html' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/workspace.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
