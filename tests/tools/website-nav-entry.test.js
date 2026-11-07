// Website and Dev Tools left the nav on 2026-11-04 (handoff §2: "Nav only:
// Dashboard, Jobs, Clients, Invoices, Contracts, Money, Reviews, Team,
// Settings"; Connor's choice of homes the same day). They now open from
// Settings -- Website editing under Add-ons, Dev Tools in its own row --
// and from Search. The guarantee the old Website nav row had carries over
// to the Settings rows: gated on the same auth.js checks the pages
// themselves use, and fails closed -- an account without the permission
// never sees the row, before or after its role loads.
//
// (Before 2026-11-04 this file tested a Website row in the sidebar and the
// More drawer, added 2026-09-23.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const NAV = read('tools-nav-pwa.js');
const AUTH = read('auth.js');
const SETTINGS = read('settings.html');
const PALETTE = read('tools-command-palette.js');

const PERM_FNS = ['canManageInvoices', 'canViewFinance', 'canViewRunway', 'canManageContracts', 'canManageReviews', 'hasDevToolsAccess', 'canManageSiteContent'];

// The Settings block under test, exactly as shipped: the two sections and
// the script that shows them.
const BLOCK = SETTINGS.slice(SETTINGS.indexOf('<!-- Add-ons (2026-11-04'), SETTINGS.indexOf('</script>', SETTINGS.indexOf('id="settingsDevToolsSection"')) + 9);

function settingsWith(perms) {
  const state = { perms };
  const dom = new JSDOM('<!DOCTYPE html><body>' + BLOCK + '</body>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/settings.html',
    beforeParse(w) { for (const fn of PERM_FNS) w[fn] = () => !!state.perms[fn]; },
  });
  const w = dom.window;
  const roleLoaded = (next) => { state.perms = next; w.dispatchEvent(new w.CustomEvent('th-role-loaded')); };
  const $ = (id) => w.document.getElementById(id);
  return { w, roleLoaded, $ };
}

test('the nav is the nine, in the approved groups -- no Website, Dev Tools, Wiki, Runway, Route Planner or Analytics', () => {
  const list = NAV.slice(NAV.indexOf('var SIDEBAR_DESTS = ['), NAV.indexOf('];', NAV.indexOf('var SIDEBAR_DESTS = [')));
  const rows = [...list.matchAll(/group: '(\w+)',\s+href: '([^']+)',\s+icon: '[\w-]+',\s+label: '([^']+)'/g)].map((m) => [m[1], m[3], m[2]]);
  assert.deepEqual(rows, [
    ['Work', 'Dashboard', '/tools/workspace.html'],
    ['Work', 'Jobs', '/tools/job-tracker.html'],
    ['Work', 'Clients', '/tools/clients.html'],
    ['Money', 'Invoices', '/tools/invoice-generator.html'],
    ['Money', 'Money', '/tools/finance.html'],
    ['Office', 'Contracts', '/tools/contract-generator.html'],
    ['Office', 'Reviews', '/tools/review-request.html'],
    ['Office', 'Team', '/tools/team.html'],
    ['Office', 'Settings', '/tools/settings.html'],
  ]);
  for (const gone of ['site-content.html', 'dev-tools.html\'', 'parts-reference.html', 'runway-dashboard.html', 'route-planner.html', 'workspace.html#insights']) {
    assert.ok(!list.includes(gone), gone + ' is not in the nav');
  }
});

// Since FP3.6 (2026-11-06, D13) everyone on the team can open Team -- a
// read-only directory unless they have Team & Settings -- once the role is
// confirmed (still fail-closed before it loads).
test('Team is its own page since Phase 4 (2026-11-04), open to every confirmed staff account since FP3.6; Dev Tools\' account permissions panel links to it', () => {
  assert.match(NAV, /'\/tools\/team\.html': function \(\) \{ return typeof getCurrentUserRole === 'function' && !!getCurrentUserRole\(\); \}/);
  assert.doesNotMatch(NAV, /'\/tools\/dev-tools\.html#team'/);
  const DEV = read('dev-tools.html');
  assert.match(DEV, /<div class="dev-panel dev-panel-wide" id="team">\s*<div class="dev-panel-heading">\s*<h2>Account permissions<\/h2>/);
  assert.match(DEV, /are on <a href="\/tools\/team\.html"/);
  assert.match(read('team.html'), /retryRoleCheck\(this, canManageRoles\)/);
});

