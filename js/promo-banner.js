// A first-time-visitor discount banner, populated into the #siteBanner1
// scaffold every public page already declares (unused until now -- no
// script anywhere ever wrote into it or styled it). Dismissible, and the
// dismissal is remembered so a visitor who closes it doesn't see it again
// on their next visit to a different page.
//
// Loaded SYNCHRONOUSLY (2026-09-23), directly after the two banner divs and
// before <header>, so the banner is already full-size in the first frame
// the header paints in. Loaded with defer it filled in after that first
// paint, pushing the whole page down 85px on desktop (CLS 0.059). So this
// file blocks rendering: keep it tiny, dependency-free, and free of network
// calls, and never add defer/async back. The ?v= stamp matters too -- the
// service worker only serves stamped requests from cache.
(function () {
  var DISMISS_KEY = 'th-promo-welcome15-dismissed';
  var banner = document.getElementById('siteBanner1');
  if (!banner) return;

  var alreadyDismissed = false;
  try {
    alreadyDismissed = !!localStorage.getItem(DISMISS_KEY);
  } catch (e) {
    // localStorage unavailable (private browsing, blocked storage) --
    // show the banner every time rather than fail closed.
  }
  if (alreadyDismissed) return;

  banner.innerHTML =
    '<div class="site-banner-inner">' +
      '<p class="site-banner-text">' +
        '<strong>New customer?</strong> Mention code <b>WELCOME15</b> when you book and get 15% off your first service call.' +
      '</p>' +
      '<button type="button" class="site-banner-close" aria-label="Dismiss this offer">&times;</button>' +
    '</div>';
  banner.style.display = 'flex';

  banner.querySelector('.site-banner-close').addEventListener('click', function () {
    banner.style.display = 'none';
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch (e) {
      // Nothing to persist if storage isn't available -- it'll just show
      // again next visit, which is an acceptable fallback here.
    }
  });
})();
