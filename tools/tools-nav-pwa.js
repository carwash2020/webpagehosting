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
    // On a computer the Create sheet opens ready to type (quick add); on a
    // phone focusing the field would throw the keyboard over the tiles.
    var qa = id === 'thCreateSheet' && window.matchMedia && window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches
      ? sheet.querySelector('#thQuickAdd') : null;
    var first = qa || sheet.querySelector('a:not([hidden]):not([style*="display: none"]), button:not([hidden])');
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
          sheet.querySelectorAll('a[href], button:not([disabled]):not([hidden]), input:not([type="hidden"])'),
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
        // Quick add (2026-09-22, Workspace rework part 7): type or say it.
        '<div class="th-qa">' +
          '<div class="th-qa-field">' +
            iconSvg('bolt') +
            '<input type="text" id="thQuickAdd" class="th-qa-input" placeholder="Try: sink leak for Sarah tomorrow" autocomplete="off" autocapitalize="sentences" enterkeyhint="go" aria-label="Quick add: type or say what to create" aria-describedby="thQuickAddPreview">' +
            '<button type="button" class="th-qa-mic" id="thQuickAddMic" aria-label="Say it" title="Say it" hidden>' + iconSvg('mic') + '</button>' +
          '</div>' +
          '<button type="button" class="th-qa-paste" id="thQuickAddPaste" hidden>' + iconSvg('clipboard') + '<span>Paste a client\u2019s text</span></button>' +
          '<div class="th-qa-preview" id="thQuickAddPreview" aria-live="polite"></div>' +
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
      var tile = e.target && e.target.closest && e.target.closest('.th-create-tile, .th-qa-go');
      if (tile) closeSheet('thCreateSheet', false);
    });
    wireQuickAdd();
    refreshCreateSheet();
  }

  // ---- Quick add: the field at the top of the Create sheet ---------------
  // Every keystroke (or word spoken) re-runs thParseQuickEntry() and shows
  // what will be created; Enter or the button opens that page's own form
  // filled in (thQuickEntryHref). Nothing is saved from here.
  var QA_KIND = {
    job: { label: 'New job', go: 'Fill in the job', icon: 'wrench', perm: null },
    invoice: { label: 'Invoice', go: 'Start the invoice', icon: 'receipt', perm: 'canManageInvoices' },
    quote: { label: 'Quote', go: 'Start the quote', icon: 'clipboard', perm: 'canManageInvoices' },
    expense: { label: 'Expense', go: 'Log the expense', icon: 'camera', perm: 'canViewFinance' },
  };
  var qaCtx = null;
  function qaEsc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function qaMoney(n) { return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function quickAddParse(text) {
    if (!qaCtx) qaCtx = (typeof thQuickAddContext === 'function') ? thQuickAddContext() : { clients: [], vendors: [], jobs: [] };
    return thParseQuickEntry(text, qaCtx);
  }
  function renderQuickAddPreview() {
    var input = document.getElementById('thQuickAdd');
    var box = document.getElementById('thQuickAddPreview');
    if (!input || !box) return;
    var text = input.value.trim();
    var sheetEl = document.getElementById('thCreateSheet');
    if (sheetEl) sheetEl.classList.toggle('is-typing', !!text);
    if (!text || typeof thParseQuickEntry !== 'function') { box.innerHTML = ''; box.classList.remove('is-shown'); return; }
    var p = quickAddParse(text);
    var kind = QA_KIND[p.intent] || QA_KIND.job;
    var allowedKind = !kind.perm || createAllowed({ perm: kind.perm });
    var chips = [];
    var chip = function (icon, html, cls) { chips.push('<span class="th-qa-chip' + (cls ? ' ' + cls : '') + '">' + iconSvg(icon) + '<span>' + html + '</span></span>'); };
    if (p.client) chip('users', qaEsc(p.client.name) + (p.client.known ? ' <em>client</em>' : ' <em>new</em>'), p.client.known ? 'is-known' : '');
    if (p.dateLabel) chip('calendar', qaEsc(p.dateLabel));
    if (p.timeLabel) chip('bell', qaEsc(p.timeLabel));
    if (p.amount !== null) chip('dollar', qaMoney(p.amount));
    if (p.vendor) chip('toolbox', qaEsc(p.vendor));
    if (p.address) chip('navigate', qaEsc(p.address));
    else if (p.client && p.client.known && p.client.address && p.intent === 'job') chip('navigate', qaEsc(p.client.address), 'is-soft');
    if (p.phone) chip('phone', qaEsc(p.phone));
    if (p.priority === 'high') chip('warning', 'High priority', 'is-hot');
    if (p.jobId) chip('wrench', 'For their latest job', 'is-soft');
    var href = thQuickEntryHref(p);
    box.innerHTML =
      '<div class="th-qa-card">' +
        '<div class="th-qa-kind">' + iconSvg(kind.icon) + '<span>' + kind.label + '</span></div>' +
        '<div class="th-qa-title">' + (p.title ? qaEsc(p.title) : '<span class="th-qa-untitled">' + (p.intent === 'job' ? 'What’s the job?' : 'What’s it for?') + '</span>') + '</div>' +
        (chips.length ? '<div class="th-qa-chips">' + chips.join('') + '</div>' : '') +
        (allowedKind
          ? '<a class="primary-btn th-qa-go" href="' + qaEsc(href) + '">' + kind.go + ' <span aria-hidden="true">&rsaquo;</span></a>'
          : '<div class="th-qa-blocked">Your account can’t create ' + (p.intent === 'expense' ? 'expenses' : p.intent + 's') + '.</div>') +
      '</div>';
    box.classList.add('is-shown');
  }
  function wireQuickAdd() {
    var input = document.getElementById('thQuickAdd');
    if (!input || input.dataset.wired) return;
    input.dataset.wired = '1';
    input.addEventListener('input', renderQuickAddPreview);
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var go = document.querySelector('#thQuickAddPreview .th-qa-go');
      if (!go) return;
      e.preventDefault();
      closeSheet('thCreateSheet', false);
      window.location.href = go.getAttribute('href');
    });
    // Paste (2026-09-23, rework part 8): a client's text message copied from
    // Messages drops straight in -- the iPhone's way in, since iOS has no
    // share target for web apps. The browser asks permission the first time.
    var paste = document.getElementById('thQuickAddPaste');
    if (paste && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
      paste.hidden = false;
      paste.addEventListener('click', function () {
        navigator.clipboard.readText().then(function (clip) {
          clip = String(clip || '').trim();
          if (!clip) return;
          input.value = input.value.trim() ? input.value.trim() + ' ' + clip : clip;
          renderQuickAddPreview();
          input.focus();
        }).catch(function () { /* permission refused: nothing to do */ });
      });
    }
    // Say it: one utterance, with the words appearing as they're heard
    // (interim results), so the preview builds itself while you talk.
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    var mic = document.getElementById('thQuickAddMic');
    if (!Rec || !mic) return;
    mic.hidden = false;
    var rec = null;
    var base = '';
    mic.addEventListener('click', function () {
      if (rec) { try { rec.stop(); } catch (e) { /* ignore */ } return; }
      rec = new Rec();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      base = input.value.trim() ? input.value.trim() + ' ' : '';
      rec.onresult = function (ev) {
        var said = '';
        for (var i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
        input.value = base + said.trim();
        renderQuickAddPreview();
      };
      var done = function () { rec = null; mic.classList.remove('is-listening'); mic.setAttribute('aria-label', 'Say it'); };
      rec.onend = done;
      rec.onerror = done;
      try {
        rec.start();
        mic.classList.add('is-listening');
        mic.setAttribute('aria-label', 'Stop listening');
        if (typeof haptic === 'function') haptic('light');
      } catch (e) { done(); }
    });
  }
  // Re-applies the permission filter. Runs on inject, on th-role-loaded,
  // and every time the sheet opens -- on a page that never loads the role
  // itself, opening the sheet asks for it (once), and th-role-loaded then
  // re-filters, so gated tiles appear a moment later rather than never.
  // A quick add already typed (or shared in before the role arrived) is
  // re-previewed too, so its "can't create" turns into the button.
  var roleRequested = false;
  function refreshCreateSheet() {
    var sheet = document.getElementById('thCreateSheet');
    if (!sheet) return;
    sheet.querySelectorAll('.th-create-tile').forEach(function (tile) {
      var perm = tile.getAttribute('data-perm');
      tile.hidden = !!perm && !createAllowed({ perm: perm });
    });
    var qaInput = document.getElementById('thQuickAdd');
    if (qaInput && qaInput.value.trim()) renderQuickAddPreview();
  }
  function openCreate(opener) {
    refreshCreateSheet();
    qaCtx = null; // re-read clients/vendors/jobs: they may have changed since last time
    var qaInput = document.getElementById('thQuickAdd');
    if (qaInput) { qaInput.value = ''; renderQuickAddPreview(); }
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
    // Next tick, not now: on a page that loads this file after the DOM is
    // ready, inject() runs before the QUICK ADD section further down this
    // file has set its tables, and the parser would throw.
    setTimeout(openQuickAddFromUrl, 0);
  }

  // Quick add from outside the app (2026-09-23, Workspace rework part 8).
  // Three ways in, one landing: Android's share sheet (manifest.json's
  // share_target sends ?share_title= &share_text= &share_url=), a plain
  // ?quick=<text> link (an iPhone Shortcut, a bookmark, another app), and
  // the home-screen shortcut's #quick-add. Each opens the Create sheet with
  // the text already in quick add and the preview built; the params are
  // stripped so a reload doesn't open it again.
  function openQuickAddFromUrl() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
    var fromHash = window.location.hash === '#quick-add';
    var bits = [];
    ['quick', 'share_title', 'share_text', 'share_url'].forEach(function (k) {
      var v = params.get(k);
      if (v !== null) params.delete(k);
      if (v && v.trim()) bits.push(v.trim());
    });
    if (!bits.length && !fromHash) return;
    // A share's title is often the first line of its text: keep the longer one.
    var text = bits.filter(function (b, i) {
      return !bits.some(function (o, j) { return j !== i && o.length > b.length && o.indexOf(b) > -1; });
    }).join(' ');
    var rest = params.toString();
    try { history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : '') + (fromHash ? '' : window.location.hash)); } catch (e) { /* ignore */ }
    openCreate(document.querySelector('.th-sidebar-new') || document.querySelector('.th-bn-create'));
    var input = document.getElementById('thQuickAdd');
    if (!input) return;
    input.value = text;
    renderQuickAddPreview();
    setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }, 80);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();

