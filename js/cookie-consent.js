/* cookie-consent.js -- shared by every public page that loads Google
   Analytics. Pairs with the small inline "consent default" snippet each
   of those pages has right before its GA4 tag (that inline snippet sets
   Google Consent Mode v2's default state to 'denied' -- or 'granted' if
   this visitor already chose -- before gtag.js ever runs, so no
   analytics cookie is set before a real choice is made). This file only
   handles the visible banner and updating that consent state after a
   choice; it never loads or blocks gtag.js itself.
*/
(function () {
  var CONSENT_KEY = 'th-cookie-consent'; // 'granted' | 'denied', absent = no choice yet

  function getConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }

  function setConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch (e) {
      /* private-browsing / storage blocked -- the choice just won't persist across visits */
    }
  }

  function updateGtagConsent(value) {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: value });
    }
  }

  function removeBanner() {
    var el = document.getElementById('cookieConsentBanner');
    if (el) el.remove();
  }

  function showBanner() {
    removeBanner();

    var el = document.createElement('div');
    el.id = 'cookieConsentBanner';
    el.className = 'cookie-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Cookie preferences');
    el.innerHTML =
      '<div class="cookie-banner-inner">' +
        '<p class="cookie-banner-text">This site uses Google Analytics to understand general site traffic. ' +
        'No information submitted through the contact or scheduling forms is shared with Google Analytics. ' +
        '<a href="/terms.html#terms">Learn more</a>.</p>' +
        '<div class="cookie-banner-actions">' +
          '<button type="button" class="cookie-btn cookie-btn-decline" id="cookieDeclineBtn">Decline</button>' +
          '<button type="button" class="cookie-btn cookie-btn-accept" id="cookieAcceptBtn">Accept</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(el);

    document.getElementById('cookieAcceptBtn').addEventListener('click', function () {
      setConsent('granted');
      updateGtagConsent('granted');
      removeBanner();
    });
    document.getElementById('cookieDeclineBtn').addEventListener('click', function () {
      setConsent('denied');
      updateGtagConsent('denied');
      removeBanner();
    });
  }

  // Exposed so a "Cookie Preferences" footer link can reopen the banner
  // at any time, even after a choice was already made.
  window.reopenCookiePreferences = function (event) {
    if (event && event.preventDefault) event.preventDefault();
    showBanner();
  };

  var HERO_DEFER_MS = 6000;
  var HERO_DEFER_SCROLL_PX = 80;

  function isNarrowMobile() {
    try {
      return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
    } catch (e) {
      return false;
    }
  }

  // On ≤760px, keep the first hero paint clear of the cookie card
  // (promo + header + Call/Book already fill the chrome). Show after
  // the visitor scrolls or after a short timeout. Desktop still shows
  // immediately. Consent Mode stays denied until Accept either way.
  function scheduleBanner() {
    if (getConsent() !== null) return;
    if (!isNarrowMobile()) {
      showBanner();
      return;
    }
    var shown = false;
    var timer = null;
    function reveal() {
      if (shown) return;
      shown = true;
      window.removeEventListener('scroll', onScroll);
      if (timer) window.clearTimeout(timer);
      showBanner();
    }
    function onScroll() {
      var y = window.scrollY || window.pageYOffset || 0;
      if (y > HERO_DEFER_SCROLL_PX) reveal();
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    timer = window.setTimeout(reveal, HERO_DEFER_MS);
  }

  document.addEventListener('DOMContentLoaded', scheduleBanner);
})();
