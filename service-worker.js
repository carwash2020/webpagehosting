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
// Bumped again (2026-08-20): fixed the .jump-nav tab bar (Snapshot/
// Action Items/More/Tools) to span the full width on desktop too,
// same fix as the header, requested directly from a screenshot.
// Bumped again (2026-08-21): moved the Live sync indicator to sit as
// a second row under the settings button on desktop, requested
// directly.
// Bumped again (2026-08-21): fixed a widespread stale-reference
// pattern found during a direct text audit -- Cost Lookup, Expenses,
// Income, and Profitability all moved to Finance during this week's
// structural rework, but 5 pages still attributed them to Job
// Tracker.
// Bumped again (2026-08-21): fixed 3 genuinely broken help buttons on
// finance.html (openCardInfo was never defined there), found by a new
// automated button-handler check requested directly.
// Bumped again (2026-08-21): fixed the Client Errors "Clear" button
// not actually persisting past a page reload, reported directly.
// Bumped again (2026-08-21): fixed a gap at the top of the screen on
// mobile with scrolled content visible through it -- the sticky
// header's top value had been offset by the safe-area-inset instead
// of staying at 0, reported directly with a screenshot.
// Bumped again (2026-08-21): added a real Delete button to the Client
// Registry in Dev Tools, requested directly.
// Bumped again (2026-08-21): added Finance and Settings tiles to the
// mobile Tools grid, requested directly.
// Bumped again (2026-08-21): Owner accounts now only see Client
// Registry and Account Roles in Dev Tools, requested directly --
// Developer keeps full, unchanged access.
// Bumped again (2026-08-21): fixed finance.html's back link (still
// went to Job Tracker, not Workspace like every other page) plus 4
// more missed stale Job Tracker/Finance references found on a more
// thorough follow-up sweep.
// Bumped again (2026-08-21): "What's new" changelog now groups
// commits by calendar day, requested directly.
// Bumped again (2026-08-21): "Flag this page for later" (suggestion
// #2, requested directly) -- a floating button on every tool page,
// synced flag queue, and a new Dev Tools panel to review them.
// Bumped again (2026-08-21): Known Issues audit (suggestion #3,
// requested directly) -- both seeded issues verified resolved against
// the live database, marked done rather than left showing as open.
// Bumped again (2026-08-21): fixed a stray blue native focus outline
// showing around buttons after a click, reported directly with a
// screenshot -- only this app's own orange :focus-visible ring should
// ever show, and only for real keyboard navigation.
// Bumped again (2026-08-21): fixed the live sync indicator and its
// refresh button not lining up on the same right edge, reported
// directly with a screenshot -- replaced fragile text-align with
// explicit flexbox column alignment.
// Bumped again (2026-08-21): fixed the tour popping up on every load
// instead of once, and the live sync/refresh button alignment,
// requested directly with screenshots.
// Bumped again (2026-08-21): the refresh button is now its own,
// fully independent position:fixed element, no longer relying on
// flexbox/shrink-to-fit sizing at all -- reported directly (twice)
// that alignment still wasn't quite right.
// Bumped again (2026-08-21): swapped the order of the refresh button
// and the live sync badge, requested directly -- refresh button now
// on top.
// Bumped again (2026-08-21): fixed the refresh button crowding the
// settings gear icon above it, reported directly -- the order swap
// left only ~8px of breathing room; now a real 20px gap.
// Bumped again (2026-08-21): found and fixed the actual root cause of
// the persistent header-button collision, reported directly across
// multiple screenshots -- a CSS selector specificity bug meant the
// main row was never actually pinned to the top of the header at all.
// Bumped again (2026-08-21): found and fixed a known iOS Safari bug
// where env(safe-area-inset-top) can unexpectedly return 0px, causing
// header content to overlap the phone's own status bar on real
// devices -- reported directly with a screenshot. Guarded every real
// usage app-wide with a 44px floor.
// Bumped again (2026-08-22): found the REAL root cause of the header/
// status-bar overlap, reported directly with a second screenshot
// showing the earlier fix had no effect at all -- a separate,
// mobile-specific media-query rule was silently overriding it with a
// flat, non-safe-area-aware padding value.
// Bumped again (2026-08-22): on mobile, the refresh button now stacks
// below "Live sync active" (matching desktop), with tighter spacing
// under the header, requested directly.
// Bumped again (2026-08-22): "Live sync active" now lives inside the
// header itself as a second row, requested directly ("move the bars
// together"), rather than a separate section below with a visible gap.
// Bumped again (2026-08-22): fixed jump-nav (the Snapshot/Action
// Items/More/Tools tabs) disappearing when scrolled -- it was sticking
// at a position now covered by the taller header, reported directly
// with a screenshot. Now measures the header's real height dynamically
// instead of relying on a hardcoded pixel value.
// Bumped again (2026-08-22): jump-nav (Snapshot/Action Items/More/
// Tools) now scrolls away normally with the page instead of staying
// sticky/pinned, requested directly ("the tools to slide") -- the
// previous fix correctly positioned it below the header but kept it
// sticky, which was reported as exactly the wrong behavior.
// Bumped 2026-09-02: data-layer.js, dev-tools-shared.js, and auth.js
// all changed across two separate merges (client-identity unification,
// then the role-check retry fix below) and NEITHER one bumped
// CACHE_NAME -- the failure mode the 2026-08-16 comment above already
// warned about.
//
// Worth being precise about what this bump does and doesn't guarantee
// (caught in review, and correct): every reference to these files
// carries a content-hash ?v= query param, and caches.match(event.request)
// below matches on the FULL request URL, search params included. So a
// genuine ?v= change on its own already produces a cache MISS for that
// new URL regardless of CACHE_NAME -- a real network fetch happens
// either way once the HTML referencing the new ?v= is loaded. Bumping
// CACHE_NAME is not what makes a correctly-?v=-bumped file fresh; what
// it actually does is (1) force every OLD versioned-URL entry to be
// dropped for good, via the activate handler's cache-name cleanup
// below, rather than sitting in storage unused forever, and (2) act as
// the real safety net for the two cases where a ?v= bump alone
// wouldn't save you: a file that's precached under its BARE path with
// no ?v= at all (this happens during install, before any page has
// requested a versioned URL), or any future change that lands without
// its ?v= correctly bumped alongside it. Bump this whenever a file in
// PRECACHE_URLS changes, even if you're confident every ?v= reference
// was updated too -- it's the backstop for the case where that
// confidence turns out to be wrong.
// Bumped 2026-09-03: dev-tools.html (precached) changed across several
// merges this week -- Portal tab panels, inline photo viewer, the
// onclick quoting fix -- without a bump. Same failure mode the
// 2026-08-16 and 2026-09-02 notes above already warned about.
// Bumped 2026-09-03: clients.html added to PRECACHE_URLS, and
// dev-tools.html/workspace.html both changed (Portal tab split out).
// Bumped 2026-09-03 (again): pos.html added to PRECACHE_URLS.
// Bumped 2026-09-05: push-notifications.js changed -- a real
// duplicate-subscription bug found during a direct scale audit was
// fixed there (a real upsert against a new unique index, instead of
// a plain insert that could accumulate duplicate rows for the same
// device). Precached under its bare path, no ?v= on this specific
// entry, so this bump is the only thing that actually invalidates
// the old cached copy -- same failure mode every prior bump above
// already warned about.
// Bumped 2026-09-05 (again): data-layer.js changed -- tombstone
// retention added (every th_*_tombstones array previously grew
// forever; now pruned to 90 days on every add), found during the
// same "should we clean up the blob" follow-up audit. Also precached
// under its bare path, same reasoning as the bump just above.
// Bumped 2026-09-05 (again): dev-tools-shared.js changed -- added a
// DEV_INFO entry for the new Portal client errors panel (automatic
// JS error capture on the portal, requested directly: "future proof
// this... what other layers can we add"). Also precached under its
// bare path.
// Bumped 2026-09-05 (again): sync.js changed -- stopped logging every
// expected, intermediate realtime CHANNEL_ERROR retry attempt as a
// client error (found investigating a real reported complaint about
// noisy client-side errors); dev-tools.html changed too (a real
// escaping-function inconsistency fixed on the same investigation).
// sync.js is also precached under its bare path.
// Bumped 2026-09-05 (again): invoice-generator.html changed -- fixed
// the iOS Safari zoom-on-focus bug (reported directly: "you click on
// a field and it zooms in"), precached under its bare path.
const CACHE_NAME = 'th-workspace-v54';
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
  // Added 2026-09-03 -- split off Dev Tools' own Portal tab onto its
  // own page, now a genuine daily operational tool in its own right,
  // same reasoning as everything else on this line.
  '/tools/clients.html',
  // Added 2026-09-03 -- the new POS tool, same reasoning.
  '/tools/pos.html',
  // Added 2026-08-20 -- same gap as above, these 3 pages (all from the
  // structural rework's Client/Job Detail views and the Finance split)
  // existed live but were never added here either.
  '/tools/finance.html', '/tools/client-detail.html', '/tools/job-detail.html',
  // Added 2026-08-20 -- same gap yet again, found while already
  // touching this list for the light-mode work above.
  '/tools/settings.html',
  // Added 2026-08-26 -- found by a new, automated check comparing this
  // list against the real file set, rather than another manual audit.
  // reset-password.html was missing entirely (a password-reset link
  // opened with flaky connectivity would fail to load at all), and
  // tools-tour.js was missing too -- the exact same file already found
  // missing from the separate cache-bust version list earlier the same
  // day, for the same underlying reason: a hardcoded list, maintained
  // by hand, drifting from reality.
  '/tools/reset-password.html', '/tools/tools-tour.js',
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