// ---------------------------------------------------------------------------
// ON THE CLOCK (2026-09-23, Workspace rework part 9). While a job's clock
// runs, a bar sits above the bottom nav (bottom-right on a computer) on
// every tools page: the job, the client, the time ticking, and Stop. Tap
// the bar for the job. Running is just a field on the job (clockSince --
// see data-layer.js's Job clock section), so the clock survives closing
// the app and shows on every device the job syncs to. A page without
// data-layer.js still shows the bar, read straight from storage; its Stop
// opens the job instead.
// ---------------------------------------------------------------------------

// 0:07, 12:40, 1:05:09 -- a stopwatch, not a sentence.
function thFormatClock(ms) {
  var s = Math.floor(Math.max(0, ms) / 1000);
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return h ? h + ':' + pad(m) + ':' + pad(sec) : m + ':' + pad(sec);
}
// 45 min, 1 h, 1 h 25 min -- how long it was, the way you'd say it.
function thClockDuration(ms) {
  var mins = Math.round(Math.max(0, ms) / 60000);
  var h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return m + ' min';
  return h + ' h' + (m ? ' ' + m + ' min' : '');
}
function thClockHoursLabel(h) {
  var n = Math.round((Number(h) || 0) * 100) / 100;
  return (n % 1 ? String(n) : n.toFixed(0)) + ' h';
}

