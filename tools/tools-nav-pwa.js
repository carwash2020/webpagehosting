// tools-nav-pwa.js -- one of 4 files split out of the former
// tools-common.js (2026-08-20, structural item #42). See tools-effects.js
// for the full explanation of why and how this split was done safely.
//
// This file: the mobile bottom app nav, display-density toggle, the
// shared icon sprite injection, jump-nav scroll-spy, the offline banner,
// and the PWA install prompt.

// ---------------------------------------------------------------------------
// MOBILE BOTTOM APP NAV -- added 2026-08-16 (redesign v2)
// Injected here so every tool page gets it from one file. Styled entirely
// by the "TOOL SUITE REDESIGN v2" layer in /styles.css (.th-bottom-nav),
// which only displays it under 720px -- desktop never sees it. Also tags
// <body> with th-tool-page (ambient background + radius tokens) and
// th-has-bottomnav (bottom padding so content clears the fixed bar).
// login.html is excluded: no point navigating before you're signed in.
// ---------------------------------------------------------------------------
(function () {
  if (typeof document === 'undefined') return;
  var path = (window.location && window.location.pathname) || '';
  var onLogin = /\/login\.html$/.test(path);

  var DESTS = [
    { href: '/tools/workspace.html',         icon: 'home',    label: 'Home' },
    { href: '/tools/job-tracker.html',       icon: 'wrench',  label: 'Jobs' },
    { href: '/tools/invoice-generator.html', icon: 'receipt', label: 'Invoices' },
    { href: '/tools/calendar.html',          icon: 'calendar',label: 'Calendar' },
    { href: '/tools/finance.html',           icon: 'dollar',  label: 'Finance' }
  ];

  // Desktop sidebar (2026-08-20), requested directly: a persistent
  // left sidebar on desktop, replacing top-tab-only navigation --
  // styled entirely by the ".th-desktop-sidebar" rules in
  // styles-tools.css, which only display it at min-width:1024px;
  // mobile never sees it (the bottom nav above stays exactly as it
  // was). A fuller destination list than the bottom nav's 5 items,
  // since the sidebar has real vertical room -- still scoped to
  // everyday tools, not admin-only pages.
  var SIDEBAR_DESTS = [
    { href: '/tools/workspace.html',          icon: 'home',     label: 'Dashboard' },
    { href: '/tools/job-tracker.html',        icon: 'wrench',   label: 'Job Tracker' },
    { href: '/tools/finance.html',            icon: 'dollar',   label: 'Finance' },
    { href: '/tools/invoice-generator.html',  icon: 'receipt',  label: 'Invoice Generator' },
    { href: '/tools/contract-generator.html', icon: 'scroll',   label: 'Contract Generator' },
    { href: '/tools/calendar.html',           icon: 'calendar', label: 'Calendar' },
    { href: '/tools/route-planner.html',      icon: 'map',      label: 'Route Planner' },
    { href: '/tools/review-request.html',     icon: 'star',     label: 'Review Requests' },
    { href: '/tools/parts-reference.html',    icon: 'book',     label: 'Appliance Wiki' },
    { href: '/tools/runway-dashboard.html',   icon: 'chart',    label: 'Runway Dashboard' },
    { href: '/tools/settings.html',           icon: 'gear',     label: 'Settings' }
  ];

  var FLAGGED_ITEMS_KEY = 'th_flagged_items';
  function injectFlagButton() {
    var btn = document.createElement('button');
    btn.className = 'th-flag-btn';
    btn.setAttribute('aria-label', 'Flag this page for later');
    btn.title = 'Flag this page for later';
    btn.innerHTML = '<svg class="th-icon" aria-hidden="true"><use href="#icon-warning" xlink:href="#icon-warning"></use></svg>';
    btn.onclick = function () {
      if (typeof showFlagDialog !== 'function') return; // tools-dialogs.js not loaded yet -- fails silently rather than throwing
      var pageLabel = (document.title || '').split('\u00b7')[0].trim() || location.pathname;
      showFlagDialog(pageLabel).then(function (note) {
        if (note === null) return; // cancelled
        var list;
        try { list = JSON.parse(localStorage.getItem(FLAGGED_ITEMS_KEY) || '[]'); } catch (e) { list = []; }
        list.push({
          id: 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
          page: pageLabel,
          note: note,
          time: new Date().toISOString(),
          resolved: false,
        });
        localStorage.setItem(FLAGGED_ITEMS_KEY, JSON.stringify(list));
        if (typeof scheduleSync === 'function') scheduleSync();
        if (typeof showToast === 'function') showToast('Flagged.');
      });
    };
    document.body.appendChild(btn);
  }

  function injectSidebar() {
    document.body.classList.add('th-has-sidebar');

    var sidebar = document.createElement('nav');
    sidebar.className = 'th-desktop-sidebar';
    sidebar.setAttribute('aria-label', 'Main navigation');
    sidebar.innerHTML =
      '<a href="/tools/workspace.html" class="th-sidebar-brand">' +
        '<img src="/images/logo-signature-orange.webp?v=202608142300" alt="">' +
        '<span>Triple H</span>' +
      '</a>' +
      '<div class="th-sidebar-links">' +
      SIDEBAR_DESTS.map(function (d) {
        var active = path === d.href ? ' is-active' : '';
        var current = path === d.href ? ' aria-current="page"' : '';
        return '<a href="' + d.href + '" class="th-sidebar-link' + active + '"' + current + '>' +
          '<svg class="th-icon" aria-hidden="true"><use href="#icon-' + d.icon + '" xlink:href="#icon-' + d.icon + '"></use></svg>' +
          '<span>' + d.label + '</span></a>';
      }).join('') +
      '</div>';
    document.body.insertBefore(sidebar, document.body.firstChild);
  }

  function inject() {
    document.body.classList.add('th-tool-page');
    if (onLogin) return;
    document.body.classList.add('th-has-bottomnav');
    injectSidebar();
    injectFlagButton();

    var nav = document.createElement('nav');
    nav.className = 'th-bottom-nav';
    nav.setAttribute('aria-label', 'Quick navigation');
    nav.innerHTML = DESTS.map(function (d) {
      var active = path === d.href ? ' is-active' : '';
      var current = path === d.href ? ' aria-current="page"' : '';
      return '<a href="' + d.href + '" class="' + active.trim() + '"' + current + '>' +
        '<span class="th-bn-icon" aria-hidden="true"><svg class="th-icon" aria-hidden="true"><use href="#icon-' + d.icon + '" xlink:href="#icon-' + d.icon + '"></use></svg></span>' +
        '<span>' + d.label + '</span></a>';
    }).join('');
    document.body.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();

// ---------------------------------------------------------------------------
// DISPLAY DENSITY TOGGLE -- added 2026-08-16. A personal display
// preference (comfortable vs compact row spacing), so it lives in plain
// localStorage rather than the synced data blob -- there's no reason a
// density choice made on one device should override another's screen
// size preference. Applies as a body class; each page's own CSS defines
// what ".is-compact-density" actually tightens for its own row markup.
// ---------------------------------------------------------------------------
const DENSITY_KEY = 'th_density';

// Shared init-failure diagnostic banner (2026-08-20). Originally built
// as a one-off on finance.html and job-tracker.html after those pages'
// real bugs were nearly impossible to pin down from a description and
// a screenshot alone -- a visible error message turned "still isn't
// working" into an exact line number in minutes. Extracted here as one
// shared implementation so every other page can get the same
// protection without 9 separate, slightly-inconsistent copies of the
// same banner HTML.
function showInitErrorBanner(pageLabel, error) {
  const errorBanner = document.createElement('div');
  errorBanner.style.cssText = 'background:#3a1414; border:1px solid #e05252; border-radius:8px; padding:14px 16px; margin:16px 0; color:#ffb3b3; font-size:13.5px; font-family:monospace; white-space:pre-wrap; word-break:break-word;';
  errorBanner.textContent = pageLabel + ' page failed to load properly.\n\nError: ' + (error && error.message ? error.message : String(error)) + '\n\nStack: ' + (error && error.stack ? error.stack : 'unavailable') + '\n\nPlease screenshot this and share it.';
  document.body.insertBefore(errorBanner, document.body.firstChild);
  if (typeof logClientError === 'function') {
    logClientError(pageLabel + ' init failed: ' + (error && error.message), pageLabel, error && error.stack, null, null);
  }
}

function loadDensityPreference() {
  try { return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'; }
  catch (e) { return 'comfortable'; }
}

function applyDensityPreference() {
  const density = loadDensityPreference();
  document.body.classList.toggle('is-compact-density', density === 'compact');
  document.querySelectorAll('[data-density-toggle]').forEach(btn => {
    btn.setAttribute('aria-pressed', density === 'compact' ? 'true' : 'false');
    btn.textContent = density === 'compact' ? 'Comfortable view' : 'Compact view';
  });
}

function toggleDensityPreference() {
  const next = loadDensityPreference() === 'compact' ? 'comfortable' : 'compact';
  try { localStorage.setItem(DENSITY_KEY, next); } catch (e) { /* ignore */ }
  applyDensityPreference();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDensityPreference);
  } else {
    applyDensityPreference();
  }
}
// ---------------------------------------------------------------------------
// SHARED ICON SPRITE -- added 2026-08-16 (visual redesign v3)
// Replaces the 29 semantic pictographic emoji used across the tool suite
// (search/trash/camera/wrench/bell/etc.) with one original, consistent
// stroke-based SVG set. Emoji render completely differently per OS --
// Windows renders them flatter and more literal than iOS/Android -- so
// the same icon looked like two different apps depending on the device.
// This sprite is injected once into every page (from this shared file)
// as a hidden <svg><defs><symbol>...</symbol></defs></svg> block; every
// page then references icons with <svg class="th-icon"><use href="#icon-
// name"/></svg>, sized and colored entirely by CSS (.th-icon in
// styles.css), so every icon automatically matches the current theme
// and inherits its container's text color.
//
// Left alone on purpose: plain typographic marks (chevrons, checkmarks,
// arrows like ▼ ▲ ✓ ⋮ ❮ ❯ ↻ ↩) already render identically across
// platforms since they're basic Unicode punctuation, not multi-color
// emoji glyphs -- converting those to SVG would add files for zero
// visual benefit.
// ---------------------------------------------------------------------------
(function () {
  if (typeof document === 'undefined') return;
  if (document.getElementById('thIconSprite')) return;

  var SPRITE_SVG =
    '<svg id="thIconSprite" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden;" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +

    '<symbol id="icon-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.3" y1="15.3" x2="20.5" y2="20.5"/></symbol>' +

    '<symbol id="icon-trash" viewBox="0 0 24 24"><path d="M5 7h14"/><path d="M9 7V4.8c0-.44.36-.8.8-.8h4.4c.44 0 .8.36.8.8V7"/><path d="M7 7l1 13.2c.03.44.4.8.85.8h6.3c.44 0 .82-.36.85-.8L17 7"/><line x1="10" y1="11" x2="10.4" y2="17"/><line x1="14" y1="11" x2="13.6" y2="17"/></symbol>' +

    '<symbol id="icon-camera" viewBox="0 0 24 24"><path d="M4 8.5c0-.83.67-1.5 1.5-1.5H8l1.2-2h5.6l1.2 2h2.5c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5h-13c-.83 0-1.5-.67-1.5-1.5z"/><circle cx="12" cy="13" r="3.4"/></symbol>' +

    '<symbol id="icon-chart" viewBox="0 0 24 24"><line x1="4" y1="20" x2="20" y2="20"/><rect x="5.5" y="13" width="3.4" height="7"/><rect x="10.3" y="8" width="3.4" height="12"/><rect x="15.1" y="4.5" width="3.4" height="15.5"/></symbol>' +

    '<symbol id="icon-star" viewBox="0 0 24 24"><path d="M 12.0 2.8 L 14.7 8.28 L 20.75 9.16 L 16.37 13.42 L 17.41 19.44 L 12.0 16.6 L 6.59 19.44 L 7.63 13.42 L 3.25 9.16 L 9.3 8.28 Z"/></symbol>' +
    '<symbol id="icon-star-filled" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M 12.0 2.8 L 14.7 8.28 L 20.75 9.16 L 16.37 13.42 L 17.41 19.44 L 12.0 16.6 L 6.59 19.44 L 7.63 13.42 L 3.25 9.16 L 9.3 8.28 Z"/></symbol>' +

    '<symbol id="icon-wrench" viewBox="0 0 24 24"><path d="M14.7 9.3a4 4 0 0 1-5.4 5.4L4 20l-1-1 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.4 2.4 1.5 1.5z"/></symbol>' +

    '<symbol id="icon-edit" viewBox="0 0 24 24"><path d="M16.5 4.5l3 3L8 19H5v-3z"/></symbol>' +

    '<symbol id="icon-shuffle" viewBox="0 0 24 24"><path d="M3 7h3.5l7 10H20"/><path d="M17 4l3 3-3 3"/><path d="M3 17h3.5l3.2-4.6"/><path d="M17 20l3-3-3-3"/><path d="M11.5 8.6L13.5 5.7"/></symbol>' +

    '<symbol id="icon-bell" viewBox="0 0 24 24"><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></symbol>' +

    '<symbol id="icon-shield" viewBox="0 0 24 24"><path d="M12 3.5l7 2.6v5.4c0 5-3 8-7 9.4-4-1.4-7-4.4-7-9.4V6.1z"/><path d="M9 12l2 2 4-4.2"/></symbol>' +

    '<symbol id="icon-receipt" viewBox="0 0 24 24"><path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><line x1="9" y1="8.5" x2="15" y2="8.5"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="15.5" x2="13" y2="15.5"/></symbol>' +

    '<symbol id="icon-map" viewBox="0 0 24 24"><path d="M9 4.5L4 6.5v13l5-2 6 2 5-2v-13l-5 2z"/><line x1="9" y1="4.5" x2="9" y2="17.5"/><line x1="15" y1="6.5" x2="15" y2="19.5"/><circle cx="12" cy="11.5" r="1.3" fill="currentColor" stroke="none"/></symbol>' +

    '<symbol id="icon-scroll" viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="17" rx="1.5"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="11.5" x2="16" y2="11.5"/><line x1="8" y1="15" x2="13" y2="15"/></symbol>' +

    '<symbol id="icon-calendar" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></symbol>' +

    '<symbol id="icon-dollar" viewBox="0 0 24 24"><text x="12" y="17.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" fill="currentColor" stroke="none">$</text></symbol>' +

    '<symbol id="icon-toolbox" viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="10.5" rx="1.5"/><path d="M8 9V6.5c0-.8.7-1.5 1.5-1.5h5c.8 0 1.5.7 1.5 1.5V9"/><line x1="3" y1="13.5" x2="21" y2="13.5"/><line x1="10.5" y1="13.5" x2="10.5" y2="15.5"/><line x1="13.5" y1="13.5" x2="13.5" y2="15.5"/></symbol>' +

    '<symbol id="icon-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6"/></symbol>' +

    '<symbol id="icon-settings" viewBox="0 0 24 24"><line x1="3.5" y1="7" x2="20.5" y2="7"/><circle cx="8.5" cy="7" r="2.3"/><line x1="3.5" y1="12" x2="20.5" y2="12"/><circle cx="16" cy="12" r="2.3"/><line x1="3.5" y1="17" x2="20.5" y2="17"/><circle cx="11" cy="17" r="2.3"/></symbol>' +

    '<symbol id="icon-link" viewBox="0 0 24 24"><rect x="3" y="9" width="9" height="6" rx="3" transform="rotate(-45 7.5 12)"/><rect x="12" y="9" width="9" height="6" rx="3" transform="rotate(-45 16.5 12)"/></symbol>' +

    '<symbol id="icon-clipboard" viewBox="0 0 24 24"><rect x="5" y="4.5" width="14" height="17" rx="1.5"/><rect x="9" y="3" width="6" height="3" rx="1"/><line x1="8" y1="10.5" x2="16" y2="10.5"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="17.5" x2="13" y2="17.5"/></symbol>' +

    '<symbol id="icon-warning" viewBox="0 0 24 24"><path d="M12 4l9.5 16.5H2.5z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none"/></symbol>' +

    '<symbol id="icon-flask" viewBox="0 0 24 24"><path d="M10 3.5h4"/><path d="M10.5 3.5v6l-5 9c-.6 1.1.2 2.5 1.5 2.5h10c1.3 0 2.1-1.4 1.5-2.5l-5-9v-6"/><line x1="8.5" y1="14.5" x2="15.5" y2="14.5"/></symbol>' +

    '<symbol id="icon-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></symbol>' +

    '<symbol id="icon-rocket" viewBox="0 0 24 24"><path d="M12 2.5c3 2 4.5 5.5 4.5 9.5 0 2-.5 3.7-1.3 5.2h-6.4C8 15.7 7.5 14 7.5 12c0-4 1.5-7.5 4.5-9.5z"/><circle cx="12" cy="10.5" r="1.6"/><path d="M8.8 17.2L6 20.5M15.2 17.2l2.8 3.3"/></symbol>' +
    '<symbol id="icon-trending" viewBox="0 0 24 24"><polyline points="3.5,17 9,11.5 13,15.5 20.5,7"/><polyline points="14.5,7 20.5,7 20.5,13"/></symbol>' +

    '<symbol id="icon-note" viewBox="0 0 24 24"><rect x="4.5" y="3.5" width="15" height="17" rx="1.5"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="11.5" x2="16" y2="11.5"/><line x1="8" y1="15" x2="12.5" y2="15"/></symbol>' +

    '<symbol id="icon-folder" viewBox="0 0 24 24"><path d="M3.5 6.5c0-.8.7-1.5 1.5-1.5h4l2 2.3h8c.8 0 1.5.7 1.5 1.5v9.7c0 .8-.7 1.5-1.5 1.5H5c-.8 0-1.5-.7-1.5-1.5z"/></symbol>' +

    '<symbol id="icon-bolt" viewBox="0 0 24 24"><path d="M13 2.5L5 14h5.5L11 21.5 19 10h-5.5z"/></symbol>' +

    '<symbol id="icon-signal" viewBox="0 0 24 24"><path d="M4.5 19.5a10.5 10.5 0 0 1 15 0"/><path d="M7.8 16.2a6 6 0 0 1 8.4 0"/><circle cx="12" cy="19.5" r="1.1" fill="currentColor" stroke="none"/></symbol>' +

    '<symbol id="icon-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.5" ry="8.5"/><line x1="3.7" y1="9.5" x2="20.3" y2="9.5"/><line x1="3.7" y1="14.5" x2="20.3" y2="14.5"/></symbol>' +

    '<symbol id="icon-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.5 2.5 5.5-5.6"/></symbol>' +

    '<symbol id="icon-inbox" viewBox="0 0 24 24"><path d="M4 12.5L6.5 5h11L20 12.5"/><path d="M4 12.5v6c0 .8.7 1.5 1.5 1.5h13c.8 0 1.5-.7 1.5-1.5v-6h-4.8a2.7 2.7 0 0 1-5.4 0z"/></symbol>' +

    '<symbol id="icon-home" viewBox="0 0 24 24"><path d="M4 11.5L12 4l8 7.5"/><path d="M6 10v9.5c0 .8.7 1.5 1.5 1.5h9c.8 0 1.5-.7 1.5-1.5V10"/><path d="M9.5 21v-5.5c0-.55.45-1 1-1h3c.55 0 1 .45 1 1V21"/></symbol>' +

    '<symbol id="icon-mic" viewBox="0 0 24 24"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5.5A3.5 3.5 0 0 0 12 15z"/><path d="M6 11.5a6 6 0 0 0 12 0"/><line x1="12" y1="17.5" x2="12" y2="21"/><line x1="8.5" y1="21" x2="15.5" y2="21"/></symbol>' +

    '<symbol id="icon-terminal" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.3l3.3 2.7-3.3 2.7"/><line x1="12" y1="14.7" x2="16.5" y2="14.7"/></symbol>' +

    '<symbol id="icon-book" viewBox="0 0 24 24"><path d="M12 6c-1.9-1.4-4.2-2-6.8-2-.7 0-1.2.6-1.2 1.2v11.6c0 .7.5 1.2 1.2 1.2 2.6 0 4.9.6 6.8 2 1.9-1.4 4.2-2 6.8-2 .7 0 1.2-.5 1.2-1.2V5.2c0-.7-.5-1.2-1.2-1.2-2.6 0-4.9.6-6.8 2z"/><line x1="12" y1="6" x2="12" y2="19"/></symbol>' +

    '<symbol id="icon-first-job" viewBox="0 0 48 48"><rect x="8" y="7" width="26" height="34" rx="3"/><rect x="16" y="4" width="10" height="6" rx="1.5"/><line x1="13" y1="19" x2="29" y2="19"/><line x1="13" y1="25" x2="29" y2="25"/><line x1="13" y1="31" x2="23" y2="31"/><circle cx="35" cy="35" r="8" fill="var(--bg-panel-2)" stroke="#ff8000"/><line x1="35" y1="31.5" x2="35" y2="38.5" stroke="#ff8000"/><line x1="31.5" y1="35" x2="38.5" y2="35" stroke="#ff8000"/></symbol>' +

    '</defs></svg>';

  function injectSprite() {
    document.body.insertAdjacentHTML('afterbegin', SPRITE_SVG);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSprite);
  } else {
    injectSprite();
  }
})();

// ---------------------------------------------------------------------------
// JUMP-NAV SCROLL-SPY -- added 2026-08-16
// Highlights whichever jump-nav pill corresponds to the section currently
// in view, using IntersectionObserver rather than a scroll listener (no
// per-frame math, no debouncing needed, and it naturally handles sections
// of very different heights). Purely additive: pages without a .jump-nav,
// or whose links don't all resolve to an in-page section, are silently
// skipped -- this never assumes a page's structure.
//
// This closes a real inconsistency: the mobile bottom nav and tab buttons
// both had a clear "you are here" treatment, but the jump-nav -- despite
// sitting on every page a person scrolls through -- had none. Reuses the
// same is-active class + orange-accent language as those two so all three
// "current location" indicators in the app now agree with each other.
// ---------------------------------------------------------------------------
(function () {
  if (typeof document === 'undefined' || typeof IntersectionObserver === 'undefined') return;

  function initJumpNavScrollSpy() {
    const nav = document.querySelector('.jump-nav');
    if (!nav) return;

    const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
    const sections = links
      .map(a => ({ link: a, el: document.getElementById(a.getAttribute('href').slice(1)) }))
      .filter(pair => pair.el);
    if (sections.length === 0) return;

    function setActive(id) {
      links.forEach(a => {
        const isMatch = a.getAttribute('href') === '#' + id;
        a.classList.toggle('is-active', isMatch);
        if (isMatch) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    }

    // rootMargin biases the trigger line toward the top of the viewport
    // (just under the sticky header + jump-nav itself) rather than the
    // exact center, so the pill updates right as a section's heading
    // scrolls into that zone -- matching where someone's eye actually is.
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting);
      if (visible.length === 0) return;
      // If multiple sections are simultaneously in the trigger band
      // (short sections, fast scroll), prefer the one closest to top.
      visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      setActive(visible[0].target.id);
    }, { rootMargin: '-120px 0px -70% 0px', threshold: 0 });

    sections.forEach(pair => observer.observe(pair.el));
    // Set an initial state immediately rather than waiting for the first
    // scroll/intersection event, so the pill isn't blank on page load.
    setActive(sections[0].el.id);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initJumpNavScrollSpy);
  } else {
    initJumpNavScrollSpy();
  }
})();

