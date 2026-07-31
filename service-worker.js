// Minimal service worker for the Triple H Workspace PWA.
//
// This exists ONLY to satisfy installability requirements in some
// browsers (a registered service worker is one of the checkboxes some
// versions of Chrome/Android look for before offering "Add to Home
// Screen"). It deliberately does NOT cache anything.
//
// Why no caching: this project has already been bitten once by aggressive
// browser disk caching causing real confusion (a styles.css update that
// looked like the whole site was broken, purely because of a stale
// cached copy). A service worker cache is stickier and harder to clear
// than normal browser cache -- adding one here would make that exact
// problem worse, not better, for a tool that depends on Supabase being
// reachable for almost everything useful anyway. So: every request just
// passes straight through to the network, every time, no exceptions.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Explicitly NOT intercepting -- let the browser handle every request
  // normally, straight to the network. No caching, no offline fallback.
});