// Start from anywhere (job detail, the Jobs list, the Dashboard): starts
// it, and says so when that stopped another job's clock.
function thStartClock(jobId) {
  if (typeof thStartJobClock !== 'function') return null;
  var r = thStartJobClock(jobId);
  if (!r) return null;
  if (typeof haptic === 'function') haptic('light');
  if (r.stopped && typeof showToast === 'function') {
    showToast('Stopped ' + (r.stopped.job.title || 'the other job') + (r.stopped.hours ? ' (' + thClockHoursLabel(r.stopped.hours) + ' saved)' : '') + '. Clock on ' + (r.job.title || 'this job') + '.');
  }
  return r;
}

// Stop from anywhere: the time is saved the moment Stop is tapped; the
// sheet only asks what's next. Done -- create the invoice goes straight to
// the invoice that part 6 fills from the job, now with real hours.
function thStopClock(jobId) {
  if (typeof thStopJobClock !== 'function') {
    window.location.href = '/tools/job-detail.html?id=' + encodeURIComponent(jobId);
    return null;
  }
  var r = thStopJobClock(jobId);
  if (!r) return null;
  if (typeof haptic === 'function') haptic('success');
  thOpenClockStoppedSheet(r);
  return r;
}
function thOpenClockStoppedSheet(r) {
  var job = r.job;
  var esc = function (v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var name = job.title || 'this job';
  var title = r.hours
    ? '<span class="th-clock-sheet-head"><strong>' + thClockDuration(r.ms) + '</strong>on ' + esc(name) + '</span>' +
      '<span class="th-clock-sheet-sub">Added ' + thClockHoursLabel(r.hours) + ' &middot; ' + thClockHoursLabel(r.totalHours) + ' on this job so far</span>'
    : '<span class="th-clock-sheet-head"><strong>Under a minute</strong>on ' + esc(name) + '</span><span class="th-clock-sheet-sub">Too short to count, so nothing was added.</span>';
  var keepRunning = { label: 'Keep the clock running', onClick: function () { if (typeof thUndoStopJobClock === 'function') thUndoStopJobClock(job.id, r.undo); } };
  if (typeof showQuickActionSheet !== 'function') {
    if (typeof showToast === 'function') showToast(r.hours ? 'Clock stopped: ' + thClockHoursLabel(r.hours) + ' added to ' + name + '.' : 'Clock stopped.');
    return;
  }
  var actions = [];
  if (job.status !== 'done' && typeof thFinishJob === 'function') {
    var canInvoice = typeof canManageInvoices !== 'function' || canManageInvoices() || !(typeof getCurrentUserRole === 'function' && getCurrentUserRole());
    var billable = false;
    if (canInvoice && typeof thJobMoneyStage === 'function' && typeof thRead === 'function' && typeof TH_KEYS !== 'undefined') {
      var income = thRead(TH_KEYS.income, []).filter(function (e) { return e.origin !== 'invoice'; });
      billable = thJobMoneyStage(Object.assign({}, job, { status: 'done' }), thRead(TH_KEYS.invoices, []), income).stage === 'to-invoice';
    }
    if (billable) {
      actions.push({ label: 'Done &mdash; create the invoice', onClick: function () {
        if (thFinishJob(job.id)) window.location.href = '/tools/invoice-generator.html?jobRef=' + encodeURIComponent(job.id);
      } });
    }
    actions.push({ label: 'Mark it done', onClick: function () {
      if (!thFinishJob(job.id)) return;
      if (typeof celebrateCompletion === 'function') celebrateCompletion();
      if (typeof showToast === 'function') showToast(name + ' marked done.');
    } });
  }
  actions.push(keepRunning);
  showQuickActionSheet(title, actions, { cancelLabel: job.status === 'done' ? 'OK' : 'Not done yet' });
}

(function () {
  'use strict';
  var tick = null;

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function runningJob() {
    var jobs;
    try { jobs = JSON.parse(localStorage.getItem('th_tracker_jobs') || '[]'); } catch (e) { return null; }
    if (!Array.isArray(jobs)) return null;
    if (typeof thRunningJobClock === 'function') return thRunningJobClock(jobs);
    var best = null, bestAt = -Infinity;
    jobs.forEach(function (j) {
      var at = j && j.clockSince ? new Date(j.clockSince).getTime() : NaN;
      if (!isNaN(at) && at > bestAt) { best = j; bestAt = at; }
    });
    return best;
  }
  function elapsed(since) {
    var at = new Date(since).getTime();
    return isNaN(at) ? 0 : Math.max(0, Date.now() - at);
  }
  // The job's own page shows its own, bigger clock.
  function isItsOwnPage(job) {
    if (!/\/job-detail\.html$/.test(window.location.pathname)) return false;
    try { return new URLSearchParams(window.location.search).get('id') === String(job.id); } catch (e) { return false; }
  }
  function updateTime() {
    var bar = document.getElementById('thClock');
    if (!bar || bar.hidden) return;
    var t = bar.querySelector('.th-clock-time');
    if (t) t.textContent = thFormatClock(elapsed(bar.getAttribute('data-since')));
  }
  function setTicking(on) {
    if (on && !tick && document.visibilityState !== 'hidden') tick = setInterval(updateTime, 1000);
    if (!on && tick) { clearInterval(tick); tick = null; }
  }
  function render() {
    if (!document.body) return;
    var job = runningJob();
    var bar = document.getElementById('thClock');
    if (!job || isItsOwnPage(job)) {
      if (bar) bar.hidden = true;
      document.body.classList.remove('th-has-clock');
      setTicking(false);
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'th-clock';
      bar.id = 'thClock';
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'On the clock');
      document.body.appendChild(bar);
      bar.addEventListener('click', function (e) {
        var stop = e.target.closest('.th-clock-stop');
        if (!stop) return;
        e.preventDefault();
        thStopClock(bar.getAttribute('data-job-id'));
      });
    }
    var who = [job.title || 'Job', job.client || ''].filter(Boolean).join(' · ');
    bar.setAttribute('data-job-id', String(job.id));
    bar.setAttribute('data-since', job.clockSince);
    bar.innerHTML =
      '<a class="th-clock-main" href="/tools/job-detail.html?id=' + encodeURIComponent(job.id) + '">' +
        '<span class="th-clock-dot" aria-hidden="true"></span>' +
        '<span class="th-clock-text"><span class="th-clock-label">On the clock</span><span class="th-clock-title">' + esc(who) + '</span></span>' +
        '<span class="th-clock-time">' + thFormatClock(elapsed(job.clockSince)) + '</span>' +
      '</a>' +
      '<button type="button" class="th-clock-stop" aria-label="Stop the clock on ' + esc(job.title || 'this job') + '">' +
        '<svg class="th-icon" aria-hidden="true"><use href="#icon-stop" xlink:href="#icon-stop"></use></svg><span>Stop</span></button>';
    bar.hidden = false;
    document.body.classList.add('th-has-clock');
    setTicking(true);
  }

  window.addEventListener('th-clock-change', render);
  // Another tab, or a sync pull that brought a clock started elsewhere.
  window.addEventListener('storage', function (e) { if (!e.key || e.key === 'th_tracker_jobs') render(); });
  window.addEventListener('th-sync-status', render);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') setTicking(false);
    else render();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
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

    // Job clock (2026-09-23, rework part 9).
    '<symbol id="icon-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><polyline points="12 7.5 12 12 15.2 14"/></symbol>' +
    '<symbol id="icon-play" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M8 5.2v13.6a.9.9 0 0 0 1.37.77l10.6-6.8a.9.9 0 0 0 0-1.54L9.37 4.43A.9.9 0 0 0 8 5.2z"/></symbol>' +
    '<symbol id="icon-stop" viewBox="0 0 24 24"><rect fill="currentColor" stroke="none" x="6" y="6" width="12" height="12" rx="2.5"/></symbol>' +
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

// ---------------------------------------------------------------------------
// QUICK ADD (2026-09-22, Workspace rework part 7) -- say it the way you'd
// text it. "Sink leak for Sarah tomorrow 2pm" becomes a job for Sarah
// Miller (the known client, so her phone and address come along), due
// tomorrow, with the time in the notes. A leading word picks what it is:
// "invoice Sarah $150 dishwasher repair", "quote ...", "expense $48 Home
// Depot drain pump". Lives in the Create sheet (a field with a microphone)
// and as the top suggestion in search.
//
// thParseQuickEntry() is pure: text + what's known (clients, vendors,
// jobs, today) in, a structured guess out. It never writes anything --
// thQuickEntryHref() turns the guess into a deep link that pre-fills the
// page's own existing form, so saving still goes through that page (the
// client registry, mirrors, portal sync), and the person sees exactly
// what will be saved before tapping Add.
// ---------------------------------------------------------------------------
var TH_QA_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
var TH_QA_WEEKDAY_ABBR = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, weds: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
var TH_QA_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
var TH_QA_NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function thQaYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function thQaEscapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function thParseQuickEntry(text, opts) {
  opts = opts || {};
  var now = opts.now || new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var original = String(text || '').replace(/\s+/g, ' ').trim();
  var out = {
    intent: 'job', title: '', client: null, date: null, dateLabel: '', time: null, timeLabel: '',
    amount: null, phone: null, address: null, priority: null, vendor: null, jobId: null, signals: 0, text: original,
  };
  if (!original) return out;
  var rest = ' ' + original + ' ';
  // Cut the first match of re out of `rest`; fn(match) returns false to refuse it.
  function take(re, fn) {
    var m = rest.match(re);
    if (!m) return null;
    if (fn && fn(m) === false) return null;
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    return m;
  }
  var days = function (n) { return new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); };

  // 1. What it is -- only as the first word(s), so "bill" or "quote" inside
  //    a job title stays in the title.
  var explicitIntent = !!take(/^\s*(?:(?:new|add|create|log)\s+(?:an?\s+)?)?(job|invoice|bill|quote|estimate|expense|receipt|spent|bought)\b[:,\-–—]?/i, function (m) {
    var w = m[1].toLowerCase();
    out.intent = (w === 'invoice' || w === 'bill') ? 'invoice'
      : (w === 'quote' || w === 'estimate') ? 'quote'
      : (w === 'job') ? 'job' : 'expense';
    if (w !== 'job') out.signals++;
  });

  // 2. A phone number.
  take(/(?:^|\s)(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?=\s|[,.;:!?)]|$)/, function (m) {
    out.phone = '(' + m[1] + ') ' + m[2] + '-' + m[3];
    out.signals++;
  });

  // 3. A street address: a number, up to four words, and a street suffix,
  //    optionally an apartment and ", City" -- taken before times and money
  //    so "88 Sunset Blvd" is never read as 88 anything else.
  take(/(?:\s(?:at|to|on))?\s+(\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9'.-]+\s+){0,3}?(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|cir|circle|pl|place|pkwy|parkway|hwy|highway|ter|terrace|loop|trl|trail)\b\.?(?:\s*(?:#|apt\.?|unit|suite|ste\.?)\s*[\w-]+)?(?:,\s*(?:(?:St|Mt|Ft|Pt)\.?\s+)?[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)?(?:,\s*[A-Z]{2}\b)?)/i, function (m) {
    out.address = m[1].replace(/\s+/g, ' ').trim();
    out.signals++;
  });

  // 4. Money: "$150", "$1,250.50", "150 dollars" / "150 bucks".
  take(/\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/, function (m) {
    out.amount = Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) / 100;
    out.signals++;
  }) || take(/\s(\d+(?:\.\d{1,2})?)\s*(?:dollars|bucks)\b/i, function (m) {
    out.amount = Math.round(parseFloat(m[1]) * 100) / 100;
    out.signals++;
  });

  // 5. A time: "2pm", "2:30 p.m.", "at 10am", "at 14:00", "noon".
  var setTime = function (h, min) {
    out.time = String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
    var h12 = h % 12 === 0 ? 12 : h % 12;
    out.timeLabel = h12 + ':' + String(min).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
    out.signals++;
  };
  take(/(?:\s(?:at|@|around|by))?\s(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?(?=\s|[,.;:!?)]|$)/i, function (m) {
    var h = parseInt(m[1], 10), min = m[2] ? parseInt(m[2], 10) : 0;
    if (h < 1 || h > 12 || min > 59) return false;
    if (m[3].toLowerCase() === 'p' && h < 12) h += 12;
    if (m[3].toLowerCase() === 'a' && h === 12) h = 0;
    setTime(h, min);
  }) || take(/\s(?:at|@)\s+(\d{1,2}):(\d{2})(?=\s|[,.;:!?)]|$)/i, function (m) {
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return false;
    if (h >= 1 && h <= 6) h += 12; // "at 2:30" on a work day means the afternoon
    setTime(h, min);
  }) || take(/\s(?:at\s+)?noon\b/i, function () { setTime(12, 0); })
    // "around 2", "at 4" -- a bare hour after at/around/about is a time
    // (workday hours: 1-6 means the afternoon); taken after addresses, so
    // "at 2 Main St" is already gone by now.
    || take(/\s(?:at|around|about|by)\s+(\d{1,2})(?:ish)?(?=\s|[,.;:!?)]|$)/i, function (m) {
      var h = parseInt(m[1], 10);
      if (h < 1 || h > 12) return false;
      setTime(h <= 6 || h === 12 ? (h === 12 ? 12 : h + 12) : h, 0);
    });

  // 6. A date.
  var setDate = function (d) { out.date = thQaYmd(d); out.signals++; };
  var prefix = '(?:\\s(?:on|by|due|for|this\\s+coming))?\\s';
  var weekdayFrom = function (targetDow, isNext) {
    var diff = (targetDow - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    if (isNext) {
      // "next Friday" = Friday of next week (weeks start Monday).
      var todayMon = (today.getDay() + 6) % 7;
      var targetMon = (targetDow + 6) % 7;
      diff = 7 - todayMon + targetMon;
    }
    return days(diff);
  };
  var dated =
    take(new RegExp(prefix + '(today|tonight|this\\s+(?:morning|afternoon|evening))\\b', 'i'), function () { setDate(today); }) ||
    take(new RegExp(prefix + 'day\\s+after\\s+tomorrow\\b', 'i'), function () { setDate(days(2)); }) ||
    take(new RegExp(prefix + '(tomorrow|tomorow|tmrw|tmr|tmw)\\b', 'i'), function () { setDate(days(1)); }) ||
    take(new RegExp(prefix + 'yesterday\\b', 'i'), function () { setDate(days(-1)); }) ||
    // Vague on purpose, so a sensible day: next week = its Monday, the
    // weekend = the coming Saturday, next weekend = the one after.
    take(new RegExp(prefix + '(?:sometime\\s+)?next\\s+weekend\\b', 'i'), function () { setDate(weekdayFrom(6, true)); }) ||
    take(new RegExp(prefix + '(?:sometime\\s+)?(?:this|the)\\s+weekend\\b', 'i'), function () { setDate(today.getDay() === 6 ? today : weekdayFrom(6, false)); }) ||
    take(new RegExp(prefix + '(?:sometime\\s+)?next\\s+week\\b', 'i'), function () { setDate(weekdayFrom(1, true)); }) ||
    take(new RegExp(prefix + 'in\\s+(\\d+|' + Object.keys(TH_QA_NUMBER_WORDS).join('|') + ')\\s+(days?|weeks?)\\b', 'i'), function (m) {
      var n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : TH_QA_NUMBER_WORDS[m[1].toLowerCase()];
      setDate(days(/^week/i.test(m[2]) ? n * 7 : n));
    }) ||
    take(new RegExp(prefix + '(?:(next|this)\\s+)?(' + TH_QA_WEEKDAYS.join('|') + ')\\b', 'i'), function (m) {
      setDate(weekdayFrom(TH_QA_WEEKDAYS.indexOf(m[2].toLowerCase()), !!m[1] && m[1].toLowerCase() === 'next'));
    }) ||
    // Abbreviations only after on/next/this/by -- "sun room" and "sat" stay words.
    take(/\s(?:on|by|(next|this))\s+(sun|mon|tues?|weds?|thu(?:rs?)?|fri|sat)\b\.?/i, function (m) {
      setDate(weekdayFrom(TH_QA_WEEKDAY_ABBR[m[2].toLowerCase()], !!m[1] && m[1].toLowerCase() === 'next'));
    });
  var pickYear = function (month, day, year) {
    var d = new Date(year || today.getFullYear(), month, day);
    if (d.getMonth() !== month) return null; // Feb 30
    // A job or quote is about the future: a date already past this year
    // means next year. Invoices and expenses are about the past.
    if (!year && (out.intent === 'job' || out.intent === 'quote') && d < days(-1)) d = new Date(today.getFullYear() + 1, month, day);
    return d;
  };
  if (!dated) {
    dated = take(new RegExp(prefix + '(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{4}|\\d{2}))?(?=\\s|[,.;:!?)]|$)', 'i'), function (m) {
      var y = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : null;
      var d = pickYear(parseInt(m[1], 10) - 1, parseInt(m[2], 10), y);
      if (!d) return false;
      setDate(d);
    }) || take(new RegExp(prefix + '(' + TH_QA_MONTHS.join('|') + ')[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'i'), function (m) {
      var d = pickYear(TH_QA_MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)), parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null);
      if (!d) return false;
      setDate(d);
    }) || take(new RegExp(prefix + '(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(' + TH_QA_MONTHS.join('|') + ')[a-z]*\\b', 'i'), function (m) {
      var d = pickYear(TH_QA_MONTHS.indexOf(m[2].toLowerCase().slice(0, 3)), parseInt(m[1], 10), null);
      if (!d) return false;
      setDate(d);
    });
  }
  if (out.date) {
    var dd = new Date(out.date + 'T00:00:00');
    var diff = Math.round((dd - today) / 86400000);
    var long = dd.toLocaleDateString('en-US', dd.getFullYear() === today.getFullYear()
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    out.dateLabel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : long;
    if (diff === 0 || Math.abs(diff) === 1) out.dateLabel += ' (' + long + ')';
  }

  // 7. Priority.
  take(/\s(urgent|asap|a\.s\.a\.p\.?|emergency|rush|right\s+away)(?=\s|[,.;!]|$)/i, function () { out.priority = 'high'; out.signals++; });

  // 8. The client. A known client's full name anywhere wins (longest
  //    first); then a known first name when it's plainly a name ("for
  //    sarah", "sarah's", or capitalised mid-sentence) and only one known
  //    client has it; else a capitalised name after "for" is a new client.
  var clients = (opts.clients || []).filter(function (c) { return c && c.name && c.name.trim().length > 1; })
    .sort(function (a, b) { return b.name.length - a.name.length; });
  for (var i = 0; i < clients.length && !out.client; i++) {
    var c = clients[i];
    take(new RegExp('(?:\\s(?:for|at|with|to|from))?\\s' + thQaEscapeRe(c.name.trim()).replace(/\s+/g, '\\s+') + "(?:'s)?(?=\\s|[,.;:!?)]|$)", 'i'), function () {
      out.client = { id: c.id || null, name: c.name.trim(), phone: c.phone || '', address: c.address || '', email: c.email || '', known: true };
    });
  }
  if (!out.client && clients.length) {
    var byFirst = {};
    clients.forEach(function (c) {
      var first = c.name.trim().split(/\s+/)[0].toLowerCase();
      if (first.length < 2) return;
      (byFirst[first] = byFirst[first] || []).push(c);
    });
    var wordRe = /(\s(?:for|at|with|to|from))?\s([A-Za-z][A-Za-z'-]*?)('s)?(?=\s|[,.;:!?)]|$)/g;
    var wm;
    while ((wm = wordRe.exec(rest)) !== null) {
      var word = wm[2].toLowerCase();
      var hits = byFirst[word];
      if (!hits || hits.length !== 1) continue;
      // "invoice sarah $150": right after a money word, the first word is who.
      var isName = !!wm[1] || !!wm[3] || (/^[A-Z]/.test(wm[2]) && wm.index > 1) ||
        (explicitIntent && out.intent !== 'job' && rest.slice(0, wm.index).trim() === '');
      if (!isName) continue;
      var hit = hits[0];
      rest = rest.slice(0, wm.index) + ' ' + rest.slice(wm.index + wm[0].length);
      out.client = { id: hit.id || null, name: hit.name.trim(), phone: hit.phone || '', address: hit.address || '', email: hit.email || '', known: true };
      break;
    }
  }
  if (!out.client) {
    take(/\s(?:for|with)\s+((?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+)?([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)(?:'s)?(?=\s|[,.;:!?)]|$)/, function (m) {
      out.client = { id: null, name: ((m[1] || '') + m[2]).trim(), phone: '', address: '', email: '', known: false };
    });
  }
  // "quote Dave Carter drywall patch": a new client's first and last name,
  // both capitalised, straight after a money word.
  if (!out.client && explicitIntent && out.intent !== 'job') {
    take(/^\s+([A-Z][a-z'-]+\s+[A-Z][a-z'-]+)(?:'s)?(?=\s|[,.;:!?)]|$)/, function (m) {
      out.client = { id: null, name: m[1], phone: '', address: '', email: '', known: false };
    });
  }
  if (out.client) out.signals++;

  // 9. Expenses: a known vendor, else "at <Capitalised Name>".
  if (out.intent === 'expense') {
    var vendors = (opts.vendors || []).filter(Boolean).sort(function (a, b) { return b.length - a.length; });
    for (var v = 0; v < vendors.length && !out.vendor; v++) {
      var vendor = vendors[v];
      take(new RegExp('(?:\\s(?:at|from))?\\s' + thQaEscapeRe(vendor).replace(/\s+/g, '\\s+') + '(?=\\s|[,.;:!?)]|$)', 'i'), function () { out.vendor = vendor; });
    }
    if (!out.vendor) take(/\s(?:at|from)\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,2})(?=\s|[,.;:!?)]|$)/, function (m) { out.vendor = m[1]; });
    if (out.vendor) out.signals++;
  }

  // 10. A bare number is the amount for money entries ("invoice sarah 150").
  if (out.amount === null && out.intent !== 'job') {
    take(/\s(\d{1,5}(?:\.\d{1,2})?)(?=\s|[,.;:!?)]|$)/, function (m) { out.amount = parseFloat(m[1]); out.signals++; });
  }

  // 11. The job this is about (expenses and invoices), among the client's
  //     jobs that are open or finished in the last 30 days: one whose title
  //     shares a word with what was said wins; then, for an invoice, a
  //     finished job (that's what gets billed), for an expense one under
  //     way (that's what parts get bought for); then the most recent.
  if (out.client && out.intent !== 'job' && opts.jobs) {
    var name = out.client.name.toLowerCase();
    var words = (rest.toLowerCase().match(/[a-z]{4,}/g) || []);
    var score = function (j) {
      var s = 0;
      var titleWords = String(j.title || '').toLowerCase().match(/[a-z]{4,}/g) || [];
      if (words.some(function (w) { return titleWords.indexOf(w) > -1; })) s += 100;
      if (out.intent === 'invoice' && j.status === 'done') s += 50;
      if (out.intent === 'expense') s += j.status === 'in-progress' ? 50 : j.status === 'not-started' ? 30 : 0;
      return s;
    };
    var mine = opts.jobs.filter(function (j) {
      if (!j) return false;
      var sameClient = (out.client.id && j.clientId === out.client.id) || String(j.client || '').trim().toLowerCase() === name;
      if (!sameClient) return false;
      if (j.status !== 'done') return true;
      var when = new Date(j.statusChangedAt || ((j.date || '') + 'T00:00:00'));
      return !isNaN(when.getTime()) && (today - when) / 86400000 <= 30;
    }).sort(function (a, b) { return (score(b) - score(a)) || String(b.date || '').localeCompare(String(a.date || '')); });
    if (mine.length) out.jobId = mine[0].id;
  }

  // 12. What's left is the title: tidy the joins the cuts left behind. A
  //     long message (a client's text, shared or pasted in) keeps all of it
  //     as sourceText -- it goes in the job's notes -- and titles itself
  //     from its first real sentence, minus the greeting.
  out.long = original.length > 70 || /[.!?]\s+\S/.test(original);
  if (out.long) {
    out.sourceText = original;
    rest = ' ' + rest.replace(/\s+/g, ' ').trim()
      .replace(/^(?:(?:hi|hello|hey|hiya|good\s+(?:morning|afternoon|evening))\b[\s,!.]*)+/i, '')
      .replace(/^(?:(?:this\s+is|it'?s|its)\b[\s,!.]*)+/i, '')
      .replace(/^[\s,!.]+/, '');
    // The title is what's wrong, not the ask: skip "can you come..."
    // sentences, and cut a trailing ", any chance ..." off the one kept.
    var REQUEST = /^(?:can|could|would|will|are|is|do|does|any\s+chance|when|let\s+me\s+know|please|thanks|thank\s+you)\b/i;
    var sentences = (rest.match(/[^.!?]+[.!?]*/g) || [rest]).map(function (x) { return x.trim(); })
      .filter(function (x) { return x.replace(/[.!?,\s]/g, '').length > 3; });
    // "It's making a noise" says nothing on its own; "can you come look at
    // our water heater?" does once the ask is peeled off it.
    var PRONOUN = /^(?:it|it's|its|this|that|they|there|he|she|we)\b/i;
    var LEAD_IN = /^(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|any\s+chance\s+you\s+(?:could\s+)?|please\s+)(?:come\s+(?:out\s+)?(?:and\s+)?|stop\s+by\s+(?:and\s+)?|swing\s+by\s+(?:and\s+)?)?(?:take\s+a\s+look\s+at|look\s+at|check\s+(?:out|on)?|fix|repair|replace|install|help\s+(?:me\s+)?with|look\s+into)?\s*(?:our|my|the|a|an)?\s*/i;
    var statements = sentences.filter(function (x) { return !REQUEST.test(x); });
    var asked = sentences.filter(function (x) { return REQUEST.test(x); })
      .map(function (x) { return x.replace(LEAD_IN, ''); })
      .filter(function (x) { return x.replace(/[.!?,\s]/g, '').length > 3 && !REQUEST.test(x); });
    var firstReal = statements.filter(function (x) { return !PRONOUN.test(x); })[0] || asked[0] || statements[0] || sentences[0] || rest;
    firstReal = firstReal.replace(/,\s*(?:any\s+chance|can\s+you|could\s+you|would\s+you|are\s+you|is\s+there|when|let\s+me\s+know|please)\b.*$/i, '')
      .replace(/[.!?]+$/, '');
    if (firstReal.length > 60) firstReal = firstReal.slice(0, 60).replace(/\s+\S*$/, '') + '…';
    rest = ' ' + firstReal + ' ';
  }
  var title = rest.replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:for|at|on|to|by|with|and|the job|job|to do|-|,|:)\s+)+/i, '')
    .replace(/(?:\s+(?:for|at|on|to|by|with|and|due|around|from|-|,))+$/i, '')
    .replace(/\s+([,.;:!?])/g, '$1').replace(/^[,.;:\s-]+|[,;:\s-]+$/g, '');
  out.title = title ? title.charAt(0).toUpperCase() + title.slice(1) : '';
  return out;
}

