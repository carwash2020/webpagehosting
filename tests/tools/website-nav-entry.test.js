// Website nav entry (2026-09-23): the site content editor
// (/tools/site-content.html) gets its own row in the desktop sidebar and
// the More drawer, so the owner no longer has to go through Dev Tools >
// Content. It is gated on canManageSiteContent() -- the same check the
// page itself uses, read from account_roles.can_manage_site_content --
// and, unlike the other gated rows (hidden once the role loads), it is
// injected hidden and only shown once the role confirms the permission,
// so an account without it never sees the row at all.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const NAV = read('tools-nav-pwa.js');
const AUTH = read('auth.js');
const HREF = '/tools/site-content.html';

const PERM_FNS = ['canManageInvoices', 'canViewFinance', 'canViewRunway', 'canManageContracts', 'canManageReviews', 'hasDevToolsAccess', 'canManageSiteContent'];
const EVERYTHING_BUT_SITE = { canManageInvoices: true, canViewFinance: true, canViewRunway: true, canManageContracts: true, canManageReviews: true, hasDevToolsAccess: true };

// A real tool page with the shell injected and the auth checks stubbed.
// `perms` is read at call time, so a test can change it and fire
// th-role-loaded again. `role` is what getCurrentUserRole() returns
// (null = not loaded yet).
function shellOn(page, { perms = {}, role = null } = {}) {
  const state = { perms, role };
  const dom = new JSDOM(read(page), {
    runScripts: 'dangerously', url: 'https://example.com/tools/' + page,
    beforeParse(w) {
      w.requireAuth = () => {};
      w.initAppTour = () => {};
      for (const fn of PERM_FNS) w[fn] = () => !!state.perms[fn];
      w.getCurrentUserRole = () => state.role;
      w.loadCurrentUserRole = () => {};
      // Keeps each page's own init inert: it waits on sync, which never
      // finishes here, so nothing runs after the test ends.
      w.initSyncOnLoad = () => new Promise(() => {});
    },
  });
  const w = dom.window;
  const s = w.document.createElement('script');
  s.textContent = NAV;
  w.document.head.appendChild(s);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const roleLoaded = (next) => {
    Object.assign(state, next);
    w.dispatchEvent(new w.CustomEvent('th-role-loaded'));
  };
  return { w, roleLoaded };
}

function websiteLinks(w) {
  return [...w.document.querySelectorAll('.th-desktop-sidebar a[href="' + HREF + '"], #thMoreSheet a[href="' + HREF + '"]')];
}
function shown(el) { return el.style.display !== 'none'; }
function assertAllHidden(w, why) {
  const links = websiteLinks(w);
  assert.equal(links.length, 2, 'one row in the sidebar, one in the More drawer');
  for (const a of links) assert.ok(!shown(a), why + ' (' + a.className + ')');
}
function assertAllShown(w, why) {
  const links = websiteLinks(w);
  assert.equal(links.length, 2, 'one row in the sidebar, one in the More drawer');
  for (const a of links) assert.ok(shown(a), why + ' (' + a.className + ')');
}

