// Fix plan FP1 (2026-11-06; approved "A person's name and title" design):
// a person's name and title belong to the person. Every place that says who
// someone is shows their name (display_name) and title, never the preset the
// account started from and never a whole email address. Runs the shipped
// code in jsdom with the database and session stubbed. Made-up people only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const AUTH = read('tools', 'auth.js');
const NAV = read('tools', 'tools-nav-pwa.js');
const TEAM = read('tools', 'team.html');
const DEV = read('tools', 'dev-tools.html');
const DEV_SHARED = read('tools', 'dev-tools-shared.js');
const SETTINGS = read('tools', 'settings.html');
const WS = read('tools', 'workspace.html');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
const KNOWN = AUTH.slice(AUTH.indexOf('const KNOWN_USER_NAMES = {'), AUTH.indexOf('};', AUTH.indexOf('const KNOWN_USER_NAMES = {')) + 2);

// auth.js's name and title, with a given signed-in email and loaded row.
function who(email, role) {
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }).window;
  // Values go on the window; only fixed code is evaluated.
  w.__email = email;
  w._cachedRoleInfo = role || null;
  w.eval('function getCurrentUserEmail() { return window.__email; }');
  w.eval(KNOWN.replace('const ', 'var '));
  for (const fn of ['thNameFromEmail', 'getCurrentUserDisplayName', 'getCurrentUserFirstName', 'getCurrentUserTitle']) w.eval(extractFn(AUTH, fn));
  return w;
}

test('FP1.2: the name is display_name, then the known names, then the email prefix capitalized -- never the whole email', () => {
  assert.equal(who('elucid@example.com', { displayName: 'TEST Employee', title: '' }).getCurrentUserDisplayName(), 'TEST Employee');
  assert.equal(who('connor@triplehenterprisesllc.biz', null).getCurrentUserDisplayName(), 'Connor', 'before the role loads');
  assert.equal(who('Steve@TripleHEnterprisesLLC.biz', { displayName: '', title: 'Owner' }).getCurrentUserDisplayName(), 'Steve');
  const prefix = who('elucidhealertwitch@gmail.com', { displayName: '', title: '' });
  assert.equal(prefix.getCurrentUserDisplayName(), 'Elucidhealertwitch');
  assert.equal(prefix.getCurrentUserFirstName(), 'Elucidhealertwitch', 'the greeting\'s helper follows the same chain');
  assert.equal(who(null, null).getCurrentUserDisplayName(), null, 'signed out: no name');
  assert.equal(who('a@b.co', { displayName: 'A', title: 'Developer' }).getCurrentUserTitle(), 'Developer');
  assert.equal(who('a@b.co', null).getCurrentUserTitle(), '');
});

test('FP1.1: the account row is read with display_name and title, kept as labels beside the switches', () => {
  assert.match(AUTH, /account_roles\?select=email,role_name,display_name,title,can_manage_roles,/);
  assert.match(AUTH, /displayName: \(row\.display_name \|\| ''\)\.trim\(\),\s*title: \(row\.title \|\| ''\)\.trim\(\),/);
});

test('FP1.8: a screen they can\'t open says their name and title, never the preset', () => {
  const run = (role, title) => {
    const w = new JSDOM('<!doctype html><body><div data-rb><span class="th-rb-who"></span></div></body>', { runScripts: 'outside-only' }).window;
    w.__r = role;
    w.__title = title;
    w.eval("function getCurrentUserRole() { return window.__r; } function getCurrentUserDisplayName() { return 'Steve'; } function getCurrentUserTitle() { return window.__title; }");
    w.eval(extractFn(AUTH, 'fillRoleBlockedScreens'));
    w.fillRoleBlockedScreens();
    return w.document.querySelector('.th-rb-who').textContent;
  };
  assert.equal(run({ roleName: 'Owner' }, 'Owner'), 'You’re signed in as Steve, Owner.');
  assert.equal(run({ roleName: 'Employee' }, ''), 'You’re signed in as Steve.', 'no title: no preset in its place');
});

function chip(email, name, title) {
  const w = new JSDOM('<!doctype html><body><a class="th-sidebar-account"><span class="th-sidebar-account-avatar"></span><span class="th-sidebar-account-name"></span><span class="th-sidebar-account-role"></span></a></body>', { runScripts: 'outside-only' }).window;
  w.__session = { email };
  w.__name = name;
  w.__title = title;
  w.eval("function getStoredSession() { return window.__session; } function getCurrentUserDisplayName() { return window.__name; } function getCurrentUserTitle() { return window.__title; } function getCurrentUserRole() { return { roleName: 'Owner' }; }");
  w.eval(extractFn(NAV, 'fillSidebarAccount'));
  w.fillSidebarAccount();
  const q = (c) => w.document.querySelector(c).textContent;
  return [q('.th-sidebar-account-avatar'), q('.th-sidebar-account-name'), q('.th-sidebar-account-role')];
}

