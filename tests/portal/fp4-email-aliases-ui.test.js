// Fix plan FP4.2 (2026-11-06; D11; approved design EmailAliases): the
// portal's Emails card and the Workspace client record's Portal emails card.
// Runs their real script blocks in jsdom against a stubbed
// portal-email-alias endpoint. Made-up accounts only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SETTINGS = fs.readFileSync(repo('portal', 'settings.html'), 'utf8');
const APP = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const DETAIL = fs.readFileSync(repo('tools', 'client-detail.html'), 'utf8');
const slice = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const k = src.indexOf(b, i); assert.ok(k > i, b); return src.slice(i, k); };
const fnSrc = (src, name) => {
  const start = src.indexOf(`function ${name}(`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
};
const tick = () => new Promise((r) => setTimeout(r, 20));

// ---- portal ------------------------------------------------------------------
const CARD = slice(SETTINGS, '<div class="set-card" id="myEmailsCard" hidden>', '\n    </div>\n\n');
const SCRIPT = slice(SETTINGS, '  // ---- Your emails (fix plan FP4.2', '  // Saved card management (2026-09-03)');

function portal(replies, url = 'https://example.com/portal/settings.html') {
  const dom = new JSDOM('<!DOCTYPE html><body>' + CARD + '</body>', { url, runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w.client = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
  w.PORTAL_ERROR_LOG_ANON_KEY = 'anon';
  w.opened = [];
  w.openSettingsSection = (k) => w.opened.push(k);
  w.confirm = () => true;
  w.fetch = async (u, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const r = typeof replies === 'function' ? replies(body) : replies[body.action];
    return { json: async () => r };
  };
  w.eval(fnSrc(APP, 'escapeHtml') + '\n' + SCRIPT.replace(/^  const /gm, '  var ').replace(/^  let /gm, '  var ') + '\nwindow.__load = loadMyEmails;');
  return { w, d: w.document, calls };
}
const LIST = { ok: true, signin: 'sam@example.com', emails: [{ email: 'sam.old@example.com', status: 'confirmed', added_by: 'client', added_at: '2026-11-01T00:00:00Z', confirmed_at: '2026-11-01T00:00:00Z' }] };

test('portal: the card stays hidden until the list loads (so it never shows before the server side is live)', async () => {
  const g = portal({ list: { ok: false, error: 'not found' } });
  await g.w.__load();
  assert.equal(g.d.getElementById('myEmailsCard').hidden, true);
  const ok = portal({ list: LIST });
  await ok.w.__load();
  assert.equal(ok.d.getElementById('myEmailsCard').hidden, false);
  const rows = [...ok.d.querySelectorAll('#myEmailsList li')].map((li) => li.textContent);
  assert.match(rows[0], /sam@example\.com.*You sign in with this one.*Sign-in/);
  assert.match(rows[1], /sam\.old@example\.com.*Confirmed/);
  assert.equal(ok.d.querySelectorAll('#myEmailsList .my-emails-remove').length, 1, 'the sign-in email has no Remove');
});

test('portal: add -> "we sent a code" -> Confirm -> "is confirmed" with what showed up', async () => {
  const g = portal((b) => ({
    list: LIST,
    add: { ok: true, next: 'code' },
    verify: { ok: true, outcome: 'confirmed', email: 'sam.work@example.com', records: { invoice: 2, quote: 1, job: 0, contract: 0, checkup: 0 }, emails: LIST.emails },
  })[b.action]);
  await g.w.__load();
  g.d.getElementById('myEmailsAddBtn').click();
  g.d.getElementById('myEmailsAddInput').value = 'Sam.Work@Example.com';
  g.d.getElementById('myEmailsAddForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(g.calls.at(-1), { action: 'add', email: 'sam.work@example.com' });
  assert.equal(g.d.getElementById('myEmailsCodeHint').textContent, 'We sent a 6-digit code to sam.work@example.com. It works for 15 minutes.');
  assert.equal(g.d.getElementById('myEmailsSubmit').textContent, 'Confirm');
  g.d.getElementById('myEmailsCodeInput').value = '207134';
  g.d.getElementById('myEmailsAddForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(g.calls.at(-1), { action: 'verify', email: 'sam.work@example.com', code: '207134' });
  const res = g.d.getElementById('myEmailsResult');
  assert.equal(res.hidden, false);
  assert.equal(res.textContent, 'sam.work@example.com is confirmed2 invoices and 1 quote sent to it are now in your portal.');
  assert.equal(g.d.getElementById('myEmailsAddForm').hidden, true);
});

test('portal: an email with its own account says so after the code -- ask Triple H, nothing moved', async () => {
  const g = portal({ list: LIST, add: { ok: true, next: 'code' }, verify: { ok: true, outcome: 'own_account', email: 'kim@example.com' } });
  await g.w.__load();
  g.d.getElementById('myEmailsAddBtn').click();
  g.d.getElementById('myEmailsAddInput').value = 'kim@example.com';
  g.d.getElementById('myEmailsAddForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await tick();
  g.d.getElementById('myEmailsCodeInput').value = '111111';
  g.d.getElementById('myEmailsAddForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await tick();
  const res = g.d.getElementById('myEmailsResult').textContent;
  assert.match(res, /That email has its own portal account/);
  assert.match(res, /ask Triple H: they'll merge them for you\. Nothing was moved\./);
});

test('portal: a wrong code shows the server\'s message and stays on the code step', async () => {
  const g = portal({ list: LIST, add: { ok: true, next: 'code' }, verify: { ok: false, error: "That code didn't work. Check the latest email from us, or send a new code." } });
  await g.w.__load();
  g.d.getElementById('myEmailsAddBtn').click();
  g.d.getElementById('myEmailsAddInput').value = 'sam.work@example.com';
  g.d.getElementById('myEmailsAddForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await tick();
  g.d.getElementById('myEmailsCodeInput').value = '000000';
  g.d.getElementById('myEmailsAddForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await tick();
  assert.match(g.d.getElementById('myEmailsMsg').textContent, /didn't work/);
  assert.equal(g.d.getElementById('myEmailsCodeStep').hidden, false);
});

test('portal: a link from Triple H (?confirm_email=) is sent to the server once, then dropped from the address bar', async () => {
  const token = 'a'.repeat(48);
  const g = portal({ list: LIST, confirm_link: { ok: true, outcome: 'confirmed', email: 'sam.work@example.com', records: { invoice: 1 }, emails: LIST.emails } }, `https://example.com/portal/settings.html?confirm_email=${token}#profile`);
  await g.w.__load();
  assert.deepEqual(g.calls.filter((c) => c.action === 'confirm_link'), [{ action: 'confirm_link', token }]);
  assert.equal(g.w.location.search, '');
  assert.deepEqual(g.w.opened, ['profile']);
  assert.match(g.d.getElementById('myEmailsResult').textContent, /1 invoice sent to it is now in your portal\./);
});

// ---- Workspace client record --------------------------------------------------
const STAFF = slice(DETAIL, '  // ---- Portal emails (fix plan FP4.2', '\n  // Delete (2026-09-24)');

function staff(replies, confirmAnswer = true) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="portalEmailsCard"><div id="portalEmailsBody"></div></div></body>', { url: 'https://example.com/tools/client-detail.html', runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w.SUPABASE_URL = 'https://x.supabase.co';
  w.SUPABASE_ANON_KEY = 'anon';
  w.getStoredSession = () => ({ access_token: 'staff-tok' });
  w.ensureFreshToken = async () => {};
  w.escapeHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  w.escapeAttr = w.escapeHtml;
  w.confirms = [];
  w.confirm = (t) => { w.confirms.push(t); return confirmAnswer; };
  w.fetch = async (u, init) => { const b = JSON.parse(init.body); calls.push(b); return { json: async () => replies[b.action] }; };
  w.eval(STAFF.replace(/^  let /gm, '  var ') + '\nwindow.__load = loadPortalEmails;');
  return { w, d: w.document, calls };
}
const SLIST = { ok: true, signin: 'sam@example.com', emails: [{ email: 'sam.work@example.com', status: 'pending', added_by: 'staff', added_at: '2026-11-06T10:00:00Z' }] };

test('Workspace: the client\'s portal emails, with a pending one waiting for the client', async () => {
  const g = staff({ staff_list: SLIST });
  await g.w.__load('Sam@Example.com');
  assert.deepEqual(g.calls[0], { action: 'staff_list', account_email: 'sam@example.com' });
  const text = g.d.getElementById('portalEmailsBody').textContent;
  assert.match(text, /sam@example\.comSigns in with thisPortal/);
  assert.match(text, /sam\.work@example\.comLink sent .* · waiting for the clientPending/);
});

test('Workspace: merge shows what happens to saved cards first, and does nothing if staff cancel', async () => {
  const preview = { ok: true, saved_cards: 2, their_emails: [], records: { invoice: 3 } };
  const g = staff({ staff_list: SLIST, merge_preview: preview, merge: { ok: true, detached_cards: 2, saved_cards: 2, emails: [] } }, false);
  await g.w.__load('sam@example.com');
  g.d.getElementById('portalEmailMergeInput').value = 'kim@example.com';
  g.d.getElementById('portalEmailMergeForm').dispatchEvent(new g.w.Event('submit', { cancelable: true }));
  await tick();
  assert.match(g.w.confirms[0], /It has 2 saved cards\. Cards can't move between accounts, so they are removed\. The client adds a card again at their next payment\./);
  assert.match(g.w.confirms[0], /history \(3 invoices\)/);
  assert.ok(!g.calls.some((c) => c.action === 'merge'), 'cancelled: no merge call');

  const yes = staff({ staff_list: SLIST, merge_preview: preview, merge: { ok: true, detached_cards: 2, saved_cards: 2, emails: [] } }, true);
  await yes.w.__load('sam@example.com');
  yes.d.getElementById('portalEmailMergeInput').value = 'kim@example.com';
  yes.d.getElementById('portalEmailMergeForm').dispatchEvent(new yes.w.Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(yes.calls.at(-1), { action: 'merge', account_email: 'sam@example.com', merge_email: 'kim@example.com', confirm: true });
  assert.match(yes.d.getElementById('portalEmailMsg').textContent, /Merged\. kim@example\.com is locked, and 2 of 2 saved cards were removed\./);
});

test('Workspace: the card is only built for accounts with Clients, and only for a client with an email', () => {
  assert.match(DETAIL, /if \(c\.email && typeof canManageClients === 'function' && canManageClients\(\)\) \{\s*html \+= '<div class="client-portal-emails th-v2-card" id="portalEmailsCard">'/);
});
