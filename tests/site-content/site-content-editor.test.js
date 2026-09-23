// tools/site-content.html's editor, end to end: the page's real inline
// script running in jsdom, with every Supabase call it makes answered by
// the real migration SQL running in PGlite (cms-db-harness.js). So "save
// then undo" here exercises the actual browser code AND the actual
// database functions, triggers, and constraints together -- the path a
// real review-count update takes.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createCmsDb, closeAllCmsDbs, asUser, rpc, readValue, OWNER_EMAIL, DEV_EMAIL } = require('./cms-db-harness');

after(closeAllCmsDbs);

const ROOT = path.join(__dirname, '..', '..');
const PAGE_HTML = fs.readFileSync(path.join(ROOT, 'tools', 'site-content.html'), 'utf8');
const DIALOGS_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'tools-dialogs.js'), 'utf8');
const SUPABASE_URL = 'https://example.supabase.co';

function tick(ms = 0) { return new Promise(r => setTimeout(r, ms)); }

// Answers the exact requests the editor makes, from the PGlite database,
// as the signed-in `email`. Anything else (FAQ/Terms panels) gets [].
function makeFetch(db, state) {
  return async (url, opts = {}) => {
    const u = new URL(url);
    const method = (opts.method || 'GET').toUpperCase();
    state.requests.push({ method, path: u.pathname, search: u.search, body: opts.body || null });
    const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

    if (u.pathname === '/rest/v1/rpc/cms_publish_content' || u.pathname === '/rest/v1/rpc/cms_undo_content') {
      const fnName = u.pathname.split('/').pop();
      const r = await rpc(db, state.email, fnName, JSON.parse(opts.body));
      return respond(r.status, r.body);
    }
    if (method === 'GET' && u.pathname === '/rest/v1/site_content') {
      const keys = /key=in\.\(([^)]*)\)/.exec(decodeURIComponent(u.search))[1].split(',');
      const rows = await asUser(db, state.email, tx => tx.query('select key, value from public.site_content where key = any($1)', [keys]));
      return respond(200, rows.rows);
    }
    if (method === 'GET' && u.pathname === '/rest/v1/site_content_history' && /key=in\./.test(decodeURIComponent(u.search))) {
      const keys = /key=in\.\(([^)]*)\)/.exec(decodeURIComponent(u.search))[1].split(',');
      const rows = await asUser(db, state.email, tx => tx.query(
        'select id, key, old_value, new_value, changed_by, changed_at, action, batch_id, undo_of from public.site_content_history where key = any($1) order by id desc limit 300', [keys]));
      return respond(200, rows.rows.map(r => Object.assign({}, r, { id: Number(r.id), undo_of: r.undo_of == null ? null : Number(r.undo_of), changed_at: new Date(r.changed_at).toISOString() })));
    }
    if (method !== 'GET') throw new Error('Unexpected write from the editor: ' + method + ' ' + u.pathname);
    return respond(200, []);
  };
}

async function loadEditor({ email = OWNER_EMAIL, devPassword = true } = {}) {
  const db = await createCmsDb();
  const state = { email, requests: [], alerts: [], toasts: [], devPasswordAsks: 0 };
  const dom = new JSDOM(PAGE_HTML, {
    runScripts: 'dangerously',
    url: 'https://www.triplehenterprisesllc.biz/tools/site-content.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.SUPABASE_URL = SUPABASE_URL;
      w.SUPABASE_ANON_KEY = 'anon-key';
      w.getAuthToken = () => 'token';
      w.ensureFreshToken = async () => true;
      w.KNOWN_USER_NAMES = { [OWNER_EMAIL]: 'Steve', [DEV_EMAIL]: 'Connor' };
      w.canManageSiteContent = () => true;
      // Keep the page's own DOMContentLoaded init parked; each test drives
      // the editor directly.
      w.initSyncOnLoad = () => new Promise(() => {});
      w.fetch = makeFetch(db, state);
      w.fetchWithTimeout = (url, ms, opts) => w.fetch(url, opts);
      w.confirmDevPassword = async () => { state.devPasswordAsks++; return devPassword; };
      w.showToast = (msg, opts) => { state.toasts.push({ msg, type: opts && opts.type }); };
      w.openInfoModal = () => {};
      w.personDot = () => '';
      w.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    },
  });
  const w = dom.window;
  const s = w.document.createElement('script');
  s.textContent = DIALOGS_SRC;
  w.document.head.appendChild(s);
  // Real escapeHtml/escapeAttr from tools-dialogs.js; alerts/confirms recorded.
  w.showAlert = async (msg) => { state.alerts.push(msg); return true; };
  w.showConfirm = async () => true;
  w.document.getElementById('contentMainView').style.display = 'block';
  w.cmsWireEditor();
  await w.renderSiteContentForm();
  return { w, db, state };
}