// ---------------------------------------------------------------------------
// OFFLINE BANNER -- added 2026-08-18 (item #5). Distinct from the
// sync-pending indicator (sync.js's th-sync-pending-change event), which
// only ever signals "this device has local edits it hasn't successfully
// pushed yet" -- it says nothing about whether the device currently has
// a network connection at all. This is the connectivity signal itself,
// which matters a lot for an app used at job sites with spotty signal.
// ---------------------------------------------------------------------------
(function () {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return;

  let banner = null;
  function ensureBanner() {
    if (banner) return banner;
    banner = document.createElement('div');
    banner.className = 'th-offline-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '<svg class="th-icon" aria-hidden="true"><use href="#icon-signal" xlink:href="#icon-signal"></use></svg><span>You\'re offline \u2014 changes will sync once you\'re back online.</span>';
    document.body.appendChild(banner);
    return banner;
  }

  function updateOfflineState() {
    const offline = !navigator.onLine;
    if (offline) {
      ensureBanner().classList.add('is-shown');
      document.body.classList.add('th-is-offline');
    } else if (banner) {
      banner.classList.remove('is-shown');
      document.body.classList.remove('th-is-offline');
    }
  }

  window.addEventListener('online', updateOfflineState);
  window.addEventListener('offline', updateOfflineState);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateOfflineState);
  } else {
    updateOfflineState();
  }
})();

