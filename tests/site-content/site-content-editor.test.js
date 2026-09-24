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
  // Banners have a mode since 2026-09-23 (site-banners-editor.test.js):
  // "My own message" is what replaces the hiring notice.
  typeInto(w, 'banner2Mode', 'custom');
  typeInto(w, 'banner2', 'Steve@triplehenterprisesllc.biz');
  const p = w.saveSiteContent();
  await waitForReview(w);
  const rows = reviewRows(w);
  const count = rows.find(r => r.label === 'Number of Google reviews');
  const banner = rows.find(r => r.label === 'Second banner: your message');
  const mode = rows.find(r => r.label === 'Second banner');
  assert.ok(count.warnings.some(x => /almost never go down/.test(x)));
  assert.ok(banner.warnings.some(x => /email address/.test(x)));
  assert.ok(mode.warnings.some(x => /hiring notice/.test(x)));
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

// ---------------------------------------------------------------------------
// Banners (2026-09-23): each banner has a mode -- the built-in wording,
// your own message (with an optional link from a fixed list), or off.
// The public side is tests/site-content/site-banners-public.test.js.
// ---------------------------------------------------------------------------

function isShown(w, key) { return !w.document.querySelector(`[data-cms-field="${key}"]`).hidden; }
async function bannerValues(db, slot) {
  return {
    mode: await readValue(db, `banner${slot}Mode`),
    text: await readValue(db, `banner${slot}`),
    link: await readValue(db, `banner${slot}Link`),
  };
}

test('banners: both start on their built-in wording, with the message and link fields out of the way', async () => {
  const { w } = await loadEditor();
  for (const slot of [1, 2]) {
    assert.equal(field(w, `banner${slot}Mode`).value, 'builtin');
    assert.ok(!isShown(w, `banner${slot}`));
    assert.ok(!isShown(w, `banner${slot}Link`));
  }
  const live = w.document.querySelector('[data-cms-field="banner1Mode"] .cms-field-live').textContent;
  assert.match(live, /Built-in: New customer\? Mention code WELCOME15/);
  typeInto(w, 'banner1Mode', 'custom');
  assert.ok(isShown(w, 'banner1') && isShown(w, 'banner1Link'));
  assert.ok(!isShown(w, 'banner2'), 'the other banner is untouched');
  typeInto(w, 'banner1Mode', 'off');
  assert.ok(!isShown(w, 'banner1'));
});

test('banners: "My own message" with no message blocks publishing until one is typed', async () => {
  const { w, state } = await loadEditor();
  typeInto(w, 'banner1Mode', 'custom');
  assert.match(fieldError(w, 'banner1Mode'), /Type your message below/);
  assert.ok(publishDisabled(w));
  assert.equal(await w.saveSiteContent(), false);
  assert.equal(rpcCalls(state, 'cms_publish_content').length, 0);
  typeInto(w, 'banner1', 'Closed Thanksgiving Day');
  assert.equal(fieldError(w, 'banner1Mode'), '');
  assert.ok(!publishDisabled(w));
});

test('banners: SAVE then UNDO -- a custom message with a link publishes as one save, and undo puts back exactly the built-in banner', async () => {
  const { w, db, state } = await loadEditor();
  const before = await bannerValues(db, 1);
  assert.deepEqual(before, { mode: 'builtin', text: null, link: null });

  typeInto(w, 'banner1Mode', 'custom');
  typeInto(w, 'banner1', '  Closed Thanksgiving   Day -- back Friday.  ');
  typeInto(w, 'banner1Link', '/booking.html');
  const p = w.saveSiteContent();
  await waitForReview(w);
  assert.match(w.document.getElementById('cmsReviewIntro').textContent, /Banner changes show from the next page a visitor opens/);
  const rows = reviewRows(w);
  assert.deepEqual(rows.map(r => [r.label, r.old, r.new]), [
    ['Top banner', 'Built-in: New customer? Mention code WELCOME15 when you book and get 15% off your first service call.', 'Your own message'],
    ['Top banner: your message', 'Blank', 'Closed Thanksgiving Day -- back Friday.'],
    ['Top banner: link at the end', 'No link', 'Book online → (/booking.html)'],
  ]);
  assert.ok(rows[0].warnings.some(x => /replaces the WELCOME15 new-customer offer/.test(x)));
  await confirmReview(w);
  assert.equal(await p, true);
  assert.deepEqual(await bannerValues(db, 1), { mode: 'custom', text: 'Closed Thanksgiving Day -- back Friday.', link: '/booking.html' });
  assert.equal(rpcCalls(state, 'cms_publish_content').length, 1, 'one save');

  const u = w.undoLastCmsSave();
  await waitForReview(w);
  assert.equal(reviewRows(w).length, 3);
  await confirmReview(w);
  assert.equal(await u, true);
  assert.deepEqual(await bannerValues(db, 1), before);
  assert.equal(field(w, 'banner1Mode').value, 'builtin');
  assert.ok(!isShown(w, 'banner1'));
});

