// Delete a client from the client page (2026-09-24), requested directly
// with a screenshot of client-detail.html: "there is no way to delete a
// client". The page now ends with a Delete block that runs the same
// thDeleteClient() Dev Tools' Client registry uses (the record goes, a
// tombstone keeps it gone, a copy goes to the Graveyard; jobs, invoices,
// quotes and contracts stay), then shows a "deleted -- Undo" state whose
// Undo is the Graveyard's own restore for a client. Also: Dev Tools'
// Graveyard list now renders on load -- it never did, so there was no
// Restore button to press.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DATA_LAYER = read('data-layer.js');
const DIALOGS = read('tools-dialogs.js');
const CLIENT_DETAIL = read('client-detail.html');

function seed() {
  return {
    th_clients: JSON.stringify([
      { id: 'c1', name: 'Yelp customer', phone: '', email: '', address: '' },
      { id: 'c2', name: 'Bill Adams', phone: '435-555-0107', email: '', address: '' },
    ]),
    th_tracker_jobs: JSON.stringify([
      { id: 1, title: 'Inspect inlet valve on fridge', client: 'Yelp customer', clientId: 'c1', date: '2026-09-07', status: 'in-progress' },
      { id: 2, title: 'Washer', client: 'Bill Adams', date: '2026-09-01', status: 'done' },
    ]),
    th_invoices: JSON.stringify([
      { id: 11, clientName: 'Yelp customer', total: 120, paid: false, paidAmount: 0, date: '2026-09-08', terms: 'Net 15' },
    ]),
  };
}

// client-detail.html in jsdom, with data-layer.js and tools-dialogs.js
// inlined (jsdom does not fetch <script src>). Function replacers: a
// replacement *string* would expand the "$&" in tools-dialogs.js's money().
async function loadClientPage({ id = 'c1', store = seed() } = {}) {
  const html = CLIENT_DETAIL
    .replace(/<script src="\/tools\/data-layer\.js\?v=[^"]*"[^>]*><\/script>/, () => '<script>' + DATA_LAYER + '</script>')
    .replace(/<script src="\/tools\/tools-dialogs\.js\?v=[^"]*"[^>]*><\/script>/, () => '<script>' + DIALOGS + '</script>');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/client-detail.html?id=' + id,
    beforeParse(w) {
      w.requireAuth = () => {};
      for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
    },
  });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 0)); // the page's async DOMContentLoaded handler
  w.confirms = [];
  w.confirmAnswer = true;
  w.showConfirm = (message, opts) => { w.confirms.push({ message, opts }); return Promise.resolve(w.confirmAnswer); };
  w.toasts = [];
  w.showToast = (m) => w.toasts.push(m);
  return w;
}
const stored = (w, key) => JSON.parse(w.localStorage.getItem(key) || 'null');
const shown = (w, id) => w.document.getElementById(id).style.display !== 'none';

test('the client page ends with a Delete block, after Contracts and away from the everyday buttons', async () => {
  const w = await loadClientPage();
  const btn = w.document.getElementById('deleteClientBtn');
  assert.ok(btn, 'Delete button renders');
  assert.equal(btn.textContent, 'Delete');
  assert.ok(btn.classList.contains('small-btn') && btn.classList.contains('danger'), 'the shared danger button');
  const blocks = [...w.document.querySelectorAll('#clientContent > .section-block')];
  assert.ok(blocks[blocks.length - 1].classList.contains('client-delete-zone'), 'last block on the page');
  assert.match(blocks[blocks.length - 2].textContent, /Contracts/);
  assert.ok(!w.document.querySelector('.client-hero #deleteClientBtn'), 'not in the hero with Call / Text / New job');
  assert.match(blocks[blocks.length - 1].textContent, /Removes Yelp customer from Clients\. Their jobs, invoices, quotes, and contracts stay on file\./);
});

test('Delete asks first, naming what stays on file; Cancel changes nothing', async () => {
  const w = await loadClientPage();
  w.confirmAnswer = false;
  await w.deleteThisClient();
  assert.equal(w.confirms.length, 1);
  assert.equal(w.confirms[0].message, 'Delete Yelp customer? Their 1 job and 1 invoice stay on file. Only the client record is removed.');
  assert.deepEqual({ ...w.confirms[0].opts }, { danger: true, confirmText: 'Delete client' });
  assert.deepEqual(stored(w, 'th_clients').map(c => c.id), ['c1', 'c2']);
  assert.equal(stored(w, 'th_client_tombstones'), null);
  assert.ok(shown(w, 'clientDetailView'));
});

