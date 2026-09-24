// tools/site-content.html's FAQ and Terms editors, end to end: the page's
// real inline script in jsdom, every Supabase request answered by the
// real SQL (cms_faq_terms_safe_publish.sql) running in PGlite.

const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createCmsDb, closeAllCmsDbs, asUser, rpc, OWNER_EMAIL, DEV_EMAIL } = require('./cms-db-harness');

// A page keeps working after its test's last assert (a publish reloads the
// lists and history in the background). Let those requests finish before
// the next test resets the shared database, and before after() closes it:
// closing PGlite mid-query never resolves on Node 24, so CI hung.
const OPEN_WINDOWS = [];
const IN_FLIGHT = new Set();
afterEach(async () => {
  do { await Promise.allSettled([...IN_FLIGHT]); await new Promise(r => setTimeout(r, 20)); } while (IN_FLIGHT.size);
  while (OPEN_WINDOWS.length) OPEN_WINDOWS.pop().close();
});
after(closeAllCmsDbs);

const ROOT = path.join(__dirname, '..', '..');
const PAGE_HTML = fs.readFileSync(path.join(ROOT, 'tools', 'site-content.html'), 'utf8');
const DIALOGS_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'tools-dialogs.js'), 'utf8');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

const LISTS = {
  site_faq: 'select id, question, answer, category, sort_order from public.site_faq order by sort_order, id',
  site_terms: 'select id, heading, body, sort_order from public.site_terms order by sort_order, id',
  site_faq_history: 'select id, action, faq_id, question, old_answer, new_answer, old_row, new_row, changed_by, changed_at, batch_id, undo_of from public.site_faq_history where batch_id is not null order by id desc limit 200',
  site_terms_history: 'select id, action, term_id, heading, old_body, new_body, old_row, new_row, changed_by, changed_at, batch_id, undo_of from public.site_terms_history where batch_id is not null order by id desc limit 200',
};
const toJson = (rows) => rows.map(r => {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k] = (typeof v === 'bigint') ? Number(v) : (v instanceof Date ? v.toISOString() : v);
  if (o.id != null) o.id = Number(o.id);
  ['faq_id', 'term_id', 'undo_of'].forEach(k => { if (o[k] != null) o[k] = Number(o[k]); });
  return o;
});

function makeFetch(db, state) {
  const answer = async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    state.requests.push({ method, path: u.pathname, body: opts.body || null });
    const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const table = u.pathname.replace('/rest/v1/', '');
    if (table.startsWith('rpc/')) {
      const r = await rpc(db, state.email, table.slice(4), JSON.parse(opts.body));
      return respond(r.status, Array.isArray(r.body) ? toJson(r.body) : r.body);
    }
    if (method === 'GET' && LISTS[table]) {
      const rows = await asUser(db, state.email, tx => tx.query(LISTS[table]));
      return respond(200, toJson(rows.rows));
    }
    if (method !== 'GET') throw new Error('Unexpected write from the editor: ' + method + ' ' + u.pathname);
    return respond(200, []);
  };
  return (url, opts) => {
    const p = answer(url, opts);
    IN_FLIGHT.add(p);
    p.then(() => IN_FLIGHT.delete(p), () => IN_FLIGHT.delete(p));
    return p;
  };
}

async function loadEditor({ email = OWNER_EMAIL } = {}) {
  const db = await createCmsDb();
  const state = { email, requests: [], alerts: [], toasts: [] };
  const dom = new JSDOM(PAGE_HTML, {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/tools/site-content.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.SUPABASE_URL = 'https://example.supabase.co';
      w.SUPABASE_ANON_KEY = 'anon-key';
      w.getAuthToken = () => 'token';
      w.ensureFreshToken = async () => true;
      w.KNOWN_USER_NAMES = { [OWNER_EMAIL]: 'Steve', [DEV_EMAIL]: 'Connor' };
      w.canManageSiteContent = () => true;
      w.initSyncOnLoad = () => new Promise(() => {});
      w.fetch = makeFetch(db, state);
      w.fetchWithTimeout = (url, ms, opts) => w.fetch(url, opts);
      w.confirmDevPassword = async () => true;
      w.showToast = (msg, opts) => { state.toasts.push({ msg, type: opts && opts.type }); };
      w.openInfoModal = () => {};
      w.personDot = () => '';
      w.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    },
  });
  const w = dom.window;
  OPEN_WINDOWS.push(w);
  const s = w.document.createElement('script');
  s.textContent = DIALOGS_SRC;
  w.document.head.appendChild(s);
  w.showAlert = async (msg) => { state.alerts.push(msg); return true; };
  w.showConfirm = async () => true;
  w.document.getElementById('contentMainView').style.display = 'block';
  w.cmsWireEditor();
  await w.renderFaqEditor();
  await w.renderTermsEditor();
  return { w, db, state };
}

