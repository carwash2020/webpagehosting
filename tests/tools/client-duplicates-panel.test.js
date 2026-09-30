// The "Possible duplicate clients" review queue in tools/clients.html (Item 1
// Phase 1b, 2026-09-30). Runs the panel's real script in jsdom against a
// fake PostgREST, and checks each button calls the right RPC with the right
// arguments. The RPCs themselves are tested in
// tests/sync/client-review-db.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const CLIENTS = fs.readFileSync(path.join(TOOLS, 'clients.html'), 'utf8');
const DIALOGS = fs.readFileSync(path.join(TOOLS, 'tools-dialogs.js'), 'utf8');
const DEV_SHARED = fs.readFileSync(path.join(TOOLS, 'dev-tools-shared.js'), 'utf8');

const PANEL_JS = CLIENTS.match(/  \/\/ Possible duplicate clients \(Item 1 Phase 1b[\s\S]*?(?=  function renderPortalPanels\(\))/)[0];
const escapers = ['escapeHtml', 'escapeAttr'].map((name) =>
  DIALOGS.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}\\n'))[0]).join('\n');

const CONNOR_REGISTRY = { id: 'uuid-reg', display_name: 'Connor Dodart', email: 'Connor@triplehenterprisesllc.biz', phone: '(435)632-6901', address: null, role: null, notes: null, seed_source: 'registry' };
const CONNOR_CONTACT = { id: 'uuid-con', display_name: 'Connor Dodart', email: 'Connor@triplehenterprisesllc.biz', phone: '(435)632-6901', address: null, role: 'Developer', notes: '<b>The Coolest</b>', seed_source: 'contact' };
const PAIRS = [{ id: 7, reasons: ['email', 'name', 'phone'], a: CONNOR_REGISTRY, b: CONNOR_CONTACT }];

function setup({ pairs = PAIRS, confirm = true, prompt = null, failRpc = null, patchStatus = 204 } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="clientDupNotice" hidden><span id="clientDupNoticeText"></span></div>
    <div id="clientDuplicatesPanel"><div id="clientDuplicatesSummary"></div><div id="clientDuplicatesList"></div></div>
  </body>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  const toasts = [];
  let open = pairs.slice();
  w.SUPABASE_URL = 'https://x.supabase.co';
  w.SUPABASE_ANON_KEY = 'anon';
  w.getAuthToken = () => 'tok';
  w.showToast = (msg, opts) => toasts.push({ msg, type: opts && opts.type });
  w.showConfirm = async (msg) => { calls.push({ confirm: msg }); return confirm; };
  w.showPromptForm = async (title, fields) => { calls.push({ prompt: title, fields }); return prompt; };
  w.activateClientsTab = (t) => calls.push({ tab: t });
  w.fetchWithTimeout = async (url, ms, init) => {
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body, headers: init && init.headers });
    const rpc = (url.match(/\/rpc\/(\w+)/) || [])[1];
    if (rpc && rpc === failRpc) {
      return { ok: false, status: 400, json: async () => ({ message: 'this pair was already reviewed (merged)' }), text: async () => '' };
    }
    if (rpc === 'merge_client_candidate' || rpc === 'keep_client_candidate_separate') open = open.filter((p) => p.id !== body.p_candidate);
    if (rpc === 'mark_client_not_a_client') open = open.filter((p) => p.a.id !== body.p_client && p.b.id !== body.p_client);
    if (rpc) return { ok: true, status: 200, text: async () => (rpc === 'refresh_my_client_candidates' ? '0' : '{}') };
    if (method === 'GET') return { ok: true, status: 200, json: async () => open };
    return { ok: patchStatus < 300, status: patchStatus, text: async () => '' };
  };
  w.eval(escapers + '\n' + PANEL_JS.replace(/\n  (const|let) /g, '\n  var ') +
    '\nwindow.__dup = { renderClientDuplicates, mergeClientDuplicate, keepClientDuplicatesSeparate, markDuplicateNotAClient, editClientDuplicate, openClientDuplicates, refreshClientDupNotice };');
  return { w, doc: w.document, api: w.__dup, calls, toasts };
}

