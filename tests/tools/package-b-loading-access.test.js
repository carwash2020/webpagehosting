// Claude Design next pass, Package B (2026-09-29): loading and no-access
// states. B7 Workspace Home paints the last visit's day at once, with a
// freshness marker and a settle tint, and shows money only to a confirmed
// role that may see it -- which also fixes Money owed and the Income lane
// showing every unpaid invoice to an Employee account. B6 the "you don't
// have access" screen on the 7 gated pages, and a first-paint placeholder
// on the two pages that were blank until the role check returned.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const WS = read('tools', 'workspace.html');
const AUTH = read('tools', 'auth.js');
const TOOLS_CSS = read('tools', 'styles-tools.css');

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
function extractConst(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `expected to find const ${name}`);
  return src.slice(start, src.indexOf('};', start) + 2);
}

const OWNER = { roleName: 'Owner', canManageInvoices: true, canManageContracts: true, canViewFinance: true, canViewRunway: true, canManageReviews: true };
const EMPLOYEE = { roleName: 'Employee', canManageInvoices: false, canManageContracts: false, canViewFinance: false, canViewRunway: false, canManageReviews: false };

// Money owed, run for real with the page's own gate and a stub invoice.
function moneyDom(role, roleState) {
  const dom = new JSDOM(`<!doctype html><body data-role-state="${roleState}" data-home-money="pending"><div id="todayMoney"></div></body>`, { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`
    var __role = ${JSON.stringify(role)};
    function getCurrentUserRole() { return __role; }
    function canManageInvoices() { return !!(__role && __role.canManageInvoices); }
    function canManageContracts() { return !!(__role && __role.canManageContracts); }
    function canViewFinance() { return !!(__role && __role.canViewFinance); }
    function canViewRunway() { return !!(__role && __role.canViewRunway); }
    function canManageReviews() { return !!(__role && __role.canManageReviews); }
    function loadInvoices() { return [{ id: 'inv-1', clientName: 'Secret Client', invoiceNumber: 'INV-9001', total: 4321.5 }]; }
    function invoicePaymentStatus() { return 'unpaid'; }
    function isOverdue() { return false; }
    function getDueDate() { return null; }
    function getRemainingCents() { return 432150; }
    function money(n) { return '$' + Number(n).toFixed(2); }
    function invoiceMarkPaidButtonHtml() { return '<button>Mark paid</button>'; }
    function readyToInvoiceRows() { return []; }
    function escapeHtml(s) { return String(s); }
    function escapeAttr(s) { return String(s); }
  `);
  // var, not const: each jsdom eval is its own script, and a top-level const
  // from one isn't visible to the next.
  w.eval(extractConst(WS, 'TILE_PERMISSION_CHECKS').replace(/^const /, 'var '));
  for (const fn of ['homeMoneyState', 'applyHomeMoneyState', 'homeMoneyLockHtml', 'renderTodayMoney']) w.eval(extractFn(WS, fn));
  w.eval('renderTodayMoney({ outstandingTotal: 4321.5, currentTotal: 4321.5, overdueTotal: 0, overdueCount: 0 })');
  return w.document;
}

test('B7: Money owed is left out of the page until the role is confirmed', () => {
  const doc = moneyDom(null, 'pending');
  const el = doc.getElementById('todayMoney');
  assert.equal(doc.body.getAttribute('data-home-money'), 'pending');
  assert.match(el.innerHTML, /class="th-money-lock"/);
  assert.match(el.textContent, /Checking access/);
  assert.doesNotMatch(el.innerHTML, /4,?321|Secret Client|Mark paid/);
  const failed = moneyDom(null, 'none');
  assert.equal(failed.body.getAttribute('data-home-money'), 'unconfirmed');
  assert.match(failed.getElementById('todayMoney').textContent, /confirm access/);
  assert.doesNotMatch(failed.getElementById('todayMoney').innerHTML, /4,?321|Secret Client/);
});

test('B7 (fix): an account with no finance-domain permission never gets Money owed', () => {
  const doc = moneyDom(EMPLOYEE, 'ready');
  assert.equal(doc.body.getAttribute('data-home-money'), 'hidden');
  assert.equal(doc.getElementById('todayMoney').innerHTML, '');
});

test('B7: a confirmed role with finance access still gets Money owed in full', () => {
  const doc = moneyDom(OWNER, 'ready');
  assert.equal(doc.body.getAttribute('data-home-money'), 'shown');
  const html = doc.getElementById('todayMoney').innerHTML;
  assert.match(html, /\$4321\.50/);
  assert.match(html, /Secret Client/);
  assert.match(html, /Mark paid/);
});

test('B7 (fix): the Income lane, Ready to invoice and their badge counts follow the same rule', () => {
  const fn = extractFn(WS, 'renderInvoicesList');
  assert.match(fn, /const moneyShown = applyHomeMoneyState\(\) === 'shown';/);
  assert.match(fn, /actionItemCounts\.unpaid = moneyShown \? invoicesForDisplay\(\)[^;]*: 0;/);
  assert.match(fn, /if \(moneyShown\) renderReadyToInvoice\(\);\s*else actionItemCounts\.toinvoice = 0;/);
  assert.match(fn, /if \(!moneyShown\) \{\s*const list = document\.getElementById\('invoicesList'\);\s*if \(list\) list\.innerHTML = '';\s*return;/);
  // Second lock: the CSS removes the lane, Business Snapshot and (for no
  // access) Money owed unless the state is "shown".
  assert.match(WS, /:not\(\[data-home-money="shown"\]\) #lane-money,\s*body\.th-tool-page\[data-th-page="workspace"\]:not\(\[data-home-money="shown"\]\) #section-snapshot,\s*body\.th-tool-page\[data-th-page="workspace"\]\[data-home-money="hidden"\] #todayMoney \{ display: none; \}/);
  assert.match(WS, /<body data-th-page="workspace" data-role-state="pending" data-home-money="pending">/);
  // Your week no longer treats a role that hasn't loaded as finance access.
  assert.match(extractFn(WS, 'renderWeekCard'), /const canFinance = typeof canViewFinance !== 'function' \|\| canViewFinance\(\);/);
});

test('B7: Home paints from the last visit before the role check and the pull, only if this device has pulled before', () => {
  const init = WS.slice(WS.indexOf("document.addEventListener('DOMContentLoaded', function () {\n    try {\n    const paintedFromLastVisit"));
  assert.ok(init.length > 0);
  assert.ok(init.indexOf('renderDashboardFromLastVisit()') < init.indexOf('initSyncOnLoad().then(renderDashboard)'));
  const paint = extractFn(WS, 'renderDashboardFromLastVisit');
  assert.match(paint, /if \(!lastSuccessfulPullTime\(\)\) return false;/);
  // Only the local renderers -- none of the network lanes.
  assert.doesNotMatch(paint, /loadAndRender|refreshRelational|fetch\(/);

  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window;
  w.eval(extractFn(WS, 'lastSuccessfulPullTime'));
  assert.equal(w.lastSuccessfulPullTime(), null);
  w.localStorage.setItem('th_sync_history', JSON.stringify([
    { type: 'push', ok: true, time: '2026-09-29T10:05:00Z' },
    { type: 'pull', ok: false, time: '2026-09-29T10:04:00Z' },
    { type: 'pull', ok: true, time: '2026-09-29T10:00:00Z' },
  ]));
  assert.equal(w.lastSuccessfulPullTime(), '2026-09-29T10:00:00Z');
});

test('B7: a renderer that throws during the last-visit paint is reported, and the rest still paint', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window;
  w.eval(`
    var ran = [], logged = [];
    function lastSuccessfulPullTime() { return '2026-09-29T10:00:00Z'; }
    function applyHomeMoneyState() { return 'pending'; }
    function settleChangedFigures() {}
    function logClientError(msg) { logged.push(msg); }
    function renderGreetingBanner() { ran.push('greeting'); }
    function renderTodayHero() { throw new Error('boom'); }
    function renderWeekCard() { ran.push('week'); }
    function renderMetrics() { ran.push('metrics'); }
    function renderUpcoming() { ran.push('upcoming'); }
    function renderFollowups() { ran.push('followups'); }
    function renderInvoicesList() { ran.push('invoices'); }
    function renderTodayV2() { ran.push('v2'); }
  `);
  w.eval(extractFn(WS, 'reportHomeRenderError'));
  w.eval(extractFn(WS, 'renderDashboardFromLastVisit'));
  assert.equal(w.renderDashboardFromLastVisit(), true);
  assert.deepEqual(Array.from(w.ran), ['greeting', 'week', 'metrics', 'upcoming', 'followups', 'invoices', 'v2']);
  assert.equal(w.logged.length, 1);
  assert.match(w.logged[0], /last-visit paint \(renderTodayHero\): boom/);
  assert.match(WS, /window\.addEventListener\('th-role-loaded', \(\) => \{ try \{ renderMetrics\(\); renderInvoicesList\(\); \} catch \(e\) \{ reportHomeRenderError\('money redraw on role load', e\); \} \}\);/);
});

test('B7: the freshness marker reads Refreshing, then Up to date, then how old', () => {
  const dom = new JSDOM('<!doctype html><body><span class="th-fresh" id="homeFresh" hidden></span></body>', { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window;
  w.eval(`
    function isSyncConfigured() { return true; }
    function getSyncCode() { return 'code'; }
    function relativeTimeFromNow() { return '5m ago'; }
    var homeFreshTimer = null;
  `);
  w.eval(extractFn(WS, 'lastSuccessfulPullTime'));
  w.eval(extractFn(WS, 'setHomeFresh'));
  const el = w.document.getElementById('homeFresh');
  w.setHomeFresh('stale');
  assert.equal(el.hidden, true, 'nothing to report before any pull');
  w.localStorage.setItem('th_sync_history', JSON.stringify([{ type: 'pull', ok: true, time: new Date().toISOString() }]));
  w.setHomeFresh('refreshing');
  assert.equal(el.hidden, false);
  assert.equal(el.getAttribute('data-state'), 'refreshing');
  assert.equal(el.textContent, 'Refreshing');
  w.setHomeFresh('fresh');
  assert.equal(el.getAttribute('data-state'), 'fresh');
  assert.equal(el.textContent, 'Up to date');
  w.setHomeFresh('stale');
  assert.equal(el.textContent, 'Updated 5m ago');
  assert.match(WS, /<span class="th-fresh" id="homeFresh" role="status" hidden><\/span>/);
  w.close(); // the marker's refresh timer would keep the test alive
});

test('B7: a figure that changed gets a one-shot settle tint; one appearing for the first time does not', () => {
  const dom = new JSDOM('<!doctype html><body><span id="greetingBannerNumber">1</span><span id="laneRespondCount" hidden></span></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  const s = WS.slice(WS.indexOf('  const SETTLE_SELECTORS'), WS.indexOf('  function renderSnapshotLastUpdated()'));
  w.eval(s.replace('const SETTLE_SELECTORS', 'var SETTLE_SELECTORS').replace('const settleLast', 'var settleLast'));
  const g = w.document.getElementById('greetingBannerNumber');
  const lane = w.document.getElementById('laneRespondCount');
  w.settleChangedFigures();
  assert.ok(!g.classList.contains('th-settle'));
  g.textContent = '2';
  lane.textContent = '3'; lane.hidden = false;
  w.settleChangedFigures();
  assert.ok(g.classList.contains('th-settle'), 'changed figure tints');
  assert.ok(!lane.classList.contains('th-settle'), 'a count appearing from nothing does not');
  w.close();
  assert.match(WS, /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]{0,300}\.th-settle \{ animation: th-settle 1\.2s ease-out both; \}/);
});

test('B6: auth.js settles body[data-role-state] once the role check ends', () => {
  const fin = AUTH.slice(AUTH.indexOf('  } finally {'), AUTH.indexOf("function getCurrentUserRole() {"));
  assert.match(fin, /if \(!usingOverride\) \{\s*\/\/[\s\S]*?document\.body\.setAttribute\('data-role-state', _cachedRoleInfo \? 'ready' : 'none'\);[\s\S]*?dispatchEvent\(new CustomEvent\('th-role-loaded'/);
});

function blockedDom(role) {
  const dom = new JSDOM('<!doctype html><body><div data-rb><h1>Finance</h1><p><span class="th-rb-who"></span></p></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`var __role = ${JSON.stringify(role)}; function getCurrentUserRole() { return __role; } function getCurrentUserEmail() { return 'jake@triplehenterprisesllc.biz'; } function getCurrentUserFirstName() { return 'jake@triplehenterprisesllc.biz'; }`);
  w.eval(extractFn(AUTH, 'fillRoleBlockedScreens'));
  w.fillRoleBlockedScreens();
  return w.document.querySelector('[data-rb]');
}

test('B6: the no-access screen says who is signed in, or that access could not be confirmed', () => {
  const known = blockedDom(EMPLOYEE);
  assert.equal(known.querySelector('.th-rb-who').textContent, 'You’re signed in as Jake (Employee).');
  assert.ok(!known.classList.contains('is-unconfirmed'));
  const unknown = blockedDom(null);
  assert.ok(unknown.classList.contains('is-unconfirmed'));
  assert.match(unknown.querySelector('.th-rb-who').textContent, /couldn’t confirm/);
  assert.match(AUTH, /window\.addEventListener\('th-role-loaded', fillRoleBlockedScreens\);/);
  // Try again only when the check failed; Switch account only when it didn't.
  assert.match(TOOLS_CSS, /\[data-rb\]:not\(\.is-unconfirmed\) \.th-rb-retry \{ display: none; \}/);
  assert.match(TOOLS_CSS, /\[data-rb\]\.is-unconfirmed \.th-rb-switch \{ display: none; \}/);
});

test('B6: all 7 gated pages use the new screen, each keeping its own permission check for Try again', () => {
  const PAGES = {
    'finance.html': ['roleBlockedOverlay', 'Finance', 'canViewFinance'],
    'invoice-generator.html': ['roleBlockedOverlay', 'Invoices', 'canManageInvoices'],
    'contract-generator.html': ['roleBlockedOverlay', 'Contracts', 'canManageContracts'],
    'review-request.html': ['roleBlockedOverlay', 'Reviews', 'canManageReviews'],
    'runway-dashboard.html': ['roleBlockedOverlay', 'Runway', 'canViewRunway'],
    'dev-tools.html': ['devBlockedView', 'Dev Tools', 'hasDevToolsAccess'],
    'site-content.html': ['contentBlockedView', 'Site Content', 'canManageSiteContent'],
  };
  for (const [page, [id, title, check]] of Object.entries(PAGES)) {
    const doc = new JSDOM(read('tools', page)).window.document;
    const box = doc.getElementById(id);
    assert.ok(box && box.hasAttribute('data-rb'), `${page}: #${id}[data-rb]`);
    assert.equal(box.querySelector('h1').textContent, title, page);
    assert.ok(box.querySelector('.th-rb-mark svg'), `${page}: lock mark`);
    assert.ok(box.querySelector('.th-rb-body .th-rb-who'), `${page}: account line`);
    const actions = box.querySelector('.th-rb-actions');
    assert.equal(actions.querySelector('a.primary-btn').getAttribute('href'), '/tools/workspace.html', page);
    assert.equal(actions.querySelector('.th-rb-switch').getAttribute('onclick'), 'signOut()', page);
    assert.equal(actions.querySelector('.th-rb-retry').getAttribute('onclick'), `retryRoleCheck(this, ${check})`, page);
  }
  // Runway loads no shared stylesheet, so it carries its own copy.
  assert.match(read('tools', 'runway-dashboard.html'), /\[data-rb\]:not\(\.is-unconfirmed\) \.th-rb-retry \{ display: none; \}/);
});

test('B6: Dev Tools and Site Content paint a placeholder until they show the page or the blocked view', () => {
  for (const [page, title] of [['dev-tools.html', 'Dev Tools'], ['site-content.html', 'Site Content']]) {
    const src = read('tools', page);
    assert.match(src, new RegExp(`<body data-th-page="${page.replace('.html', '')}" data-page-pending>`));
    const doc = new JSDOM(src).window.document;
    const pending = doc.querySelector('.th-page-pending');
    assert.ok(pending, page);
    assert.equal(pending.querySelector('.th-page-pending-title').textContent, title);
    assert.ok(pending.querySelector('.th-skel[aria-hidden="true"]'));
    assert.match(pending.querySelector('[role="status"]').textContent, new RegExp(`Loading ${title}`));
    const proceed = src.slice(src.indexOf('const proceed = () => {'), src.indexOf('const proceed = () => {') + 600);
    assert.match(proceed, /document\.body\.removeAttribute\('data-page-pending'\);/);
  }
  assert.match(TOOLS_CSS, /\.th-page-pending \{ display: none; \}/);
  assert.match(TOOLS_CSS, /body\[data-page-pending\] \.th-page-pending \{ display: block;/);
  assert.match(TOOLS_CSS, /\.th-skel \{[^}]*animation: th-skel-in \.01s linear \.25s both;/);
});
