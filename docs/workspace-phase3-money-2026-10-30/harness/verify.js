// Behaviour checks for Workspace Phase 3 (Invoices + Finance), same stubs
// as shoot.js and Phase 2's verify.js. Two kinds of output:
//   PASS/FAIL lines -- every action on the two pages still does what it
//     did (Money switch, tiles, chips, search, the row sheet, Mark paid,
//     Delete's confirm, the builders' add-row buttons, the keypad, Log
//     expense / Log income, Add entry, Add part, the tabs), plus the
//     Phase 3 chrome (one-row header, equal segments, the status dot and
//     banner on Finance, sticky tabs under the header, empty states).
//   One FINGERPRINT line -- the money numbers the pages compute (builder
//     subtotal/tax/total, quote totals, summary tiles, Cost lookup results,
//     the keypad amount, the Spent total, rows per filter). Run it against
//     main and against the branch: the two lines must be identical. This
//     PR is chrome only, so any difference there is a regression.
//
//   SUPABASE_UMD=/path/to/supabase.js node docs/workspace-phase3-money-2026-10-30/harness/verify.js http://localhost:8543
// (Without SUPABASE_UMD the "healthy" check expects grey, not green.)
// CHROME_CHECKS=0 skips the chrome checks (for the run against main).
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { installLiveStub } = require('../../workspace-phase2-native-app-2026-10-30/harness/live-stub');

