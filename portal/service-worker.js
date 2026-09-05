// Service worker for the client portal PWA (2026-09-04), requested
// directly: "lets build push notifications offline support."
//
// A genuinely separate file from the internal tools' own
// /service-worker.js, not a shared one -- a service worker's scope
// is determined by where it's served from, and the portal's own
// manifest.json already declares scope: "/portal/". Registering a
// second service worker from here, scoped to /portal/, means it
// never competes with or overrides the tools PWA's own registration
// at the site root, and vice versa. Same underlying strategy as that
// file, adapted for the portal's own page set:
//
//   - Versioned assets (any URL with a ?v= param): cache-first.
//     Immutable once published -- a content change always comes with
//     a new version string, so the same URL never needs re-fetching.
//   - Everything else (the portal's own HTML pages): network-first.
//     Online, always fetch fresh; offline, fall back to whatever was
//     last successfully cached so the app can still open and show
//     existing data rather than failing to load at all -- the actual
//     point of "offline support" here. Cross-origin requests
//     (Supabase API calls) are never touched -- serving stale
//     business data as current would be actively misleading, not
//     helpful, so those keep failing exactly as they already did if
//     genuinely offline.
//
// Bump CACHE_NAME whenever a file in PRECACHE_URLS changes, even if
// every ?v= reference was updated too -- see the tools service
// worker's own header comment for the full reasoning on why that
// matters (a real incident, several times over, of a file changing
// without this bump meaning devices kept serving stale content
// indefinitely).
// Bumped 2026-09-04 (v3 -> v4): pull-to-refresh and the offline
// indicator changed portal-app.js/portal-app.css and all 8 precached
// HTML pages (three gained the script tag for the first time; five
// gained the pull-to-refresh wire-up). Same reasoning as every prior
// bump in this file's history.
// Bumped 2026-09-05 (v4 -> v5): biometric app lock changed
// portal-app.js/portal-app.css and 6 precached HTML pages
// (home/dashboard/jobs/quotes/work-orders gained the gate call;
// settings gained the toggle UI and its own render function). Same
// reasoning as every prior bump in this file's history.
// Bumped 2026-09-05 (v5 -> v6): push-notifications.js changed -- the
// same real duplicate-subscription fix described in the internal
// tools service worker's own comment on this date.
// Bumped 2026-09-05 (v6 -> v7): portal-app.js changed -- automatic
// error capture added (requested directly: "future proof this...
// what other layers can we add"), catching every real JS error on
// the portal the same way the internal tools already do.
const CACHE_NAME = 'th-portal-v7';
const PRECACHE_URLS = [
  '/portal/home.html', '/portal/dashboard.html', '/portal/jobs.html', '/portal/quotes.html',
  '/portal/work-orders.html', '/portal/settings.html', '/portal/login.html', '/portal/set-password.html',
  '/portal/manifest.json',
  '/portal/portal-app.css',
  '/portal/portal-app.js',
  '/styles.css', '/business-hours.js',
  '/portal/push-notifications.js',
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

  // { cache: 'reload' } forces a real revalidation with the server on
  // every request rather than being silently satisfied from the
  // browser's own underlying HTTP cache -- see the tools service
  // worker's own comment on this exact fix, found there after a real
  // stale-content incident.
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
// Identical shape to the tools service worker's own push/
// notificationclick handlers -- same underlying Push API, just a
// different default landing page (a client's own home, not
// Workspace).
self.addEventListener('push', (event) => {
  let data = { title: 'Triple H Enterprises', body: 'You have a new notification.' };
  try { if (event.data) data = event.data.json(); } catch (e) { /* fall back to the default above */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/images/icon-192.png',
      badge: '/images/icon-192.png',
      data: { url: data.url || '/portal/home.html' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/portal/home.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
