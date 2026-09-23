// review-stats.js -- the Google star rating and review count, read live
// from public.site_content (keys googleRating / googleReviewCount) instead
// of being hardcoded into every page that shows them (2026-09-23).
//
// Edited in tools/site-content.html; no code push needed for a new review.
// The HTML keeps today's real values as its static text, so a visitor
// whose Supabase fetch fails (or has JS off) still sees correct numbers,
// and a page whose saved values match the HTML changes nothing at all.
//
// Each page's own site_content fetch hands its key/value map to
// applyReviewStats(). This file is loaded with defer, so it may run
// before OR after that fetch lands -- whichever happens second applies
// the values (window.__siteContentMap bridges the two), so there's no race.
//
// Hooks -- classes on elements that already existed, never new wrapper
// elements. An extra inline span around "7" measurably moved the text
// after it by a sub-pixel on booking.html (a real before/after screenshot
// diff), so the numbers are rewritten inside the existing text node:
//   .js-review-text          contains the phrase "5.0 from 7 Google reviews";
//                            only that phrase's two numbers are rewritten
//   .js-review-stars         the decorative star glyphs next to a rating
//   .js-review-rating-stat   the stats-strip count-up number (data-count-to)
//   .js-review-count-stat    same, for the count
//   .js-review-star-label    "Real 5-Star Reviews", which is only true at 5.0
// plus any JSON-LD block with an aggregateRating (index.html's LocalBusiness),
// updated from the same values so search data never disagrees with the page.
// One global, applyReviewStats(); every helper lives inside it, so this
// file can't collide with a page's own top-level names.
function applyReviewStats(map) {
  if (!map || typeof map !== 'object') return;

  // Same rules the database enforces (site_content_value_is_valid); a value
  // that somehow fails them is ignored and the static text stays.
  function validRating(v) { return typeof v === 'string' && /^[1-5]\.[0-9]$/.test(v) && Number(v) <= 5; }
  function validCount(v) { return typeof v === 'string' && /^[1-9][0-9]{0,4}$/.test(v); }

  function starsFor(value) {
    var full = Math.round(Number(value));
    return new Array(full + 1).join('\u2605') + new Array(5 - full + 1).join('\u2606');
  }

  // "5.0 from 7 Google reviews" -> the saved values, in each hook element's
  // own direct text nodes. A text node is only written if it changes, so
  // matching values leave the DOM exactly as the HTML built it.
  function setPhrase(newRating, newCount) {
    var phrase = /[1-5]\.[0-9] from [1-9][0-9]{0,4} Google reviews/;
    var els = document.querySelectorAll('.js-review-text');
    for (var i = 0; i < els.length; i++) {
      for (var n = els[i].firstChild; n; n = n.nextSibling) {
        if (n.nodeType !== 3) continue;
        var m = phrase.exec(n.nodeValue);
        if (!m) continue;
        var parts = m[0].replace(' Google reviews', '').split(' from ');
        var next = (newRating || parts[0]) + ' from ' + (newCount || parts[1]) + ' Google reviews';
        if (next !== m[0]) n.nodeValue = n.nodeValue.replace(m[0], next);
      }
    }
  }

  function setText(selector, text) {
    var els = document.querySelectorAll(selector);
    for (var i = 0; i < els.length; i++) {
      if (els[i].textContent !== text) els[i].textContent = text;
    }
  }

  function setCountUp(selector, value, decimals) {
    var els = document.querySelectorAll(selector);
    var target = String(Number(value));
    var shown = Number(value).toFixed(decimals);
    for (var i = 0; i < els.length; i++) {
      // The homepage count-up animation reads data-count-to on every frame,
      // so updating it here is enough even if the animation is mid-run.
      if (els[i].getAttribute('data-count-to') !== target) {
        els[i].setAttribute('data-count-to', target);
        els[i].textContent = shown;
      }
    }
  }

  function updateJsonLd(newRating, newCount) {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var data;
      try { data = JSON.parse(scripts[i].textContent); } catch (e) { continue; }
      var ar = data && data.aggregateRating;
      if (!ar || typeof ar !== 'object') continue;
      var changed = false;
      if (newRating && ar.ratingValue !== newRating) { ar.ratingValue = newRating; changed = true; }
      if (newCount && ar.reviewCount !== newCount) { ar.reviewCount = newCount; changed = true; }
      if (changed) scripts[i].textContent = JSON.stringify(data, null, 2);
    }
  }

  var rating = validRating(map.googleRating) ? map.googleRating : null;
  var count = validCount(map.googleReviewCount) ? map.googleReviewCount : null;
  if (rating || count) setPhrase(rating, count);
  if (rating) {
    setText('.js-review-stars', starsFor(rating));
    setCountUp('.js-review-rating-stat', rating, 1);
    setText('.js-review-star-label', Number(rating) >= 5 ? 'Real 5-Star Reviews' : 'Real Google Reviews');
  }
  if (count) setCountUp('.js-review-count-stat', count, 0);
  if (rating || count) updateJsonLd(rating, count);
}

if (window.__siteContentMap) applyReviewStats(window.__siteContentMap);