test('banners: turning the hiring notice off warns what disappears, and undo brings it back', async () => {
  const { w, db } = await loadEditor();
  typeInto(w, 'banner2Mode', 'off');
  const p = w.saveSiteContent();
  await waitForReview(w);
  const [row] = reviewRows(w);
  assert.deepEqual([row.label, row.new], ['Second banner', 'No banner']);
  assert.ok(row.warnings.some(x => /hiring notice disappears from every page/.test(x)));
  await confirmReview(w);
  assert.equal(await p, true);
  assert.equal(await readValue(db, 'banner2Mode'), 'off');
  const u = w.undoLastCmsSave();
  await confirmReview(w);
  assert.equal(await u, true);
  assert.equal(await readValue(db, 'banner2Mode'), 'builtin');
});

test('banners: clearing the message of a banner that is live on "My own message" is refused', async () => {
  const { w, db, state } = await loadEditor();
  await rpc(db, OWNER_EMAIL, 'cms_publish_content', { p_changes: [
    { key: 'banner1Mode', expected: 'builtin', value: 'custom' },
    { key: 'banner1', expected: null, value: 'Closed Monday' },
  ] });
  await w.renderSiteContentForm();
  assert.ok(isShown(w, 'banner1'));
  typeInto(w, 'banner1', '');
  assert.match(fieldError(w, 'banner1'), /Type your message, or pick another option above/);
  assert.ok(publishDisabled(w));
  assert.equal(await w.saveSiteContent(), false);
  assert.equal(rpcCalls(state, 'cms_publish_content').length, 0);
});

test('banners: "Put back" can\'t leave a banner on "My own message" with no message', async () => {
  const { w, db, state } = await loadEditor();
  await rpc(db, OWNER_EMAIL, 'cms_publish_content', { p_changes: [
    { key: 'banner1Mode', expected: 'builtin', value: 'custom' },
    { key: 'banner1', expected: null, value: 'Closed Monday' },
  ] });
  await w.renderSiteContentForm();
  const btn = w.document.querySelector('[data-cms-field="banner1"] [data-cms-action="putback"]');
  assert.equal(btn.textContent, 'Put back blank');
  btn.click();
  for (let i = 0; i < 100 && !state.alerts.length; i++) await tick(5);
  assert.match(state.alerts[0], /no message/);
  assert.equal(rpcCalls(state, 'cms_publish_content').length, 0);
  assert.equal(await readValue(db, 'banner1'), 'Closed Monday');
});

test('banners: a message saved before modes existed shows as "My own message", the way the site shows it', async () => {
  const { w, db } = await loadEditor();
  await asUser(db, OWNER_EMAIL, tx => tx.query("update public.site_content set value = case key when 'banner2' then 'Closed Monday' else null end where key in ('banner2', 'banner2Mode')"));
  await w.renderSiteContentForm();
  assert.equal(field(w, 'banner2Mode').value, 'custom');
  assert.ok(isShown(w, 'banner2'));
  assert.equal(field(w, 'banner2').value, 'Closed Monday');
});

test('banners: the recent-changes list says what a mode change means, not its code word', async () => {
  const { w } = await loadEditor();
  typeInto(w, 'banner2Mode', 'off');
  const p = w.saveSiteContent();
  await confirmReview(w);
  assert.equal(await p, true);
  const change = w.document.querySelector('[data-cms-field="banner2Mode"] .cms-hist-change').textContent;
  assert.equal(change, 'built-in wording → no banner');
  assert.match(w.document.querySelector('.cms-last-save-detail').textContent, /Second banner: built-in wording → no banner/);
});

test('banners: the editor\'s built-in wording is word for word what js/site-banners.js shows', () => {
  const js = fs.readFileSync(path.join(ROOT, 'js', 'site-banners.js'), 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><body><div id="siteBanner1"></div><div id="siteBanner2"></div></body>', { runScripts: 'outside-only', url: 'https://example.com/' });
  dom.window.eval(js);
  const shown = (id) => dom.window.document.querySelector(`#${id} .site-banner-text`).textContent;
  const builtIn = new Function(PAGE_HTML.match(/const BANNER_BUILT_IN = (\{[\s\S]*?\});/)[1].replace(/^/, 'return '))();
  assert.equal(builtIn[1], shown('siteBanner1'));
  assert.equal(builtIn[2], shown('siteBanner2'));
});

test('no function name is declared twice in the page -- a second declaration silently replaces the first', () => {
  // The FAQ/Terms editor and the banner editor were built side by side and
  // both named a helper cmsShort() with different arguments; whichever came
  // second would have won for every caller. check-undefined-vars does not
  // catch a repeated function declaration inside one page.
  // Parsed, not regex-matched: JSDOM without runScripts never executes them.
  const doc = new JSDOM(PAGE_HTML).window.document;
  const scripts = [...doc.querySelectorAll('script:not([src])')].map(el => el.textContent).join('\n');
  const names = [...scripts.matchAll(/^ {2}(?:async )?function (\w+)\s*\(/gm)].map(m => m[1]);
  const seen = new Set();
  const dupes = names.filter(n => (seen.has(n) ? true : (seen.add(n), false)));
  assert.ok(names.length > 50, `expected to find the page's functions, found ${names.length}`);
  assert.deepEqual(dupes, []);
});
