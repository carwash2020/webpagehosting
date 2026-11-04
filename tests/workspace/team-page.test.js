// Team page (Phase 4, 2026-11-04; approved "Team: roster and invite" and
// "one person's capabilities" designs). Runs the shipped tools/team.html
// markup and script in jsdom with the database, team-admin and the Dev
// Tools password stubbed. Made-up people only; nothing is sent anywhere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TEAM = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'team.html'), 'utf8');
const BODY = TEAM.slice(TEAM.indexOf('<body data-th-page="team">') + '<body data-th-page="team">'.length, TEAM.indexOf('</body>'));

const OWNER = { email: 'owner@example.com', display_name: 'Pat Owner', status: 'active', last_sign_in_at: '2026-11-03T15:00:00Z', invited_at: null, deactivated_at: null };
const ALL_ON = { can_manage_roles: true, can_access_dev_tools: true, can_access_dev_tools_full: true, can_manage_site_content: true, can_manage_invoices: true, can_manage_contracts: true, can_view_finance: true, can_view_runway: true, can_manage_reviews: true, can_manage_clients: true, can_manage_others_jobs: true };
const ALL_OFF = Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, false]));

function roster() {
  return [
    { ...OWNER, ...ALL_ON },
    { email: 'tech@example.com', display_name: null, status: 'active', last_sign_in_at: '2026-11-01T15:00:00Z', invited_at: null, deactivated_at: null, ...ALL_OFF, can_manage_reviews: true, can_view_finance: true },
    { email: 'new@example.com', display_name: 'New Person', status: 'invited', last_sign_in_at: null, invited_at: '2026-11-04T10:00:00Z', deactivated_at: null, ...ALL_OFF },
    { email: 'gone@example.com', display_name: 'Gone Person', status: 'deactivated', last_sign_in_at: '2026-09-01T10:00:00Z', invited_at: null, deactivated_at: '2026-10-01T10:00:00Z', ...ALL_OFF },
  ];
}

async function page({ manager = true, rows = roster(), patchOk = true, fnOk = true, me = OWNER.email } = {}) {
  const calls = [];
  const toasts = [];
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + BODY + '</body></html>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/team.html',
    beforeParse(w) {
      w.SUPABASE_URL = 'https://example.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon';
      w.getAuthToken = () => 'tok';
      w.getCurrentUserEmail = () => me;
      w.canManageRoles = () => manager;
      w.loadCurrentUserRole = () => { setTimeout(() => w.dispatchEvent(new w.Event('th-role-loaded')), 0); };
      w.confirmDevPassword = async () => true;
      w.showConfirm = async () => true;
      w.showToast = (m, o) => toasts.push([m, o && o.type]);
      w.signOut = () => {};
      w.retryRoleCheck = () => {};
      w.escapeHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      w.escapeAttr = w.escapeHtml;
      w.thJobs = { all: () => [{ id: 1, assignee: 'tech@example.com', status: 'in-progress' }, { id: 2, assignee: 'tech@example.com', status: 'done' }] };
      w.fetch = async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ url: String(url), method: init.method || 'GET', body, auth: init.headers && init.headers.Authorization });
        const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b });
        if (String(url).endsWith('/rest/v1/rpc/team_roster')) return json(rows);
        if (String(url).includes('/rest/v1/account_roles?email=eq.')) return patchOk ? json([{ email: 'x' }]) : json({ message: 'Cannot remove permission management access from the last account that has it' }, 400);
        if (String(url).endsWith('/functions/v1/team-admin')) return fnOk ? json({ ok: true }) : json({ ok: false, error: "You can't deactivate yourself." }, 400);
        throw new Error('unexpected ' + url);
      };
    },
  });
  const w = dom.window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 20));
  const $ = (id) => w.document.getElementById(id);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { w, $, calls, toasts, settle };
}

test('only accounts with Team & Settings get the page; anyone else sees the locked screen and no roster is fetched', async () => {
  const no = await page({ manager: false });
  assert.ok(no.$('roleBlockedOverlay').classList.contains('is-shown'));
  assert.equal(no.calls.length, 0);
  const yes = await page();
  assert.ok(!yes.$('roleBlockedOverlay').classList.contains('is-shown'));
  assert.equal(yes.calls[0].url, 'https://example.supabase.co/rest/v1/rpc/team_roster');
  assert.equal(yes.calls[0].auth, 'Bearer tok', 'as the signed-in person');
});

