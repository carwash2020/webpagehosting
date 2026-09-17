/* analytics-events.js -- GA4 custom events, shared across every public
   page (Audit Round 5, 2026-09-10; booking/lead funnel extended 2026-09-17).

   Before this, GA4 only ever received the default pageview -- not one
   custom event existed anywhere on the site, so there was no way to
   tell which page, blog post, or traffic source actually drove a real
   call, text, or booking, only that a pageview happened somewhere.
   Real leads/bookings already land in th_leads/th_bookings; this file
   doesn't create data, it just tells GA4 about interactions that were
   already happening so that data can be joined to GA4's own
   page/source/campaign attribution.

   Measurement ID is the one already on every public page
   (G-TMJJMGY2DQ). This file does not load gtag itself -- it only
   fires events through the page's existing stub. Swapping that ID in
   the shared gtag snippet is enough to retarget every event here.

   Purely additive: every event fires from a plain click listener added
   after the fact. Nothing here changes what a link or button already
   does, and a page with no gtag() defined (or GA4 blocked) just no-ops
   silently -- never worth breaking a live lead-generating page over an
   analytics call.

   Existing events (keep the names -- reports already depend on them):
   - phone_click / text_click on any tel:/sms: link
   - chat_opened when the homepage chat bubble is opened
   - lead_form_submitted / booking_step_view / booking_completed stay
     inline at the real success/step paths (see those pages)

   Added 2026-09-17:
   - email_click on mailto: links
   - book_cta_click on primary Book/Schedule links to /booking.html
   - booking_page_view when /booking.html loads
   - booking_form_start on first real engagement with the booking flow

   Loaded on every public marketing page (index, booking, city and
   service pages, blog + posts, about, our-work, terms, privacy).
   Deliberately NOT loaded in the portal or /tools/ -- those aren't
   the public marketing surface this is measuring. */
(function () {
  if (typeof gtag !== 'function') return;

  function track(name, params) {
    try { gtag('event', name, params || {}); } catch (e) { /* never worth breaking the page over */ }
  }

  function pagePath() {
    return location.pathname || '';
  }

  function isBookingPage() {
    return /(?:^|\/)booking\.html$/i.test(pagePath());
  }

  function isBookingCtaHref(href) {
    if (!href) return false;
    var lower = href.toLowerCase();
    if (lower.indexOf('tel:') === 0 || lower.indexOf('sms:') === 0 || lower.indexOf('mailto:') === 0) return false;
    try {
      var u = new URL(href, location.href);
      return /(?:^|\/)booking\.html$/i.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  function linkText(link) {
    return (link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  // Phone/text/email clicks, plus Book/Schedule CTAs that go to the
  // calendar. Uses delegation (one listener on document) so it also
  // covers links added later by JS (e.g. business hours overrides).
  document.addEventListener('click', function (e) {
    const link = e.target.closest && e.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.indexOf('tel:') === 0) {
      track('phone_click', { link_url: href, page_path: pagePath() });
    } else if (href.indexOf('sms:') === 0) {
      track('text_click', { link_url: href, page_path: pagePath() });
    } else if (href.indexOf('mailto:') === 0) {
      track('email_click', { link_url: href, page_path: pagePath() });
    } else if (isBookingCtaHref(href) && !isBookingPage()) {
      track('book_cta_click', {
        link_url: href,
        page_path: pagePath(),
        link_text: linkText(link)
      });
    }
  });

  // Chat bubble opening (index.html only -- silently does nothing
  // elsewhere since the element won't exist).
  const chatBubbleBtn = document.getElementById('chatBubbleBtn');
  if (chatBubbleBtn) {
    chatBubbleBtn.addEventListener('click', function () {
      track('chat_opened', { page_path: pagePath() });
    });
  }

  if (!isBookingPage()) return;

  track('booking_page_view', { page_path: pagePath() });

  var formStarted = false;
  function startBookingForm() {
    if (formStarted) return;
    formStarted = true;
    track('booking_form_start', { page_path: pagePath() });
  }

  // Deep-link / auto-advance may already have left step 1 before this
  // deferred script runs (the inline booking IIFE is earlier in the
  // body). Treat an already-active later step as started.
  var laterStep = document.getElementById('stepDateTime') || document.getElementById('stepContact');
  if (laterStep && laterStep.classList.contains('is-active')) startBookingForm();

  document.addEventListener('click', function (e) {
    if (formStarted) return;
    if (e.target.closest && e.target.closest('#serviceList, #bookingForm, .booking-main')) {
      startBookingForm();
    }
  });
  document.addEventListener('input', function (e) {
    if (formStarted) return;
    if (e.target && e.target.closest && e.target.closest('#bookingForm')) startBookingForm();
  });
})();