const base = process.argv[2];
const CHROME = process.env.CHROME_CHECKS !== '0';
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const invoices = [
  { id: 9001, invoiceNumber: 'INV-1046', clientName: 'Maria Lopez', clientEmail: 'maria@example.com', total: 312.5, subtotal: 290, tax: 22.5, date: day(-1), terms: 'Net 15', paid: false, jobRefId: '101', lineItems: [] },
  { id: 9002, invoiceNumber: 'INV-1045', clientName: 'Preferred Property Management', total: 1180, subtotal: 1100, tax: 80, date: day(-40), terms: 'Net 15', paid: false, lineItems: [] },
  { id: 9003, invoiceNumber: 'INV-1044', clientName: 'Greg Hall', total: 285, subtotal: 265, tax: 20, date: day(-20), terms: 'Net 30', paid: true, paidAmount: 285, lineItems: [] },
  { id: 9004, invoiceNumber: 'INV-1043', clientName: 'Kim Reyes', total: 640, subtotal: 600, tax: 40, date: day(-5), terms: 'Net 30', paid: false, paidAmount: 200, lineItems: [] },
];
const rows = invoices.map((i) => ({ id: i.id, invoice_number: i.invoiceNumber, client_name: i.clientName, client_email: i.clientEmail || null, invoice_date: i.date, terms: i.terms, invoice_type: 'standard', subtotal: i.subtotal, tax: i.tax, discount: 0, total: i.total, paid: !!i.paid, paid_amount: i.paidAmount ?? null, job_id: i.jobRefId || null }));
const seed = {
  th_tracker_jobs: [{ id: 101, title: 'Dryer not heating', client: 'Maria Lopez', date: day(-1), status: 'done', priority: 'high' }],
  th_invoices: invoices,
  th_quotes: [{ id: 9101, quoteNumber: 'Q-2031', clientName: 'Ana Smith', date: day(-2), subtotal: 410, tax: 0, discount: 0, total: 410 }],
  th_income_log: [{ id: 9201, date: day(-3), desc: 'Cash job', amount: 150, source: 'Tom Ruiz', origin: 'manual' }],
  th_expense_log: [
    { id: 9301, date: day(0), type: 'expense', desc: 'Thermal fuse', vendor: 'Reliable Parts', payment: 'card', amount: 18.42, miles: 0, jobRefId: '', receiptPath: '' },
    { id: 9302, date: day(0), type: 'mileage', desc: 'Ivins', vendor: '', payment: '', amount: 26.13, miles: 39, jobRefId: '', receiptPath: '' }],
  th_inventory: [{ id: 9401, name: 'Dryer thermal fuse', qty: 3, cost: 9.5 }],
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark', serviceWorkers: 'block' });
  await ctx.addInitScript((seed) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1');
    const e = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    localStorage.setItem('th_auth_session', JSON.stringify({ access_token: e({ a: 1 }) + '.' + e({ aal: 'aal2' }) + '.s', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400, email: 'connor@triplehenterprisesllc.biz' }));
    localStorage.setItem('th_onboarding_v1_seen_connor@triplehenterprisesllc.biz', '1');
    sessionStorage.setItem('th_mfa_nag_dismissed', '1');
    Object.keys(seed).forEach((k) => localStorage.setItem(k, JSON.stringify(seed[k])));
  }, seed);
  let emptyRelational = false;
  await ctx.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith(base)) return r.continue();
    if (/supabase\.co/.test(u)) {
      if (/account_roles/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '[{"email":"connor@triplehenterprisesllc.biz","role_name":"Owner","can_manage_invoices":true,"can_view_finance":true}]' });
      if (/\/rest\/v1\/invoices\?/.test(u) && r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: emptyRelational ? '[]' : JSON.stringify(rows) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return r.abort();
  });
  const live = await installLiveStub(ctx);
  const results = [];
  const fp = {};
  const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + JSON.stringify(extra) : ''));
  const chrome = (name, cond, extra) => { if (CHROME) ok(name, cond, extra); };
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  const go = async (url) => { await p.goto(base + url, { waitUntil: 'load' }); await p.waitForTimeout(3000); await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelectorAll('.th-page-tip, .th-install-banner, .th-update-card').forEach((x) => x.remove()); }); };
  const sheetRows = () => p.evaluate(() => [...document.querySelectorAll('.quick-actions-sheet .quick-actions-btn:not(.quick-actions-cancel)')].map((x) => x.textContent.trim()));
  const closeSheet = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); await p.evaluate(() => document.querySelectorAll('.quick-actions-overlay').forEach((o) => o.remove())); };
  const listed = () => p.evaluate(() => [...document.querySelectorAll('#invoiceLogList [data-invoice-id]')].map((x) => x.dataset.invoiceId).join(','));

  // ================= Invoices =================
  await go('/tools/invoice-generator.html');
  const hdr = await p.evaluate(() => { const h = document.querySelector('.hub-header').getBoundingClientRect(); const bt = [...document.querySelectorAll('.hub-header .th-hdr-actions > *')].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().top)); const t = document.querySelector('.hub-header .hub-title'); return { h: Math.round(h.height), top: Math.round(h.top), bt, title: t.textContent.trim(), tt: getComputedStyle(t).textTransform }; });
  chrome('invoices: header is one row at the top (<=64px, buttons on the title row), title "Invoices" not upper-cased', hdr.h <= 64 && hdr.top === 0 && hdr.bt.length === 3 && hdr.bt.every((t) => t < 20) && hdr.title === 'Invoices' && hdr.tt === 'none', hdr);
  const seg = await p.evaluate(() => { const s = document.getElementById('moneySeg'); const w = [...s.children].map((c) => Math.round(c.getBoundingClientRect().width)); return { w: Math.round(s.getBoundingClientRect().width), segs: w, tt: [...s.children].map((c) => getComputedStyle(c).textTransform) }; });
  chrome('invoices: Money switch spans 366px, three equal segments, sentence case', seg.w === 366 && new Set(seg.segs).size === 1 && seg.tt.every((t) => t === 'none'), seg);
  fp.tiles = await p.evaluate(() => [...document.querySelectorAll('#invoiceSummary .inv-stat')].map((x) => x.querySelector('.inv-stat-value').textContent + '/' + x.querySelector('.inv-stat-sub').textContent));
  fp.listAll = await listed();
  // Tiles + chips + search filter the list
  await p.click('#invoiceSummary .inv-stat.is-owed'); await p.waitForTimeout(300);
  fp.listOwedTile = await listed();
  ok('invoices: Owed tile filters to unpaid', fp.listOwedTile.split(',').length === 3 && await p.evaluate(() => localStorage.getItem('th_invoice_filter') === 'unpaid'), fp.listOwedTile);
  await p.click('#invoiceSummary .inv-stat.is-owed'); await p.waitForTimeout(300);
  await p.click('#invoiceFilters .th-chip[data-filter="paid"]'); await p.waitForTimeout(300);
  fp.listPaid = await listed();
  ok('invoices: Paid chip shows only the paid invoice', fp.listPaid === '9003', fp.listPaid);
  await p.click('#invoiceFilters .th-chip[data-filter="overdue"]'); await p.waitForTimeout(300);
  fp.listOverdue = await listed();
  await p.click('#invoiceFilters .th-chip[data-filter="all"]'); await p.waitForTimeout(300);
  await p.fill('#invoiceLogSearch', 'greg'); await p.waitForTimeout(700);
  fp.listSearch = await listed();
  ok('invoices: search narrows to Greg Hall', fp.listSearch === '9003', fp.listSearch);
  const chipsWhileMiss = await (async () => { await p.fill('#invoiceLogSearch', 'zzzz'); await p.waitForTimeout(700); return p.evaluate(() => !!document.getElementById('invoiceLogSearch').offsetParent && !!document.querySelector('#invoiceFilters').offsetParent); })();
  ok('invoices: a search with no matches keeps search + chips (so it can be cleared)', chipsWhileMiss);
  await p.fill('#invoiceLogSearch', ''); await p.waitForTimeout(700);
  const chipH = await p.evaluate(() => [...document.querySelectorAll('#invoiceFilters .th-chip')].map((c) => { const r = c.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }));
  chrome('invoices: filter chips and Compact view are >=44px', chipH.every((x) => x >= 44) && await p.evaluate(() => document.querySelector('[data-density-toggle]').getBoundingClientRect().height >= 44), chipH);
  // Row sheet + Mark paid + Delete's confirm
  await p.evaluate(() => document.querySelector('[data-invoice-id="9001"] .th-row-link').scrollIntoView({ block: 'center' }));
  await p.click('[data-invoice-id="9001"] .th-row-link'); await p.waitForTimeout(500);
  fp.sheet = await sheetRows();
  ok('invoices: row sheet lists View / Mark paid / reminder / Resend / Open job / Delete', fp.sheet.length >= 5 && /View invoice/.test(fp.sheet[0]) && /Mark Paid/i.test(fp.sheet[1]) && fp.sheet.some((x) => /Resend/.test(x)) && fp.sheet.some((x) => /^Delete$/.test(x)), fp.sheet);
  await p.click('.quick-actions-sheet .quick-actions-btn >> nth=1'); await p.waitForTimeout(700);
  const paid = await p.evaluate(() => JSON.parse(localStorage.getItem('th_invoices')).find((i) => i.id === 9001));
  ok('invoices: Mark paid (from the sheet) records it paid in full', paid.paid === true && paid.paidAmount === 312.5, { paid: paid.paid, paidAmount: paid.paidAmount });
  await closeSheet();
  await p.click('[data-invoice-id="9001"] .th-row-link'); await p.waitForTimeout(500);
  await p.click('.quick-actions-sheet .quick-actions-btn >> nth=1'); await p.waitForTimeout(700);
  ok('invoices: Mark unpaid flips it back', await p.evaluate(() => JSON.parse(localStorage.getItem('th_invoices')).find((i) => i.id === 9001).paidAmount === 0));
  await closeSheet();
  await p.click('[data-invoice-id="9002"] .th-row-link'); await p.waitForTimeout(500);
  await p.click('.quick-actions-sheet .quick-actions-btn:has-text("Delete")'); await p.waitForTimeout(500);
  // showConfirm (tools-dialogs.js): its Cancel is #customDialogCancelAction.
  const conf = await p.evaluate(() => { const c = document.getElementById('customDialogCancelAction'); const asked = !!c && /Delete this invoice/.test(document.body.textContent); if (c) c.click(); return asked; });
  await p.waitForTimeout(500);
  ok('invoices: Delete still asks first; Cancel keeps the invoice', conf && await p.evaluate(() => JSON.parse(localStorage.getItem('th_invoices')).some((i) => i.id === 9002)));
  await closeSheet();
  // Builders
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('.inv-log-head .mn-new-btn'); await p.waitForTimeout(500);
  const tabs = await p.evaluate(() => { const t = document.querySelector('.tabs'); const v = [...t.querySelectorAll('.tab-btn')].filter((x) => x.offsetParent); return { active: document.getElementById('tab-invoice').classList.contains('is-active'), w: Math.round(t.getBoundingClientRect().width), segs: v.map((x) => Math.round(x.getBoundingClientRect().width)), seg: document.querySelector('#moneySeg .is-active').dataset.moneySeg }; });
  ok('builder: + New invoice opens the invoice builder (Invoices segment stays lit)', tabs.active && tabs.seg === 'invoices', tabs);
  chrome('builder: New invoice | New quote strip spans 366px, equal halves', tabs.w === 366 && tabs.segs.length === 2 && tabs.segs[0] === tabs.segs[1], tabs);
  const n0 = await p.evaluate(() => document.querySelectorAll('#lineItemsBody tr').length);
  await p.click('#tab-invoice .add-row-btn:has-text("+ Add line item")'); await p.waitForTimeout(200);
  await p.click('#tab-invoice .add-row-btn:has-text("+ Add labor")'); await p.waitForTimeout(200);
  await p.click('#tab-invoice .add-row-btn:has-text("mileage")'); await p.waitForTimeout(200);
  const n1 = await p.evaluate(() => document.querySelectorAll('#lineItemsBody tr').length);
  ok('builder: + Add line item / labor / mileage each add a row', n1 === n0 + 3, { n0, n1 });
  await p.evaluate(() => { document.querySelectorAll('#lineItemsBody tr').forEach((tr, i) => { const q = tr.querySelector('.li-qty'); const pr = tr.querySelector('.li-price'); if (q) { q.value = String(i + 2); q.dispatchEvent(new Event('input', { bubbles: true })); } if (pr) { pr.value = String(37.5 * (i + 1)); pr.dispatchEvent(new Event('input', { bubbles: true })); } }); });
  await p.waitForTimeout(300);
  fp.invoiceTotals = await p.evaluate(() => ['subtotalDisplay', 'taxDisplay', 'totalDisplay'].map((id) => document.getElementById(id).textContent.trim()));
  const liH = await p.evaluate(() => [...document.querySelectorAll('#lineItemsBody input:not([type=checkbox]), #lineItemsBody select')].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().height)));
  chrome('builder: line-item fields are >=44px tall', liH.length > 0 && liH.every((h) => h >= 44), liH.slice(0, 6));
  await p.click('.tabs .tab-btn[data-tab="quote"]'); await p.waitForTimeout(400);
  await p.click('#tab-quote .add-row-btn:has-text("+ Add line item")'); await p.waitForTimeout(200);
  await p.evaluate(() => { const tr = document.querySelector('#quoteLineItemsBody tr:last-child'); tr.querySelector('.qli-qty').value = '3'; tr.querySelector('.qli-price').value = '64.99'; tr.querySelectorAll('input').forEach((x) => x.dispatchEvent(new Event('input', { bubbles: true }))); });
  await p.waitForTimeout(300);
  fp.quoteTotals = await p.evaluate(() => ['quoteSubtotalDisplay', 'quoteTaxDisplay', 'quoteTotalDisplay'].map((id) => document.getElementById(id).textContent.trim()));
  ok('builder: quote PDF button still calls generateQuotePDF()', await p.evaluate(() => { const b = [...document.querySelectorAll('#tab-quote button')].find((x) => /estimate PDF/i.test(x.textContent)); return !!b && b.getAttribute('onclick') === 'generateQuotePDF()'; }));
  // Quick charge
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('#moneySeg [data-money-seg="pos"]'); await p.waitForTimeout(400);
  ok('quick charge: the segment opens Quick charge and lights it', await p.evaluate(() => document.getElementById('tab-pos').classList.contains('is-active') && document.querySelector('#moneySeg [data-money-seg="pos"]').classList.contains('is-active')));
  for (const k of ['4', '2', '.', '5']) await p.click('#posKeypad button:text-is("' + k + '")');
  fp.keypad = await p.evaluate(() => document.getElementById('posAmount').value);
  ok('quick charge: keypad types the amount', fp.keypad === '42.5', fp.keypad);
  await p.click('#moneySeg [data-money-seg="invoices"]'); await p.waitForTimeout(400);
  ok('invoices: the Invoices segment returns to the list', await p.evaluate(() => document.getElementById('tab-recent').classList.contains('is-active')));
  ok('invoices: Finance segment links to finance.html', await p.evaluate(() => document.querySelector('#moneySeg [data-money-seg="finance"]').getAttribute('href') === '/tools/finance.html'));

  // ================= Finance =================
  await go('/tools/finance.html#cost');
  const fh = await p.evaluate(() => { const h = document.querySelector('.hub-header').getBoundingClientRect(); const t = document.querySelector('.hub-header .hub-title'); return { h: Math.round(h.height), top: Math.round(h.top), title: t.textContent.trim(), tt: getComputedStyle(t).textTransform, intro: getComputedStyle(document.querySelector('.hub-header ~ p.tool-sub')).display }; });
  chrome('finance: header is one row at the top, "Finance" sentence case, intro hidden on a phone', fh.h <= 64 && fh.top === 0 && fh.title === 'Finance' && fh.tt === 'none' && fh.intro === 'none', fh);
  fp.cost = await p.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }; set('hours', '2.5'); set('rate', '85'); set('parts', '42.10'); return ['laborResult', 'partsResult', 'subtotalResult', 'taxResult', 'standardResult', 'discountedResult'].map((id) => (document.getElementById(id) || {}).textContent); });
  fp.spent = await p.evaluate(() => document.getElementById('finSpentTotal').textContent + ' ' + document.getElementById('finSpentMonth').textContent);
  // The status dot and banner (the shared component)
  const RED = await p.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--status-error)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  const GREEN = await p.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--status-live)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  const dotState = () => p.evaluate(() => { const dot = document.getElementById('realtimeDot'); const note = document.getElementById('thSyncNote'); const r = dot.getBoundingClientRect(); return { bg: getComputedStyle(dot).backgroundColor, w: Math.round(r.width), inHdr: !!dot.closest('.hub-header .th-status'), banner: !!(note && note.classList.contains('is-issue') && note.offsetHeight > 0), text: note ? note.textContent : null }; });
  const setSync = (v) => p.evaluate((v) => { localStorage.setItem('th_sync_last', JSON.stringify(Object.assign({ type: 'push', time: new Date().toISOString() }, v))); window.dispatchEvent(new CustomEvent('th-sync-status')); }, v);
  if (CHROME) {
    let st = await dotState();
    ok('finance: status dot in the header, 10px round, ' + (live ? 'green' : 'not red') + ' when healthy, no banner', st.inHdr && st.w === 10 && (live ? st.bg === GREEN : st.bg !== RED) && !st.banner, st);
    await p.evaluate(() => updateRealtimeBadge('CHANNEL_ERROR'));
    st = await dotState();
    ok('finance: live updates dropped alone -> grey, no banner', st.bg !== RED && st.bg !== GREEN && !st.banner, st);
    await setSync({ ok: false, error: 'http-503' });
    st = await dotState();
    ok('finance: backup failed -> red dot AND the shared banner, plain words', st.bg === RED && st.banner && /Couldn't back up/.test(st.text) && !/503/.test(st.text), st);
    const retried = await p.evaluate(async () => { let n = 0; const o = window.pushSync; window.pushSync = () => { n++; return Promise.resolve({ ok: true }); }; document.getElementById('realtimeBadge').click(); await new Promise((r) => setTimeout(r, 50)); window.pushSync = o; return n; });
    ok('finance: tapping the red dot retries the backup', retried === 1, { retried });
    await setSync({ ok: true, error: null });
    st = await dotState();
    ok('finance: recovered -> red and banner clear', st.bg !== RED && !st.banner, st);
  }
  // Sticky tabs sit right under the header
  const stick = await p.evaluate(async () => { window.scrollTo(0, 1400); await new Promise((r) => setTimeout(r, 150)); const t = document.querySelector('.tabs.tabs-sticky').getBoundingClientRect(); const h = document.querySelector('.hub-header').getBoundingClientRect(); window.scrollTo(0, 0); return { tabsTop: Math.round(t.top), hdrBottom: Math.round(h.bottom) }; });
  chrome('finance: sticky tabs land on the header\'s bottom edge when scrolled', Math.abs(stick.tabsTop - stick.hdrBottom) <= 1, stick);
  await p.click('.tab-btn[data-tab="profitability"]'); await p.waitForTimeout(400);
  ok('finance: tabs switch (Profitability)', await p.evaluate(() => document.getElementById('tab-profitability').classList.contains('is-active')));
  // Log expense / Log income
  await p.evaluate(() => window.scrollTo(0, 0));
  const pair = await p.evaluate(() => [...document.querySelectorAll('.fin-spent-actions > button')].map((x) => { const s = getComputedStyle(x); const r = x.getBoundingClientRect(); return { h: Math.round(r.height), top: Math.round(r.top), ff: s.fontFamily, fs: s.fontSize, fw: s.fontWeight, ls: s.letterSpacing, sh: s.boxShadow }; }));
  chrome('finance: Log expense / Log income match (48px, same top and type, no lip)', pair.length === 2 && pair.every((x) => x.h === 48 && x.sh === 'none') && pair[0].top === pair[1].top && pair[0].ff === pair[1].ff && pair[0].fs === pair[1].fs && pair[0].fw === pair[1].fw && pair[0].ls === pair[1].ls, pair);
  await p.click('.fin-spent-actions .primary-btn'); await p.waitForTimeout(600);
  ok('finance: Log expense opens Expenses with its add form', await p.evaluate(() => document.getElementById('tab-expenses').classList.contains('is-active') && !!document.getElementById('entryDate').offsetParent));
  await closeSheet(); await p.evaluate(() => { if (typeof closeAllSheets === 'function') closeAllSheets(); window.scrollTo(0, 0); }); await p.waitForTimeout(400);
  await p.click('.fin-spent-actions .secondary-btn'); await p.waitForTimeout(600);
  ok('finance: Log income opens Income with its add form', await p.evaluate(() => document.getElementById('tab-income').classList.contains('is-active') && !!document.getElementById('incomeAmount').offsetParent));
  const before = await p.evaluate(() => JSON.parse(localStorage.getItem('th_income_log')).length);
  await p.evaluate(() => { const d = new Date().toISOString().slice(0, 10); document.getElementById('incomeDate').value = d; document.getElementById('incomeDesc').value = 'Verify cash job'; document.getElementById('incomeAmount').value = '120'; });
  await p.evaluate(() => document.getElementById('addIncomeEntryBtn').click()); await p.waitForTimeout(800);
  const inc = await p.evaluate(() => JSON.parse(localStorage.getItem('th_income_log')));
  ok('finance: Add entry saves an income entry', inc.length === before + 1 && inc.some((e) => e.desc === 'Verify cash job' && e.amount === 120), { before, after: inc.length });
  chrome('finance: income button reads "Add entry" (sentence case) again after saving', await p.evaluate(() => document.getElementById('addIncomeEntryBtn').textContent === 'Add entry'));
  await closeSheet(); await p.evaluate(() => { if (typeof closeAllSheets === 'function') closeAllSheets(); });
  await p.goto(base + '/tools/finance.html#inventory'); await p.waitForTimeout(2500);
  const invBefore = await p.evaluate(() => JSON.parse(localStorage.getItem('th_inventory') || '[]').length);
  await p.evaluate(() => { document.getElementById('invPartName').value = 'Verify part'; document.getElementById('invQty').value = '2'; document.getElementById('addInventoryBtn').click(); });
  await p.waitForTimeout(600);
  ok('finance: Add part saves an inventory item', await p.evaluate((n) => JSON.parse(localStorage.getItem('th_inventory')).length === n + 1, invBefore));
  const delW = await p.evaluate(() => [...document.querySelectorAll('#tab-inventory .small-btn.danger')].filter((x) => x.offsetParent).map((x) => Math.round(x.getBoundingClientRect().width)));
  chrome('finance: inventory Delete buttons >=44px wide', delW.length > 0 && delW.every((w) => w >= 44), delW);

  // ================= Empty states =================
  await p.evaluate(() => { ['th_invoices', 'th_quotes', 'th_expense_log'].forEach((k) => localStorage.setItem(k, '[]')); localStorage.removeItem('th_invoice_filter'); });
  emptyRelational = true;
  await go('/tools/invoice-generator.html');
  const ei = await p.evaluate(() => ({ msg: !!document.querySelector('#invoiceLogList .inv-empty'), search: !!document.getElementById('invoiceLogSearch').offsetParent, chips: !!document.getElementById('invoiceFilters').offsetParent, compact: !!document.querySelector('[data-density-toggle]').offsetParent, newBtns: [...document.querySelectorAll('#tab-recent button')].filter((x) => x.offsetParent && /New invoice/.test(x.textContent)).length, qSearch: !!document.getElementById('quoteLogSearch').offsetParent }));
  chrome('empty: no invoices -> one message, one New invoice, no dead search/chips/Compact view; no quote search', ei.msg && !ei.search && !ei.chips && !ei.compact && ei.newBtns === 1 && !ei.qSearch, ei);
  await p.click('#invoiceLogList .inv-empty .primary-btn'); await p.waitForTimeout(400);
  ok('empty: its New invoice opens the builder', await p.evaluate(() => document.getElementById('tab-invoice').classList.contains('is-active')));
  await go('/tools/finance.html#cost');
  const ef = await p.evaluate(() => ({ total: getComputedStyle(document.getElementById('finSpentTotal')).display, bar: getComputedStyle(document.getElementById('finSpentBar')).display, month: getComputedStyle(document.getElementById('finSpentMonth')).display, msg: (document.querySelector('.fin-spent-empty') || {}).textContent }));
  chrome('empty: Spent this month shows its "Nothing logged" line, no $0 / empty bar / 0 entries', ef.total === 'none' && ef.bar === 'none' && ef.month === 'none' && /Nothing logged/.test(ef.msg || ''), ef);

  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  console.log(results.join('\n'));
  console.log('FINGERPRINT ' + JSON.stringify(fp));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
