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

  // Phase 5 (2026-11-04): two more pieces of "where did this visitor come
  // from", saved on the lead or booking so Insights can follow it to paid.
  //
  // 1. The first outside site that sent them (www.google.com,
  //    m.facebook.com): host name only, never the path or search terms,
  //    first-touch with the same 90-day window as the UTM values. Like the
  //    UTM values, it never leaves this browser except on a form the visitor
  //    sends themselves.
  // 2. The Google Analytics visit ID, ONLY when the visitor accepted
  //    analytics cookies (cookie-consent.js, 'th-cookie-consent' ===
  //    'granted'). Read from GA's own _ga cookie, which GA only sets after
  //    that consent; declined or undecided means null, always.
  var REFERRER_KEY = 'th_first_referrer';
  var OWN_HOSTS = /(^|\.)triplehenterprisesllc\.biz$/i;

  function captureReferrer() {
    var host = '';
    try { host = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : ''; } catch (e) { host = ''; }
    if (!host || host === window.location.hostname.toLowerCase() || OWN_HOSTS.test(host)) return;
    if (host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || host.charAt(0) === '.' || host.charAt(0) === '-') return;
    try {
      var prev = JSON.parse(localStorage.getItem(REFERRER_KEY) || 'null');
      if (prev && typeof prev.captured_at === 'number' && Date.now() - prev.captured_at <= MAX_AGE_MS) return;
      localStorage.setItem(REFERRER_KEY, JSON.stringify({ host: host, captured_at: Date.now() }));
    } catch (e) { /* storage blocked -- nothing to keep */ }
  }

  captureReferrer();

  function storedReferrer() {
    try {
      var prev = JSON.parse(localStorage.getItem(REFERRER_KEY) || 'null');
      if (!prev || typeof prev.captured_at !== 'number' || Date.now() - prev.captured_at > MAX_AGE_MS) return null;
      return prev.host || null;
    } catch (e) {
      return null;
    }
  }

  function gaClientIdWithConsent() {
    var consent = null;
    try { consent = localStorage.getItem('th-cookie-consent'); } catch (e) { consent = null; }
    if (consent !== 'granted') return null;
    var m = String(document.cookie || '').match(/(?:^|;\s*)_ga=([^;]+)/);
    if (!m) return null;
    var parts = decodeURIComponent(m[1]).split('.');
    if (parts.length < 4) return null;
    var id = parts.slice(-2).join('.');
    return /^[0-9]{1,20}\.[0-9]{1,20}$/.test(id) ? id : null;
  }

  // Read at submit time by the lead form (index.html) and the booking form
  // (booking.html), next to getStoredUtmParams().
  window.getStoredAttributionExtras = function () {
    return { landing_referrer: storedReferrer(), ga_client_id: gaClientIdWithConsent() };
  };

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