test('FP1.3: the sidebar chip is the person\'s name over their title; no title shows their email, never a preset', () => {
  assert.deepEqual(chip('connor@triplehenterprisesllc.biz', 'Connor', 'Developer'), ['CO', 'Connor', 'Developer']);
  assert.deepEqual(chip('elucid@example.com', 'TEST Employee', ''), ['TE', 'TEST Employee', 'elucid@example.com']);
  assert.doesNotMatch(NAV, /ROLE_WORDS/, 'the preset-word table is gone');
});

test('FP1.2: the dashboard greeting redraws once the person\'s row has loaded', () => {
  assert.match(WS, /window\.addEventListener\('th-role-loaded', \(\) => \{ try \{ renderGreetingBanner\(\); \}/);
});

test('Settings and the Dev Tools badge show the title, not the preset', () => {
  assert.match(SETTINGS, /const title = typeof getCurrentUserTitle === 'function' \? getCurrentUserTitle\(\) : '';/);
  assert.doesNotMatch(SETTINGS, /badge\.textContent = role\.roleName/);
  assert.match(DEV, /role && role\.title \? '<span class="dev-role-tag">' \+ escapeHtml\(role\.title\)/);
  assert.doesNotMatch(DEV, /escapeHtml\(role\.roleName\)/);
});

test('FP1.4–1.6: Dev Tools names people by name and title, and presets are starting templates', () => {
  assert.doesNotMatch(DEV, /started from/);
  assert.match(DEV, /account_roles\?select=email,role_name,display_name,title,/);
  // The account picker's label, run on its own.
  const start = DEV.indexOf('accounts.map(a => {');
  const fnSrc = DEV.slice(start + 'accounts.map('.length, DEV.indexOf("}).join('') +", start) + 1);
  const label = (a) => {
    const w = new JSDOM('', { runScripts: 'outside-only' }).window;
    w.eval('var _selectedPermEmail = ""; function escapeAttr(v) { return String(v); } function escapeHtml(v) { return String(v); }');
    w.eval('var f = ' + fnSrc);
    const div = w.document.createElement('select');
    div.innerHTML = w.f(a);
    return div.querySelector('option').textContent;
  };
  assert.equal(label({ email: 'steve@example.com', display_name: 'Steve', title: 'Owner', role_name: 'Owner' }), 'Steve · Owner — steve@example.com');
  assert.equal(label({ email: 'tess@example.com', display_name: null, title: null, role_name: 'Employee' }), 'Tess — tess@example.com');
  assert.match(DEV, /<p class="th-v2-card-title">Starting templates<\/p>/);
  assert.doesNotMatch(DEV, /Who can open what/);
  assert.match(DEV, /What a new account starts with\. Not people: each person’s switches are their own, on Team\./);
  assert.match(DEV, />Start from a template \(optional\)/);
  assert.match(DEV, /' template<\/option>'/);
  assert.doesNotMatch(DEV_SHARED, /A preset \(Owner, Developer, Employee\)/);
  assert.match(DEV_SHARED, /It is a starting point, not a role/);
});

// ---- Team: the person sheet's Name and title, and the roster ----------------

const BODY = TEAM.slice(TEAM.indexOf('<body data-th-page="team">') + '<body data-th-page="team">'.length, TEAM.indexOf('</body>'));
const ON = { can_manage_roles: true, can_access_dev_tools: true, can_access_dev_tools_full: true, can_manage_site_content: true, can_manage_invoices: true, can_manage_contracts: true, can_view_finance: true, can_view_runway: true, can_manage_reviews: true, can_manage_clients: true, can_manage_others_jobs: true };
const OFF = Object.fromEntries(Object.keys(ON).map((k) => [k, false]));
const rows = () => [
  { email: 'owner@example.com', display_name: 'Pat Owner', title: 'Developer', status: 'active', last_sign_in_at: '2026-11-03T15:00:00Z', invited_at: null, deactivated_at: null, ...ON },
  { email: 'tech@example.com', display_name: null, title: null, status: 'active', last_sign_in_at: null, invited_at: null, deactivated_at: null, ...OFF },
];

async function team({ patchOk = true, me = 'owner@example.com' } = {}) {
  const calls = [];
  const toasts = [];
  let roleReloads = 0;
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + BODY + '</body></html>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/team.html',
    beforeParse(w) {
      w.SUPABASE_URL = 'https://example.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon';
      w.getAuthToken = () => 'tok';
      w.getCurrentUserEmail = () => me;
      w.canManageRoles = () => true;
      w.loadCurrentUserRole = () => { roleReloads++; setTimeout(() => w.dispatchEvent(new w.Event('th-role-loaded')), 0); };
      w.confirmDevPassword = async () => true;
      w.showConfirm = async () => true;
      w.showToast = (m, o) => toasts.push([m, o && o.type]);
      w.signOut = () => {};
      w.retryRoleCheck = () => {};
      w.escapeHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      w.escapeAttr = w.escapeHtml;
      const data = rows();
      w.fetch = async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ url: String(url), method: init.method || 'GET', body });
        const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b });
        if (String(url).endsWith('/rest/v1/rpc/team_roster')) return json(data);
        if (String(url).includes('/rest/v1/account_roles?email=eq.')) return patchOk ? json([{ email: 'x' }]) : json([]);
        throw new Error('unexpected ' + url);
      };
    },
  });
  const w = dom.window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const settle = () => new Promise((r) => setTimeout(r, 20));
  await settle();
  const $ = (id) => w.document.getElementById(id);
  return { w, $, calls, toasts, settle, reloads: () => roleReloads };
}

