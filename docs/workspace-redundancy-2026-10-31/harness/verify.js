// Behaviour checks for the Workspace redundancy pass (2026-10-31), run in
// a real browser against the stubbed, seeded pages (common.js). One check
// per approved item's end state, then a smoke pass over the pages several
// items touched (Home, Jobs, Job detail, Invoices, Finance, Clients,
// Client detail): no page errors, no sideways scroll at 390 and 1280, and
// their main content renders.
//
//   python3 -m http.server 8543              (from the repo root)
//   node docs/workspace-redundancy-2026-10-31/harness/verify.js http://localhost:8543
//
// Exit code 1 on any failure. Needs Playwright (PLAYWRIGHT=/path/to/it).
const { launch, newContext } = require('./common');

const base = process.argv[2];
const results = [];
const check = (item, name, ok, detail) => { results.push({ item, name, ok: !!ok, detail }); };

async function open(browser, url, opts, wait) {
  const ctx = await newContext(browser, base, opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForTimeout(wait || 2200);
  return { ctx, page, errors };
}

(async () => {
  const browser = await launch();

  // ---------------- Home ----------------
  {
    const { ctx, page, errors } = await open(browser, '/tools/workspace.html');
    const r = await page.evaluate(() => {
      const vis = (el) => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
      const strip = [...document.querySelectorAll('#dashPrimaryStrip .dash-primary-action')].map((a) => a.textContent.trim());
      return {
        restOfDay: !!document.getElementById('todayRestOfDay'),
        heroRoute: !!document.getElementById('todayRouteLink'),
        routeAll: (() => { const a = document.getElementById('todayRouteAll'); return a && !a.hidden && /google\.com\/maps\/dir/.test(a.href); })(),
        heroOf: /\d+ of \d+/.test((document.querySelector('.today-next-job-label') || {}).textContent || ''),
        summary: (document.getElementById('todaySummaryLine') || {}).textContent || '',
        ringJobs: (document.querySelector('#todayRings .today-ring') || {}).textContent || '',
        routeCount: (document.getElementById('todayRouteCount') || {}).textContent || '',
        search: !!document.getElementById('globalSearch'),
        strip,
        incomeLane: !!document.getElementById('lane-money'),
        unpaidRows: document.querySelectorAll('#todayMoney #todayOverdueList .dash-list-item').length,
        markPaid: document.querySelectorAll('#todayMoney .paid-toggle-btn:not(.is-remind):not(.is-paid):not(.rti-invoice-btn)').length,
        rtiInCard: !!document.querySelector('#todayMoney #readyToInvoiceGroup:not([hidden]) .rti-invoice-btn'),
        historyOpenRows: document.querySelectorAll('#invoicesList > .dash-list-item').length,
        settled: (document.querySelector('#invoicesList .income-settled summary') || {}).textContent || '',
        needsHasInvoices: !!document.querySelector('#section-actionitems #invoicesList'),
        mileageTile: !!document.getElementById('metricMileage'),
        gallery: !!document.getElementById('section-gallery'),
        moneyCardVisible: vis(document.getElementById('todayMoney')),
      };
    });
    check(1, 'Rest of Today gone from the DOM', !r.restOfDay);
    check(2, 'one route button: Route all on Today\'s route (a Maps link), none on Next Job', !r.heroRoute && r.routeAll);
    check(18, 'Next Job card has no "1 of N"; the summary line has no "stops left"', !r.heroOf && !/stops? left/.test(r.summary), r.summary);
    check(18, 'the count stays on the Jobs ring and Today\'s route', /0\/3/.test(r.ringJobs) && /3 stops/.test(r.routeCount), r.ringJobs + ' | ' + r.routeCount);
    check(6, 'no Home search box', !r.search);
    check(7, 'daily strip is Find client + Calendar only', JSON.stringify(r.strip) === '["Find client","Calendar"]', r.strip.join(','));
    check(8, 'no Income lane; Money owed lists all 7 unpaid once (6 + 1 folded) with one Mark paid each', !r.incomeLane && r.unpaidRows === 7 && r.markPaid === 7, r.unpaidRows + ' rows, ' + r.markPaid + ' Mark paid');
    check(8, 'Ready to invoice is on the Money owed card; the income list shows history only', r.rtiInCard && r.historyOpenRows === 0 && /paid or received/.test(r.settled) && !r.needsHasInvoices, r.settled);
    check(10, 'no Mileage tile in Business Snapshot', !r.mileageTile);
    check(17, 'no Gallery Queue on Home', !r.gallery);
    // Mark paid still works from Money owed (item 8).
    page.on('dialog', (d) => d.accept());
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('th_invoices')).filter((i) => !i.paid).length);
    await page.evaluate(() => { const b = document.querySelector('#todayMoney #todayOverdueList .paid-toggle-btn:not(.is-remind):not(.is-paid)'); if (b) b.click(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const ok = document.querySelector('#customDialogOverlay.is-open .dialog-btn-primary, .help-modal-overlay.is-open .dialog-btn-primary'); if (ok) ok.click(); });
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('th_invoices')).filter((i) => !i.paid).length);
    check(8, 'Mark paid on Money owed marks the invoice paid', after === before - 1, before + ' -> ' + after);
    // Find client opens the shared search (item 6).
    await page.evaluate(() => { const b = [...document.querySelectorAll('#dashPrimaryStrip button')].find((x) => /Find client/.test(x.textContent)); if (b) b.click(); });
    await page.waitForTimeout(400);
    check(6, 'Find client opens Ctrl+K search', await page.evaluate(() => { const o = document.getElementById('thCmdkOverlay'); return !!o && getComputedStyle(o).display !== 'none' && o.classList.contains('is-open') || !!document.querySelector('.th-cmdk-overlay.is-open, .th-cmdk-overlay:not([hidden])'); }));
    // + New carries the four strip actions (item 7).
    const create = await page.evaluate(() => [...document.querySelectorAll('#thCreateSheet a')].map((a) => a.getAttribute('href')));
    check(7, '+ New has Job / Invoice / Quick charge / Expense', ['/tools/job-tracker.html#add-job', '/tools/invoice-generator.html#invoice', '/tools/invoice-generator.html#pos', '/tools/finance.html#expenses'].every((h) => create.includes(h)), create.length + ' links');
    check('smoke', 'Home: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // Ctrl+K (items 3, 11, 16) and old Home ?search= links (item 6).
  {
    const { ctx, page } = await open(browser, '/tools/workspace.html');
    await page.evaluate(() => window.openCommandPalette());
    await page.waitForTimeout(300);
    const list = await page.evaluate(() => [...document.querySelectorAll('#thCmdkResults a')].map((a) => a.getAttribute('href')));
    check(3, 'Ctrl+K: Route Planner is not in the before-you-type list', !list.includes('/tools/route-planner.html'));
    check(11, 'Ctrl+K: no Cost lookup / Inventory entries', !list.some((h) => /finance\.html#(cost|inventory)/.test(h || '')));
    await page.fill('#thCmdkInput', 'route');
    await page.waitForTimeout(300);
    check(3, 'Ctrl+K: typing "route" finds Route Planner', await page.evaluate(() => [...document.querySelectorAll('#thCmdkResults a')].some((a) => a.getAttribute('href') === '/tools/route-planner.html')));
    await page.fill('#thCmdkInput', 'Bill');
    await page.waitForTimeout(300);
    const inv = await page.evaluate(() => [...document.querySelectorAll('#thCmdkResults a')].map((a) => a.getAttribute('href')).filter((h) => /\?search=/.test(h || '')));
    check(6, 'Ctrl+K invoice results open the Invoices list, not Home\'s old search box', inv.length > 0 && inv.every((h) => /invoice-generator\.html\?search=Bill/.test(h)), inv.join(','));
    await ctx.close();
    const old = await open(browser, '/tools/workspace.html?search=Greg');
    check(6, 'an old workspace.html?search= link filters Money owed\'s income list', await old.page.evaluate(() => document.getElementById('invoiceSearch').value === 'Greg' && /Greg Hall/.test(document.getElementById('invoicesList').textContent)));
    await old.ctx.close();
  }
  // Sidebar vs More (item 3).
  {
    const { ctx, page } = await open(browser, '/tools/workspace.html', { width: 1280, height: 900, touch: false });
    const side = await page.evaluate(() => [...document.querySelectorAll('.th-desktop-sidebar .th-sidebar-link')].map((a) => a.getAttribute('href')));
    const more = await page.evaluate(() => [...document.querySelectorAll('.th-more-sheet-link')].map((a) => a.getAttribute('href')));
    check(3, 'desktop sidebar: no Route Planner; More drawer: still there', !side.includes('/tools/route-planner.html') && more.includes('/tools/route-planner.html'));
    await ctx.close();
  }
  // Route Planner (item 4).
  {
    const { ctx, page, errors } = await open(browser, '/tools/route-planner.html');
    const r = await page.evaluate(() => ({ card: !!document.querySelector('.route-cost-card, #tripDistance'), badge: !!document.querySelector('.hub-header #realtimeBadge, .hub-sub #realtimeBadge'), stops: document.querySelectorAll('#stopsContainer input').length, rate: localStorage.getItem('th_mileage_rate') }));
    // The page's live-sync badge left the Cost Analyzer's heading; the shared
    // shell's mountStatusDot() lifts it into the header's status dot, as on
    // every other page.
    check(4, 'Cost Analyzer card gone; stops and live-sync badge still there', !r.card && r.badge && r.stops === 2);
    check('smoke', 'Route Planner: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // Job Tracker (items 5, 15).
  {
    const { ctx, page, errors } = await open(browser, '/tools/job-tracker.html');
    await page.evaluate(() => window.openJobActions(102));
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.th-qa-sheet button, .quick-action-sheet button, [role="dialog"] button')].find((b) => /Log Expense/.test(b.textContent));
      return { row: !!row, modal: !!document.getElementById('quickExpenseOverlay') };
    });
    check(5, 'Log Expense is on the job sheet; the pop-up form is gone', r.row && !r.modal);
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Log Expense/.test(x.textContent)); if (b) b.click(); });
    await page.waitForURL(/finance\.html\?job=102#expenses/, { timeout: 4000 }).catch(() => {});
    check(5, 'Log Expense opens finance.html?job=102#expenses', /finance\.html\?job=102#expenses/.test(page.url()), page.url());
    await page.waitForTimeout(1800);
    check(5, 'Finance lands on Expenses with the job picked', await page.evaluate(() => document.getElementById('tab-expenses').classList.contains('is-active') && document.getElementById('entryJobRef').value === '102'));
    check('smoke', 'Jobs: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
    const s = await open(browser, '/tools/job-tracker.html#contacts');
    const sr = await s.page.evaluate(() => ({ tab: document.querySelector('.tab-btn[data-tab="contacts"]').textContent, active: document.getElementById('tab-contacts').classList.contains('is-active'), rows: document.querySelectorAll('#contactsList .contact-card').length, trig: (document.querySelector('#tab-contacts .th-sheet-trigger-label') || {}).textContent }));
    check(15, 'Suppliers tab: label, form, and existing entries all listed', sr.tab === 'Suppliers' && sr.active && sr.rows === 2 && /Add a supplier/.test(sr.trig || ''), JSON.stringify(sr));
    await s.ctx.close();
  }
  // Finance (items 11, 16).
  {
    for (const url of ['/tools/finance.html', '/tools/finance.html#inventory']) {
      const { ctx, page, errors } = await open(browser, url);
      const r = await page.evaluate(() => ({ tabs: [...document.querySelectorAll('.tabs .tab-btn')].map((b) => b.dataset.tab), active: [...document.querySelectorAll('.tab-panel.is-active')].map((p) => p.id), inv: localStorage.getItem('th_inventory'), ref: localStorage.getItem('th_price_reference'), entries: document.querySelectorAll('#entriesTable .dash-list-item, #entriesTable tr, #entriesTable .fin-row').length, scroll: (() => { const t = document.querySelector('.tabs'); return t.scrollWidth - t.clientWidth; })() }));
      check(url === '/tools/finance.html' ? 11 : 16, url + ': tabs Expenses/Income/Profitability, opens on Expenses', JSON.stringify(r.tabs) === '["expenses","income","profitability"]' && JSON.stringify(r.active) === '["tab-expenses"]', JSON.stringify(r.active));
      if (url === '/tools/finance.html') {
        check(16, 'th_inventory and th_price_reference are still stored (no data removed)', !!r.inv && JSON.parse(r.inv).length === 1 && !!r.ref && JSON.parse(r.ref).length === 1);
        check(11, 'the three tabs fit at 390 without a scrolling track', r.scroll <= 0, 'overflow ' + r.scroll);
        check('smoke', 'Finance: no page errors', errors.length === 0, errors.join(' | '));
      }
      await ctx.close();
    }
    const q = await open(browser, '/tools/invoice-generator.html#quote');
    check(11, 'New quote\'s "Add From Saved Job Types" still lists th_price_reference', await q.page.evaluate(() => !document.getElementById('quotePriceRefRow').style.display.includes('none') && /Dishwasher install/.test(document.getElementById('quotePriceRefSelect').textContent)));
    await q.ctx.close();
  }
  // Redirects for removed/relocated deep links (rebase onto Phase 4, 2026-10-31).
  {
    // finance.html#cost (Cost Lookup) -> New quote, for an account with Invoices.
    const c = await open(browser, '/tools/finance.html#cost', null, 2800);
    const cr = await c.page.evaluate(() => ({ url: location.pathname + location.hash, quote: !!document.querySelector('.tab-panel.is-active#tab-quote, #tab-quote.is-active, .tab-btn.is-active[data-tab="quote"]'), ref: /Dishwasher install/.test((document.getElementById('quotePriceRefSelect') || {}).textContent || '') }));
    check('redirect', 'finance.html#cost lands on New quote (invoice-generator.html#quote) with saved job types', cr.url === '/tools/invoice-generator.html#quote' && cr.quote && cr.ref, JSON.stringify(cr));
    check('redirect', 'finance.html#cost -> New quote: no page errors', c.errors.length === 0, c.errors.join(' | '));
    await c.ctx.close();
    // ... but an account without Invoices stays on Finance's Expenses.
    const n = await open(browser, '/tools/finance.html#cost', { role: { can_manage_invoices: false } }, 2800);
    const nr = await n.page.evaluate(() => ({ path: location.pathname, active: [...document.querySelectorAll('.tab-panel.is-active')].map((p) => p.id) }));
    check('redirect', 'finance.html#cost without Invoices access stays on Finance, on Expenses', nr.path === '/tools/finance.html' && JSON.stringify(nr.active) === '["tab-expenses"]', JSON.stringify(nr));
    await n.ctx.close();
    // workspace.html#section-gallery / #gallery -> Site Content's Gallery queue, opened.
    for (const h of ['#section-gallery', '#gallery']) {
      const g = await open(browser, '/tools/workspace.html' + h, null, 4000);
      const gr = await g.page.evaluate(() => { const p = document.getElementById('section-gallery'); const r = p && p.getBoundingClientRect(); return { url: location.pathname + location.hash, open: !!p && !p.classList.contains('is-collapsed'), tiles: document.querySelectorAll('#galleryQueueList .gallery-queue-item').length, inView: !!r && r.top < innerHeight && r.bottom > 0 }; });
      check('redirect', 'workspace.html' + h + ' lands on Site Content with the Gallery queue open, loaded and in view', gr.url === '/tools/site-content.html#gallery' && gr.open && gr.tiles === 2 && gr.inView, JSON.stringify(gr));
      check('redirect', 'workspace.html' + h + ' -> Site Content: no page errors', g.errors.length === 0, g.errors.join(' | '));
      await g.ctx.close();
    }
    // The old Ctrl+K invoice link (workspace.html?search=…#section-actionitems):
    // filters Money owed's list, opens its search and scrolls it up under the
    // sticky header (not to Needs attention, where the old hash pointed).
    const s = await open(browser, '/tools/workspace.html?search=Greg#section-actionitems', null, 2800);
    const sr = await s.page.evaluate(() => { const hb = document.querySelector('.hub-header').getBoundingClientRect().bottom; const r = document.getElementById('invoiceSearchWrap').getBoundingClientRect(); return { val: document.getElementById('invoiceSearch').value, open: document.getElementById('invoiceSearchWrap').classList.contains('is-expanded'), hit: /Greg Hall/.test(document.getElementById('invoicesList').textContent), below: Math.round(r.top - hb), hash: location.hash }; });
    check('redirect', 'old workspace.html?search=…#section-actionitems: Money owed filtered, search open and in view under the header', sr.val === 'Greg' && sr.open && sr.hit && sr.below >= 0 && sr.below < 120 && sr.hash === '', JSON.stringify(sr));
    check('redirect', 'old ?search= link: no page errors', s.errors.length === 0, s.errors.join(' | '));
    await s.ctx.close();
  }
  // Invoices (item 13) + smoke.
  {
    const { ctx, page, errors } = await open(browser, '/tools/invoice-generator.html');
    const r = await page.evaluate(() => ({ rows: document.querySelectorAll('#invoiceLogList .inv-row, #invoiceLogList [data-invoice-id], #invoiceLogList .th-row').length, fn: typeof resendInvoiceToClient === 'function' && typeof resendQuoteToClient === 'function' }));
    check(13, 'Invoices list renders and has Resend for invoices and quotes', r.rows > 0 && r.fn, r.rows + ' rows');
    check('smoke', 'Invoices: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // Runway (items 9, 19).
  {
    const { ctx, page, errors } = await open(browser, '/tools/runway-dashboard.html');
    const r = await page.evaluate(() => ({ rate: document.getElementById('taxSetAsideRate').value, pull: !!document.getElementById('pullMonthBtn'), rev: !!document.getElementById('biz-revenue'), keep: ['biz-draws', 'biz-cash', 'biz-other'].every((id) => !!document.getElementById(id)), mom: !!document.getElementById('momStats') && !!document.getElementById('yoyStats'), backup: !!document.getElementById('exportBackupBtn') && !!document.getElementById('restoreBackupBtn'), reset: !!document.getElementById('resetAllBtn'), note: (document.getElementById('bizFinanceNote') || {}).textContent || '' }));
    check(9, 'Runway shows the Dashboard\'s rate (th_setaside_rate = 25), not its old 30', r.rate === '25', r.rate);
    check(9, 'no Pull from Finance / Revenue box; Draws, Cash, Other, MoM, YoY stay', !r.pull && !r.rev && r.keep && r.mom);
    check(9, 'Save Month\'s from-Finance line is shown', /From Finance for this month/.test(r.note), r.note);
    await page.evaluate(() => { const i = document.getElementById('taxSetAsideRate'); i.value = '20'; i.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ shared: localStorage.getItem('th_setaside_rate'), rd: JSON.parse(localStorage.getItem('rd_budget-settings')) }));
    check(9, 'changing it writes th_setaside_rate and leaves rd_budget-settings alone', st.shared === '20' && st.rd.taxSetAsideRate === 30 && st.rd.savingsPct === 20, JSON.stringify(st));
    check(19, 'Runway-only Download/Restore kept, Reset all data gone', r.backup && !r.reset);
    check('smoke', 'Runway: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
    const h = await open(browser, '/tools/workspace.html#insights');
    await h.page.evaluate(() => { localStorage.setItem('th_setaside_rate', '20'); if (typeof renderMetrics === 'function') renderMetrics(); });
    check(9, 'the Dashboard reads the same rate back', await h.page.evaluate(() => typeof loadSetAsideRate === 'function' && loadSetAsideRate() === 20));
    await h.ctx.close();
  }
  // Clients (items 12, 13, 14) + Client detail smoke.
  {
    const { ctx, page, errors } = await open(browser, '/tools/clients.html#portal', null, 2800);
    const r = await page.evaluate(() => ({ bug: !!document.getElementById('portalBugReports'), err: !!document.getElementById('portalClientErrors'), inv: !!document.getElementById('portalInvoices'), quo: !!document.getElementById('portalQuotes'), wo: /Washer won't drain/.test((document.getElementById('portalWorkOrders') || {}).textContent || '') }));
    check(12, 'Clients\' Portal tab has no bug reports / client errors', !r.bug && !r.err);
    check(13, 'Clients\' Portal tab has no Portal invoices / quotes', !r.inv && !r.quo);
    check(14, '(not done, flagged) Portal work orders panel still on Clients', r.wo);
    check('smoke', 'Clients: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
    const d = await open(browser, '/tools/client-detail.html?name=' + encodeURIComponent('Maria Lopez'));
    check('smoke', 'Client detail: no page errors', d.errors.length === 0, d.errors.join(' | '));
    await d.ctx.close();
    const j = await open(browser, '/tools/job-detail.html?id=101');
    check('smoke', 'Job detail: no page errors, and its Expense link still goes to Finance', j.errors.length === 0 && await j.page.evaluate(() => [...document.querySelectorAll('a')].some((a) => /finance\.html\?job=101#expenses/.test(a.getAttribute('href') || ''))), j.errors.join(' | '));
    await j.ctx.close();
  }
  // Dev Tools (item 12).
  {
    const { ctx, page, errors } = await open(browser, '/tools/dev-tools.html', null, 2800);
    const r = await page.evaluate(() => ({ bug: /The pay button did nothing/.test((document.getElementById('portalBugReports') || {}).textContent || ''), err: /TypeError/.test((document.getElementById('portalClientErrors') || {}).textContent || ''), inHealth: !!document.querySelector('[data-tab-panel="health"] #portalBugReports') }));
    check(12, 'Dev Tools -> Health shows the portal bug reports and client errors', r.bug && r.err && r.inHealth);
    check('smoke', 'Dev Tools: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // Site Content (item 17).
  {
    const { ctx, page, errors } = await open(browser, '/tools/site-content.html', null, 2800);
    const badge = await page.evaluate(() => (document.getElementById('galleryHeadingBadge') || {}).textContent || '');
    await page.evaluate(() => { const p = document.getElementById('section-gallery'); if (p.classList.contains('is-collapsed')) toggleDevPanel(p.querySelector('.dev-panel-heading')); });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ slider: document.querySelectorAll('#galleryQueueList .ba-slider').length, tiles: document.querySelectorAll('#galleryQueueList .gallery-queue-item').length, img: [...document.querySelectorAll('#galleryQueueList .ba-slider img')].every((i) => i.naturalWidth > 0) }));
    check(17, 'Site Content: collapsed Gallery queue shows its count', /3 waiting/.test(badge), badge);
    check(17, 'Site Content: opened, it renders the before/after slider and tiles, and the photos load', r.slider === 1 && r.tiles === 2 && r.img, JSON.stringify(r));
    check('smoke', 'Site Content: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // Sideways scroll, 390 and 1280, the touched pages.
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900, touch: false }]) {
    for (const url of ['/tools/workspace.html', '/tools/job-tracker.html', '/tools/job-detail.html?id=101', '/tools/invoice-generator.html', '/tools/finance.html', '/tools/clients.html', '/tools/client-detail.html?name=Maria%20Lopez', '/tools/route-planner.html', '/tools/runway-dashboard.html', '/tools/site-content.html', '/tools/dev-tools.html']) {
      const { ctx, page } = await open(browser, url, vp, 1600);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check('smoke', 'no sideways scroll at ' + vp.width + ': ' + url, o <= 0, 'overflow ' + o);
      await ctx.close();
    }
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log((r.ok ? 'PASS' : 'FAIL') + '  [' + r.item + '] ' + r.name + (r.ok || !r.detail ? '' : '  -- ' + r.detail)));
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})();