test('the roster: Active, then Invite pending, then Deactivated, with capabilities in plain words, last sign-in and jobs assigned', async () => {
  const { $ } = await page();
  const rows = [...$('teamList').querySelectorAll('.team-row')];
  const names = rows.map((r) => r.querySelector('.team-name').textContent);
  assert.deepEqual(names, ['Pat Owner', 'Tech', 'New Person', 'Gone Person']);
  const statuses = rows.map((r) => r.querySelector('.team-status').textContent);
  assert.deepEqual(statuses, ['Active', 'Active', 'Invite pending', 'Deactivated']);
  assert.deepEqual([...rows[0].querySelectorAll('.team-tag')].map((t) => t.textContent), ['Money', 'Clients', 'Contracts', 'Reviews', 'Team & Settings', 'Manage jobs for others']);
  assert.deepEqual([...rows[1].querySelectorAll('.team-tag')].map((t) => t.textContent), ['Reviews'], 'Money is only shown when all of it is on');
  assert.match(rows[1].querySelector('.team-meta').textContent, /Last sign-in Nov 1 · 1 job assigned/);
  assert.match(rows[2].querySelector('.team-meta').textContent, /Invited Nov 4 · own jobs only/);
  assert.deepEqual([...rows[2].querySelectorAll('[data-team-act]')].map((b) => b.textContent), ['Resend', 'Revoke']);
  assert.match(rows[3].querySelector('.team-meta').textContent, /Can't sign in · history kept/);
  assert.deepEqual([...rows[3].querySelectorAll('[data-team-act]')].map((b) => b.textContent), ['Reactivate']);
});

test('one person: the six switches; Money partly on says so; switching a group writes every switch in it', async () => {
  const { w, $, calls } = await page();
  $('teamList').querySelector('[data-team-open="tech@example.com"]').click();
  assert.equal($('teamPersonView').hidden, false);
  assert.equal($('teamPersonName').textContent, 'Tech');
  const sw = (k) => $('teamCaps').querySelector('[data-team-cap="' + k + '"]');
  assert.deepEqual([...$('teamCaps').querySelectorAll('.team-cap-label')].map((l) => l.textContent), ['Money', 'Clients', 'Contracts', 'Reviews', 'Team & Settings', 'Manage jobs for others']);
  assert.equal(sw('money').getAttribute('aria-checked'), 'false');
  assert.match($('teamCaps').textContent, /Partly on/);
  assert.equal(sw('reviews').getAttribute('aria-checked'), 'true');
  sw('money').click();
  await new Promise((r) => setTimeout(r, 20));
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.url, 'https://example.supabase.co/rest/v1/account_roles?email=eq.tech%40example.com');
  assert.deepEqual(patch.body, { can_manage_invoices: true, can_view_finance: true, can_view_runway: true });
  assert.equal(patch.auth, 'Bearer tok', 'as the signed-in person: the database decides');
  assert.equal(sw('money').getAttribute('aria-checked'), 'true');
  assert.ok(w.document.querySelector('.team-danger'), 'Deactivate Tech is offered');
});

test('a refused change (the database\'s last-admin check) shows its reason and leaves the switch as it was', async () => {
  const { $, toasts } = await page({ patchOk: false, rows: roster().map((r) => r.email === 'tech@example.com' ? { ...r, can_manage_roles: true, can_manage_site_content: true, can_access_dev_tools: true } : r) });
  $('teamList').querySelector('[data-team-open="tech@example.com"]').click();
  const sw = $('teamCaps').querySelector('[data-team-cap="team"]');
  sw.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  assert.match(toasts.at(-1)[0], /last account that has it/);
  assert.equal(toasts.at(-1)[1], 'error');
});

test('your own row has no Deactivate; nor does the last person who can manage the team', async () => {
  const mine = await page();
  mine.$('teamList').querySelector('[data-team-open="owner@example.com"]').click();
  assert.equal(mine.w.document.querySelector('.team-danger'), null);
  assert.match(mine.$('teamPersonActions').textContent, /This is you/);

  const only = await page({ me: 'someone@example.com', rows: [{ ...OWNER, ...ALL_ON }, { email: 'someone@example.com', display_name: 'Me', status: 'active', ...ALL_OFF }] });
  only.$('teamList').querySelector('[data-team-open="owner@example.com"]').click();
  assert.equal(only.w.document.querySelector('.team-danger'), null);
  assert.match(only.$('teamPersonActions').textContent, /last active person with Team & Settings/);
  only.$('teamCaps').querySelector('[data-team-cap="team"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(only.calls.filter((c) => c.method === 'PATCH').length, 0, 'not even sent');
});

test('Deactivate, Reactivate, Resend and Revoke go through team-admin with the right action', async () => {
  const g = await page();
  g.$('teamList').querySelector('[data-team-open="tech@example.com"]').click();
  g.w.document.querySelector('.team-danger').click();
  await g.settle();
  g.$('teamList').querySelector('[data-team-act="reactivate"]').click();
  await g.settle();
  g.$('teamList').querySelector('[data-team-act="resend"]').click();
  await g.settle();
  g.$('teamList').querySelector('[data-team-act="revoke"]').click();
  await g.settle();
  const fn = g.calls.filter((c) => c.url.endsWith('/functions/v1/team-admin')).map((c) => [c.body.action, c.body.email]);
  assert.deepEqual(fn, [['deactivate', 'tech@example.com'], ['reactivate', 'gone@example.com'], ['resend', 'new@example.com'], ['revoke', 'new@example.com']]);
});

test('Invite someone: name and email go to team-admin as an invite; a bad email is caught first; the sheet closes on success', async () => {
  const g = await page();
  g.$('teamInviteBtn').click();
  assert.equal(g.$('teamInviteSheet').hidden, false);
  g.$('teamInviteEmail').value = 'nope';
  g.$('teamInviteForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await g.settle();
  assert.equal(g.$('teamInviteError').textContent, 'Enter their email address.');
  g.$('teamInviteName').value = 'Sam Field';
  g.$('teamInviteEmail').value = ' Sam@Example.com ';
  g.$('teamInviteForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await g.settle();
  const inv = g.calls.find((c) => c.body && c.body.action === 'invite');
  assert.deepEqual(inv.body, { action: 'invite', email: 'sam@example.com', name: 'Sam Field' });
  assert.equal(g.$('teamInviteSheet').hidden, true);
  assert.match(g.toasts.at(-1)[0], /Invite sent to sam@example\.com/);
});

test('names in the roster are escaped, and the roster is cached for assignee names elsewhere', async () => {
  const g = await page({ rows: [{ ...OWNER, ...ALL_ON, display_name: '<img src=x onerror=alert(1)>' }] });
  assert.equal(g.$('teamList').querySelectorAll('img').length, 0);
  const cache = JSON.parse(g.w.localStorage.getItem('th_team_roster_cache'));
  assert.deepEqual(cache, [{ email: 'owner@example.com', display_name: '<img src=x onerror=alert(1)>', status: 'active' }]);
});
