// Client portal shared app-shell JavaScript (2026-09-04), paired
// with portal/portal-app.css. Currently just the skeleton-loading
// helpers, requested directly: "Skeleton loading states." A
// dedicated home for this rather than duplicating the same template
// string across five pages, and a natural place for other shared
// app-shell behavior (pull-to-refresh, an offline indicator) as
// those get built.

// A generic card shape (title bar + two lines of varying width),
// repeated `count` times. Not a bespoke skeleton per page -- this is
// a reasonable approximation of every real card class on the portal
// (invoice-card, job-card, quote-card, wo-card, set-card), and
// building a pixel-matched skeleton per page would be considerably
// more work for a perceptual improvement that doesn't need it.
function portalSkeletonCards(count) {
  const card =
    '<div class="skeleton-card">' +
    '<div class="skeleton-line is-title"></div>' +
    '<div class="skeleton-line is-wide"></div>' +
    '<div class="skeleton-line is-narrow"></div>' +
    '</div>';
  return card.repeat(count);
}

// A smaller variant for nested contexts, e.g. a message thread
// opening inside an already-visible work order card, where a
// full-sized card skeleton would be visually heavier than the space
// it sits in.
function portalSkeletonLines(count) {
  const line =
    '<div class="skeleton-mini">' +
    '<div class="skeleton-line is-medium"></div>' +
    '</div>';
  return line.repeat(count);
}

// Offline indicator (2026-09-04), requested directly. Checks
// navigator.onLine on init (in case a page loads while already
// offline, e.g. opened from the installed app with no signal) and
// listens for the browser's own online/offline events after that --
// no polling, since those events fire reliably on every platform
// this app targets.
function initOfflinePortalIndicator() {
  let banner = document.getElementById('offlinePortalBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offlinePortalBanner';
    banner.className = 'offline-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = "You're offline -- showing saved data";
    document.body.appendChild(banner);
  }

  function updateBanner() {
    banner.classList.toggle('is-visible', !navigator.onLine);
  }

  window.addEventListener('online', updateBanner);
  window.addEventListener('offline', updateBanner);
  updateBanner();
}

// Self-initializing rather than requiring an explicit call on each
// page: this feature is fully generic (show a banner if offline,
// hide it if not) and doesn't depend on any page-specific state, so
// there's no reason to hunt down 8 differently-structured pages'
// own init patterns just to wire up the same call everywhere.
// Pull-to-refresh below stays an explicit per-page call, since it
// genuinely needs a page-specific refresh callback.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOfflinePortalIndicator);
} else {
  initOfflinePortalIndicator();
}

// Pull-to-refresh (2026-09-04), requested directly: "Make swiping
// feel good, but don't over do it." One restrained gesture, not a
// gesture library: pull down from the very top of the page, a small
// spinner grows in tracking the finger exactly (no lag, no CSS
// transition while dragging), release past REFRESH_THRESHOLD to
// trigger onRefresh, or below it and the indicator snaps back with
// the one deliberate animation this feature has.
//
// Only arms when window.scrollY is already 0 -- pulling down while
// mid-scroll should scroll the page normally, not hijack the
// gesture, which is the actual native convention this is copying.
function initPortalPullToRefresh(onRefresh) {
  const REFRESH_THRESHOLD = 70;
  const MAX_PULL = 100;

  let indicator = document.getElementById('ptrIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'ptrIndicator';
    indicator.className = 'ptr-indicator';
    indicator.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14.5-4.5M20 12a8 8 0 0 1-14.5 4.5"/><path d="M18.5 3v5h-5M5.5 21v-5h5"/></svg>';
    document.body.appendChild(indicator);
  }

  let startY = null;
  let pulling = false;
  let refreshing = false;

  document.addEventListener('touchstart', (e) => {
    if (window.scrollY > 0 || refreshing) return;
    startY = e.touches[0].clientY;
    pulling = true;
    indicator.classList.remove('is-snapping');
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling || startY === null) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) return;
    const pull = Math.min(delta * 0.5, MAX_PULL);
    indicator.style.transform = `translate(-50%, ${pull - 36}px)`;
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    const currentPull = indicator.style.transform;
    const match = currentPull.match(/,\s*(-?[\d.]+)px\)/);
    const pulledPast = match && parseFloat(match[1]) >= (REFRESH_THRESHOLD * 0.5 - 36);

    indicator.classList.add('is-snapping');
    if (pulledPast && !refreshing) {
      refreshing = true;
      indicator.classList.add('is-refreshing');
      indicator.style.transform = 'translate(-50%, 20px)';
      Promise.resolve(onRefresh()).finally(() => {
        refreshing = false;
        indicator.classList.remove('is-refreshing');
        indicator.style.transform = 'translate(-50%, -100%)';
      });
    } else {
      indicator.style.transform = 'translate(-50%, -100%)';
    }
    startY = null;
  });
}