test('Delete removes only the client record: tombstoned by id and name, copied to the Graveyard, jobs and invoices untouched, and the rebuild from jobs does not bring it back', async () => {
  const w = await loadClientPage();
  const jobsBefore = w.localStorage.getItem('th_tracker_jobs');
  const invoicesBefore = w.localStorage.getItem('th_invoices');
  await w.deleteThisClient();

  assert.deepEqual(stored(w, 'th_clients').map(c => c.id), ['c2']);
  const [tomb] = stored(w, 'th_client_tombstones');
  assert.equal(tomb.id, 'c1');
  assert.equal(tomb.normalizedName, 'yelp customer');
  const [grave] = stored(w, 'th_graveyard');
  assert.equal(grave.recordType, 'client');
  assert.equal(grave.record.id, 'c1');
  assert.equal(w.localStorage.getItem('th_tracker_jobs'), jobsBefore, 'jobs are left exactly as they were');
  assert.equal(w.localStorage.getItem('th_invoices'), invoicesBefore, 'invoices are left exactly as they were');

  w.thBackfillClients();
  assert.deepEqual(stored(w, 'th_clients').map(c => c.id), ['c2'], 'a job still naming the client does not recreate it');

  assert.ok(!shown(w, 'clientDetailView'));
  assert.ok(!shown(w, 'clientNotFound'), 'not the "not found" screen');
  assert.ok(shown(w, 'clientDeletedState'));
  assert.equal(w.document.getElementById('clientDeletedText').textContent,
    'Yelp customer was deleted. Their 1 job and 1 invoice are still on file. Undo puts them back; later, Dev Tools → Data → Graveyard can restore them.');
  assert.equal(w.document.activeElement.id, 'undoDeleteClientBtn');

  w.onClientRealtimeChange(); // the sync echo of this very delete
  assert.ok(shown(w, 'clientDeletedState'), 'a live-sync refresh keeps the Undo screen');
  assert.ok(!shown(w, 'clientNotFound'));
});

test('Undo puts the same client back: record and id restored, tombstone marked restored (not removed), Graveyard entry cleared, page shown again', async () => {
  const w = await loadClientPage();
  await w.deleteThisClient();
  w.undoDeleteClient();

  const back = stored(w, 'th_clients').find(c => c.id === 'c1');
  assert.ok(back, 'restored under the same id, so its jobs stay linked');
  assert.equal(back.name, 'Yelp customer');
  const [tomb] = stored(w, 'th_client_tombstones');
  assert.ok(tomb.restoredAt, 'kept as restored, so the server copy of the delete cannot win on the next pull');
  assert.ok(new Date(tomb.restoredAt).getTime() >= new Date(tomb.deletedAt).getTime());
  assert.equal(w.thLoadGraveyard().length, 0, 'nothing left to restore in the Graveyard');
  assert.ok(stored(w, 'th_graveyard')[0].removedAt, 'marked removed, the way the Graveyard itself does it');

  assert.ok(shown(w, 'clientDetailView'));
  assert.ok(!shown(w, 'clientDeletedState'));
  assert.ok(w.document.getElementById('deleteClientBtn'), 'page re-rendered');
  assert.deepEqual([...w.toasts], ['Yelp customer is back.']);

  w.thBackfillClients();
  assert.equal(stored(w, 'th_clients').filter(c => c.name === 'Yelp customer').length, 1, 'no duplicate');
});

test('one thing kept reads "stays" / "is", several read "stay" / "are"', async () => {
  const store = seed();
  store.th_invoices = '[]';
  const w = await loadClientPage({ store });
  await w.deleteThisClient();
  assert.equal(w.confirms[0].message, 'Delete Yelp customer? Their 1 job stays on file. Only the client record is removed.');
  assert.match(w.document.getElementById('clientDeletedText').textContent, /^Yelp customer was deleted\. Their 1 job is still on file\. /);
});

test('a client with nothing else on file gets the short confirm', async () => {
  const store = seed();
  store.th_tracker_jobs = '[]';
  store.th_invoices = '[]';
  const w = await loadClientPage({ store });
  w.confirmAnswer = false;
  await w.deleteThisClient();
  assert.equal(w.confirms[0].message, 'Delete Yelp customer? Nothing else is on file for them.');
});

test('the Delete block has a readable danger colour in light mode, and the danger-zone border outranks the shared section-block border', () => {
  assert.match(CLIENT_DETAIL, /\[data-theme="light"\] \.client-delete-row \.small-btn\.danger \{ color: #b3261e;/);
  assert.match(CLIENT_DETAIL, /body \.section-block\.client-delete-zone \{ border-color:/);
});

test('Dev Tools\' Graveyard renders on page load, so a deleted client (or anything else) has a Restore button there', async () => {
  const html = read('dev-tools.html');
  const graveyard = [{ graveyardId: 'gy_1', recordType: 'client', record: { id: 'c9', name: 'Deleted Client' }, deletedAt: '2026-09-24T01:00:00Z' }];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/dev-tools.html',
    beforeParse(w) {
      w.localStorage.setItem('th_graveyard', JSON.stringify(graveyard));
      w.requireAuth = () => {};
      w.hasDevToolsAccess = () => true;
      w.canAccessDevToolsFull = () => true;
      w.canManageRoles = () => false;
      w.getCurrentUserEmail = () => null;
      w.fetchWithTimeout = async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' });
      w.initCollapsiblePanels = () => {};
      w.personDot = () => '';
      w.escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      w.escapeForInlineHandler = (s) => String(s);
      w.escapeAttr = w.escapeHtml;
      w.money = (v) => '$' + v;
      w.thLoadGraveyard = () => JSON.parse(w.localStorage.getItem('th_graveyard') || '[]').filter(g => !g.removedAt);
    },
  });
  const w = dom.window;
  // No sync.js in jsdom, so the page falls back to setTimeout(proceed, 300).
  await new Promise(r => setTimeout(r, 450));
  const list = w.document.getElementById('graveyardList');
  assert.match(list.textContent, /Client: Deleted Client/);
  assert.ok(list.querySelector('button[onclick="restoreFromGraveyard(\'gy_1\')"]'), 'with its Restore button');
  const src = html.slice(html.indexOf('const proceed = () => {'));
  assert.match(src.slice(0, src.indexOf('};')), /renderFlaggedItems\(\);[\s\S]*?renderGraveyard\(\);/);
  w.close();
});