// The deep link that pre-fills the right page's own form with a guess.
function thQuickEntryHref(p) {
  var q = new URLSearchParams();
  var set = function (k, v) { if (v !== null && v !== undefined && v !== '') q.set(k, String(v)); };
  if (p.intent === 'invoice' || p.intent === 'quote') {
    set('client', p.client && p.client.name);
    set('item', p.title);
    set('price', p.amount);
    if (p.intent === 'invoice') set('jobRef', p.jobId);
    return '/tools/invoice-generator.html' + (q.toString() ? '?' + q.toString() : '') + (p.intent === 'quote' ? '#quote' : '#invoice');
  }
  if (p.intent === 'expense') {
    set('amount', p.amount);
    set('vendor', p.vendor);
    set('desc', p.title);
    set('date', p.date);
    set('job', p.jobId);
    return '/tools/finance.html' + (q.toString() ? '?' + q.toString() : '') + '#expenses';
  }
  set('title', p.title);
  set('client', p.client && p.client.name);
  set('date', p.date);
  set('phone', p.phone);
  set('address', p.address);
  set('priority', p.priority);
  var notes = [];
  if (p.timeLabel) notes.push('Time: ' + p.timeLabel);
  if (p.sourceText) notes.push('Their message: “' + p.sourceText + '”');
  set('notes', notes.join('\n'));
  q.set('qa', '1');
  return '/tools/job-tracker.html?' + q.toString() + '#add-job';
}

