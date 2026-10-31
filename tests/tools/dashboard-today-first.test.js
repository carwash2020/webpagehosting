// Today-first dashboard rebuild (2026-09-21). The problem being solved
// was information architecture, not paint: workspace.html carried five
// overlapping navigation layers (bottom bar / sidebar, a chip row, the
// daily strip, a 13-tile Tools grid, and "Today's schedule" pointing at
// the hero), a 170px greeting card that pushed Next Job below the first
// phone screen, and its ops inbox collapsed behind a count badge. This
// file locks in the new shape: greeting as one band, hero with Route
// today and every unpaid invoice, the inbox open right under it, one
// Business group for the occasional drawers, Backup on Settings, and no
// chip row or tile grid.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const SETTINGS = fs.readFileSync(repo('tools', 'settings.html'), 'utf8');
const STYLES = fs.readFileSync(repo('tools', 'styles-tools.css'), 'utf8');
const TOUR = fs.readFileSync(repo('tools', 'tools-tour.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

test('page order is answer-first: greeting band, hero, route, action strip, Needs attention, Money owed, then the Business group -- no search box, chip row, tile grid, Backup drawer, Tools section or Gallery drawer', () => {
  const at = (needle) => { const i = WORKSPACE.indexOf(needle); assert.ok(i >= 0, `missing ${needle}`); return i; };
  // Redundancy pass (2026-10-31): Home's own search box left (the shared
  // Ctrl+K search covers the same records) and the Gallery queue moved to
  // Site Content.
  const order = [
    'id="greetingBanner"', 'id="todayHero"', 'id="todayRouteCard"', 'id="dashPrimaryStrip"',
    'id="section-actionitems"', 'id="todayMoney"', 'class="dash-group-label"', 'id="section-snapshot"', 'id="section-analytics"',
    'id="section-compliance"', 'id="helpModalOverlay"',
  ];
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) < at(order[i]), `${order[i - 1]} should come before ${order[i]}`);
  for (const gone of ['id="everythingElseChips"', 'class="tools-grid"', 'class="tool-tile', 'id="section-backup"', 'id="section-tools"', 'more-tools-details', 'jumpNavMoreBtn', 'class="global-search-block"', 'id="globalSearch"', 'id="section-gallery"']) {
    assert.doesNotMatch(WORKSPACE, new RegExp(gone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gone} should be gone`);
  }
  assert.equal((WORKSPACE.match(/<div class="section-block" id=/g) || []).length, 4, 'exactly four section blocks remain');
});

test('the greeting is one compact band, not a card: same ids, same asserted rules, a fraction of the height', () => {
  const rule = WORKSPACE.match(/\.greeting-banner \{([^}]*)\}/)[1];
  assert.match(rule, /padding: 10px 16px/);
  assert.match(rule, /flex-wrap: wrap/);
  const number = WORKSPACE.match(/\.greeting-banner-number \{([^}]*)\}/)[1];
  assert.match(number, /font-size: 22px/, 'the job count is a number in the line, not a 44px display figure');
  for (const id of ['greetingBanner', 'greetingBannerGreeting', 'greetingBannerDate', 'greetingBannerNumber', 'greetingBannerLabel']) {
    assert.match(WORKSPACE, new RegExp('id="' + id + '"'));
  }
});

test('Route today: a Google Maps directions link through every address on today\'s active jobs, in hero order, de-duplicated and capped at Google\'s 10 stops', () => {
  const src = extractFn(WORKSPACE, 'todayRouteAddresses') + '\n' + extractFn(WORKSPACE, 'buildTodayRouteUrl');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.build = buildTodayRouteUrl; this.addrs = todayRouteAddresses;', ctx);
  const jobs = [
    { address: '1 Main St' }, { address: '  1 main st ' }, { address: '' }, { address: '2 Oak Ave' }, {},
  ];
  // Arrays built inside the vm context carry that context's Array
  // prototype, so compare by value, not by strict deep-equality.
  assert.equal(JSON.stringify(ctx.addrs(jobs)), JSON.stringify(['1 Main St', '2 Oak Ave']));
  assert.equal(ctx.build(jobs), 'https://www.google.com/maps/dir/?api=1&destination=2%20Oak%20Ave&travelmode=driving&waypoints=1%20Main%20St');
  assert.equal(ctx.build([{ address: 'Only Stop' }]), 'https://www.google.com/maps/dir/?api=1&destination=Only%20Stop&travelmode=driving');
  assert.equal(ctx.build([{ address: '' }]), null);
  const many = Array.from({ length: 14 }, (_, i) => ({ address: `${i} Stop Rd` }));
  assert.equal(ctx.addrs(many).length, 10);
  // Same URL shape route-planner.html's own buildRouteUrl() produces.
  const routePlanner = fs.readFileSync(repo('tools', 'route-planner.html'), 'utf8');
  assert.match(routePlanner, /'https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=' \+ encodeURIComponent\(destination\) \+ '&travelmode=driving'/);
});

test('the day\'s route is one button, Route all on Today\'s route (redundancy pass, 2026-10-31): the Next Job card no longer repeats it as Route today, and has no "1 of N"', () => {
  const hero = extractFn(WORKSPACE, 'renderTodayHero');
  assert.doesNotMatch(hero, /buildTodayRouteUrl|todayRouteLink|Route today|View in Job Tracker/);
  assert.doesNotMatch(hero, /1 of '|today-next-of/);
  assert.match(hero, /Open job/);
  const route = extractFn(WORKSPACE, 'renderTodayRoute');
  assert.match(route, /const routeUrl = buildTodayRouteUrl\(getTodaysJobs\(\)\);/);
  assert.match(route, /routeAll\.href = routeUrl; routeAll\.hidden = false;/);
  assert.match(WORKSPACE, /<a class="th-v2-link" id="todayRouteAll" href="\/tools\/route-planner\.html" target="_blank" rel="noopener" hidden>/);
});

test('Money Owed lists every unpaid invoice -- overdue first, then current by due date -- each with Mark paid and a due label, six shown and the rest folded under "N more unpaid" (the one list since the Income lane left, 2026-10-31)', () => {
  const fn = extractFn(WORKSPACE, 'renderTodayMoney');
  assert.match(fn, /invoicePaymentStatus\(i\) !== 'paid'/);
  assert.match(fn, /overdue: isOverdue\(i\), due: getDueDate\(i\)/);
  assert.match(fn, /a\.overdue \? -1 : 1/);
  assert.match(fn, /slice\(0, 6\)/);
  assert.match(fn, /'' : 's'\} overdue`/);
  assert.match(fn, /Due today/);
  assert.match(fn, /Due in \$\{days\} day/);
  assert.doesNotMatch(fn, /in Needs attention below/);
  assert.match(fn, /<details class="today-money-more-unpaid"><summary>\$\{unpaidInvoices\.length - 6\} more unpaid<\/summary>\$\{unpaidInvoices\.slice\(6\)\.map\(unpaidRowHtml\)\.join\(''\)\}<\/details>/);
  assert.match(fn, /invoiceMarkPaidButtonHtml\(i\)/);
});

test('the Money Owed rows render current invoices unhighlighted and overdue ones highlighted, with Mark paid on both (real DOM render)', () => {
  const today = new Date();
  const iso = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
  const dom = new JSDOM(WORKSPACE, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      // A signed-in Owner: money on Home waits for a confirmed role with a
      // finance permission (2026-09-29), and auth.js isn't loaded here.
      w.getCurrentUserRole = () => ({ roleName: 'Owner' });
      w.canManageInvoices = () => true;
      w.money = (n) => '$' + (Number(n) || 0).toFixed(2);
      w.escapeHtml = (s) => String(s == null ? '' : s);
      w.escapeAttr = (s) => String(s == null ? '' : s);
      w.localStorage.setItem('th_invoices', JSON.stringify([
        { id: 1, invoiceNumber: 'INV-1', clientName: 'Late Client', total: 100, paid: false, paidAmount: 0, date: iso(-40), terms: 'Net 15' },
        { id: 2, invoiceNumber: 'INV-2', clientName: 'Current Client', total: 200, paid: false, paidAmount: 0, date: iso(-2), terms: 'Net 30' },
        { id: 3, invoiceNumber: 'INV-3', clientName: 'Paid Client', total: 50, paid: true, paidAmount: 50, date: iso(-5), terms: 'Net 15' },
      ]));
    },
  });
  const { window } = dom;
  window.renderTodayMoney(window.computeMoneyOwed());
  const rows = [...window.document.querySelectorAll('#todayOverdueList .dash-list-item')];
  assert.equal(rows.length, 2, 'both unpaid invoices listed, the paid one left out');
  assert.match(rows[0].textContent, /Late Client/);
  assert.ok(rows[0].classList.contains('is-unread'), 'overdue row is highlighted');
  assert.match(rows[0].textContent, /days overdue/);
  assert.match(rows[1].textContent, /Current Client/);
  assert.ok(!rows[1].classList.contains('is-unread'), 'current row is plain');
  assert.match(rows[1].textContent, /Due in \d+ days/);
  assert.equal(window.document.querySelectorAll('#todayOverdueList .paid-toggle-btn').length, 2);
  window.close();
});

