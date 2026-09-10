/* analytics-events.js -- GA4 custom events, shared across every public
   page (Audit Round 5, 2026-09-10).

   Before this, GA4 only ever received the default pageview -- not one
   custom event existed anywhere on the site, so there was no way to
   tell which page, blog post, or traffic source actually drove a real
   call, text, or booking, only that a pageview happened somewhere.
   Real leads/bookings already land in th_leads/th_bookings; this file
   doesn't create data, it just tells GA4 about interactions that were
   already happening so that data can be joined to GA4's own
   page/source/campaign attribution.

   Purely additive: every event fires from a plain click listener added
   after the fact. Nothing here changes what a link or button already
   does, and a page with no gtag() defined (or GA4 blocked) just no-ops
   silently -- never worth breaking a live lead-generating page over an
   analytics call.

   Loaded on every public marketing page (index, booking, the 5 city
   landing pages, blog + posts, about, our-work, terms). Deliberately
   NOT loaded in the portal or /tools/ -- those aren't the public
   marketing surface this is measuring. */
(function () {
  if (typeof gtag !== 'function') return;

  function track(name, params) {
    try { gtag('event', name, params || {}); } catch (e) { /* never worth breaking the page over */ }
  }

  // Phone/text link clicks, anywhere on the page -- the two most direct
  // "this page turned into contact" signals there are. Uses delegation
  // (one listener on document) so it also covers phone/text links added
  // later by JS (e.g. business hours overrides, portal-adjacent widgets).
  document.addEventListener('click', function (e) {
    const link = e.target.closest && e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.indexOf('tel:') === 0) {
      track('phone_click', { link_url: href, page_path: location.pathname });
    } else if (href.indexOf('sms:') === 0) {
      track('text_click', { link_url: href, page_path: location.pathname });
    }
  });

  // Chat bubble opening (index.html only -- silently does nothing
  // elsewhere since the element won't exist).
  const chatBubbleBtn = document.getElementById('chatBubbleBtn');
  if (chatBubbleBtn) {
    chatBubbleBtn.addEventListener('click', function () {
      track('chat_opened', { page_path: location.pathname });
    });
  }
})();
