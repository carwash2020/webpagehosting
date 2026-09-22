// tools-nav-pwa.js -- one of 4 files split out of the former
// tools-common.js (2026-08-20, structural item #42). See tools-effects.js
// for the full explanation of why and how this split was done safely.
//
// This file: the app shell (bottom bar, Create sheet, header actions,
// More drawer, desktop sidebar), display-density toggle, the shared icon
// sprite injection, jump-nav scroll-spy, the offline banner, and the PWA
// install prompt.

// ---------------------------------------------------------------------------
// APP SHELL v2 (2026-09-22) -- one app, not a pile of pages.
//
// Injected here so every tool page gets the same shell from one file.
// Styled by the "APP SHELL v2" block in styles-tools.css (mirrored into
// runway-dashboard.html, which keeps its own copy of the shell CSS).
//
// Phone and tablet (<=1023px), the bottom bar is five slots:
//
//     Home  ·  Jobs  ·  ( + )  ·  Clients  ·  Money
//
//   - ( + ) opens the Create sheet: every "start something" action in the
//     app (job, invoice, quote, quick charge, expense, income, contact,
//     contract, review request) one tap away from any screen. Before this,
//     each lived on its own page, so starting one meant knowing which page
//     owned it first.
//   - Money is ONE tab for the two money pages (Invoices and Finance). It
//     opens whichever of the two you used last on this device, and on both
//     pages a two-segment switch sits in the header where the page title
//     was, so they read as two halves of one section rather than two
//     unrelated destinations. Permissions still apply per page: someone
//     who can see only one of the two gets that one, and no switch.
//   - More moved out of the bar into the header (the grid button at the
//     top right), next to Search -- the same place a phone app keeps its
//     menu. The floating search and flag buttons that used to hover over
//     page content (and covered it -- see the 2026-09-22 fade fix) are
//     gone on phones: Search is a header button, and "Flag this page"
//     is a row in the More drawer.
//
// Desktop (>=1024px) keeps the sidebar, which lists every page, and gains
// a New button at the top that opens the same Create sheet as a centred
// dialog. Pressing N anywhere (outside a text field) does the same.
//
// Also tags <body> with th-tool-page (ambient background + radius tokens)
// and th-has-bottomnav / th-has-sidebar (both mean "the nav shell is
// here" -- set together, unconditionally). login.html is excluded: no
// point navigating before you're signed in.
// ---------------------------------------------------------------------------
(function () {
  if (typeof document === 'undefined') return;
  var path = (window.location && window.location.pathname) || '';
  var onLogin = /\/login\.html$/.test(path);

  // Money: one tab over two pages. MONEY_LAST_KEY is a per-device
  // convenience (plain localStorage, never synced), the same kind of
  // preference as th_tracker_view / th_finance_tab / th_runway_tab.
  var MONEY_PAGES = ['/tools/invoice-generator.html', '/tools/finance.html'];
  var MONEY_LAST_KEY = 'th_money_last';
  function isMoneyPath(p) { return MONEY_PAGES.indexOf(p) > -1; }
  if (isMoneyPath(path)) {
    try { localStorage.setItem(MONEY_LAST_KEY, path); } catch (e) { /* ignore */ }
  }
  function lastMoneyHref() {
    var last = null;
    try { last = localStorage.getItem(MONEY_LAST_KEY); } catch (e) { /* ignore */ }
    return isMoneyPath(last) ? last : MONEY_PAGES[0];
  }

  // Bottom bar. `create: true` is the ( + ) button; `money: true` is the
  // Money tab, whose href is resolved at injection time (last used) and
  // again once the role loads (permissions).
  var DESTS = [
    { href: '/tools/workspace.html',   icon: 'home',   label: 'Home' },
    { href: '/tools/job-tracker.html', icon: 'wrench', label: 'Jobs' },
    { create: true,                    icon: 'plus',   label: 'New' },
    { href: '/tools/clients.html',     icon: 'users',  label: 'Clients' },
    { money: true,                     icon: 'dollar', label: 'Money' }
  ];

  // Per-href permission checks for every restricted destination that
  // can appear in the sidebar/More sheet (out of everything in
  // SIDEBAR_DESTS below). Replaces the old single canManageBusinessFinances()
  // bundle check -- that function was removed in the 2026-09-02 granular
  // permission split (see auth.js) and this map went stale along with
  // it, silently turning hideRestrictedNavLinks() below into a no-op
  // (the `typeof ... !== 'function'` guard always took the early
  // return). Mirrors workspace.html's own TILE_PERMISSION_CHECKS map so
  // the dashboard tiles and this nav can never disagree about who sees
  // what. Dev Tools is intentionally separate (checked directly below)
  // since it gates on hasDevToolsAccess(), not one of these.
  var NAV_PERMISSION_CHECKS = {
    '/tools/finance.html': function () { return typeof canViewFinance === 'function' && canViewFinance(); },
    '/tools/runway-dashboard.html': function () { return typeof canViewRunway === 'function' && canViewRunway(); },
    '/tools/invoice-generator.html': function () { return typeof canManageInvoices === 'function' && canManageInvoices(); },
    // clients.html left this map 2026-09-22 (Workspace rework part 2): the
    // page opens on the client list now -- the same local client data
    // Job Tracker already shows every account -- and gates its own Portal
    // tab (the portal admin console) on canManageInvoices instead.
    '/tools/contract-generator.html': function () { return typeof canManageContracts === 'function' && canManageContracts(); },
    '/tools/review-request.html': function () { return typeof canManageReviews === 'function' && canManageReviews(); },
    '/tools/dev-tools.html': function () { return typeof hasDevToolsAccess === 'function' && hasDevToolsAccess(); }
  };

  // Hides specific already-injected nav/sidebar links by href, rather
  // than re-rendering the whole nav from scratch -- avoids a visible
  // flicker on every page load while the role is still being fetched.
  // Listens for th-role-loaded (dispatched by loadCurrentUserRole() in
  // auth.js) so this reacts centrally, on every tool page, without
  // needing each page's own init sequence to explicitly call this --
  // most tool pages never call loadCurrentUserRole() directly at all,
  // but plenty call initSyncOnLoad(), which does, and this only needs
  // to fire once, whenever that happens to resolve on this page.
  // The Money tab is skipped here and handled by applyMoneyPermissions()
  // instead: its href is one of two gated pages, and hiding it because
  // ONE of them is off-limits would be wrong when the other is allowed.
  function hideRestrictedNavLinks() {
    Object.keys(NAV_PERMISSION_CHECKS).forEach(function (href) {
      if (NAV_PERMISSION_CHECKS[href]()) return;
      document.querySelectorAll('a[href="' + href + '"]:not(.th-bn-money)').forEach(function (el) {
        el.style.display = 'none';
      });
    });
    applyMoneyPermissions();
    refreshCreateSheet();
  }
  window.addEventListener('th-role-loaded', hideRestrictedNavLinks);

  function applyMoneyPermissions() {
    var canInvoices = NAV_PERMISSION_CHECKS['/tools/invoice-generator.html']();
    var canFinance = NAV_PERMISSION_CHECKS['/tools/finance.html']();
    var tab = document.querySelector('.th-bn-money');
    if (tab) {
      if (!canInvoices && !canFinance) tab.style.display = 'none';
      else if (!canInvoices) tab.setAttribute('href', MONEY_PAGES[1]);
      else if (!canFinance) tab.setAttribute('href', MONEY_PAGES[0]);
    }
    var sw = document.querySelector('.th-money-switch');
    if (sw) {
      var both = canInvoices && canFinance;
      sw.hidden = !both;
      document.body.classList.toggle('th-money-switch-on', both);
    }
  }

  // Desktop sidebar (2026-08-20), requested directly: a persistent
  // left sidebar on desktop, replacing top-tab-only navigation --
  // styled entirely by the ".th-desktop-sidebar" rules in
  // styles-tools.css, which only display it at min-width:1024px;
  // mobile never sees it (the bottom nav above stays exactly as it
  // was). A fuller destination list than the bottom nav's 5 items,
  // since the sidebar has real vertical room -- still scoped to
  // everyday tools, not admin-only pages.
  // Grouped Work / Money / Office. Labels match the short names on the
  // bottom bar. Calendar dropped out 2026-09-21 when it became a view
  // inside Job Tracker (/tools/job-tracker.html#calendar); POS the same
  // day, as the Quick charge tab inside Invoices
  // (/tools/invoice-generator.html#pos). Pages and permissions are
  // otherwise unchanged.
  var SIDEBAR_DESTS = [
    { group: 'Work',   href: '/tools/workspace.html',          icon: 'home',     label: 'Dashboard' },
    { group: 'Work',   href: '/tools/job-tracker.html',        icon: 'wrench',   label: 'Job Tracker' },
    { group: 'Work',   href: '/tools/route-planner.html',      icon: 'map',      label: 'Route Planner' },
    { group: 'Work',   href: '/tools/clients.html',            icon: 'users',    label: 'Clients' },
    { group: 'Money',  href: '/tools/invoice-generator.html',  icon: 'receipt',  label: 'Invoices' },
    { group: 'Money',  href: '/tools/finance.html',            icon: 'dollar',   label: 'Finance' },
    { group: 'Money',  href: '/tools/runway-dashboard.html',   icon: 'chart',    label: 'Runway Dashboard' },
    { group: 'Office', href: '/tools/contract-generator.html', icon: 'scroll',   label: 'Contracts' },
    { group: 'Office', href: '/tools/review-request.html',     icon: 'star',     label: 'Reviews' },
    { group: 'Office', href: '/tools/parts-reference.html',    icon: 'book',     label: 'Appliance Wiki' },
    { group: 'Office', href: '/tools/dev-tools.html',          icon: 'terminal', label: 'Dev Tools' },
    { group: 'Office', href: '/tools/settings.html',           icon: 'gear',     label: 'Settings' }
  ];

  // Everything the sidebar lists that the bar does not -- the bar's own
  // links plus both Money pages (the Money tab covers them) -- goes in
  // the More drawer. Derived from SIDEBAR_DESTS so the two lists cannot
  // drift.
  var PRIMARY_HREFS = {};
  DESTS.forEach(function (d) { if (d.href) PRIMARY_HREFS[d.href] = true; });
  MONEY_PAGES.forEach(function (href) { PRIMARY_HREFS[href] = true; });
  var MORE_DESTS = SIDEBAR_DESTS.filter(function (d) { return !PRIMARY_HREFS[d.href]; });

  // The Create sheet. Every entry is a deep link to a form that already
  // exists and already opens itself from its hash (job-tracker #add-job,
  // invoice-generator #invoice/#quote/#pos, finance #expenses/#income...),
  // so this adds a front door, not a second copy of any form. `perm`
  // names an auth.js check, the same ones the nav and the command palette
  // use, so nobody is offered a form their account cannot open.
  var CREATE_ACTIONS = [
    { label: 'Job',          hint: 'Put it on the schedule',      icon: 'wrench',  href: '/tools/job-tracker.html#add-job' },
    { label: 'Invoice',      hint: 'Bill a finished job',         icon: 'receipt', href: '/tools/invoice-generator.html#invoice', perm: 'canManageInvoices' },
    { label: 'Quote',        hint: 'Price it before you start',   icon: 'clipboard', href: '/tools/invoice-generator.html#quote', perm: 'canManageInvoices' },
    { label: 'Quick charge', hint: 'Take a card now',             icon: 'card',    href: '/tools/invoice-generator.html#pos', perm: 'canManageInvoices' },
    { label: 'Expense',      hint: 'Snap the receipt',            icon: 'camera',  href: '/tools/finance.html#expenses', perm: 'canViewFinance' },
    { label: 'Income',       hint: 'Cash or check received',      icon: 'dollar',  href: '/tools/finance.html#income', perm: 'canViewFinance' },
    { label: 'Client',       hint: 'Add to your client list',     icon: 'user-plus', href: '/tools/clients.html#new' },
    { label: 'Contract',     hint: 'Work order or agreement',     icon: 'scroll',  href: '/tools/contract-generator.html', perm: 'canManageContracts' },
    { label: 'Review ask',   hint: 'Text a Google review link',   icon: 'star',    href: '/tools/review-request.html', perm: 'canManageReviews' }
  ];

  function isMorePage() {
    return MORE_DESTS.some(function (d) { return path === d.href; });
  }

  function iconSvg(name) {
    return '<svg class="th-icon" aria-hidden="true"><use href="#icon-' + name + '" xlink:href="#icon-' + name + '"></use></svg>';
  }

  function destLinksHtml(dests) {
    var html = '';
    var lastGroup = '';
    dests.forEach(function (d) {
      if (d.group && d.group !== lastGroup) {
        html += '<div class="th-sidebar-group">' + d.group + '</div>';
        lastGroup = d.group;
      }
      var active = path === d.href ? ' is-active' : '';
      var current = path === d.href ? ' aria-current="page"' : '';
      html += '<a href="' + d.href + '" class="th-sidebar-link' + active + '"' + current + '>' +
        '<span class="th-hex-icon">' + iconSvg(d.icon) + '</span>' +
        '<span>' + d.label + '</span></a>';
    });
    return html;
  }

  // ---- sheets (More drawer + Create) -------------------------------------
  // Both are bottom sheets on a phone and centred cards on a tablet; the
  // Create sheet is also a centred dialog on desktop. One small open/close
  // helper for both: focus moves into the sheet on open (and is held there
  // by a Tab trap), Esc or a backdrop tap closes it, and focus goes back
  // to whatever opened it.
  var sheetReturnFocus = null;
  function openSheet(id, opener) {
    closeAllSheets();
    var sheet = document.getElementById(id);
    if (!sheet) return;
    sheetReturnFocus = opener || document.activeElement;
    sheet.removeAttribute('hidden');
    document.body.classList.add(id === 'thMoreSheet' ? 'th-more-open' : 'th-create-open');
    if (opener) opener.setAttribute('aria-expanded', 'true');
    if (typeof haptic === 'function') haptic('light');
    var first = sheet.querySelector('a:not([hidden]):not([style*="display: none"]), button:not([hidden])');
    if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 30);
  }
  function closeSheet(id, restoreFocus) {
    var sheet = document.getElementById(id);
    if (!sheet || sheet.hasAttribute('hidden')) return;
    sheet.setAttribute('hidden', '');
    document.body.classList.remove(id === 'thMoreSheet' ? 'th-more-open' : 'th-create-open');
    document.querySelectorAll('[aria-controls="' + id + '"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    if (restoreFocus !== false && sheetReturnFocus && typeof sheetReturnFocus.focus === 'function') {
      try { sheetReturnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    sheetReturnFocus = null;
  }
  function closeAllSheets() {
    closeSheet('thMoreSheet', false);
    closeSheet('thCreateSheet', false);
  }
  function toggleSheet(id, opener) {
    var sheet = document.getElementById(id);
    if (sheet && !sheet.hasAttribute('hidden')) closeSheet(id);
    else openSheet(id, opener);
  }
  function openSheetId() {
    if (document.body.classList.contains('th-create-open')) return 'thCreateSheet';
    if (document.body.classList.contains('th-more-open')) return 'thMoreSheet';
    return null;
  }
  function wireSheet(sheet) {
    sheet.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('[data-th-sheet-close]')) closeSheet(sheet.id);
    });
    var panel = sheet.querySelector('.th-sheet-panel');
    if (panel && typeof attachSwipeToDismiss === 'function') {
      attachSwipeToDismiss(panel, function () { closeSheet(sheet.id); });
    }
  }
  document.addEventListener('keydown', function (e) {
    var id = openSheetId();
    if (id) {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(id); return; }
      if (e.key === 'Tab') {
        var sheet = document.getElementById(id);
        var focusable = Array.prototype.filter.call(
          sheet.querySelectorAll('a[href], button:not([disabled])'),
          function (el) { return el.offsetParent !== null; }
        );
        if (!focusable.length) return;
        var firstEl = focusable[0], lastEl = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
      return;
    }
    // N opens Create, the way a desktop app binds New. Ignored while
    // typing, with a modifier held, or with any dialog already open.
    if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      var el = document.activeElement;
      var tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;
      if (document.querySelector('.help-modal-overlay.is-open, .th-cmdk-overlay.is-open, #customDialogOverlay.is-open, .onboarding-card')) return;
      e.preventDefault();
      openSheet('thCreateSheet', document.querySelector('.th-sidebar-new') || document.querySelector('.th-bn-create'));
    }
  });

  var FLAGGED_ITEMS_KEY = 'th_flagged_items';
  function openFlagDialog() {
    if (typeof showFlagDialog !== 'function') return; // tools-dialogs.js not loaded yet -- fails silently rather than throwing
    var pageLabel = (document.title || '').split('·')[0].trim() || location.pathname;
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
  }

  // "How this page works": every tool page has its own help modal behind a
  // ? button in its header; the drawer row just presses that button, so
  // the drawer never needs to know which modal a page uses.
  function pageHelpButton() {
    return document.querySelector('.hub-header-right .help-btn[onclick*="openHelpModal"], header#mainContent .help-btn[onclick*="openHelpModal"]');
  }

  function injectMoreSheet() {
    if (document.getElementById('thMoreSheet')) return;
    var sheet = document.createElement('div');
    sheet.id = 'thMoreSheet';
    sheet.className = 'th-more-sheet th-sheet';
    sheet.setAttribute('hidden', '');
    var tiles = MORE_DESTS.map(function (d) { return { href: d.href, icon: d.icon, label: d.label }; });
    sheet.innerHTML =
      '<div class="th-more-sheet-backdrop th-sheet-backdrop" data-th-sheet-close="1"></div>' +
      '<div class="th-more-sheet-panel th-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="thMoreSheetTitle">' +
        '<div class="th-more-sheet-handle th-sheet-handle" aria-hidden="true"></div>' +
        '<h2 class="th-more-sheet-title th-sheet-title" id="thMoreSheetTitle">More tools</h2>' +
        '<div class="th-more-sheet-links">' +
          destLinksHtml(tiles).replace(/th-sidebar-link/g, 'th-more-sheet-link') +
        '</div>' +
        '<div class="th-more-sheet-utils">' +
          (pageHelpButton() ? '<button type="button" class="th-more-sheet-util" data-th-util="help">' + iconSvg('help') + '<span>How this page works</span></button>' : '') +
          '<button type="button" class="th-more-sheet-util" data-th-util="flag">' + iconSvg('flag') + '<span>Flag this page for later</span></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    wireSheet(sheet);
    sheet.addEventListener('click', function (e) {
      var util = e.target && e.target.closest && e.target.closest('[data-th-util]');
      if (!util) return;
      var which = util.getAttribute('data-th-util');
      closeSheet('thMoreSheet', false);
      if (which === 'flag') openFlagDialog();
      else if (which === 'help') { var help = pageHelpButton(); if (help) help.click(); }
    });
  }

  function createAllowed(a) {
    if (!a.perm) return true;
    return typeof window[a.perm] === 'function' && !!window[a.perm]();
  }
  function injectCreateSheet() {
    if (document.getElementById('thCreateSheet')) return;
    var sheet = document.createElement('div');
    sheet.id = 'thCreateSheet';
    sheet.className = 'th-create-sheet th-sheet';
    sheet.setAttribute('hidden', '');
    sheet.innerHTML =
      '<div class="th-sheet-backdrop" data-th-sheet-close="1"></div>' +
      '<div class="th-sheet-panel th-create-panel" role="dialog" aria-modal="true" aria-labelledby="thCreateSheetTitle">' +
        '<div class="th-sheet-handle" aria-hidden="true"></div>' +
        '<div class="th-create-head">' +
          '<h2 class="th-sheet-title" id="thCreateSheetTitle">Create</h2>' +
          '<button type="button" class="th-create-close" data-th-sheet-close="1" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="th-create-grid">' +
          CREATE_ACTIONS.map(function (a) {
            return '<a class="th-create-tile" href="' + a.href + '"' + (a.perm ? ' data-perm="' + a.perm + '"' : '') + '>' +
              '<span class="th-hex-icon">' + iconSvg(a.icon) + '</span>' +
              '<span class="th-create-label">' + a.label + '</span>' +
              '<span class="th-create-hint">' + a.hint + '</span></a>';
          }).join('') +
        '</div>' +
      '</div>';
    document.body.appendChild(sheet);
    wireSheet(sheet);
    // A tile that deep-links into THIS page only changes the hash; the
    // page's own hashchange handler opens the form. Close the sheet first
    // so the form is what's on screen.
    sheet.addEventListener('click', function (e) {
      var tile = e.target && e.target.closest && e.target.closest('.th-create-tile');
      if (tile) closeSheet('thCreateSheet', false);
    });
    refreshCreateSheet();
  }
  // Re-applies the permission filter. Runs on inject, on th-role-loaded,
  // and every time the sheet opens -- on a page that never loads the role
  // itself, opening the sheet asks for it (once), and th-role-loaded then
  // re-filters, so gated tiles appear a moment later rather than never.
  var roleRequested = false;
  function refreshCreateSheet() {
    var sheet = document.getElementById('thCreateSheet');
    if (!sheet) return;
    sheet.querySelectorAll('.th-create-tile').forEach(function (tile) {
      var perm = tile.getAttribute('data-perm');
      tile.hidden = !!perm && !createAllowed({ perm: perm });
    });
  }
  function openCreate(opener) {
    refreshCreateSheet();
    if (!roleRequested && typeof getCurrentUserRole === 'function' && !getCurrentUserRole() && typeof loadCurrentUserRole === 'function') {
      roleRequested = true;
      try { loadCurrentUserRole(); } catch (e) { /* ignore */ }
    }
    toggleSheet('thCreateSheet', opener);
  }
  window.openCreateSheet = function () { openCreate(document.querySelector('.th-sidebar-new') || document.querySelector('.th-bn-create')); };

  // Header actions (phone/tablet): Search and More, appended to the
  // page's own header-right group so they sit beside its ? button. A page
  // without the shared .hub-header (runway-dashboard.html) gets them on
  // its own header, pinned top-right.
  function injectHeaderActions() {
    var host = document.querySelector('.hub-header-right');
    var floating = false;
    if (!host) { host = document.querySelector('header#mainContent'); floating = true; }
    if (!host || host.querySelector('.th-hdr-actions')) return;
    var wrap = document.createElement('div');
    wrap.className = 'th-hdr-actions' + (floating ? ' is-floating' : '');
    wrap.innerHTML =
      '<button type="button" class="th-hdr-btn th-hdr-search" aria-label="Search (Ctrl+K)" title="Search">' + iconSvg('search') + '</button>' +
      '<button type="button" class="th-hdr-btn th-hdr-menu' + (isMorePage() ? ' is-active' : '') + '" aria-label="More tools" title="More tools" aria-haspopup="dialog" aria-expanded="false" aria-controls="thMoreSheet">' + iconSvg('grid') + '</button>';
    host.appendChild(wrap);
    wrap.querySelector('.th-hdr-search').addEventListener('click', function () {
      if (typeof openCommandPalette === 'function') openCommandPalette();
    });
    wrap.querySelector('.th-hdr-menu').addEventListener('click', function () { toggleSheet('thMoreSheet', this); });
  }

  // Money switch: on the two Money pages, a two-segment control where the
  // page title sits on a phone -- Invoices | Finance -- so hopping between
  // them is one tap and the pair reads as one section. Hidden (and the
  // title shown again) unless the account can open both.
  function injectMoneySwitch() {
    if (!isMoneyPath(path)) return;
    var left = document.querySelector('.hub-header-left');
    if (!left || left.querySelector('.th-money-switch')) return;
    var sw = document.createElement('nav');
    sw.className = 'th-money-switch';
    sw.setAttribute('aria-label', 'Money');
    sw.innerHTML = [
      { href: MONEY_PAGES[0], label: 'Invoices' },
      { href: MONEY_PAGES[1], label: 'Finance' }
    ].map(function (s) {
      var on = s.href === path;
      return '<a href="' + s.href + '" class="th-money-seg' + (on ? ' is-active' : '') + '"' + (on ? ' aria-current="page"' : '') + '>' + s.label + '</a>';
    }).join('');
    left.appendChild(sw);
    document.body.classList.add('th-money-page');
    applyMoneyPermissions();
  }

  // A header that knows it is floating over scrolled content -- a firmer
  // edge once the page moves, like a native app bar. Nothing else keys
  // off this class.
  function initScrolledState() {
    var ticking = false;
    function update() {
      document.body.classList.toggle('th-scrolled', window.scrollY > 4);
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  // The flag button stays a small corner button on desktop (a free
  // corner there, nothing to cover); on a phone it is hidden by CSS and
  // the More drawer's "Flag this page" row does the same thing.
  function injectFlagButton() {
    var btn = document.createElement('button');
    btn.className = 'th-flag-btn';
    btn.setAttribute('aria-label', 'Flag this page for later');
    btn.title = 'Flag this page for later';
    btn.innerHTML = iconSvg('flag');
    btn.onclick = openFlagDialog;
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
      // New (2026-09-22): the desktop door into the Create sheet -- the
      // same sheet the bar's ( + ) opens on a phone, shown as a dialog.
      '<button type="button" class="th-sidebar-new" aria-haspopup="dialog" aria-expanded="false" aria-controls="thCreateSheet">' +
        iconSvg('plus') + '<span>New</span><kbd class="th-sidebar-search-kbd">N</kbd>' +
      '</button>' +
      // Command palette trigger (tools-command-palette.js, 2026-09-21).
      // A real sidebar row: this is the desktop search entry point (the
      // header Search button covers phones and tablets). Checked at click
      // time, not injection time, since this script runs before
      // tools-command-palette.js loads.
      '<button type="button" class="th-sidebar-link th-sidebar-search-trigger" onclick="if (typeof openCommandPalette === \'function\') openCommandPalette();">' +
        '<span class="th-hex-icon">' + iconSvg('search') + '</span>' +
        '<span>Search</span><kbd class="th-sidebar-search-kbd">⌘K</kbd>' +
      '</button>' +
      '<div class="th-sidebar-links">' +
      destLinksHtml(SIDEBAR_DESTS) +
      '</div>';
    document.body.insertBefore(sidebar, document.body.firstChild);
    sidebar.querySelector('.th-sidebar-new').addEventListener('click', function () { openCreate(this); });
  }

  function barItemHtml(d) {
    if (d.create) {
      return '<button type="button" class="th-bn-create" aria-label="Create something new" aria-haspopup="dialog" aria-expanded="false" aria-controls="thCreateSheet">' +
        '<span class="th-bn-create-disc" aria-hidden="true">' + iconSvg(d.icon) + '</span>' +
        '<span class="th-bn-create-label">' + d.label + '</span></button>';
    }
    var href = d.money ? lastMoneyHref() : d.href;
    var isHere = d.money ? isMoneyPath(path) : path === d.href;
    var cls = (d.money ? 'th-bn-money' : '') + (isHere ? ' is-active' : '');
    return '<a href="' + href + '" class="' + cls.trim() + '"' + (isHere ? ' aria-current="page"' : '') + '>' +
      '<span class="th-bn-icon th-hex-icon" aria-hidden="true">' + iconSvg(d.icon) + '</span>' +
      '<span>' + d.label + '</span></a>';
  }

  function inject() {
    document.body.classList.add('th-tool-page');
    if (onLogin) return;
    document.body.classList.add('th-has-bottomnav');
    injectSidebar();
    injectFlagButton();
    injectHeaderActions();
    injectMoneySwitch();
    initScrolledState();

    var nav = document.createElement('nav');
    nav.className = 'th-bottom-nav';
    nav.setAttribute('aria-label', 'Quick navigation');
    nav.innerHTML = DESTS.map(barItemHtml).join('');
    document.body.appendChild(nav);
    injectMoreSheet();
    injectCreateSheet();
    var createBtn = nav.querySelector('.th-bn-create');
    if (createBtn) createBtn.addEventListener('click', function () { openCreate(this); });
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

    '<symbol id="icon-wrench" viewBox="0 0 24 24"><path transform="translate(2.92,-1.92)" d="M14.7 9.3a4 4 0 0 1-5.4 5.4L4 20l-1-1 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.4 2.4 1.5 1.5z"/></symbol>' +

    '<symbol id="icon-edit" viewBox="0 0 24 24"><path d="M16.5 4.5l3 3L8 19H5v-3z"/></symbol>' +

    '<symbol id="icon-shuffle" viewBox="0 0 24 24"><path d="M3 7h3.5l7 10H20"/><path d="M17 4l3 3-3 3"/><path d="M3 17h3.5l3.2-4.6"/><path d="M17 20l3-3-3-3"/><path d="M11.5 8.6L13.5 5.7"/></symbol>' +

    '<symbol id="icon-bell" viewBox="0 0 24 24"><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z"/><path d="M10 19.5a2 2 0 0 0 4 0"/></symbol>' +

    '<symbol id="icon-shield" viewBox="0 0 24 24"><path d="M12 3.5l7 2.6v5.4c0 5-3 8-7 9.4-4-1.4-7-4.4-7-9.4V6.1z"/><path d="M9 12l2 2 4-4.2"/></symbol>' +

    '<symbol id="icon-receipt" viewBox="0 0 24 24"><path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><line x1="9" y1="8.5" x2="15" y2="8.5"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="15.5" x2="13" y2="15.5"/></symbol>' +

    '<symbol id="icon-map" viewBox="0 0 24 24"><path d="M9 4.5L4 6.5v13l5-2 6 2 5-2v-13l-5 2z"/><line x1="9" y1="4.5" x2="9" y2="17.5"/><line x1="15" y1="6.5" x2="15" y2="19.5"/><circle cx="12" cy="11.5" r="1.3" fill="currentColor" stroke="none"/></symbol>' +

    '<symbol id="icon-scroll" viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="17" rx="1.5"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="11.5" x2="16" y2="11.5"/><line x1="8" y1="15" x2="13" y2="15"/></symbol>' +

    '<symbol id="icon-calendar" viewBox="0 0 24 24"><rect x="5.2" y="6.6" width="13.6" height="12.4" rx="1.2"/><line x1="5.2" y1="10.2" x2="18.8" y2="10.2"/><line x1="8.8" y1="5" x2="8.8" y2="8.2"/><line x1="15.2" y1="5" x2="15.2" y2="8.2"/></symbol>' +

    '<symbol id="icon-dollar" viewBox="0 0 24 24"><text transform="translate(-0.1,0.5)" x="12" y="16.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" fill="currentColor" stroke="none">$</text></symbol>' +

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

    '<symbol id="icon-home" viewBox="0 0 24 24"><g transform="translate(0,-0.5)"><path d="M4 11.5L12 4l8 7.5"/><path d="M6 10v9.5c0 .8.7 1.5 1.5 1.5h9c.8 0 1.5-.7 1.5-1.5V10"/><path d="M9.5 21v-5.5c0-.55.45-1 1-1h3c.55 0 1 .45 1 1V21"/></g></symbol>' +
    '<symbol id="icon-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/></symbol>' +
    '<symbol id="icon-plus" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></symbol>' +
    '<symbol id="icon-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/></symbol>' +
    '<symbol id="icon-users" viewBox="0 0 24 24"><circle cx="9.5" cy="8.5" r="3.3"/><path d="M3.5 19.5c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3"/><path d="M15.2 5.6a3.1 3.1 0 0 1 0 5.9"/><path d="M17.4 14.6c1.8.7 2.9 2.4 3.2 4.9"/></symbol>' +
    '<symbol id="icon-user-plus" viewBox="0 0 24 24"><circle cx="10" cy="8.5" r="3.4"/><path d="M3.8 19.5c.6-3.4 3-5.4 6.2-5.4 1.6 0 3 .5 4.1 1.4"/><line x1="18.5" y1="13.5" x2="18.5" y2="20"/><line x1="15.25" y1="16.75" x2="21.75" y2="16.75"/></symbol>' +
    '<symbol id="icon-card" viewBox="0 0 24 24"><rect x="3" y="5.5" width="18" height="13" rx="2"/><line x1="3" y1="9.8" x2="21" y2="9.8"/><line x1="6.5" y1="14.6" x2="10.5" y2="14.6"/></symbol>' +
    '<symbol id="icon-flag" viewBox="0 0 24 24"><line x1="5.5" y1="3.5" x2="5.5" y2="21"/><path d="M5.5 4.5h11.8l-2.6 4.2 2.6 4.2H5.5"/></symbol>' +
    '<symbol id="icon-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6v.6"/><circle cx="12" cy="16.9" r="0.9" fill="currentColor" stroke="none"/></symbol>' +
    '<symbol id="icon-phone" viewBox="0 0 24 24"><path d="M6.6 3.8h2.6l1.4 4-1.8 1.3a11 11 0 0 0 5.9 5.9l1.3-1.8 4 1.4v2.6a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.6 6a2 2 0 0 1 2-2.2z"/></symbol>' +
    '<symbol id="icon-message" viewBox="0 0 24 24"><path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5V16.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/></symbol>' +
    '<symbol id="icon-navigate" viewBox="0 0 24 24"><path d="M20.5 3.5L3.5 11l7.2 2.3L13 20.5z"/></symbol>' +
    '<symbol id="icon-chevron" viewBox="0 0 24 24"><polyline points="9.5,5.5 15.5,12 9.5,18.5"/></symbol>' +

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
      // When secondary chips live behind a More control, light that
      // control too so the collapsed mobile row still shows "you are
      // in Health/Backup/etc." rather than going blank.
      const moreBtn = nav.querySelector('.jump-nav-more-btn');
      if (moreBtn) {
        const activeLink = links.find(a => a.getAttribute('href') === '#' + id);
        moreBtn.classList.toggle('is-active', !!(activeLink && activeLink.closest('.jump-nav-secondary')));
      }
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
// Shared banner helpers -- used by both the PWA install prompt below and
// the "app update available" banner further down. Extracted here
// (2026-08-27) rather than duplicated, since both are the exact same
// dismissible-bottom-banner-with-an-action-button UI.
// ---------------------------------------------------------------------------
function dismissThBanner(banner, onDismiss) {
  if (typeof onDismiss === 'function') onDismiss();
  banner.classList.remove('is-shown');
  setTimeout(() => banner.remove(), 250);
}

function showThBanner(message, actionLabel, onAction, onDismiss) {
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
  banner.querySelector('.th-install-dismiss').addEventListener('click', () => dismissThBanner(banner, onDismiss));
  if (actionLabel) {
    banner.querySelector('.th-install-action').addEventListener('click', () => {
      onAction();
      dismissThBanner(banner, onDismiss);
    });
  }
  return banner;
}

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
  function rememberDismissal() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* ignore */ }
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }
  function isSafari() {
    return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  }

  function init() {
    if (alreadyInstalled() || wasDismissed()) return;

    if (isIOS() && isSafari()) {
      // No programmatic prompt exists here -- this IS the feature for
      // this platform, not a fallback for a missing one.
      showThBanner('Add Triple H to your Home Screen: tap Share, then "Add to Home Screen."', null, null, rememberDismissal);
      return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      showThBanner('Add Triple H to your Home Screen for the full app experience.', 'Install', () => {
        e.prompt();
      }, rememberDismissal);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ---------------------------------------------------------------------------
// APP UPDATE AVAILABLE -- added 2026-08-27, requested directly ("a pop up
// for when a app becomes stale and needs to be redownloaded"). Confirmed
// this app's own service worker (service-worker.js) already calls
// self.skipWaiting() unconditionally on install and self.clients.claim()
// on activate -- meaning a new version, once deployed, already takes
// over as the active worker without waiting for every tab to close.
// That part isn't new here.
//
// What's still missing without this: the currently OPEN page instance
// keeps running the OLD already-loaded JS/HTML/CSS even after a newer
// service worker has silently taken control in the background -- exactly
// the "stale, needs redownloading" case. The real signal for this is the
// `controllerchange` event on navigator.serviceWorker -- but confirmed
// directly, via a real isolated test server (not assumed from docs),
// that this event ALSO fires on a page's very first-ever service worker
// registration, which would be a false positive (nothing is stale on a
// first visit). Guarded against this by capturing whether a controller
// already existed at script-start, BEFORE calling register() at all --
// only a controllerchange that happens when one already existed means a
// real handoff from an old worker to a new one. Verified this exact
// three-step sequence (first load: no false positive; reload with an
// existing controller: still no false positive; a genuine update while
// that page stays open: correctly detected) with real Playwright tests
// against a disposable service worker before relying on it here.
//
// Deliberately NOT a forced auto-reload -- this app has real forms
// (adding a job, typing notes) where silently reloading out from under
// someone mid-task would lose unsaved work. Shows a dismissible banner
// instead, reusing the exact same UI as the install prompt. Unlike that
// one, dismissing this does NOT persist anything -- each real update is
// a new, genuine event, not a repeated nag for the same thing, and the
// already-active new worker will serve the fresh version automatically
// the next time this page naturally reloads anyway.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const hadControllerAtScriptStart = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtScriptStart) return; // first-ever registration, not a real update
    showThBanner('A new version of Triple H is available.', 'Update', () => {
      window.location.reload();
    });
  });
}