test('a site-content manager sees Website editing under Add-ons once the role loads (the Add-ons card itself is always there: it holds the Route planner and Appliance Wiki switches)', () => {
  const { roleLoaded, $ } = settingsWith({});
  assert.equal($('settingsWebsiteRow').hidden, true, 'hidden before the role loads');
  assert.equal($('settingsAddons').hidden, false);
  roleLoaded({ canManageSiteContent: true });
  assert.equal($('settingsWebsiteRow').hidden, false);
  assert.equal($('settingsWebsiteRow').querySelector('a').getAttribute('href'), '/tools/site-content.html');
  assert.match($('settingsWebsiteRow').textContent, /Edit the public site's hours, banners, FAQ and terms from here\./);
});

test('an account without the permission never sees Website editing, whatever else it can do; a later role load without it hides it again', async () => {
  const everything = Object.fromEntries(PERM_FNS.filter((f) => f !== 'canManageSiteContent').map((f) => [f, true]));
  const { roleLoaded, $ } = settingsWith({});
  roleLoaded(everything);
  assert.equal($('settingsWebsiteRow').hidden, true);
  const again = settingsWith({ canManageSiteContent: true });
  await new Promise((r) => setTimeout(r, 0)); // DOMContentLoaded
  assert.equal(again.$('settingsWebsiteRow').hidden, false, 'shown straight away when the role was already known');
  again.roleLoaded({});
  assert.equal(again.$('settingsWebsiteRow').hidden, true, 'hidden again once the permission is gone');
});

test('Dev Tools opens from Settings only for an account with Dev Tools access', () => {
  const { roleLoaded, $ } = settingsWith({});
  assert.equal($('settingsDevToolsSection').hidden, true);
  roleLoaded({ canManageSiteContent: true });
  assert.equal($('settingsDevToolsSection').hidden, true, 'site content alone is not Dev Tools');
  roleLoaded({ hasDevToolsAccess: true });
  assert.equal($('settingsDevToolsSection').hidden, false);
  assert.equal($('settingsDevToolsSection').querySelector('a').getAttribute('href'), '/tools/dev-tools.html');
});

test('the Settings rows gate on exactly the checks the pages gate on', () => {
  assert.match(BLOCK, /var site = typeof canManageSiteContent === 'function' && canManageSiteContent\(\);/);
  assert.match(BLOCK, /var dev = typeof hasDevToolsAccess === 'function' && hasDevToolsAccess\(\);/);
  assert.match(read('site-content.html'), /const allowed = typeof canManageSiteContent === 'function' && canManageSiteContent\(\);/);
});

test('everything that left the nav is still in Search, behind the same checks', () => {
  for (const [title, href, perm] of [
    ['Website', '/tools/site-content.html', 'canManageSiteContent'],
    ['Dev Tools', '/tools/dev-tools.html', 'hasDevToolsAccess'],
    ['Team', '/tools/team.html', null], // everyone on the team since FP3.6 (D13)
    ['Analytics', '/tools/workspace.html#insights', null],
    ['Runway Dashboard', '/tools/runway-dashboard.html#runway', 'canViewRunway'],
  ]) {
    const line = PALETTE.split('\n').find((l) => l.includes(`title: '${title}'`));
    assert.ok(line, title + ' is in Search');
    assert.ok(line.includes(`href: '${href}'`), title + ' href');
    if (perm) assert.ok(line.includes(`perm: '${perm}'`), title + ' gated on ' + perm);
  }
});

// End to end through the real auth.js: the account_roles row decides.
async function withRealRole(row) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body>' + BLOCK + '</body></html>', { runScripts: 'dangerously', url: 'https://example.com/tools/settings.html' });
  const w = dom.window;
  w.localStorage.setItem('th_auth_session', JSON.stringify({
    email: row.email, access_token: 'test-token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600,
    remember_until: Date.now() + 30 * 86400000, // a current remembered session (D31 clears pre-cap ones once)
  }));
  w.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/rest/v1/account_roles') ? [row] : []) });
  const s = w.document.createElement('script');
  s.textContent = AUTH;
  w.document.head.appendChild(s);
  assert.equal(w.document.getElementById('settingsWebsiteRow').hidden, true, 'hidden before the role loads');
  await w.loadCurrentUserRole();
  return w;
}
const ROW = {
  role_name: 'Owner', can_manage_roles: false, can_access_dev_tools: true, can_access_dev_tools_full: false,
  can_manage_invoices: true, can_manage_contracts: true, can_view_finance: true, can_view_runway: true, can_manage_reviews: true,
};

test('real auth.js: can_manage_site_content = true shows Website editing', async () => {
  const w = await withRealRole({ ...ROW, email: 'steve@triplehenterprisesllc.biz', can_manage_site_content: true });
  assert.equal(w.canManageSiteContent(), true);
  assert.equal(w.document.getElementById('settingsWebsiteRow').hidden, false);
});

test('real auth.js: can_manage_site_content = false never shows it, whatever else it can do', async () => {
  const w = await withRealRole({ ...ROW, role_name: 'Employee', email: 'helper@triplehenterprisesllc.biz', can_manage_site_content: false });
  assert.equal(w.canManageSiteContent(), false);
  assert.equal(w.document.getElementById('settingsWebsiteRow').hidden, true);
});