test('FP1.1: each roster row shows the title under the name; no title reads "No title yet", never a preset', async () => {
  const { $ } = await team();
  const r = [...$('teamList').querySelectorAll('.team-row')].map((row) => [row.querySelector('.team-name').textContent, row.querySelector('.team-title').textContent]);
  assert.deepEqual(r, [['Pat Owner', 'Developer'], ['Tech', 'No title yet']]);
});

test('FP1.1: the person sheet fills Name and Title, and Save writes only those two fields to that person\'s row', async () => {
  const g = await team();
  g.w.document.querySelector('[data-team-open="tech@example.com"]').click();
  assert.equal(g.$('teamIdentName').value, '');
  assert.equal(g.$('teamIdentTitle').value, '');
  assert.equal(g.$('teamIdentName').maxLength, 120);
  assert.equal(g.$('teamIdentTitle').maxLength, 60);
  assert.equal(g.$('teamPersonMeta').textContent, 'tech@example.com · Active');
  const before = g.reloads();
  g.$('teamIdentName').value = '  Tess   Tech ';
  g.$('teamIdentTitle').value = 'Field tech';
  g.$('teamIdentForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await g.settle();
  const patch = g.calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.url, 'https://example.supabase.co/rest/v1/account_roles?email=eq.tech%40example.com');
  assert.deepEqual(patch.body, { display_name: 'Tess Tech', title: 'Field tech' }, 'no switch is part of the save');
  assert.equal(g.$('teamPersonName').textContent, 'Tess Tech');
  assert.equal(g.$('teamPersonMeta').textContent, 'Field tech · tech@example.com · Active');
  assert.deepEqual(g.toasts.at(-1), ['Saved for Tess Tech.', undefined]);
  const cache = JSON.parse(g.w.localStorage.getItem('th_team_roster_cache'));
  assert.deepEqual(cache.find((p) => p.email === 'tech@example.com'), { email: 'tech@example.com', display_name: 'Tess Tech', title: 'Field tech', status: 'active' });
  assert.equal(g.reloads(), before, 'someone else\'s name: your own row isn\'t reloaded');
});

test('FP1.1: clearing both fields saves no name and no title; a refused save says so and changes nothing on screen', async () => {
  const g = await team();
  g.w.document.querySelector('[data-team-open="owner@example.com"]').click();
  assert.equal(g.$('teamIdentName').value, 'Pat Owner');
  assert.equal(g.$('teamIdentTitle').value, 'Developer');
  const before = g.reloads();
  g.$('teamIdentName').value = '';
  g.$('teamIdentTitle').value = ' ';
  g.$('teamIdentForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await g.settle();
  assert.deepEqual(g.calls.find((c) => c.method === 'PATCH').body, { display_name: null, title: null });
  assert.equal(g.reloads(), before + 1, 'your own name: reloaded so the sidebar and greeting update now');

  const bad = await team({ patchOk: false });
  bad.w.document.querySelector('[data-team-open="owner@example.com"]').click();
  bad.$('teamIdentTitle').value = 'Boss';
  bad.$('teamIdentForm').dispatchEvent(new bad.w.Event('submit', { cancelable: true }));
  await bad.settle();
  assert.match(bad.$('teamIdentError').textContent, /didn’t save/);
  assert.equal(bad.$('teamPersonMeta').textContent, 'Developer · owner@example.com · Active');
});

test('FP1.1: reopening a person shows their saved values, not something left half-typed', async () => {
  const g = await team();
  g.w.document.querySelector('[data-team-open="owner@example.com"]').click();
  g.$('teamIdentTitle').value = 'half-typed';
  g.$('teamBackBtn').click();
  g.w.document.querySelector('[data-team-open="owner@example.com"]').click();
  assert.equal(g.$('teamIdentTitle').value, 'Developer');
});

// Connor, 2026-11-06: "fix the site content history too". Site Content's
// history and "Last save" lines name the person, never their email.
test('Site Content history names who saved: Team name, then the known names, then the email prefix -- never the address', () => {
  const SC = read('tools', 'site-content.html');
  const w = new JSDOM('', { runScripts: 'outside-only' }).window;
  w.__team = [{ email: 'tess@example.com', display_name: 'Tess Tech', status: 'active' }];
  w.eval('function thTeamMembers() { return window.__team; }');
  w.eval(KNOWN.replace('const ', 'var '));
  w.eval(extractFn(SC, 'cmsWho'));
  assert.equal(w.cmsWho('Tess@Example.com'), 'Tess Tech');
  assert.equal(w.cmsWho('steve@triplehenterprisesllc.biz'), 'Steve');
  assert.equal(w.cmsWho('elucidhealertwitch@gmail.com'), 'Elucidhealertwitch');
  assert.equal(w.cmsWho(null), 'Setup');
});