function field(w, key, part = 'value') {
  return w.document.querySelector(`[data-cms-key="${key}"][data-cms-part="${part}"]`);
}
function typeInto(w, key, value, part = 'value') {
  const el = field(w, key, part);
  el.value = value;
  el.dispatchEvent(new w.Event(part === 'mode' ? 'change' : 'input', { bubbles: true }));
}
function reviewRows(w) {
  return [...w.document.querySelectorAll('#cmsReviewBody .cms-diff-row')].map(row => ({
    label: row.querySelector('.cms-diff-label').textContent,
    old: row.querySelector('.cms-diff-old .cms-diff-text').textContent,
    new: row.querySelector('.cms-diff-new .cms-diff-text').textContent,
    warnings: [...row.querySelectorAll('.cms-diff-warnings li')].map(li => li.textContent),
  }));
}
function reviewOpen(w) { return w.document.getElementById('cmsReviewOverlay').classList.contains('is-open'); }
async function waitForReview(w) {
  for (let i = 0; i < 200 && !reviewOpen(w); i++) await tick(5);
  assert.ok(reviewOpen(w), 'the review dialog should open');
}
async function confirmReview(w) { await waitForReview(w); w.document.getElementById('cmsReviewConfirm').click(); }
async function cancelReview(w) { await waitForReview(w); w.document.getElementById('cmsReviewCancel').click(); }
function publishDisabled(w) { return w.document.getElementById('saveSiteContentBtn').disabled; }
function fieldError(w, key) {
  const el = w.document.querySelector(`[data-cms-field="${key}"] .cms-field-error`);
  return el.hidden ? '' : el.textContent;
}
function rpcCalls(state, fnName) {
  return state.requests.filter(r => r.path === '/rest/v1/rpc/' + fnName).map(r => JSON.parse(r.body));
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

test('loads the live values into the right inputs, with plain-English labels and nothing to publish yet', async () => {
  const { w } = await loadEditor();
  assert.equal(field(w, 'googleRating').type, 'number');
  assert.equal(field(w, 'googleRating').value, '5.0');
  assert.equal(field(w, 'googleRating').min, '1');
  assert.equal(field(w, 'googleRating').max, '5');
  assert.equal(field(w, 'googleReviewCount').type, 'number');
  assert.equal(field(w, 'googleReviewCount').value, '7');
  assert.equal(field(w, 'phone').type, 'tel');
  assert.equal(field(w, 'email').type, 'email');
  const labels = [...w.document.querySelectorAll('.cms-field-head label')].map(l => l.textContent);
  assert.ok(labels.includes('Star rating on Google'));
  assert.ok(labels.includes('Number of Google reviews'));
  assert.ok(!labels.some(l => /^(googleRating|googleReviewCount|banner1|hoursMonday)$/.test(l)), 'no raw column names as labels');
  assert.equal(publishDisabled(w), true);
  assert.match(w.document.querySelector('.cms-last-save').textContent, /No edits yet/, 'the migration seed rows are not offered as an "undo"');
});

test('the live Sunday value "2:00 pm - 8:00 pm" loads as Open 2 PM to 8 PM and is NOT counted as an edit', async () => {
  const { w } = await loadEditor();
  assert.equal(field(w, 'hoursSunday', 'mode').value, 'open');
  assert.equal(field(w, 'hoursSunday', 'open').value, '14:00');
  assert.equal(field(w, 'hoursSunday', 'close').value, '20:00');
  assert.equal(field(w, 'hoursMonday', 'mode').value, 'default');
  assert.equal(publishDisabled(w), true);
});

// ---------------------------------------------------------------------------
// The headline flow: change the number, review, publish, undo
// ---------------------------------------------------------------------------

test('SAVE then UNDO from the real editor: review count 7 -> 8 goes live, then Undo puts back exactly 7', async () => {
  const { w, db, state } = await loadEditor();

  typeInto(w, 'googleReviewCount', '8');
  assert.equal(publishDisabled(w), false);
  assert.equal(w.document.querySelector('[data-cms-field="googleReviewCount"] .cms-dirty-pill').hidden, false);

  const publishing = w.saveSiteContent();
  await waitForReview(w);
  assert.deepEqual(reviewRows(w).map(r => [r.label, r.old, r.new]), [['Number of Google reviews', '7', '8']]);
  assert.equal(await readValue(db, 'googleReviewCount'), '7', 'nothing is live until the review is confirmed');
  await confirmReview(w);
  assert.equal(await publishing, true);

  assert.equal(await readValue(db, 'googleReviewCount'), '8');
  assert.deepEqual(rpcCalls(state, 'cms_publish_content'), [{ p_changes: [{ key: 'googleReviewCount', expected: '7', value: '8' }] }],
    'only the touched field is sent, with the value the editor showed as live');
  assert.match(w.document.querySelector('.cms-last-save').textContent, /Number of Google reviews: 7 → 8/);
  assert.match(w.document.querySelector('.cms-field-live').parentElement.textContent + w.document.querySelector('[data-cms-field="googleReviewCount"]').textContent, /Live now: 8/);

  const undoing = w.undoLastCmsSave();
  await waitForReview(w);
  assert.deepEqual(reviewRows(w).map(r => [r.old, r.new]), [['8', '7']]);
  await confirmReview(w);
  assert.equal(await undoing, true);

  const back = await readValue(db, 'googleReviewCount');
  assert.equal(back, '7');
  assert.equal(field(w, 'googleReviewCount').value, '7');
  const hist = await db.query("select action, old_value, new_value, undo_of from public.site_content_history where key = 'googleReviewCount' order by id");
  assert.deepEqual(hist.rows.map(r => [r.action, r.old_value, r.new_value, r.undo_of !== null]), [
    ['insert', null, '7', false], ['update', '7', '8', false], ['update', '8', '7', true],
  ]);
});

test('rating and count changed together publish as one save and undo together', async () => {
  const { w, db } = await loadEditor();
  typeInto(w, 'googleRating', '4.9');
  typeInto(w, 'googleReviewCount', '12');
  const p = w.saveSiteContent();
  await confirmReview(w);
  assert.equal(await p, true);
  assert.equal(await readValue(db, 'googleRating'), '4.9');
  assert.equal(await readValue(db, 'googleReviewCount'), '12');
  const u = w.undoLastCmsSave();
  await confirmReview(w);
  assert.equal(await u, true);
  assert.equal(await readValue(db, 'googleRating'), '5.0');
  assert.equal(await readValue(db, 'googleReviewCount'), '7');
});

test('cancelling the review publishes nothing and keeps the edit on screen', async () => {
  const { w, db, state } = await loadEditor();
  typeInto(w, 'googleReviewCount', '8');
  const p = w.saveSiteContent();
  await cancelReview(w);
  assert.equal(await p, false);
  assert.equal(await readValue(db, 'googleReviewCount'), '7');
  assert.equal(rpcCalls(state, 'cms_publish_content').length, 0);
  assert.equal(field(w, 'googleReviewCount').value, '8');
  assert.equal(publishDisabled(w), false);
});

test('a refused dev password publishes nothing', async () => {
  const { w, db, state } = await loadEditor({ devPassword: false });
  typeInto(w, 'googleReviewCount', '8');
  const p = w.saveSiteContent();
  await confirmReview(w);
  assert.equal(await p, false);
  assert.equal(state.devPasswordAsks, 1);
  assert.equal(await readValue(db, 'googleReviewCount'), '7');
});

// ---------------------------------------------------------------------------
// Inline validation, before anything can be published
// ---------------------------------------------------------------------------

const BAD_INPUTS = [
  ['googleRating', '6', /1\.0 to 5\.0/],
  ['googleRating', '0.5', /1\.0 to 5\.0/],
  ['googleRating', '4.85', /one decimal/],
  ['googleRating', '', /can't be blank/],
  ['googleReviewCount', '0', /at least 1/],
  ['googleReviewCount', '7.5', /whole number/],
  ['googleReviewCount', '-3', /whole number/],
  ['googleReviewCount', '', /can't be blank/],
  ['phone', '414-1667', /10-digit/],
  ['phone', 'call me', /10-digit/],
  ['email', 'steve at triplehenterprisesllc.biz', /email address/],
  ['banner1', 'x'.repeat(201), /200 characters/],
];
for (const [key, value, message] of BAD_INPUTS) {
  test(`typing ${JSON.stringify(value.length > 20 ? value.slice(0, 12) + '...' : value)} into ${key} shows an inline error and blocks publishing`, async () => {
    const { w, db, state } = await loadEditor();
    typeInto(w, key, value);
    assert.match(fieldError(w, key), message);
    assert.equal(publishDisabled(w), true);
    assert.match(w.document.getElementById('cmsPendingSummary').textContent, /needs fixing/);
    assert.equal(await w.saveSiteContent(), false);
    assert.equal(reviewOpen(w), false);
    assert.equal(rpcCalls(state, 'cms_publish_content').length, 0);
    assert.equal(await readValue(db, 'googleReviewCount'), '7');
  });
}

test('"5" is tidied to "5.0" and a phone number typed any way is saved in the site\'s (435) 414-1667 format', async () => {
  const { w, db } = await loadEditor();
  typeInto(w, 'googleRating', '5');
  assert.equal(publishDisabled(w), true, '5 == 5.0, so there is nothing to publish');
  typeInto(w, 'phone', '435.414.1667');
  const p = w.saveSiteContent();
  await waitForReview(w);
  const rows = reviewRows(w);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].new, '(435) 414-1667');
  assert.match(rows[0].old, /Blank \(the site shows its built-in \(435\) 414-1667\)/);
  assert.ok(rows[0].warnings.some(x => /Call it once/.test(x)));
  await confirmReview(w);
  assert.equal(await p, true);
  assert.equal(await readValue(db, 'phone'), '(435) 414-1667');
});

// ---------------------------------------------------------------------------
// Warnings in the review step
// ---------------------------------------------------------------------------

test('the review step warns about a review count going down and an email address typed into a banner (the 2026-08-16 incident)', async () => {
  const { w } = await loadEditor();
  typeInto(w, 'googleReviewCount', '4');
  typeInto(w, 'banner2', 'Steve@triplehenterprisesllc.biz');
  const p = w.saveSiteContent();
  await waitForReview(w);
  const rows = reviewRows(w);
  const count = rows.find(r => r.label === 'Number of Google reviews');
  const banner = rows.find(r => /Banner 2/.test(r.label));
  assert.ok(count.warnings.some(x => /almost never go down/.test(x)));
  assert.ok(banner.warnings.some(x => /email address/.test(x)));
  assert.ok(banner.warnings.some(x => /hiring notice/.test(x)));
  await cancelReview(w);
  await p;
});

test('dropping the rating below 5.0 warns that the stats strip label will change', async () => {
  const { w } = await loadEditor();
  typeInto(w, 'googleRating', '4.9');
  const p = w.saveSiteContent();
  await waitForReview(w);
  assert.ok(reviewRows(w)[0].warnings.some(x => /Real Google Reviews/.test(x)));
  await cancelReview(w);
  await p;
});

// ---------------------------------------------------------------------------
// Never clobbering someone else's newer edit
// ---------------------------------------------------------------------------

test('a stale tab cannot overwrite a newer edit: publish is refused, nothing changes, and the latest value is shown', async () => {
  const { w, db, state } = await loadEditor({ email: DEV_EMAIL });
  // Steve updates the count from his phone after this tab loaded.
  await rpc(db, OWNER_EMAIL, 'cms_publish_content', { p_changes: [{ key: 'googleReviewCount', expected: '7', value: '9' }] });

  typeInto(w, 'googleReviewCount', '8');
  const p = w.saveSiteContent();
  await confirmReview(w);
  assert.equal(await p, false);
  assert.equal(await readValue(db, 'googleReviewCount'), '9', "Steve's edit survives");
  assert.equal(state.alerts.length, 1);
  assert.match(state.alerts[0], /"Number of Google reviews" was changed by someone else/);
  assert.match(state.alerts[0], /Nothing was published/);
  assert.match(w.document.querySelector('[data-cms-field="googleReviewCount"]').textContent, /Live now: 9/);
  assert.equal(field(w, 'googleReviewCount').value, '8', 'the unpublished edit is kept, not thrown away');
});

test('undo is refused if the field changed again since that save', async () => {
  const { w, db, state } = await loadEditor();
  typeInto(w, 'googleReviewCount', '8');
  const p = w.saveSiteContent();
  await confirmReview(w);
  assert.equal(await p, true);
  await rpc(db, DEV_EMAIL, 'cms_publish_content', { p_changes: [{ key: 'googleReviewCount', expected: '8', value: '9' }] });

  const u = w.undoLastCmsSave();
  await confirmReview(w);
  assert.equal(await u, false);
  assert.equal(await readValue(db, 'googleReviewCount'), '9');
  assert.match(state.alerts[0], /changed by someone else|changed again/);
});

// ---------------------------------------------------------------------------
// Per-field history: put back an earlier value
// ---------------------------------------------------------------------------

test('"Put back" in a field\'s recent changes restores an earlier value through the same review step', async () => {
  const { w, db } = await loadEditor();
  for (const next of ['8', '9']) {
    typeInto(w, 'googleReviewCount', next);
    const p = w.saveSiteContent();
    await confirmReview(w);
    assert.equal(await p, true);
  }
  const buttons = [...w.document.querySelectorAll('[data-cms-field="googleReviewCount"] [data-cms-action="putback"]')];
  const putBack8 = buttons.find(b => b.textContent === 'Put back "8"');
  assert.ok(putBack8, 'expected a Put back "8" button, got: ' + buttons.map(b => b.textContent).join(' | '));
  putBack8.click();
  await waitForReview(w);
  assert.deepEqual(reviewRows(w).map(r => [r.old, r.new]), [['9', '8']]);
  await confirmReview(w);
  for (let i = 0; i < 100 && (await readValue(db, 'googleReviewCount')) !== '8'; i++) await tick(5);
  assert.equal(await readValue(db, 'googleReviewCount'), '8');
});

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

test('hours: set Saturday to Closed, publish, and the saved text is exactly "Closed"', async () => {
  const { w, db } = await loadEditor();
  typeInto(w, 'hoursSaturday', 'closed', 'mode');
  const p = w.saveSiteContent();
  await waitForReview(w);
  assert.deepEqual(reviewRows(w).map(r => [r.label, r.new]), [['Saturday hours', 'Closed']]);
  await confirmReview(w);
  assert.equal(await p, true);
  assert.equal(await readValue(db, 'hoursSaturday'), 'Closed');
});

test('hours: "Open" with times is saved in the site\'s own format, and a closing time before opening is refused', async () => {
  const { w, db } = await loadEditor();
  typeInto(w, 'hoursMonday', 'open', 'mode');
  assert.match(fieldError(w, 'hoursMonday'), /both an opening and a closing time/);
  typeInto(w, 'hoursMonday', '15:00', 'open');
  typeInto(w, 'hoursMonday', '09:00', 'close');
  assert.match(fieldError(w, 'hoursMonday'), /after the opening time/);
  assert.equal(publishDisabled(w), true);
  typeInto(w, 'hoursMonday', '21:30', 'close');
  assert.equal(fieldError(w, 'hoursMonday'), '');
  const p = w.saveSiteContent();
  await confirmReview(w);
  assert.equal(await p, true);
  assert.equal(await readValue(db, 'hoursMonday'), '3:00 PM – 9:30 PM');
});

test('the editor\'s built-in fallbacks match what the public pages really show when a field is blank', () => {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const src = PAGE_HTML.match(/const CMS_BUILT_IN = \{[\s\S]*?\n  \};/)[0];
  const builtIn = new Function(src + '; return CMS_BUILT_IN;')();
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const indexDom = new JSDOM(index).window.document;
  for (const day of days) {
    const shown = [...indexDom.querySelectorAll('.js-hours-' + day)].map(el => el.textContent.trim());
    assert.ok(shown.length >= 2, 'index.html shows ' + day + ' hours in 2 places');
    const key = 'hours' + day[0].toUpperCase() + day.slice(1);
    shown.forEach(text => assert.equal(text, builtIn[key], key));
  }
  const phones = new Set([...indexDom.querySelectorAll('.js-phone-text')].map(el => el.textContent.trim()));
  assert.deepEqual([...phones], [builtIn.phone]);
  const emails = new Set([...indexDom.querySelectorAll('.js-email-text')].map(el => el.textContent.trim()));
  assert.deepEqual([...emails], [builtIn.email]);
});

// ---------------------------------------------------------------------------
// The old unsafe paths are gone
// ---------------------------------------------------------------------------

test('the editor never writes site_content directly -- only through the two checked RPCs', async () => {
  const { w, state } = await loadEditor();
  typeInto(w, 'banner1', 'Now booking October weekends');
  const p = w.saveSiteContent();
  await confirmReview(w);
  assert.equal(await p, true);
  const writes = state.requests.filter(r => r.method !== 'GET');
  assert.ok(writes.length > 0);
  assert.ok(writes.every(r => r.path.startsWith('/rest/v1/rpc/cms_')), writes.map(r => r.method + ' ' + r.path).join(', '));
  assert.doesNotMatch(PAGE_HTML, /site_content\?on_conflict=key/, 'the old blind "Save all" upsert must not come back');
});

test('the Content edit history panel\'s Restore for a site content row goes through the editor, not a blind upsert', () => {
  const restore = PAGE_HTML.match(/async function restoreHistoryEntry[\s\S]*?\n  \}/)[0];
  assert.match(restore, /putBackCmsHistoryRow\(entry\.historyRow\)/);
  assert.doesNotMatch(restore, /site_content\?/);
});