test('Money owed\'s income list (the old Income lane) folds paid/received history under one summary line and lists open invoices only for a search -- the card above already lists them, once (redundancy pass, 2026-10-31)', () => {
  const fn = extractFn(WORKSPACE, 'renderInvoicesList');
  assert.match(fn, /const isOpenItem = it => it\.kind === 'invoice' && invoicePaymentStatus\(it\.raw\) !== 'paid';/);
  assert.match(fn, /const openItems = searchTerm \? items\.filter\(isOpenItem\) : \[\];/);
  assert.match(fn, /openItems\.concat\(settledItems\)\.slice\(0, 20\)/);
  assert.match(fn, /<details class="income-settled"><summary>\$\{settledCount\} paid or received<\/summary>/);
  assert.match(fn, /if \(searchTerm\) \{\s*container\.innerHTML = openHtml \+ settledHtml;/);
  // It sits on the always-visible Money owed card now, not in the
  // collapsible Needs attention drawer, so it no longer skips its markup
  // when that drawer is closed; the count still updates first.
  assert.doesNotMatch(fn, /dashSectionClosed\('actionitems'\)/);
  assert.ok(fn.indexOf('actionItemCounts.unpaid') >= 0);
  assert.match(WORKSPACE, /<div class="today-money" id="todayMoney">[\s\S]*?<div class="today-money-more ops-lane" data-lane="money" id="todayMoneyMore">[\s\S]*?id="readyToInvoiceGroup"[\s\S]*?id="invoiceSearch"[\s\S]*?<div id="invoicesList"><\/div>/);
});

test('Mark paid on Money owed: one row per unpaid invoice, nothing listed twice (real DOM render, redundancy pass 2026-10-31)', () => {
  const today = new Date();
  const iso = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
  const dom = new JSDOM(WORKSPACE, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.getCurrentUserRole = () => ({ roleName: 'Owner' });
      w.canManageInvoices = () => true;
      w.canViewFinance = () => true;
      w.money = (n) => '$' + (Number(n) || 0).toFixed(2);
      w.escapeHtml = (s) => String(s == null ? '' : s);
      w.escapeAttr = (s) => String(s == null ? '' : s);
      const rows = [];
      for (let k = 1; k <= 8; k++) rows.push({ id: k, invoiceNumber: 'INV-' + k, clientName: 'Client ' + k, total: 100, paid: false, paidAmount: 0, date: iso(-k), terms: 'Net 30' });
      rows.push({ id: 9, invoiceNumber: 'INV-9', clientName: 'Paid Client', total: 50, paid: true, paidAmount: 50, date: iso(-5), terms: 'Net 15' });
      w.localStorage.setItem('th_invoices', JSON.stringify(rows));
    },
  });
  const { window } = dom;
  window.renderTodayMoney(window.computeMoneyOwed());
  window.renderInvoicesList();
  const doc = window.document;
  assert.equal(doc.querySelectorAll('#todayOverdueList > .dash-list-item').length, 6, 'six shown');
  assert.equal(doc.querySelectorAll('#todayOverdueList .today-money-more-unpaid .dash-list-item').length, 2, 'the other two folded, not dropped');
  assert.equal(doc.querySelectorAll('#todayMoney .paid-toggle-btn:not(.is-remind):not(.is-paid)').length, 8, 'one Mark paid per unpaid invoice, in the whole card');
  const history = doc.querySelectorAll('#invoicesList .dash-list-item');
  assert.equal(history.length, 1, 'only the paid invoice, in the history');
  assert.match(history[0].textContent, /Paid Client/);
  window.close();
});

