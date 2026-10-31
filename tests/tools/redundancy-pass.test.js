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
