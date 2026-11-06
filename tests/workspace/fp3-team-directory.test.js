// Fix plan FP3.6 (2026-11-06, D13; approved "Read-only team directory").
// Someone on the team who can't manage it opens Team and sees who's on it:
// names and titles only -- no switches, no emails or sign-in dates, no
// invite, no deactivate, no deactivated people. Runs the shipped team.html
// in jsdom with the roster stubbed. Made-up people only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TEAM = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'team.html'), 'utf8');
const BODY = TEAM.slice(TEAM.indexOf('<body data-th-page="team">') + '<body data-th-page="team">'.length, TEAM.indexOf('</body>'));
const ROSTER = [
  { email: 'owner@example.com', display_name: 'Pat Owner', title: 'Owner', status: 'active', last_sign_in_at: '2026-11-03T15:00:00Z', can_manage_roles: true, can_view_finance: true },
  { email: 'tess@example.com', display_name: 'Tess Tech', title: 'Field tech', status: 'active', last_sign_in_at: '2026-11-05T15:00:00Z', can_manage_roles: false },
  { email: 'new@example.com', display_name: 'New Person', title: null, status: 'invited', invited_at: '2026-11-04T10:00:00Z' },
  { email: 'gone@example.com', display_name: 'Gone Person', title: 'Helper', status: 'deactivated' },
];

async function page({ manager = false, role = { roleName: 'x' } } = {}) {
  const calls = [];
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + BODY + '</body></html>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/team.html',
    beforeParse(w) {
      w.SUPABASE_URL = 'https://example.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon';
      w.getAuthToken = () => 'tok';
      w.getCurrentUserEmail = () => 'tess@example.com';
      w.canManageRoles = () => manager;
      w.getCurrentUserRole = () => role;
      w.loadCurrentUserRole = () => { setTimeout(() => w.dispatchEvent(new w.Event('th-role-loaded')), 0); };
      w.confirmDevPassword = async () => true;
      w.showConfirm = async () => true;
      w.showToast = () => {};
      w.signOut = () => {};
      w.retryRoleCheck = () => {};
      w.escapeHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      w.escapeAttr = w.escapeHtml;
      w.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET' });
        return { ok: true, status: 200, json: async () => ROSTER };
      };
    },
  });
  const w = dom.window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 30));
  return { w, $: (id) => w.document.getElementById(id), calls };
}

test('FP3.6: a team member who can\'t manage it sees names and titles, alphabetical, no deactivated people', async () => {
  const { w, $ } = await page();
  assert.ok(!$('roleBlockedOverlay').classList.contains('is-shown'), 'no locked screen');
  const rows = [...w.document.querySelectorAll('[data-team-directory] .team-dir-row')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.team-name').textContent, r.querySelector('.team-title').textContent]), [
    ['New Person', 'No title yet'], ['Pat Owner', 'Owner'], ['Tess Tech', 'Field tech'],
  ]);
  assert.match(rows[0].textContent, /Invite pending/);
  assert.equal($('teamDirIntro').hidden, false);
});

test('FP3.6: nothing to act on and nothing private -- no invite, switches, actions, emails or sign-in dates', async () => {
  const { w, $, calls } = await page();
  assert.equal($('teamInviteBtn').hidden, true);
  const list = $('teamList');
  assert.equal(list.querySelectorAll('button, a, .th-toggle, [data-team-open], [data-team-act], .team-tag').length, 0);
  assert.doesNotMatch(list.textContent, /@example\.com|Last sign-in|Deactivate|Money/);
  assert.ok(calls.length >= 1);
  assert.ok(calls.every((c) => c.url.endsWith('/rest/v1/rpc/team_roster')), 'only roster reads: no writes, no team-admin');
  assert.ok(w.document.body.classList.contains('team-is-directory'));
});

test('FP3.6: someone with Team & Settings still gets the full screen; an unconfirmed role still gets the locked screen', async () => {
  const mgr = await page({ manager: true });
  assert.equal(mgr.$('teamInviteBtn').hidden, false);
  assert.equal(mgr.w.document.querySelector('[data-team-directory]'), null);
  assert.ok(mgr.w.document.querySelector('[data-team-open="owner@example.com"]'));
  const unknown = await page({ role: null });
  assert.ok(unknown.$('roleBlockedOverlay').classList.contains('is-shown'));
  assert.equal(unknown.calls.length, 0);
});