// What the parser knows, read straight from this device's data: every
// client name (the registry, plus names on jobs and contacts that predate
// it), the vendors on logged expenses, and the jobs.
function thQuickAddContext() {
  var read = function (k) { try { return JSON.parse(localStorage.getItem(k) || '[]') || []; } catch (e) { return []; } };
  var seen = {};
  var clients = [];
  var add = function (c) {
    var key = String(c.name || '').trim().toLowerCase();
    if (!key || seen[key]) return;
    seen[key] = true;
    clients.push(c);
  };
  read('th_clients').forEach(function (c) { add({ id: c.id, name: c.name, phone: c.phone, address: c.address, email: c.email }); });
  var jobs = read('th_tracker_jobs');
  jobs.forEach(function (j) { if (j.client) add({ id: j.clientId || null, name: j.client, phone: j.phone, address: j.address, email: j.clientEmail }); });
  read('th_tracker_contacts').forEach(function (c) { add({ id: null, name: c.name, phone: c.phone, address: c.address, email: c.email }); });
  var vendorSeen = {};
  var vendors = [];
  read('th_expense_log').forEach(function (e) {
    var v = String(e.vendor || '').trim();
    if (v && !vendorSeen[v.toLowerCase()]) { vendorSeen[v.toLowerCase()] = true; vendors.push(v); }
  });
  return { clients: clients, vendors: vendors, jobs: jobs };
}
