// tools-command-palette.js -- global Cmd/Ctrl+K search, added 2026-09-21.
//
// workspace.html already has its own "Find a client" box that searches
// jobs/contacts/invoices/quotes/contracts, but it only exists on that one
// page and only opens by clicking into it. This gives every tool page the
// same search, keyboard-triggered (Cmd/Ctrl+K) or via the floating button
// this file also injects, so a client's whole history is one shortcut away
// no matter which tool is open. Reuses the exact same localStorage-backed
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

  function ensurePalette() {
    if (document.getElementById('thCmdkOverlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'thCmdkOverlay';
    overlay.className = 'th-cmdk-overlay';
    overlay.innerHTML =
      '<div class="th-cmdk-modal" role="dialog" aria-modal="true" aria-label="Search">' +
        '<div class="th-cmdk-input-row">' +
          '<svg class="th-icon" aria-hidden="true"><use href="#icon-search" xlink:href="#icon-search"></use></svg>' +
          '<input type="text" id="thCmdkInput" class="th-cmdk-input" placeholder="Search jobs, contacts, invoices, quotes, contracts&hellip;" autocomplete="off">' +
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
    if (!term) { container.innerHTML = '<div class="th-cmdk-hint">Type to search jobs, contacts, invoices, quotes, and contracts.</div>'; return; }

    var groups = SEARCH_SOURCES.map(function (source) { return buildGroup(source, term); }).filter(Boolean);

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
    { label: 'Jobs', load: loadJobs,
      match: function (j, term) { return (j.title || '').toLowerCase().indexOf(term) > -1 || (j.client || '').toLowerCase().indexOf(term) > -1; },
      toItem: function (j) { return { title: j.title, meta: j.client || 'No client set', href: '/tools/job-tracker.html?search=' + encodeURIComponent(j.client || j.title) + '#jobs' }; } },
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

  function injectTriggerButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'th-cmdk-btn';
    btn.setAttribute('aria-label', 'Search (Ctrl+K)');
    btn.title = 'Search (Ctrl+K)';
    btn.innerHTML = '<svg class="th-icon" aria-hidden="true"><use href="#icon-search" xlink:href="#icon-search"></use></svg>';
    btn.onclick = openPalette;
    document.body.appendChild(btn);
  }

  function init() {
    injectTriggerButton();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