test('the heading badge shows the breakdown on wide screens and only the total on a phone, so the long sentence no longer wraps the heading', () => {
  const fn = extractFn(WORKSPACE, 'updateActionItemsBadge');
  assert.match(fn, /ai-badge-detail/);
  // Since the redundancy pass (2026-10-31) unpaid / to-invoice live on the
  // Money owed card: the heading counts only what this section holds, while
  // the app icon badge (total) still counts them.
  assert.match(fn, /ai-badge-total[^`]*\$\{total - actionItemCounts\.unpaid - actionItemCounts\.toinvoice\}/);
  assert.doesNotMatch(fn, /parts\.push\(actionItemCounts\.unpaid/);
  assert.match(fn, /navigator\.setAppBadge\(total\)/);
  assert.match(WORKSPACE, /\.ai-badge-total \{ display: none; \}/);
  assert.match(WORKSPACE, /@media \(max-width: 720px\) \{\s*\.ai-badge-detail \{ display: none; \}\s*\.ai-badge-total \{ display: inline-block; \}/);
});

test('Backup & Restore moved to Dev Tools intact (2026-09-22, admin/dev capability, not a regular Settings item): every synced key, both actions, the same confirm text; the dashboard and Settings both hand #backup off there', () => {
  const DEV_TOOLS = fs.readFileSync(repo('tools', 'dev-tools.html'), 'utf8');
  assert.doesNotMatch(WORKSPACE, /function downloadBackup|function restoreBackup|ALL_SYNCED_KEYS/);
  assert.doesNotMatch(SETTINGS, /function downloadBackup|function restoreBackup|ALL_SYNCED_KEYS/);
  assert.doesNotMatch(SETTINGS, /<h2>Your Data<\/h2>/, 'the Your Data section should no longer live in Settings');
  // Since 2026-10-01 the key list is sync.js's own (see tests/tools/full-backup-keys.test.js).
  assert.match(DEV_TOOLS, /function fullBackupKeys\(\)/);
  assert.match(DEV_TOOLS, /function downloadBackup\(\)/);
  assert.match(DEV_TOOLS, /function restoreBackup\(event\)/);
  assert.match(DEV_TOOLS, /This will REPLACE all current data/);
  assert.match(DEV_TOOLS, /<div class="dev-panel dev-owner-hidden dev-panel-wide" id="backup">/, 'Backup & Restore must be Developer-only (dev-owner-hidden), like every other data-management panel on this tab');
  assert.doesNotMatch(SETTINGS, /workspace\.html#backup/, 'no more hop back to the dashboard');
  assert.match(SETTINGS, /if \(window\.location\.hash === '#backup'\)/);
  assert.match(SETTINGS, /window\.location\.replace\('\/tools\/dev-tools\.html#backup'\)/);
  assert.match(WORKSPACE, /if \(window\.location\.hash === '#backup'\) \{\s*window\.location\.replace\('\/tools\/dev-tools\.html#backup'\);/);
});

test('the shared stylesheet no longer carries the dead tile-grid rules, and runway-dashboard.html (which mirrors shared nav CSS by hand) never had them to mirror', () => {
  assert.doesNotMatch(STYLES, /\.tool-tile/);
  const runway = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');
  assert.doesNotMatch(runway, /tool-tile|section-tools|everythingElseChips/);
});

test('workspace.html\'s 3 tour steps (of the First Impressions handoff\'s 6, 2026-09-29) target real elements on the page', () => {
  const steps = [...TOUR.matchAll(/\{ page: '\/tools\/workspace\.html', highlightSelector: '([^']+)', title: '([^']+)'/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(steps, [
    ['.th-sidebar-new, .th-bn-create', 'Add a job'],
    ['#todayMoney', 'Money owed'],
    ['[onclick="openHelpModal()"]', 'Help lives here'],
  ]);
  assert.match(WORKSPACE, /id="todayMoney"/);
});

test('the help modal describes the new layout and no longer mentions the chip row, the Tools section, or the retired Show on Calendar checkbox', () => {
  const help = WORKSPACE.match(/<div class="help-modal-body">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<script>/)[1];
  assert.match(help, /Route all/);
  assert.doesNotMatch(help, /Route today|Rest of Today|Gallery Queue/);
  assert.match(help, /Needs attention/);
  assert.match(help, /Backup &amp; Restore lives in Dev Tools/, 'moved Settings -> Dev Tools on 2026-09-22');
  assert.doesNotMatch(help, /chip row|More tools|Show on Calendar|Today's schedule/);
});