// ---------------------------------------------------------------------------
// PWA INSTALL PROMPT -- added 2026-08-18 (item #3). Two genuinely
// different paths, not one feature with a gap:
//
// - Chrome/Android etc. fire a real `beforeinstallprompt` event this
//   code can capture and trigger programmatically on tap.
// - iOS Safari NEVER fires that event -- Apple has never implemented
//   it, on purpose, as part of keeping the install decision manual.
//   Since this app's primary audience is confirmed iPhone users, only
//   building the Android path would silently leave the actual target
//   audience with nothing. iOS gets its own banner with the real manual
//   steps (Share -> Add to Home Screen) instead.
//
// Neither path shows anything if already running installed
// (display-mode: standalone), and both remember a dismissal
// permanently so this never nags someone who said no once.
// ---------------------------------------------------------------------------
(function () {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
  const DISMISS_KEY = 'th_install_prompt_dismissed';

  function alreadyInstalled() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  function wasDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  }
  function dismiss(banner) {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* ignore */ }
    banner.classList.remove('is-shown');
    setTimeout(() => banner.remove(), 250);
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }
  function isSafari() {
    return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  }

  function showBanner(message, actionLabel, onAction) {
    const banner = document.createElement('div');
    banner.className = 'th-install-banner';
    banner.innerHTML =
      '<span>' + message + '</span>' +
      '<span class="th-install-actions">' +
        (actionLabel ? '<button class="th-install-action">' + actionLabel + '</button>' : '') +
        '<button class="th-install-dismiss" aria-label="Dismiss">&times;</button>' +
      '</span>';
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('is-shown'));
    banner.querySelector('.th-install-dismiss').addEventListener('click', () => dismiss(banner));
    if (actionLabel) {
      banner.querySelector('.th-install-action').addEventListener('click', () => {
        onAction();
        dismiss(banner);
      });
    }
  }

  function init() {
    if (alreadyInstalled() || wasDismissed()) return;

    if (isIOS() && isSafari()) {
      // No programmatic prompt exists here -- this IS the feature for
      // this platform, not a fallback for a missing one.
      showBanner('Add Triple H to your Home Screen: tap Share, then "Add to Home Screen."', null, null);
      return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      showBanner('Add Triple H to your Home Screen for the full app experience.', 'Install', () => {
        e.prompt();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