test('a site-content manager gets a Website row in the sidebar and the More drawer, next to Dev Tools, once the role loads', () => {
  const { w, roleLoaded } = shellOn('job-tracker.html');
  roleLoaded({ perms: { ...EVERYTHING_BUT_SITE, canManageSiteContent: true }, role: { roleName: 'Owner' } });
  assertAllShown(w, 'a manager sees Website');

  const side = w.document.querySelector('.th-desktop-sidebar a.th-sidebar-link[href="' + HREF + '"]');
  assert.equal(side.textContent.trim(), 'Website');
  assert.match(side.innerHTML, /#icon-globe/);
  assert.match(NAV, /<symbol id="icon-globe"/, 'the sprite carries the globe icon');
  const sideLabels = [...w.document.querySelectorAll('.th-desktop-sidebar .th-sidebar-links a')].map(a => a.textContent.trim());
  assert.deepEqual(sideLabels.slice(-4), ['Appliance Wiki', 'Website', 'Dev Tools', 'Settings']);

  const more = w.document.querySelector('#thMoreSheet a.th-more-sheet-link[href="' + HREF + '"]');
  assert.equal(more.textContent.trim(), 'Website');
});

test('an account without the permission never sees it: not before the role loads, not after, not with every other permission', () => {
  const { w, roleLoaded } = shellOn('job-tracker.html');
  assertAllHidden(w, 'hidden before the role loads');
  roleLoaded({ perms: EVERYTHING_BUT_SITE, role: { roleName: 'Employee' } });
  assertAllHidden(w, 'hidden once the role loads without can_manage_site_content');
  w.document.querySelector('.th-hdr-menu').click();
  assert.ok(!w.document.getElementById('thMoreSheet').hasAttribute('hidden'));
  assertAllHidden(w, 'still hidden with the drawer open');

  const none = shellOn('workspace.html');
  none.roleLoaded({ perms: {}, role: null });
  assertAllHidden(none.w, 'hidden for an account with no role at all');
});

test('fails closed: even a manager does not see it until the role confirms it, and a page whose role never loads never shows it', () => {
  const { w, roleLoaded } = shellOn('workspace.html', { perms: { canManageSiteContent: true }, role: null });
  assertAllHidden(w, 'hidden while the role is still loading');
  roleLoaded({ role: { roleName: 'Owner' } });
  assertAllShown(w, 'shown once the role confirms it');
});

test('a role that loaded before the shell was built still shows it, and a later role load without the permission hides it again', () => {
  const { w, roleLoaded } = shellOn('settings.html', { perms: { canManageSiteContent: true }, role: { roleName: 'Developer' } });
  assertAllShown(w, 'shown straight away when the role was already known');
  roleLoaded({ perms: {} });
  assertAllHidden(w, 'hidden again once the permission is gone');
});

test('on the editor itself the Website row is the current page', () => {
  const { w, roleLoaded } = shellOn('site-content.html');
  roleLoaded({ perms: { canManageSiteContent: true }, role: { roleName: 'Owner' } });
  const side = w.document.querySelector('.th-desktop-sidebar a.th-sidebar-link[href="' + HREF + '"]');
  assert.ok(side.classList.contains('is-active'));
  assert.equal(side.getAttribute('aria-current'), 'page');
  assert.ok(w.document.querySelector('.th-hdr-menu').classList.contains('is-active'), 'Website lives in More, so More carries the you-are-here dot');
});

test('the nav gates Website on exactly the check the editor page gates on', () => {
  assert.match(NAV, /'\/tools\/site-content\.html': function \(\) \{ return typeof canManageSiteContent === 'function' && canManageSiteContent\(\); \}/);
  assert.match(NAV, /href: '\/tools\/site-content\.html',\s+icon: 'globe',\s+label: 'Website', hideUntilAllowed: true/);
  assert.match(read('site-content.html'), /const allowed = typeof canManageSiteContent === 'function' && canManageSiteContent\(\);/);
});

// End to end through the real auth.js: the account_roles row decides.
// A minimal tool page, a signed-in session in storage, and a fetch that
// answers the account_roles query the way Supabase would.
async function withRealRole(row) {
  const EMAIL = row.email;
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head></head><body><header class="hub-header"><div class="hub-header-left"></div><div class="hub-header-right"></div></header></body></html>',
    { runScripts: 'dangerously', url: 'https://example.com/tools/job-tracker.html' }
  );
  const w = dom.window;
  w.localStorage.setItem('th_auth_session', JSON.stringify({
    email: EMAIL, access_token: 'test-token', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600,
  }));
  const requests = [];
  w.fetch = async (url) => {
    requests.push(String(url));
    const body = String(url).includes('/rest/v1/account_roles') ? [
      { email: 'someone-else@triplehenterprisesllc.biz', role_name: 'Developer', can_manage_site_content: !row.can_manage_site_content },
      row,
    ] : [];
    return { ok: true, status: 200, json: async () => body };
  };
  for (const src of [AUTH, NAV]) {
    const s = w.document.createElement('script');
    s.textContent = src;
    w.document.head.appendChild(s);
  }
  if (w.document.readyState === 'loading') await new Promise(r => w.document.addEventListener('DOMContentLoaded', r));
  assertAllHidden(w, 'hidden before the role loads');
  await w.loadCurrentUserRole();
  assert.ok(requests.some(u => u.includes('/rest/v1/account_roles') && u.includes('can_manage_site_content')), 'the role came from account_roles.can_manage_site_content');
  return w;
}
const ROW = {
  role_name: 'Owner', can_manage_roles: false, can_access_dev_tools: true, can_access_dev_tools_full: false,
  can_manage_invoices: true, can_manage_contracts: true, can_view_finance: true, can_view_runway: true, can_manage_reviews: true,
};

test('real auth.js: an account whose account_roles row has can_manage_site_content = true (Steve, Connor) sees Website', async () => {
  const w = await withRealRole({ ...ROW, email: 'steve@triplehenterprisesllc.biz', can_manage_site_content: true });
  assert.equal(w.canManageSiteContent(), true);
  assertAllShown(w, 'shown for a site-content manager');
});

test('real auth.js: an account whose row has can_manage_site_content = false never sees Website, whatever else it can do', async () => {
  const w = await withRealRole({ ...ROW, role_name: 'Employee', email: 'helper@triplehenterprisesllc.biz', can_manage_site_content: false });
  assert.equal(w.canManageSiteContent(), false);
  assertAllHidden(w, 'hidden without the permission');
});
