// The two bars above the header on every public page (2026-09-23):
// #siteBanner1, the new-customer offer, and #siteBanner2, the hiring
// notice. This file replaces promo-banner.js and hiring-banner.js. What
// each one shows is set in Tools > Site Content (site_content rows
// banner1Mode / banner1 / banner1Link, and the same for banner2):
//   builtin -- the wording below. Also what shows on a first visit, before
//              this browser has ever heard from the server.
//   custom  -- the owner's own message, as plain text, with an optional
//              link picked from LINKS (never a typed URL)
//   off     -- nothing
// Either banner can be dismissed. The built-in ones keep their original
// localStorage keys. A custom message is remembered by a hash of its
// text, so a new message shows even to someone who closed the old one.
//
// Loaded SYNCHRONOUSLY, directly after the two banner divs and before
// <header>, so the banner is already full-size in the first frame the
// header paints in. Loaded with defer it filled in after that first
// paint, pushing the whole page down 85px on desktop (CLS 0.059). So this
// file blocks rendering: keep it small, dependency-free, and free of
// network calls, and never add defer/async back. The ?v= stamp matters
// too -- the service worker only serves stamped requests from cache.
//
// No network here means the first frame can only use what this browser
// saw last time. Each page's own site_content fetch passes the live rows
// to applySiteBanners(rows), which saves them for the next page and
// updates a banner right away only when that can't move the page: nothing
// has been painted yet, or the banner keeps its exact height. Otherwise
// the change shows from the next page on, instead of the page jumping
// under the visitor.
function applySiteBanners(rows) {
  var STORE_KEY = 'th-site-banners';
  var KEYS = ['banner1Mode', 'banner1', 'banner1Link', 'banner2Mode', 'banner2', 'banner2Link'];
  // Same list as BANNER_LINKS in tools/site-content.html and the check in
  // sql/site-content/cms_site_banners.sql.
  var LINKS = {
    '/booking.html': 'Book online →',
    '/careers.html': 'See the job & apply →',
    '/our-work.html': 'See our work →'
  };
  var SLOTS = [
    { n: 1, dismissKey: 'th-promo-welcome15-dismissed', close: 'Dismiss this offer', link: null,
      html: '<strong>New customer?</strong> Mention code <b>WELCOME15</b> when you book and get 15% off your first service call.' },
    { n: 2, dismissKey: 'th-hiring-banner-dismissed', close: 'Dismiss this notice', link: '/careers.html',
      html: '<strong>We\'re hiring.</strong> Part-time handyman helper, flexible hours, <span class="site-banner-keep">$35–$100+</span> per job. ' +
        '<a href="/careers.html">See the posting &amp; apply &rarr;</a>' }
  ];

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    // Storage can be unavailable (private browsing, blocked storage).
    // Then nothing is remembered: built-in banners show every time and
    // server changes apply only when they can't move the page.
    try { localStorage.setItem(key, value); } catch (e) { /* see above */ }
  }

  // Mirrors site_content_value_is_valid(): one trimmed line, 200 max.
  function cleanText(v) {
    return typeof v === 'string' && v !== '' && v === v.trim() && v.length <= 200 && !/[\r\n]/.test(v) ? v : null;
  }
  function settingsFor(map, n) {
    var text = cleanText(map['banner' + n]);
    var mode = map['banner' + n + 'Mode'];
    // No mode saved: a message on its own replaced the built-in banner,
    // which is how banner1/banner2 worked before modes existed.
    if (mode !== 'builtin' && mode !== 'custom' && mode !== 'off') mode = text ? 'custom' : 'builtin';
    if (mode === 'custom' && !text) mode = 'builtin';
    var link = map['banner' + n + 'Link'];
    if (mode !== 'custom') return { mode: mode };
    return { mode: 'custom', text: text, link: Object.prototype.hasOwnProperty.call(LINKS, link) ? link : null };
  }

  // FNV-1a, enough to tell one message from the next.
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  function samePage(href) {
    var norm = function (p) { p = p.replace(/\.html$/, '').replace(/\/$/, ''); return p === '' ? '/index' : p; };
    return !!href && norm(href) === norm(location.pathname);
  }

  // What a slot should show: null for nothing, else how to build it.
  function plan(slot, s) {
    if (s.mode === 'off') return null;
    if (s.mode === 'builtin') {
      if (samePage(slot.link) || lsGet(slot.dismissKey)) return null;
      return { sig: 'builtin', html: slot.html, close: slot.close, key: slot.dismissKey, mark: '1' };
    }
    // A "see the job" banner on the job page itself would just be noise.
    if (samePage(s.link)) return null;
    var mark = hash(s.text + '|' + (s.link || ''));
    var key = 'th-banner' + slot.n + '-dismissed';
    if (lsGet(key) === mark) return null;
    return { sig: 'custom:' + mark, text: s.text, link: s.link, close: 'Dismiss this notice', key: key, mark: mark };
  }

  function render(el, p) {
    el.innerHTML = '';
    if (!p) {
      el.style.display = 'none';
      el.removeAttribute('data-banner');
      return;
    }
    var inner = document.createElement('div');
    inner.className = 'site-banner-inner';
    var text = document.createElement('p');
    text.className = 'site-banner-text';
    if (p.html) {
      text.innerHTML = p.html;
    } else {
      text.textContent = p.text;
      if (p.link) {
        var a = document.createElement('a');
        a.href = p.link;
        a.textContent = LINKS[p.link];
        text.appendChild(document.createTextNode(' '));
        text.appendChild(a);
      }
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'site-banner-close';
    btn.setAttribute('aria-label', p.close);
    btn.innerHTML = '&times;';
    btn.addEventListener('click', function () {
      el.style.display = 'none';
      el.removeAttribute('data-banner');
      lsSet(p.key, p.mark);
    });
    inner.appendChild(text);
    inner.appendChild(btn);
    el.appendChild(inner);
    el.style.display = 'flex';
    el.setAttribute('data-banner', p.sig);
  }

  function painted() {
    try { return performance.getEntriesByType('paint').length > 0; } catch (e) { return true; }
  }

  function mapFrom(list) {
    var map = {};
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r && typeof r.key === 'string' && KEYS.indexOf(r.key) !== -1) map[r.key] = r.value;
    }
    return map;
  }

  // First call, at parse time: render from what this browser saw last.
  if (rows === undefined) {
    var saved = null;
    try { saved = JSON.parse(lsGet(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    var map0 = saved && typeof saved === 'object' ? saved : {};
    for (var i = 0; i < SLOTS.length; i++) {
      var el0 = document.getElementById('siteBanner' + SLOTS[i].n);
      if (el0) render(el0, plan(SLOTS[i], settingsFor(map0, SLOTS[i].n)));
    }
    return;
  }

  // A failed or empty fetch never changes anything.
  if (!Array.isArray(rows) || !rows.length) return;
  var map = mapFrom(rows);
  var store = {};
  for (var k = 0; k < KEYS.length; k++) if (typeof map[KEYS[k]] === 'string') store[KEYS[k]] = map[KEYS[k]];
  lsSet(STORE_KEY, JSON.stringify(store));

  for (var j = 0; j < SLOTS.length; j++) {
    var el = document.getElementById('siteBanner' + SLOTS[j].n);
    if (!el) continue;
    var next = plan(SLOTS[j], settingsFor(map, SLOTS[j].n));
    if ((el.getAttribute('data-banner') || '') === (next ? next.sig : '')) continue;
    var before = el.offsetHeight;
    var oldNodes = Array.prototype.slice.call(el.childNodes);
    var oldDisplay = el.style.display;
    var oldSig = el.getAttribute('data-banner');
    render(el, next);
    if (painted() && el.offsetHeight !== before) {
      // It would move the page: put the old banner back exactly as it was
      // (same nodes, so its close button still works). No frame is drawn
      // in between. The saved copy above shows the change on the next page.
      el.innerHTML = '';
      for (var m = 0; m < oldNodes.length; m++) el.appendChild(oldNodes[m]);
      el.style.display = oldDisplay;
      if (oldSig) el.setAttribute('data-banner', oldSig); else el.removeAttribute('data-banner');
    }
  }
}
applySiteBanners();
