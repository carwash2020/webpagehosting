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
// Bumped 2026-09-05 (v7 -> v8): settings.html changed -- collapsible
// sections added (requested directly: "we need to revamp the
// settings it still looks a little much"), precached under its bare
// path.
// Bumped 2026-09-05 (v8 -> v9): the iOS Safari zoom-on-focus fix
// (invoice-generator.html only, earlier the same day) was extended
// to every one of the 8 precached portal pages after a comprehensive
// scan found the identical bug on all of them, including a shared
// "Report a problem" textarea present on every single one.
// Bumped 2026-09-05 (v9 -> v10): dashboard.html changed -- fixed a
// real reported bug ("it puts the paid stamp right over the total
// amount") in the invoice/receipt PDF generator.
// Bumped 2026-09-06 (v10 -> v11): a run of visual work changed
// /styles.css repeatedly and added /portal/portal-polish.css, and the 8
// precached portal pages each gained a stylesheet link -- none of which
// bumped this constant at the time. That is exactly the failure this
// file's header warns about: because ?v= URLs are served cache-first and
// never revalidated, installed apps were pinned to the stylesheet cached
// under the old ?v= string and could not pick up any of it. Bumping the
// cache name purges every stale entry on activate. The new
// /portal/portal-update.js gives people a way out of this situation
// without reinstalling if it ever recurs.
// Bumped 2026-09-06 (v11 -> v12): portal-polish.css changed again
// (quote/work-order status colours, the request progress track, and
// print styles for quotes and work orders). It is in PRECACHE_URLS, and
// this file's rule is to bump on any such change even when the ?v=
// reference was updated too.
// Bumped 2026-09-06 (v12 -> v13): portal-polish.css changed again
// (widened the surface-elevation token range for .portal-page, matching
// the tool suite's equivalent fix). Precached under its bare path.
// Bumped 2026-09-06 (v13 -> v14): portal-polish.css changed again
// (matching button/icon redesign for .btn.orange/.btn.blue/.secondary-btn/
// .small-btn/.portal-icon-btn/.help-actions a). Precached under its bare path.
// Bumped 2026-09-06 (v14 -> v15): portal-polish.css changed again (faint
// drafting-grid background on login.html/set-password.html). Precached
// under its bare path.
// Bumped 2026-09-06 (v15 -> v16): the same type-system change. /styles.css
// and /portal/portal-polish.css are both in PRECACHE_URLS and both changed.
// Same reasoning as every prior bump in this file's history.
// Bumped 2026-09-06 (v16 -> v17): the same <html> inline-style fix as the
// tools service worker's own comment on this date, applied to all 8
// precached portal pages for consistency -- their own ambient gradient
// lives on body.portal-page rather than html, so they were never actually
// broken by this, but they carry the identical hazard otherwise.
// Bumped 2026-09-07 (v17 -> v18): portal-polish.css, home.html and
// work-orders.html all changed, and all three are in PRECACHE_URLS.
// portal-polish.css: the .wo-hint all-caps fix, the primary treatment
// for "Request Work" on the home help card, and the tighter collapsed
// .set-card rows on settings. home.html: the stat-card labels now
// pluralize off their count, and "Request Work" carries .primary.
// work-orders.html: the schedule toggle groups with the urgency
// question above it. Same reasoning as every prior bump in this file's
// history.
// Bumped 2026-09-07 (v18 -> v19): portal-polish.css and set-password.html
// changed, both in PRECACHE_URLS. portal-polish.css: "View details" on the
// invoice and quote cards was a bare <details>/<summary> rendering the
// browser's own disclosure triangle -- the one raw platform widget left in
// the app, a few hundred pixels from Settings' custom chevron doing the
// identical job; it now uses that same chevron, rotation and easing. Also
// adds .login-hint. set-password.html: the 8-character rule is stated on
// the field instead of only after a failed submit, and the length check
// now runs before the mismatch check. Same reasoning as every prior bump
// in this file's history.
// Bumped 2026-09-07 (v19 -> v20): home.html and jobs.html both changed,
// both in PRECACHE_URLS. home.html: every stat card and attention row
// gained an icon, reusing the exact SVG paths already established by
// this page's own bottom nav. jobs.html: the warranty pill and warranty
// overview rows gained a small ring showing days-left as a fraction of
// the 30-day window, not just the number as text -- driven off the same
// real per-job numbers already computed here, no invented data. Same
// reasoning as every prior bump in this file's history.
// Bumped 2026-09-07 (v20 -> v21): dashboard.html changed, in
// PRECACHE_URLS. Added a paid-vs-outstanding ring above the invoice
// list -- summed from the exact same `invoices` array the existing
// Outstanding/Paid section split already reads, no separate figure.
const CACHE_NAME = 'th-portal-v21';
const PRECACHE_URLS = [
  '/portal/home.html', '/portal/dashboard.html', '/portal/jobs.html', '/portal/quotes.html',
  '/portal/work-orders.html', '/portal/settings.html', '/portal/login.html', '/portal/set-password.html',
  '/portal/manifest.json',
  '/portal/portal-app.css',
  '/portal/portal-app.js',
  '/portal/portal-polish.css',
  '/portal/portal-update.js',
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

// ---------- update handshake ----------
// portal-update.js posts this when someone taps "Update", so a worker
// that is waiting takes over straight away instead of after every tab
// holding the old one is closed.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
