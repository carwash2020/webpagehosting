// Workspace redundancy pass (2026-10-31, Connor-approved, 19 items).
// UI-only: every item removed or moved a screen, and no stored data or
// Supabase table. These pin the behaviour that changed hands -- where a
// feature now lives, and that its data is still read from the same place.
// Item-by-item notes: docs/specialist-logs/visual.md, 2026-10-31.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');

// ---- Item 9: Runway reads and writes the Dashboard's set-aside rate ----

function loadRunway(seed) {
  const html = read('runway-dashboard.html');
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/runway-dashboard.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.showToast = () => {};
      w.requestAnimationFrame = (fn) => setTimeout(fn, 0);
      w.syncs = 0;
      w.scheduleSync = () => { w.syncs++; };
      Object.entries(seed || {}).forEach(([k, v]) => w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
      w.addEventListener('error', (e) => errors.push(e.message));
    },
  });
  return { w: dom.window, errors };
}
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

const RUNWAY_SEED = {
  th_setaside_rate: '30',
  'rd_budget-settings': { savingsPct: 15, taxSetAsideRate: 22 },
  th_income_log: [{ id: 1, date: '2026-10-05', amount: 500, origin: 'manual' }],
  th_expense_log: [
    { id: 2, date: '2026-10-06', amount: 40, type: 'expense' },
    { id: 3, date: '2026-10-07', amount: 7.6, type: 'mileage', miles: 10 },
    { id: 4, date: '2026-09-07', amount: 99, type: 'expense' },
  ],
};

test('item 9: Runway\'s Tax Set-Aside rate shows the Dashboard\'s rate (th_setaside_rate), not its own old rd_budget-settings copy', async () => {
  const { w, errors } = loadRunway(RUNWAY_SEED);
  await tick();
  assert.deepEqual(errors, []);
  assert.equal(w.document.getElementById('taxSetAsideRate').value, '30');
  assert.equal(w.sharedSetAsideRate(), 30);
  w.close();
  // Never set on this device: the Dashboard's own default, 25.
  const fresh = loadRunway({ 'rd_budget-settings': { savingsPct: 15, taxSetAsideRate: 40 } });
  await tick();
  assert.equal(fresh.w.document.getElementById('taxSetAsideRate').value, '25');
  fresh.w.close();
});

