/* utm-tracking.js -- captures UTM campaign parameters (utm_source,
   utm_medium, utm_campaign, utm_term, utm_content) from the URL a real
   visitor first lands on, and carries them through to whichever page
   they eventually submit a lead or booking form on.

   Requested directly, following the site's own recent GA4 work: GA4
   already attributes traffic sources for pageviews, but that data lives
   only in GA4 -- it was never joined to an actual th_leads/th_bookings
   row, so there was no way to see "which campaign's leads actually
   turned into paid jobs" without cross-referencing two separate
   systems by hand. This closes that gap by storing the SAME UTM values
   directly on the lead/booking row itself.

   First-touch attribution, not last-touch: once a real campaign
   landing is captured, browsing to another page (or clicking a second,
   different campaign link) during the same visit never overwrites it --
   the customer's ORIGINAL entry point is what should get credit for the
   eventual lead, not whatever page they happened to submit the form
   from. Expires after 90 days (a visitor who lands from an ad in
   January and finally calls in June was not actually brought back by
   that ad), matching common analytics-industry attribution windows --
   at that point a fresh visit with no utm params just stops attaching
   any campaign data at all, rather than attaching a meaningless
   months-old one.

   Deliberately separate from the existing `source` dropdown ("How did
   you hear about us?") on both public forms -- that's a manual,
   customer-self-reported field for channels with no URL at all (a
   referral, a truck sign, in-person word of mouth). This is the
   automatic, URL-driven counterpart for real UTM-tagged campaign
   traffic; the two are complementary, not a replacement for each other.

   Loaded on every public page that could be a real campaign landing
   page (same set as cookie-consent.js/analytics-events.js), in <head>,
   so a UTM-tagged link is captured immediately on arrival -- before any
   possible navigation away from that exact URL.
*/
(function () {
  var STORAGE_KEY = 'th_utm_attribution';
  var MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

  function readStored() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.captured_at !== 'number') return null;
      if (Date.now() - parsed.captured_at > MAX_AGE_MS) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function captureFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var found = {};
    var hasAny = false;
    UTM_KEYS.forEach(function (key) {
      var val = params.get(key);
      if (val) {
        found[key] = val.slice(0, 200);
        hasAny = true;
      }
    });
    if (!hasAny) return;

    // First-touch: never overwrite a still-valid, already-stored
    // attribution with a later visit's params.
    if (readStored()) return;

    found.captured_at = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(found));
    } catch (e) { /* private browsing / storage full -- never worth breaking the page over */ }
  }

  captureFromUrl();

  // Exposed for both public forms (index.html, booking.html) to read at
  // submit time. Returns null if nothing was ever captured, or if the
  // stored attribution has aged out past MAX_AGE_MS.
  window.getStoredUtmParams = function () {
    var stored = readStored();
    if (!stored) return null;
    var result = {};
    UTM_KEYS.forEach(function (key) {
      result[key] = stored[key] || null;
    });
    return result;
  };
})();