const rpcCalls = (calls) => calls.filter((c) => /\/rpc\//.test(c.url || '')).map((c) => [c.url.split('/rpc/')[1], c.body]);

test('renders each pair side by side, with its sources and why it matched, escaping client text', async () => {
  const { doc, api, calls } = setup();
  await api.renderClientDuplicates();
  const text = doc.getElementById('clientDuplicatesList').textContent;
  assert.match(text, /Possible match: same email, same name, same phone/);
  assert.match(text, /Client list/);
  assert.match(text, /Job Tracker contact/);
  assert.match(text, /Developer/);
  assert.equal(doc.querySelectorAll('.dup-pair').length, 1);
  assert.equal(doc.querySelector('#clientDuplicatesList b'), null, 'notes are escaped, not rendered as HTML');
  assert.match(doc.getElementById('clientDuplicatesSummary').textContent, /1 pair to review\. Nothing is merged until you choose\./);
  // It refreshes before it reads, and reads open pairs with both clients embedded.
  const reqs = calls.filter((c) => c.url);
  assert.match(reqs[0].url, /\/rpc\/refresh_my_client_candidates$/);
  assert.match(reqs[1].url, /client_duplicate_candidates\?status=eq\.open/);
  assert.match(reqs[1].url, /a:client_a\(/);
  assert.match(reqs[1].url, /b:client_b\(/);
  assert.equal(reqs[1].headers.Authorization, 'Bearer tok');
});

test('Keep this one merges the other card into the chosen one, after a confirm', async () => {
  const { doc, api, calls, toasts } = setup();
  await api.renderClientDuplicates();
  await api.mergeClientDuplicate(7, 'b');
  assert.match(calls.find((c) => c.confirm).confirm, /Keep: Connor Dodart \(Job Tracker contact\)\nMerge in: Connor Dodart \(Client list\)/);
  assert.deepEqual(rpcCalls(calls).filter(([n]) => n === 'merge_client_candidate'),
    [['merge_client_candidate', { p_candidate: 7, p_keep: 'uuid-con' }]]);
  assert.equal(toasts[0].msg, 'Merged into Connor Dodart.');
  // The list re-renders from the server afterwards.
  await new Promise((r) => setTimeout(r, 0));
  assert.match(doc.getElementById('clientDuplicatesList').textContent, /No possible duplicates to review\./);
});

test('cancelling the merge confirm sends nothing', async () => {
  const { api, calls } = setup({ confirm: false });
  await api.renderClientDuplicates();
  await api.mergeClientDuplicate(7, 'a');
  assert.equal(rpcCalls(calls).filter(([n]) => n === 'merge_client_candidate').length, 0);
});

test("a refused merge shows the server's reason instead of claiming success", async () => {
  const { api, toasts } = setup({ failRpc: 'merge_client_candidate' });
  await api.renderClientDuplicates();
  await api.mergeClientDuplicate(7, 'a');
  assert.deepEqual(toasts[0], { msg: 'Could not merge: this pair was already reviewed (merged)', type: 'error' });
});

test('Different people keeps both', async () => {
  const { api, calls, toasts } = setup();
  await api.renderClientDuplicates();
  await api.keepClientDuplicatesSeparate(7);
  assert.deepEqual(rpcCalls(calls).filter(([n]) => n === 'keep_client_candidate_separate'),
    [['keep_client_candidate_separate', { p_candidate: 7 }]]);
  assert.equal(toasts[0].msg, 'Kept as two clients.');
});

test('Not a client marks just that card, after a confirm', async () => {
  const { api, calls } = setup();
  await api.renderClientDuplicates();
  await api.markDuplicateNotAClient(7, 'b');
  assert.deepEqual(rpcCalls(calls).filter(([n]) => n === 'mark_client_not_a_client'),
    [['mark_client_not_a_client', { p_client: 'uuid-con' }]]);
});

test('Edit patches that client row, turning blanks into null', async () => {
  const { api, calls } = setup({ prompt: { display_name: ' Connor D ', email: '', phone: '4356326901', address: '', notes: 'x' } });
  await api.renderClientDuplicates();
  await api.editClientDuplicate(7, 'a');
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.match(patch.url, /\/rest\/v1\/clients\?id=eq\.uuid-reg$/);
  assert.deepEqual(patch.body, { display_name: 'Connor D', email: null, phone: '4356326901', address: null, notes: 'x' });
  assert.equal(patch.headers.Prefer, 'return=minimal');
});

test('Edit to an email another client already has says so, in plain words', async () => {
  const { api, toasts } = setup({ patchStatus: 409, prompt: { display_name: 'Connor', email: 'taken@example.com', phone: '', address: '', notes: '' } });
  await api.renderClientDuplicates();
  await api.editClientDuplicate(7, 'a');
  assert.deepEqual(toasts[0], { msg: 'Could not save: that email already belongs to another client', type: 'error' });
});

test('the Clients tab notice shows the count only for someone who can review', async () => {
  const noRole = setup();
  await noRole.api.refreshClientDupNotice({ canManageInvoices: false });
  assert.equal(noRole.calls.filter((c) => c.url).length, 0, 'no request without the permission');
  assert.equal(noRole.doc.getElementById('clientDupNotice').hidden, true);

  const reviewer = setup();
  await reviewer.api.refreshClientDupNotice({ canManageInvoices: true });
  assert.equal(reviewer.doc.getElementById('clientDupNotice').hidden, false);
  assert.equal(reviewer.doc.getElementById('clientDupNoticeText').textContent, '1 possible duplicate client to review.');

  const empty = setup({ pairs: [] });
  await empty.api.refreshClientDupNotice({ canManageInvoices: true });
  assert.equal(empty.doc.getElementById('clientDupNotice').hidden, true);
});

test('Review on the notice opens the Portal tab', () => {
  const { w, api, calls } = setup();
  w.document.getElementById('clientDuplicatesPanel').scrollIntoView = () => {};
  api.openClientDuplicates();
  assert.deepEqual(calls.find((c) => c.tab), { tab: 'portal' });
});

test('wiring: the panel renders with the other Portal panels, the notice listens for the role, and the ? has help text', () => {
  assert.match(CLIENTS, /portalPanelsRendered = true;\n    renderClientDuplicates\(\);/);
  assert.match(CLIENTS, /th-role-loaded', \(e\) => \{ applyPortalPermission\(e\.detail\); refreshClientDupNotice\(e\.detail\); \}/);
  assert.match(CLIENTS, /onclick="openDevInfo\('clientduplicates'\)"/);
  assert.match(DEV_SHARED, /clientduplicates: \{/);
  assert.match(CLIENTS, /<div class="cd-dup-notice" id="clientDupNotice" hidden>/);
});