test('item 9: changing it on Runway writes th_setaside_rate (what the Dashboard reads) and leaves rd_budget-settings -- savings target included -- as it was', async () => {
  const { w } = loadRunway(RUNWAY_SEED);
  await tick();
  const input = w.document.getElementById('taxSetAsideRate');
  input.value = '18';
  input.dispatchEvent(new w.Event('change'));
  await tick();
  assert.equal(w.localStorage.getItem('th_setaside_rate'), '18');
  assert.ok(w.syncs > 0, 'synced like the Dashboard\'s own save');
  assert.deepEqual(JSON.parse(w.localStorage.getItem('rd_budget-settings')), { savingsPct: 15, taxSetAsideRate: 22 });
  // The Dashboard reads exactly this key the same way.
  assert.match(read('workspace.html'), /function loadSetAsideRate\(\) \{\s*const stored = localStorage\.getItem\('th_setaside_rate'\);\s*return stored !== null \? parseFloat\(stored\) : 25;/);
  w.close();
});

test('item 9: every Runway set-aside figure uses the shared rate; nothing reads budgetSettings.taxSetAsideRate any more', () => {
  const src = read('runway-dashboard.html');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // (Restoring a backup file still copies its own legacy field back into
  // rd_budget-settings -- data.budgetSettings.taxSetAsideRate -- so the
  // file's contents are kept; nothing uses it as the rate.)
  assert.doesNotMatch(code, /(?<!data\.)budgetSettings\.taxSetAsideRate\b/);
  assert.match(code, /function latestTaxSetAside\(\)\{[\s\S]*?sharedSetAsideRate\(\)/);
  assert.match(code, /function renderTaxSetAside\(sorted\)\{[\s\S]*?sharedSetAsideRate\(\)/);
});

test('item 9: no Pull from Finance -- Save Month records Revenue / Expenses / Fuel from Finance for that month, plus the Draws / Cash / Other typed here', async () => {
  const { w } = loadRunway(RUNWAY_SEED);
  await tick();
  const doc = w.document;
  assert.equal(doc.getElementById('pullMonthBtn'), null);
  doc.getElementById('biz-month-select').value = '10';
  doc.getElementById('biz-year-select').value = '2026';
  doc.getElementById('biz-month-select').dispatchEvent(new w.Event('change'));
  assert.match(doc.getElementById('bizFinanceNote').textContent, /Revenue \$500 \(1 income entry\) · Expenses \$40 · Fuel \/ mileage \$8/);
  doc.getElementById('biz-draws').value = '200';
  doc.getElementById('biz-cash').value = '1500';
  doc.getElementById('biz-other').value = '12';
  doc.getElementById('addMonthBtn').click();
  await tick();
  const months = JSON.parse(w.localStorage.getItem('rd_business-months'));
  assert.deepEqual(months, [{ month: '2026-10', revenue: 500, expenses: 40, fuel: 7.6, other: 12, draws: 200, cash: 1500 }], 'same row shape as before');
  w.close();
});

test('item 19: Runway keeps a Runway-only Download / Restore (Dev Tools\' full backup is hidden from accounts without full technical access); Reset all data is gone', () => {
  const src = read('runway-dashboard.html');
  assert.match(src, /id="exportBackupBtn"/);
  assert.match(src, /id="restoreBackupBtn"/);
  assert.doesNotMatch(src, /id="resetAllBtn"/);
  // The gap that keeps it: the full backup panel is dev-owner-hidden.
  assert.match(read('dev-tools.html'), /<div class="dev-panel dev-owner-hidden dev-panel-wide" id="backup">/);
});

// ---- Item 17: the Gallery queue on Site Content ----

test('item 17: the Gallery queue left Home for Site Content, with the same render code and data, and Site Content\'s CSP lets its signed photo URLs load', () => {
  const sc = read('site-content.html');
  const ws = read('workspace.html');
  assert.match(sc, /<div class="dev-panel dev-panel-wide is-collapsible" data-collapse-key="gallery" id="section-gallery">/);
  assert.match(sc, /<div id="galleryQueueList"><\/div>/);
  assert.match(sc, /data-sc-jump="gallery"/);
  for (const fn of ['loadAndRenderGalleryQueue', 'refreshGalleryChip', 'unqueueGalleryPhoto', 'initBeforeAfterSliders']) {
    assert.match(sc, new RegExp('function ' + fn + '\\('), fn);
    assert.doesNotMatch(ws, new RegExp('function ' + fn + '\\('), fn + ' moved, not copied');
  }
  assert.match(sc, /await fetchFeaturedPhotos\(\)/);
  assert.match(sc, /await toggleFeaturedPhoto\(photoId, false, ''\)/);
  // Found by the 390x844 shots: Site Content's img-src was 'self' data:
  // only, so the queue's signed Supabase photo URLs were blocked. Home's
  // policy (where the queue used to live) allows them; this matches it.
  const csp = (html) => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1].match(/img-src ([^;]+)/)[1];
  assert.match(csp(sc), /https:\/\/\*\.supabase\.co/);
  assert.equal(csp(sc), csp(ws));
});

// ---- Items 12, 13: Clients' Portal tab ----

test('item 12: Portal bug reports / client errors render in Dev Tools -> Health from the same tables; item 13: Portal invoices / quotes are gone from Clients', () => {
  const cl = read('clients.html');
  const dt = read('dev-tools.html');
  for (const id of ['portalBugReports', 'portalClientErrors', 'portalInvoices', 'portalQuotes']) {
    assert.doesNotMatch(cl, new RegExp('id="' + id + '"'), id + ' off Clients');
  }
  assert.match(dt, /portal_bug_reports\?select=\*&order=created_at\.desc&limit=50/);
  assert.match(dt, /portal_bug_reports\?id=eq\.' \+ id/, 'Mark resolved still writes the same row');
  assert.match(dt, /portal_client_errors\?select=\*&order=created_at\.desc&limit=50/);
  // Item 14 was not done: the work orders panel (messages, photos, closed
  // history, CSV export) stays on Clients.
  assert.match(cl, /id="portalWorkOrders"/);
  assert.match(cl, /function toggleWorkOrderMessages\(/);
});

// ---- Item 15: Suppliers ----

test('item 15: Job Tracker\'s Contacts tab is Suppliers -- same tab id, hash and th_tracker_contacts records, and it points clients to Clients -> Add', () => {
  const jt = read('job-tracker.html');
  assert.match(jt, /<button class="tab-btn" data-tab="contacts">Suppliers<\/button>/);
  assert.match(jt, /<h3>Add a supplier<\/h3>/);
  assert.match(jt, /<a href="\/tools\/clients\.html#new">Clients &rsaquo; Add<\/a>/);
  assert.match(jt, /contacts: 'th_tracker_contacts'/);
  // The saved record keeps its shape.
  assert.match(jt, /const fields = \{\s*name,\s*role: document\.getElementById\('contactRole'\)\.value\.trim\(\),\s*phone: contactPhoneVal,\s*email: document\.getElementById\('contactEmail'\)\.value\.trim\(\),\s*notes: document\.getElementById\('contactNotes'\)\.value\.trim\(\),\s*\};/);
});

// ---- Redirects for removed/relocated deep links (rebase onto Phase 4) ----
// Browser-checked end to end in docs/workspace-redundancy-2026-10-31/
// harness/verify.js ('redirect' checks); these pin the wiring.

test('redirect: finance.html#cost goes to New quote for an Invoices account, after the role loads and before the Finance gate', () => {
  const html = read('finance.html');
  const fn = html.match(/function redirectRetiredFinanceHash\(h\) \{[\s\S]*?\n {2}\}/);
  assert.ok(fn, 'redirectRetiredFinanceHash() exists');
  assert.match(fn[0], /h !== 'cost'/);
  assert.match(fn[0], /canManageInvoices\(\)\) return false/, 'an account without Invoices stays on Finance');
  assert.match(fn[0], /location\.replace\('\/tools\/invoice-generator\.html#quote'\)/);
  const sync = html.indexOf('await initSyncOnLoad();');
  const call = html.indexOf('if (redirectRetiredFinanceHash(', sync);
  const gate = html.indexOf("canViewFinance === 'function' && !canViewFinance()", sync);
  assert.ok(sync > 0 && call > sync && call < gate, 'checked after the role loads, before the Finance gate');
  assert.match(html, /if \(redirectRetiredFinanceHash\(h\)\) return;\s*if \(TAB_HASHES\[h\]\) activateTab\(h\);/, 'same-document hash changes too');
});

test('redirect: Home #section-gallery / #gallery go to Site Content, which opens the Gallery queue on that hash', () => {
  assert.match(read('workspace.html'), /location\.hash === '#section-gallery' \|\| window\.location\.hash === '#gallery'\) \{\s*window\.location\.replace\('\/tools\/site-content\.html#gallery'\)/);
  const sc = read('site-content.html');
  assert.match(sc, /id="section-gallery"/);
  assert.match(sc, /if \(h !== '#gallery' && h !== '#section-gallery'\) return;/);
  assert.match(sc, /jump\('gallery'\)/);
});

test('redirect: an old Home ?search= link opens Money owed\'s search and drops the stale #section-actionitems', () => {
  const html = read('workspace.html');
  assert.match(html, /invoiceSearchWrap'\);\s*if \(wrap\) wrap\.classList\.add\('is-expanded'\)/);
  assert.match(html, /history\.replaceState\(null, '', location\.pathname \+ location\.search\)/);
  assert.match(html, /showMoneyCardAfterRender = true;/);
  assert.match(html, /behavior: 'instant'/);
});

// ---- Item 11 follow-up: "Manage saved job types" on New invoice / New
// quote puts back Cost Lookup's create + delete for th_price_reference.
// Runs the page's real picker + manager markup and functions with the real
// showPromptForm() (tools-dialogs.js) and the real tombstone/graveyard
// writers (data-layer.js), same approach as resend-quote.test.js. ----

const IG = read('invoice-generator.html');
const PRICE_REF_JS = IG.slice(IG.indexOf('  function loadPriceReferencesForPicker() {'), IG.indexOf('  async function createPriceReference() {'))
  // deletePriceReference() gained a confirm step (corrections pack,
  // 2026-11-01, async showConfirm()) and so gained the `async` keyword
  // plus an explanatory comment block right above it -- both matched
  // loosely here (non-greedy `[\s\S]*?`) rather than assumed either way.
  + IG.match(/ {2}async function createPriceReference\(\) \{[\s\S]*?\n {2}\}\n[\s\S]*?(?:async )?function deletePriceReference\(id\) \{[\s\S]*?\n {2}\}\n/)[0];
const PRICE_REF_HTML = ['invoice', 'quote'].map((k) => IG.match(new RegExp('  <div class="tool-form-row" id="' + k + 'PriceRefRow"[\\s\\S]*?PriceRefManager" hidden>[\\s\\S]*?\\n    </div>\\n  </div>\\n'))[0]).join('');

function loadPriceRefManager(seed) {
  const dom = new JSDOM('<!doctype html><body>' + PRICE_REF_HTML + '</body>', { url: 'https://example.com/tools/invoice-generator.html', runScripts: 'outside-only' });
  const w = dom.window;
  const out = { syncs: 0, toasts: [], added: [] };
  Object.entries(seed || {}).forEach(([k, v]) => w.localStorage.setItem(k, JSON.stringify(v)));
  w.eval(read('tools-dialogs.js'));
  w.eval(read('data-layer.js'));
  w.scheduleSync = () => { out.syncs++; };
  w.showToast = (m) => out.toasts.push(m);
  w.addQuoteLineItem = (...a) => out.added.push(a);
  w.eval(PRICE_REF_JS + '\nObject.assign(window, { populatePriceRefPickers, togglePriceRefManager, createPriceReference, deletePriceReference, addLineItemFromPriceRef });');
  w.populatePriceRefPickers();
  const stored = () => JSON.parse(w.localStorage.getItem('th_price_reference') || '[]');
  const $ = (s) => w.document.querySelector(s);
  // jsdom's outside-only mode doesn't run inline on* attributes; run the
  // button's own onclick text, bound to the button, as a click would.
  const tap = (sel) => { const b = $(sel); new w.Function(b.getAttribute('onclick')).call(b); };
  return { w, out, stored, $, tap };
}

test('item 11 follow-up: a "Manage saved job types" link sits under both pickers, outside the row that hides when the list is empty', () => {
  const { $ } = loadPriceRefManager({});
  assert.equal($('#quotePriceRefRow').style.display, 'none', 'no saved types: the picker row hides, as before');
  for (const k of ['invoice', 'quote']) {
    const t = $('#' + k + 'PriceRefManageToggle');
    assert.ok(t && !t.closest('#' + k + 'PriceRefRow'), k + ': link is outside the hidden picker row');
    assert.equal(t.textContent, 'Manage saved job types');
    assert.equal(t.getAttribute('aria-controls'), k + 'PriceRefManager');
    assert.equal($('#' + k + 'PriceRefManager').hidden, true);
  }
});

test('item 11 follow-up: create writes { id, label, hours, rate } -- the exact shape Cost Lookup\'s Save Current as Reference wrote -- and the picker lists it', async () => {
  // The old writer, from main before the redundancy pass (907e562:tools/finance.html):
  //   list.push({ id: Date.now(), label: values.label, hours, rate });
  const { w, out, stored, $, tap } = loadPriceRefManager({ th_price_reference: [{ id: 1, label: 'Dishwasher install', hours: 2, rate: 85 }] });
  tap('#quotePriceRefManageToggle');
  assert.equal($('#quotePriceRefManager').hidden, false);
  assert.equal($('#quotePriceRefManageToggle').getAttribute('aria-expanded'), 'true');
  assert.equal(w.document.querySelectorAll('#quotePriceRefManager .price-ref-chip').length, 1);

  const before = Date.now();
  const p = w.createPriceReference();
  assert.equal($('#quotePriceRefManager .add-row-btn').getAttribute('onclick'), 'createPriceReference()');
  await tick(0);
  assert.equal($('#customDialogMessage').textContent, 'New saved job type');
  const f = (i) => $('#customDialogField' + i);
  assert.equal(f(1).type, 'number');
  assert.equal(f(2).type, 'number');
  const save = () => [...w.document.querySelectorAll('#customDialogButtons button')].find((b) => b.textContent === 'Save').click();
  save(); // no name
  assert.match($('#customDialogFieldsError').textContent, /Enter a name/);
  f(0).value = 'Drywall patch - small'; f(1).value = '-1'; save();
  assert.match($('#customDialogFieldsError').textContent, /0 or more/);
  f(1).value = '1.5'; f(2).value = '90'; save();
  await p;

  const list = stored();
  assert.equal(list.length, 2);
  const n = list[1];
  assert.deepEqual(Object.keys(n).sort(), ['hours', 'id', 'label', 'rate']);
  assert.equal(typeof n.id, 'number');
  assert.ok(n.id >= before);
  assert.deepEqual({ label: n.label, hours: n.hours, rate: n.rate }, { label: 'Drywall patch - small', hours: 1.5, rate: 90 });
  assert.deepEqual(list[0], { id: 1, label: 'Dishwasher install', hours: 2, rate: 85 }, 'existing entries untouched');
  assert.equal(out.syncs, 1);
  assert.match($('#quotePriceRefSelect').textContent, /Drywall patch - small \(1\.5hr @ \$90\/hr\)/);
  assert.match($('#invoicePriceRefSelect').textContent, /Drywall patch - small/);
  assert.equal(w.document.querySelectorAll('#quotePriceRefManager .price-ref-chip').length, 2);
  // ... and the picker adds it as a labor line, the same way it always did.
  $('#quotePriceRefSelect').value = '1';
  w.addLineItemFromPriceRef('quotePriceRefSelect', 'addQuoteLineItem');
  assert.deepEqual(out.added[0], ['Drywall patch - small', '', 1.5, 90, true, 'labor', true]);
});

test('item 11 follow-up: Cancel on the new-job-type dialog saves nothing', async () => {
  const { w, out, stored, $ } = loadPriceRefManager({});
  const p = w.createPriceReference();
  await tick(0);
  $('#customDialogField0').value = 'Never saved';
  $('#customDialogCancelAction').click();
  await p;
  assert.deepEqual(stored(), []);
  assert.equal(out.syncs, 0);
});

// Confirms the pending showConfirm() dialog (corrections pack, 2026-11-01:
// deletePriceReference() now asks first) -- showConfirm opens the overlay
// and its buttons synchronously before returning its pending Promise, so
// the danger button is already there to click right after tap() returns.
const confirmDeleteDialog = (w) => w.document.querySelector('#customDialogButtons .dialog-btn-danger').click();

test('item 11 follow-up: delete (x) asks first, then removes it everywhere, tombstones it for sync and keeps it in the deleted-items graveyard, like Cost Lookup did', async () => {
  const seed = [{ id: 1, label: 'Dishwasher install', hours: 2, rate: 85 }, { id: 1790000000000, label: 'Disposal swap', hours: 1, rate: 90 }];
  const { w, out, stored, $, tap } = loadPriceRefManager({ th_price_reference: seed });
  w.togglePriceRefManager('quotePriceRefManager', $('#quotePriceRefManageToggle'));
  let p = tap('#quotePriceRefManager .price-ref-chip[data-price-ref-id="1790000000000"] .chip-remove');
  confirmDeleteDialog(w);
  await p;
  assert.deepEqual(stored(), [seed[0]]);
  assert.ok(out.syncs >= 1, 'queued for sync (the tombstone and graveyard writes queue their own too)');
  assert.doesNotMatch($('#quotePriceRefSelect').textContent, /Disposal swap/);
  assert.doesNotMatch($('#invoicePriceRefManager').textContent + $('#quotePriceRefManager').textContent, /Disposal swap/);
  const tomb = JSON.parse(w.localStorage.getItem('th_price_ref_tombstones'));
  assert.equal(tomb.length, 1);
  assert.equal(tomb[0].id, 1790000000000, 'tombstoned with the record\'s own (numeric) id, which sync matches on');
  const grave = JSON.parse(w.localStorage.getItem('th_graveyard'));
  assert.equal(grave[0].recordType, 'priceReference');
  assert.deepEqual(grave[0].record, seed[1]);
  // Last one gone: the picker hides again, the manage link stays.
  p = tap('#quotePriceRefManager .price-ref-chip .chip-remove');
  confirmDeleteDialog(w);
  await p;
  assert.deepEqual(stored(), []);
  assert.equal($('#quotePriceRefRow').style.display, 'none');
  assert.ok($('#quotePriceRefManageToggle'));
  assert.match($('#quotePriceRefManager .price-ref-list').textContent, /No saved job types yet/);
});

test('item 11 follow-up: Cancel on the delete confirm leaves the saved job type untouched', async () => {
  const seed = [{ id: 1, label: 'Dishwasher install', hours: 2, rate: 85 }];
  const { w, out, stored, $, tap } = loadPriceRefManager({ th_price_reference: seed });
  w.togglePriceRefManager('quotePriceRefManager', $('#quotePriceRefManageToggle'));
  const p = tap('#quotePriceRefManager .price-ref-chip[data-price-ref-id="1"] .chip-remove');
  w.document.querySelector('#customDialogButtons .dialog-btn-cancel').click();
  await p;
  assert.deepEqual(stored(), seed);
  assert.equal(out.syncs, 0);
  assert.equal(w.localStorage.getItem('th_price_ref_tombstones'), null);
});

test('item 11 follow-up: a saved label is escaped in the manage list (no markup injection)', () => {
  const { w, $ } = loadPriceRefManager({ th_price_reference: [{ id: 5, label: '<img src=x onerror=alert(1)>', hours: 1, rate: 1 }] });
  w.togglePriceRefManager('quotePriceRefManager', $('#quotePriceRefManageToggle'));
  assert.equal(w.document.querySelectorAll('#quotePriceRefManager img').length, 0);
  assert.match($('#quotePriceRefManager .price-ref-chip').textContent, /<img src=x/);
});
