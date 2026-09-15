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

  document.addEventListener('DOMContentLoaded', function () {
    if (getConsent() === null) {
      showBanner();
    }
  });
})();
