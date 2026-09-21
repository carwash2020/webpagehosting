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

test('page order is answer-first: search, greeting band, hero, action strip, Needs attention, then the Business group -- no chip row, tile grid, Backup drawer, or Tools section', () => {
  const at = (needle) => { const i = WORKSPACE.indexOf(needle); assert.ok(i >= 0, `missing ${needle}`); return i; };
  const order = [
    'class="global-search-block"', 'id="greetingBanner"', 'id="todayHero"', 'id="dashPrimaryStrip"',
    'id="section-actionitems"', 'class="dash-group-label"', 'id="section-snapshot"', 'id="section-analytics"',
    'id="section-compliance"', 'id="section-gallery"', 'id="helpModalOverlay"',
  ];
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) < at(order[i]), `${order[i - 1]} should come before ${order[i]}`);
  for (const gone of ['id="everythingElseChips"', 'class="tools-grid"', 'class="tool-tile', 'id="section-backup"', 'id="section-tools"', 'more-tools-details', 'jumpNavMoreBtn']) {
    assert.doesNotMatch(WORKSPACE, new RegExp(gone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${gone} should be gone`);
  }
  assert.equal((WORKSPACE.match(/<div class="section-block" id=/g) || []).length, 5, 'exactly five section blocks remain');
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

test('the Next Job card offers Route today (or Directions for a single stop) and falls back to View in Job Tracker when no address is on file', () => {
  const fn = extractFn(WORKSPACE, 'renderTodayHero');
  assert.match(fn, /const routeUrl = buildTodayRouteUrl\(todaysJobs\);/);
  assert.match(fn, /id="todayRouteLink"/);
  assert.match(fn, /target="_blank" rel="noopener"/);
  assert.match(fn, /'Directions' : 'Route today/);
  assert.match(fn, /View in Job Tracker/);
});

test('Money Owed lists every unpaid invoice -- overdue first, then current by due date -- each with Mark paid and a due label, capped at six with a pointer to the inbox', () => {
  const fn = extractFn(WORKSPACE, 'renderTodayMoney');
  assert.match(fn, /invoicePaymentStatus\(i\) !== 'paid'/);
  assert.match(fn, /overdue: isOverdue\(i\), due: getDueDate\(i\)/);
  assert.match(fn, /a\.overdue \? -1 : 1/);
  assert.match(fn, /slice\(0, 6\)/);
  assert.match(fn, /'' : 's'\} overdue`/);
  assert.match(fn, /Due today/);
  assert.match(fn, /Due in \$\{days\} day/);
  assert.match(fn, /more unpaid in Needs attention below/);
  assert.match(fn, /invoiceMarkPaidButtonHtml\(i\)/);
});

test('the Money Owed rows render current invoices unhighlighted and overdue ones highlighted, with Mark paid on both (real DOM render)', () => {
  const today = new Date();
  const iso = (offset) => { const d = new Date(today); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
  const dom = new JSDOM(WORKSPACE, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      w.requireAuth = () => {};
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

test('the Income lane leads with unpaid invoices and folds paid/received history under one summary line, unless a search asks for it', () => {
  const fn = extractFn(WORKSPACE, 'renderInvoicesList');
  assert.match(fn, /const isOpenItem = it => it\.kind === 'invoice' && invoicePaymentStatus\(it\.raw\) !== 'paid';/);
  assert.match(fn, /openItems\.concat\(settledItems\)\.slice\(0, 20\)/);
  assert.match(fn, /<details class="income-settled"><summary>\$\{settledCount\} paid or received<\/summary>/);
  assert.match(fn, /if \(searchTerm \|\| settledCount === 0\)/);
  assert.match(fn, /Nothing unpaid right now/);
  // The lazy-loading contract from workspace-lazy-sections.test.js still
  // holds: the count updates before any markup is skipped.
  const countAt = fn.indexOf('actionItemCounts.unpaid');
  const skipAt = fn.indexOf("dashSectionClosed('actionitems')");
  assert.ok(countAt >= 0 && skipAt > countAt);
});

test('the heading badge shows the breakdown on wide screens and only the total on a phone, so the long sentence no longer wraps the heading', () => {
  const fn = extractFn(WORKSPACE, 'updateActionItemsBadge');
  assert.match(fn, /ai-badge-detail/);
  assert.match(fn, /ai-badge-total[^`]*\$\{total\}/);
  assert.match(WORKSPACE, /\.ai-badge-total \{ display: none; \}/);
  assert.match(WORKSPACE, /@media \(max-width: 720px\) \{\s*\.ai-badge-detail \{ display: none; \}\s*\.ai-badge-total \{ display: inline-block; \}/);
});

test('Backup & Restore moved to Settings intact: the same ALL_SYNCED_KEYS list, both actions, the same confirm text; the dashboard hands #backup off there', () => {
  assert.doesNotMatch(WORKSPACE, /function downloadBackup|function restoreBackup|ALL_SYNCED_KEYS/);
  assert.match(SETTINGS, /const ALL_SYNCED_KEYS = \[[\s\S]*?'th_tracker_jobs', 'th_tracker_contacts', 'th_tracker_notes_v2',[\s\S]*?'th_inventory',\s*\];/);
  assert.match(SETTINGS, /function downloadBackup\(\)/);
  assert.match(SETTINGS, /function restoreBackup\(event\)/);
  assert.match(SETTINGS, /This will REPLACE all current data/);
  assert.match(SETTINGS, /<div class="settings-section" id="backup">/);
  assert.doesNotMatch(SETTINGS, /workspace\.html#backup/, 'no more hop back to the dashboard');
  assert.match(SETTINGS, /if \(window\.location\.hash === '#backup'\)/);
  assert.match(WORKSPACE, /if \(window\.location\.hash === '#backup'\) \{\s*window\.location\.replace\('\/tools\/settings\.html#backup'\);/);
});

test('the shared stylesheet no longer carries the dead tile-grid rules, and runway-dashboard.html (which mirrors shared nav CSS by hand) never had them to mirror', () => {
  assert.doesNotMatch(STYLES, /\.tool-tile/);
  const runway = fs.readFileSync(repo('tools', 'runway-dashboard.html'), 'utf8');
  assert.doesNotMatch(runway, /tool-tile|section-tools|everythingElseChips/);
});

test('the tour\'s four dashboard steps follow the new page: Today hero, Needs attention, Quick actions strip, Business', () => {
  const steps = [...TOUR.matchAll(/\{ page: '\/tools\/workspace\.html', highlightSelector: '([^']+)', title: '([^']+)'/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(steps, [
    ['#todayHero', 'Today'],
    ['#section-actionitems', 'Needs attention'],
    ['#dashPrimaryStrip', 'Quick actions'],
    ['#section-snapshot', 'Business'],
  ]);
  for (const [selector] of steps) assert.match(WORKSPACE, new RegExp('id="' + selector.slice(1) + '"'), `${selector} must exist on the page`);
});

test('the help modal describes the new layout and no longer mentions the chip row, the Tools section, or the retired Show on Calendar checkbox', () => {
  const help = WORKSPACE.match(/<div class="help-modal-body">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<script>/)[1];
  assert.match(help, /Route today/);
  assert.match(help, /Needs attention/);
  assert.match(help, /Backup &amp; Restore moved to Settings/);
  assert.doesNotMatch(help, /chip row|More tools|Show on Calendar|Today's schedule/);
});
