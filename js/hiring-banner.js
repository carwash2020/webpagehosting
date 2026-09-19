// A "we're hiring" banner (2026-09-19), populated into the #siteBanner2
// scaffold every public page already declares (declared alongside
// #siteBanner1 from the start, never used until now). Same dismissible
// pattern as promo-banner.js's WELCOME15 banner in #siteBanner1, kept
// as a fully separate script/key/element so the two can show or be
// dismissed independently -- a visitor who closes the discount offer
// should still see the hiring push, and vice versa.
(function () {
  var DISMISS_KEY = 'th-hiring-banner-dismissed';
  var banner = document.getElementById('siteBanner2');
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
        '<strong>We\'re hiring.</strong> Part-time handyman helper, flexible hours, $35–$100+ per job. ' +
        '<a href="/careers.html">See the posting &amp; apply &rarr;</a>' +
      '</p>' +
      '<button type="button" class="site-banner-close" aria-label="Dismiss this notice">&times;</button>' +
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