const reviewOpen = (w) => w.document.getElementById('cmsReviewOverlay').classList.contains('is-open');
async function waitForReview(w) { for (let i = 0; i < 300 && !reviewOpen(w); i++) await tick(5); assert.ok(reviewOpen(w), 'review dialog should open'); }
async function confirmReview(w) { await waitForReview(w); w.document.getElementById('cmsReviewConfirm').click(); }
async function cancelReview(w) { await waitForReview(w); w.document.getElementById('cmsReviewCancel').click(); }
function reviewRows(w) {
  return [...w.document.querySelectorAll('#cmsReviewBody .cms-diff-row')].map(row => ({
    label: row.querySelector('.cms-diff-label').textContent,
    old: row.querySelector('.cms-diff-old .cms-diff-text').textContent,
    new: row.querySelector('.cms-diff-new .cms-diff-text').textContent,
    warnings: [...row.querySelectorAll('.cms-diff-warnings li')].map(li => li.textContent),
  }));
}
async function faqRows(db) {
  const r = await db.query('select id, question, answer, category, sort_order from public.site_faq order by sort_order, id');
  return r.rows.map(x => ({ ...x, id: Number(x.id) }));
}
async function termsRows(db) {
  const r = await db.query('select id, heading, body, sort_order from public.site_terms order by sort_order, id');
  return r.rows.map(x => ({ ...x, id: Number(x.id) }));
}
function typeIntoItem(w, name, index, fieldKey, value) {
  const card = w.document.getElementById(name + 'Item_' + index);
  const el = [...card.querySelectorAll('input, textarea')].find(x => (x.getAttribute('oninput') || '').includes("'" + fieldKey + "'"));
  el.value = value;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------------------

test('loads both lists with their ids, and the button says Review & publish', async () => {
  const { w } = await loadEditor();
  assert.equal(w.eval('faqItems.length'), 4);
  assert.ok(w.eval('faqItems.every(i => typeof i.id === "number")'));
  assert.equal(w.eval('termsItems.length'), 3);
  assert.equal(w.document.getElementById('saveFaqBtn').textContent, 'Review & publish');
  assert.equal(w.document.getElementById('saveFaqBtn').disabled, false);
});

test('FAQ headline: edit + add + delete + move in the editor, review shows each one, publish, then Undo puts every row back exactly', async () => {
  const { w, db } = await loadEditor();
  const original = await faqRows(db);

  typeIntoItem(w, 'faq', 0, 'answer', 'Free within 15 miles; $25 beyond that.');
  w.deleteFaqItem(1);
  w.moveFaqItem(2, -1); // the last item moves up one
  w.addFaqItem();
  typeIntoItem(w, 'faq', 3, 'question', 'Do you haul away old appliances?');
  typeIntoItem(w, 'faq', 3, 'answer', 'Yes, for a small fee.');
  typeIntoItem(w, 'faq', 3, 'category', 'Policies');

  const p = w.saveFaqList();
  await waitForReview(w);
  const rows = reviewRows(w);
  const labels = rows.map(r => r.label);
  assert.ok(labels.some(l => /answer$/.test(l)), labels.join(' | '));
  assert.ok(labels.some(l => /^Removed question: How soon can you come out\?/.test(l)));
  assert.ok(labels.some(l => /^New question: Do you haul away old appliances\?/.test(l)));
  assert.ok(labels.includes('Order'));
  const removed = rows.find(r => /^Removed/.test(r.label));
  assert.ok(removed.warnings.some(x => /Undo this save/.test(x)));
  assert.deepEqual(await faqRows(db), original, 'nothing live before confirming');
  await confirmReview(w);
  assert.equal(await p, true);

  const live = await faqRows(db);
  assert.equal(live.length, 4);
  assert.equal(live[0].id, original[0].id, 'the edited item kept its id');
  assert.equal(live[0].answer, 'Free within 15 miles; $25 beyond that.');
  assert.match(w.document.getElementById('faqLastSave').textContent, /Last FAQ save: Steve/);

  const u = w.undoLastListSave('faq');
  await confirmReview(w);
  assert.equal(await u, true);
  assert.deepEqual(await faqRows(db), original, 'every FAQ row back exactly, same ids, same order');
  assert.deepEqual(JSON.parse(JSON.stringify(w.eval('faqItems.map(i => i.id)'))), original.map(r => r.id));
});

test('Terms headline: edit a section, publish, Undo restores it exactly', async () => {
  const { w, db } = await loadEditor();
  const original = await termsRows(db);
  typeIntoItem(w, 'terms', 2, 'body', 'Payment is due when the work is done.');
  const p = w.saveTermsList();
  await waitForReview(w);
  assert.deepEqual(reviewRows(w).map(r => [r.old, r.new]), [['Payment is due upon completion.', 'Payment is due when the work is done.']]);
  await confirmReview(w);
  assert.equal(await p, true);
  assert.equal((await termsRows(db))[2].body, 'Payment is due when the work is done.');
  const u = w.undoLastListSave('terms');
  await confirmReview(w);
  assert.equal(await u, true);
  assert.deepEqual(await termsRows(db), original);
});

test('a cleared answer is flagged and blocks publishing -- it no longer silently deletes the question', async () => {
  const { w, db, state } = await loadEditor();
  const original = await faqRows(db);
  typeIntoItem(w, 'faq', 2, 'answer', '   ');
  const err = w.document.getElementById('faqItemError_2');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /Answer can't be blank/);
  assert.equal(w.document.getElementById('saveFaqBtn').disabled, true);
  assert.equal(await w.saveFaqList(), false);
  assert.equal(reviewOpen(w), false);
  assert.equal(state.requests.filter(r => r.path.startsWith('/rest/v1/rpc/')).length, 0);
  assert.deepEqual(await faqRows(db), original);
});

test('two questions with the same wording are flagged before publishing', async () => {
  const { w } = await loadEditor();
  typeIntoItem(w, 'faq', 3, 'question', 'Do you charge a trip fee?');
  assert.match(w.document.getElementById('faqItemError_3').textContent, /Same question as #1/);
  assert.equal(w.document.getElementById('saveFaqBtn').disabled, true);
});

test('cancelling the review publishes nothing', async () => {
  const { w, db } = await loadEditor();
  const original = await faqRows(db);
  typeIntoItem(w, 'faq', 0, 'answer', 'Changed.');
  const p = w.saveFaqList();
  await cancelReview(w);
  assert.equal(await p, false);
  assert.deepEqual(await faqRows(db), original);
});

test('with no changes there is nothing to review', async () => {
  const { w, state } = await loadEditor();
  assert.equal(await w.saveFaqList(), false);
  assert.equal(reviewOpen(w), false);
  assert.ok(state.toasts.some(t => /Nothing has changed/.test(t.msg)));
});

test('a stale editor cannot overwrite a newer FAQ edit: 409, nothing changes, edits kept for a re-review', async () => {
  const { w, db, state } = await loadEditor({ email: DEV_EMAIL });
  // Steve edits item 2 after this page loaded.
  const loaded = await faqRows(db);
  const items = loaded.map(r => ({ id: r.id, question: r.question, answer: r.answer, category: r.category }));
  items[1] = { ...items[1], answer: 'Updated by Steve.' };
  await rpc(db, OWNER_EMAIL, 'cms_publish_faq', { p_expected: loaded, p_items: items });
  const newer = await faqRows(db);

  typeIntoItem(w, 'faq', 3, 'answer', 'Edited in a stale tab.');
  const p = w.saveFaqList();
  await confirmReview(w);
  assert.equal(await p, false);
  assert.deepEqual(await faqRows(db), newer, "Steve's edit survives");
  assert.match(state.alerts[0], /changed by someone else/);
  assert.equal(w.eval('faqItems[3].answer'), 'Edited in a stale tab.', 'the unpublished edit is kept');
});

test('the history panel\'s Restore for an FAQ edit goes through review + compare-and-swap and puts the old answer back', async () => {
  const { w, db } = await loadEditor();
  typeIntoItem(w, 'faq', 0, 'answer', 'Brand new answer.');
  const p = w.saveFaqList();
  await confirmReview(w);
  assert.equal(await p, true);
  const hist = await db.query("select * from public.site_faq_history where action = 'update' order by id desc limit 1");
  const row = { ...hist.rows[0], id: Number(hist.rows[0].id), faq_id: Number(hist.rows[0].faq_id) };
  const r = w.putBackListHistoryRow('faq', row);
  await confirmReview(w);
  assert.equal(await r, true);
  assert.equal((await faqRows(db))[0].answer, 'Jobs within 15 miles have no trip fee. Beyond 15 miles, a $25 trip fee is added to the total.');
});

test('the editor never writes the FAQ/Terms tables directly -- only through the checked functions', async () => {
  const { w, state } = await loadEditor();
  typeIntoItem(w, 'terms', 0, 'body', 'Triple H Enterprises LLC, St. George, UT.');
  const p = w.saveTermsList();
  await confirmReview(w);
  assert.equal(await p, true);
  const writes = state.requests.filter(r => r.method !== 'GET');
  assert.ok(writes.length && writes.every(r => r.path.startsWith('/rest/v1/rpc/cms_')));
  assert.doesNotMatch(PAGE_HTML, /site_faq\?id=gte\.0|site_terms\?id=gte\.0/, 'the old delete-everything save must not come back');
});
