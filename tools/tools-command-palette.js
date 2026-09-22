// tools-command-palette.js -- global Cmd/Ctrl+K search, added 2026-09-21.
//
// workspace.html already has its own "Find a client" box that searches
// jobs/contacts/invoices/quotes/contracts, but it only exists on that one
// page and only opens by clicking into it. This gives every tool page the
// same search, keyboard-triggered (Cmd/Ctrl+K) or via the header/sidebar
// Search button, so a client's whole history is one shortcut away no
// matter which tool is open. Reuses the exact same localStorage-backed
// data and the same job-tracker.html/contract-generator.html deep-link
// convention (?search=...#tab) that already existed -- adds a new front
// door, not a new backend.
//
// Skipped on login.html/reset-password.html: nothing to search before
// signing in.
(function () {
  if (typeof document === 'undefined') return;
  var path = (window.location && window.location.pathname) || '';
  if (/\/(login|reset-password)\.html$/.test(path)) return;

  function loadJobs() { try { return JSON.parse(localStorage.getItem('th_tracker_jobs') || '[]'); } catch (e) { return []; } }
  function loadContacts() { try { return JSON.parse(localStorage.getItem('th_tracker_contacts') || '[]'); } catch (e) { return []; } }
  function loadInvoices() { try { return JSON.parse(localStorage.getItem('th_invoices') || '[]'); } catch (e) { return []; } }
  function loadQuotes() { try { return JSON.parse(localStorage.getItem('th_quotes') || '[]'); } catch (e) { return []; } }
  function loadContracts() { try { return JSON.parse(localStorage.getItem('th_contracts') || '[]'); } catch (e) { return []; } }
  function loadClients() { try { return JSON.parse(localStorage.getItem('th_clients') || '[]'); } catch (e) { return []; } }

  function esc(str) {
    if (typeof escapeHtml === 'function') return escapeHtml(str);
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function money(v) {
    if (typeof window.money === 'function') return window.money(v);
    return '$' + (v || 0).toFixed(2);
  }

  var CONTRACT_TYPE_LABELS = { pwo: 'Per-Job Work Order', stpa: 'Short-Term Project Agreement', ltsa: 'Long-Term Service Agreement' };

  // Actions (2026-09-22): the palette is also the app's launcher. Every
  // place you can go and every thing you can start, as deep links to the
  // exact tab or form -- so "expense", "quote", "route" typed anywhere
  // lands on the right spot without remembering which page owns it. The
  // full list shows before you type; typing filters it (title + keywords)
  // and record matches follow underneath. Gated ones use the same auth.js
  // checks the nav uses, so an Employee account never sees a Finance link
  // here that the bar hides.
  function allowed(check) { return typeof window[check] !== 'function' || window[check](); }
  var ACTIONS = [
    { title: 'New job', meta: 'Jobs \u203a Add a Job', href: '/tools/job-tracker.html#add-job', keywords: 'add create book schedule' },
    { title: 'Calendar', meta: 'Jobs \u203a Calendar view', href: '/tools/job-tracker.html#calendar', keywords: 'month schedule bookings' },
    { title: 'Contacts', meta: 'Jobs \u203a Contacts tab', href: '/tools/job-tracker.html#contacts', keywords: 'address book supplier vendor phone history' },
    { title: 'Notes', meta: 'Jobs \u203a Notes tab', href: '/tools/job-tracker.html#notes', keywords: 'notepad memo' },
    { title: 'Clients', meta: 'Your client list: who owes you, next and last job, call or text', href: '/tools/clients.html#directory', keywords: 'customer directory people owes balance phone' },
    { title: 'Add a client', meta: 'Clients \u203a new client', href: '/tools/clients.html#new', keywords: 'new customer create person' },
    { title: 'Client portal admin', meta: 'Clients \u203a Portal: accounts, invites, referral credit, work orders', href: '/tools/clients.html#portal', keywords: 'portal invite referral work order bug', perm: 'canManageInvoices' },
    { title: 'Create invoice', meta: 'Invoices \u203a New invoice tab', href: '/tools/invoice-generator.html#invoice', keywords: 'bill send pdf', perm: 'canManageInvoices' },
    { title: 'New quote / estimate', meta: 'Invoices \u203a New quote tab', href: '/tools/invoice-generator.html#quote', keywords: 'price bid proposal', perm: 'canManageInvoices' },
    { title: 'Quick charge', meta: 'Invoices \u203a charge a card on the spot, no invoice', href: '/tools/invoice-generator.html#pos', keywords: 'pos pay payment card stripe', perm: 'canManageInvoices' },
    { title: 'Invoices', meta: 'Who owes you, what is overdue, every invoice and quote', href: '/tools/invoice-generator.html#recent', keywords: 'log history paid unpaid overdue owed recent quotes', perm: 'canManageInvoices' },
    { title: 'Log expense', meta: 'Finance \u203a Expenses tab', href: '/tools/finance.html#expenses', keywords: 'receipt cost part mileage fuel', perm: 'canViewFinance' },
    { title: 'Log income', meta: 'Finance \u203a Income tab', href: '/tools/finance.html#income', keywords: 'payment paid revenue', perm: 'canViewFinance' },
    { title: 'Profitability', meta: 'Finance \u203a what each job made', href: '/tools/finance.html#profitability', keywords: 'profit margin', perm: 'canViewFinance' },
    { title: 'Cost lookup', meta: 'Finance \u203a price a job with tax', href: '/tools/finance.html#cost', keywords: 'quote estimate calculator tax', perm: 'canViewFinance' },
    { title: 'Inventory', meta: 'Finance \u203a Inventory tab', href: '/tools/finance.html#inventory', keywords: 'parts stock truck', perm: 'canViewFinance' },
    { title: 'Plan a route', meta: 'Route Planner', href: '/tools/route-planner.html', keywords: 'directions maps drive stops mileage' },
    { title: 'New contract', meta: 'Contract Generator', href: '/tools/contract-generator.html', keywords: 'work order agreement sign', perm: 'canManageContracts' },
    { title: 'Send review request', meta: 'Review Request Sender', href: '/tools/review-request.html', keywords: 'google yelp text qr', perm: 'canManageReviews' },
    { title: 'Look up a part', meta: 'Appliance Wiki', href: '/tools/parts-reference.html', keywords: 'manual model brand appliance wiki' },
    { title: 'Runway Dashboard', meta: 'Personal budget and business runway', href: '/tools/runway-dashboard.html#runway', keywords: 'budget net worth draw', perm: 'canViewRunway' },
    { title: 'Dashboard', meta: 'Home \u203a today, money owed, needs attention', href: '/tools/workspace.html', keywords: 'home today inbox' },
    { title: 'Settings', meta: 'Account, theme, notifications, backup', href: '/tools/settings.html', keywords: 'backup restore theme password notifications' },
    { title: 'Replay the tour', meta: 'Two-minute walkthrough of every page', href: '/tools/workspace.html?tour=1', keywords: 'help tutorial guide how to' }
  ];
  function actionItems(term) {
    return ACTIONS.filter(function (a) {
      if (a.perm && !allowed(a.perm)) return false;
      if (!term) return true;
      return (a.title + ' ' + a.meta + ' ' + (a.keywords || '')).toLowerCase().indexOf(term) > -1;
    }).map(function (a) { return { title: a.title, meta: a.meta, href: a.href }; });
  }

  function ensurePalette() {
    if (document.getElementById('thCmdkOverlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'thCmdkOverlay';
    overlay.className = 'th-cmdk-overlay';
    overlay.innerHTML =
      '<div class="th-cmdk-modal" role="dialog" aria-modal="true" aria-label="Search">' +
        '<div class="th-cmdk-input-row">' +
          '<svg class="th-icon" aria-hidden="true"><use href="#icon-search" xlink:href="#icon-search"></use></svg>' +
          '<input type="text" id="thCmdkInput" class="th-cmdk-input" placeholder="Search anything, or type what to do (expense, quote, route)&hellip;" autocomplete="off">' +
          '<kbd class="th-cmdk-esc">Esc</kbd>' +
        '</div>' +
        '<div class="th-cmdk-results" id="thCmdkResults"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePalette(); });
    document.getElementById('thCmdkInput').addEventListener('input', function () { renderResults(this.value); });
    overlay.addEventListener('keydown', onPaletteKeydown);
  }

  function currentItems() {
    return Array.prototype.slice.call(document.querySelectorAll('#thCmdkResults .th-cmdk-item'));
  }
  function setActive(index) {
    var items = currentItems();
    items.forEach(function (el, i) { el.classList.toggle('is-active', i === index); });
    if (items[index]) items[index].scrollIntoView({ block: 'nearest' });
  }
  function onPaletteKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
    var items = currentItems();
    if (!items.length) return;
    var active = items.findIndex(function (el) { return el.classList.contains('is-active'); });
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active < items.length - 1 ? active + 1 : 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active > 0 ? active - 1 : items.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); var target = items[active] || items[0]; if (target) target.click(); }
  }

  function renderResults(rawTerm) {
    var container = document.getElementById('thCmdkResults');
    var term = (rawTerm || '').trim().toLowerCase();
    if (!term) {
      container.innerHTML = '<div class="th-cmdk-hint">Type a name to find a job, contact, invoice, quote, or contract \u2014 or what you want to do (\u201cexpense\u201d, \u201cquote\u201d, \u201croute\u201d). Or pick a place to go:</div>' +
        groupHtml({ label: 'Go to', items: actionItems('') });
      setActive(0);
      return;
    }

    var groups = SEARCH_SOURCES.map(function (source) { return buildGroup(source, term); }).filter(Boolean);
    var actions = actionItems(term);
    if (actions.length) groups.unshift({ label: 'Actions', items: actions.slice(0, 6) });

    if (!groups.length) {
      container.innerHTML = '<div class="th-cmdk-hint">No matches for &ldquo;' + esc(rawTerm) + '&rdquo;.</div>';
      return;
    }
    container.innerHTML = groups.map(groupHtml).join('');
    setActive(0);
  }

  // One config entry per searchable collection instead of five near-
  // identical filter/map/push blocks -- match() decides whether a
  // record counts, toItem() shapes it for display. A null href means
  // "show as plain info, not a link" (quotes have no dedicated list
  // page to jump to).
  var SEARCH_SOURCES = [
    // Clients first (2026-09-22): a name typed here is usually a person,
    // and their page (client-detail.html) has everything -- jobs,
    // invoices, what they owe, Call / Text / New job -- one tap on.
    { label: 'Clients', load: loadClients,
      match: function (c, term) {
        if ((c.name || '').toLowerCase().indexOf(term) > -1 || (c.email || '').toLowerCase().indexOf(term) > -1) return true;
        var digits = term.replace(/\D/g, '');
        return digits.length >= 3 && (c.phone || '').replace(/\D/g, '').indexOf(digits) > -1;
      },
      toItem: function (c) { return { title: c.name, meta: c.phone || c.email || c.address || 'Client', href: '/tools/client-detail.html?id=' + encodeURIComponent(c.id) }; } },
    { label: 'Jobs', load: loadJobs,
      match: function (j, term) { return (j.title || '').toLowerCase().indexOf(term) > -1 || (j.client || '').toLowerCase().indexOf(term) > -1; },
      // Straight to the job's own page (2026-09-22), not a filtered list.
      toItem: function (j) { return { title: j.title, meta: j.client || 'No client set', href: '/tools/job-detail.html?id=' + encodeURIComponent(j.id) }; } },
    { label: 'Contacts', load: loadContacts,
      match: function (c, term) { return (c.name || '').toLowerCase().indexOf(term) > -1; },
      toItem: function (c) { return { title: c.name, meta: c.phone || c.email || '', href: '/tools/job-tracker.html?search=' + encodeURIComponent(c.name) + '#contacts' }; } },
    { label: 'Invoices', load: loadInvoices,
      match: function (i, term) { return (i.clientName || '').toLowerCase().indexOf(term) > -1; },
      toItem: function (i) { return { title: i.clientName, meta: '#' + (i.invoiceNumber || '—') + ' · ' + money(i.total), href: '/tools/workspace.html?search=' + encodeURIComponent(i.clientName) + '#section-actionitems' }; } },
    { label: 'Contracts', load: loadContracts,
      match: function (e, term) { return ((e.fields && e.fields.clientName) || '').toLowerCase().indexOf(term) > -1; },
      toItem: function (e) { return { title: e.fields.clientName, meta: CONTRACT_TYPE_LABELS[e.type] || e.type, href: '/tools/contract-generator.html?search=' + encodeURIComponent(e.fields.clientName) }; } },
    { label: 'Quotes / Estimates (view in Invoice Generator)', load: loadQuotes,
      match: function (q, term) { return (q.clientName || '').toLowerCase().indexOf(term) > -1; },
      toItem: function (q) { return { title: q.clientName, meta: (q.date || '') + ' · ' + money(q.total), href: null }; } },
  ];

  function buildGroup(source, term) {
    var matches = source.load().filter(function (record) { return source.match(record, term); });
    if (!matches.length) return null;
    return { label: source.label, items: matches.slice(0, 6).map(source.toItem) };
  }

  function itemHtml(it) {
    var body = '<div class="th-cmdk-item-title">' + esc(it.title || '(no name)') + '</div><div class="th-cmdk-item-meta">' + esc(it.meta) + '</div>';
    return it.href
      ? '<a class="th-cmdk-item" href="' + it.href + '">' + body + '</a>'
      : '<div class="th-cmdk-item is-static">' + body + '</div>';
  }
  function groupHtml(g) {
    return '<div class="th-cmdk-group-label">' + esc(g.label) + '</div>' + g.items.map(itemHtml).join('');
  }

  function openPalette() {
    ensurePalette();
    document.getElementById('thCmdkOverlay').classList.add('is-open');
    var input = document.getElementById('thCmdkInput');
    input.value = '';
    renderResults('');
    setTimeout(function () { input.focus(); }, 10);
  }
  function closePalette() {
    var overlay = document.getElementById('thCmdkOverlay');
    if (overlay) overlay.classList.remove('is-open');
  }
  window.openCommandPalette = openPalette;

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      var overlay = document.getElementById('thCmdkOverlay');
      if (overlay && overlay.classList.contains('is-open')) closePalette(); else openPalette();
    }
  });

  // The floating bottom-left trigger button this file used to inject is
  // gone (2026-09-22, app shell v2): on phones and tablets Search is a
  // header button injected by tools-nav-pwa.js (.th-hdr-search), and on
  // desktop it is the sidebar's Search row -- both call
  // openCommandPalette() above. A floating button over page content kept
  // landing on top of form fields (see the 2026-09-22 fade fix it needed).
})();
