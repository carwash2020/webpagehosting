// Screenshot + chrome-audit harness for Workspace Phase 3 (the money pages:
// invoice-generator.html and finance.html). Dev-only; nothing loads this.
//
// Built on Phase 2's harness (docs/workspace-phase2-native-app-2026-10-30/
// harness/): the same stubs (every supabase.co request answered locally,
// an Owner role row), the same live-stub.js (required from there, not
// copied), the same 390x844 dark touch context and tap-target audit.
// Added for the money pages: seeded invoices (paid / unpaid / overdue /
// partial), quotes, income, expenses (incl. mileage) and inventory; an
// EMPTY=1 mode with no money data at all (empty states); and a sweep for
// horizontal overflow at 390 / 820 / 1280 in light and dark.
//
//   python3 -m http.server 8543            (from the repo root)
//   SUPABASE_UMD=/path/to/supabase.js node docs/workspace-phase3-money-2026-10-30/harness/shoot.js http://localhost:8543 /tmp/shots
//   EMPTY=1 ... (same) /tmp/shots-empty
//
// Needs Playwright (not a dependency of this repo): npm i -g playwright, or
// PLAYWRIGHT=/path/to/node_modules/playwright.
//
// REAL_FONTS=1 (review round 2, 2026-10-31): answer the page's Google Fonts
// request with the repo's own copies (fonts/pdf/: Anton, Archivo 400/600,
// Oswald) instead of blocking it, so shots show the real type, not the
// metric-matched fallbacks. Fallback digits are shorter than Anton's, which
// made the keypad and the Quick charge amount look lower than they are.
// Newsreader has no local copy and still falls back. Round 2 also shoots
// Finance's tabs scrolled to the end and the New invoice captions.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');
const { installLiveStub } = require('../../workspace-phase2-native-app-2026-10-30/harness/live-stub');

const base = process.argv[2];
const REAL_FONTS = !!process.env.REAL_FONTS;
const FONT_DIR = path.join(__dirname, '../../../fonts/pdf/');
const FONT_FILES = { 'anton.ttf': 'Anton-Regular.ttf', 'archivo4.ttf': 'Archivo-Regular.ttf', 'archivo6.ttf': 'Archivo-SemiBold.ttf', 'oswald.ttf': 'Oswald-Medium.ttf' };
const FONT_CSS = "@font-face{font-family:'Anton';src:url(https://fonts.gstatic.com/th/anton.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:100 500;src:url(https://fonts.gstatic.com/th/archivo4.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:501 900;src:url(https://fonts.gstatic.com/th/archivo6.ttf)}" +
  "@font-face{font-family:'Oswald';font-weight:100 900;src:url(https://fonts.gstatic.com/th/oswald.ttf)}";
const out = process.argv[3];
const EMPTY = !!process.env.EMPTY;
fs.mkdirSync(out, { recursive: true });

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const now = Date.now();

const jobs = [
  { id: 101, title: 'Dryer not heating', client: 'Maria Lopez', phone: '435-555-0101', address: '123 Red Cliffs Dr, St. George, UT', priority: 'high', date: addDays(-1), status: 'done', hoursWorked: 1.5 },
  { id: 104, title: 'Fridge ice maker', client: 'Greg Hall', phone: '435-555-0104', address: '410 Telegraph St, Washington, UT', priority: 'medium', date: addDays(-20), status: 'done', hoursWorked: 2 },
  { id: 105, title: 'Washer drain pump', client: 'Ana Smith', phone: '435-555-0105', address: '77 Dixie Dr, St. George, UT', priority: 'high', date: addDays(3), status: 'not-started' },
];
const items = (d, amt) => [{ description: d, qty: 1, rate: amt, amount: amt }];
const invoices = EMPTY ? [] : [
  { id: now - 1000, invoiceNumber: 'INV-1046', clientName: 'Maria Lopez', clientEmail: 'maria@example.com', total: 312.5, subtotal: 290, tax: 22.5, date: addDays(-1), terms: 'Net 15', paid: false, jobRefId: '101', lineItems: items('Dryer thermal fuse + labor', 290) },
  { id: now - 2000, invoiceNumber: 'INV-1045', clientName: 'Preferred Property Management', clientEmail: 'ops@example.com', total: 1180, subtotal: 1100, tax: 80, date: addDays(-40), terms: 'Net 15', paid: false, lineItems: items('Unit turn: 4 appliances', 1100) },
  { id: now - 3000, invoiceNumber: 'INV-1044', clientName: 'Greg Hall', total: 285, subtotal: 265, tax: 20, date: addDays(-20), terms: 'Net 30', paid: true, paidAmount: 285, lineItems: items('Ice maker valve', 265) },
  { id: now - 4000, invoiceNumber: 'INV-1043', clientName: 'Kim Reyes', total: 640, subtotal: 600, tax: 40, date: addDays(-5), terms: 'Net 30', paid: false, paidAmount: 200, lineItems: items('Shelves + TV mount', 600) },
];
// The same invoices as the relational table returns them (snake_case).
const invoiceRows = invoices.map((i) => ({ id: i.id, invoice_number: i.invoiceNumber, client_name: i.clientName, client_email: i.clientEmail || null, invoice_date: i.date, terms: i.terms, invoice_type: 'standard', subtotal: i.subtotal, tax: i.tax, discount: 0, total: i.total, paid: !!i.paid, paid_amount: i.paidAmount ?? null, job_id: i.jobRefId || null, job_ref_title: null, source_quote_id: null, generated_by: null }));
const quotes = EMPTY ? [] : [
  { id: now - 1500, quoteNumber: 'Q-2031', clientName: 'Ana Smith', clientEmail: 'ana@example.com', date: addDays(-2), subtotal: 410, tax: 0, discount: 0, total: 410, jobRefId: '105', status: 'sent' },
  { id: now - 2500, quoteNumber: 'Q-2030', clientName: 'Tom Ruiz', date: addDays(-9), subtotal: 185, tax: 0, discount: 0, total: 185 },
];
const income = EMPTY ? [] : [
  { id: now - 100, date: addDays(-20), desc: 'INV-1044 Greg Hall', amount: 285, source: 'Greg Hall', origin: 'invoice', invoiceId: now - 3000 },
  { id: now - 200, date: addDays(-3), desc: 'Cash job, garbage disposal', amount: 150, source: 'Tom Ruiz', origin: 'manual' },
];
const expenses = EMPTY ? [] : [
  { id: now - 10, date: addDays(-1), type: 'expense', desc: 'Thermal fuse', vendor: 'Reliable Parts', payment: 'card', amount: 18.42, miles: 0, jobRefId: '101', jobRefTitle: 'Dryer not heating', receiptPath: '', partNumber: '3392519' },
  { id: now - 20, date: addDays(-4), type: 'expense', desc: 'Drain pump', vendor: 'Amazon', payment: 'card', amount: 46.9, miles: 0, jobRefId: '105', jobRefTitle: 'Washer drain pump', receiptPath: '', partNumber: '' },
  { id: now - 30, date: addDays(-2), type: 'mileage', desc: 'Washington + Ivins', vendor: '', payment: '', amount: 26.13, miles: 39, jobRefId: '', jobRefTitle: '', receiptPath: '', partNumber: '' },
  { id: now - 40, date: addDays(-6), type: 'expense', desc: 'Wire nuts, tape', vendor: 'Home Depot', payment: 'card', amount: 12.07, miles: 0, jobRefId: '', jobRefTitle: '', receiptPath: '', partNumber: '' },
];
const inventory = EMPTY ? [] : [
  { id: now - 5, name: 'Dryer thermal fuse', partNumber: '3392519', qty: 3, cost: 9.5, location: 'Van bin 2' },
  { id: now - 6, name: 'Washer door boot', partNumber: '', qty: 1, cost: 38, location: 'Shelf' },
];

function fakeJwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b({ alg: 'HS256' }) + '.' + b({ aal: 'aal2', email: 'connor@triplehenterprisesllc.biz', exp: 9999999999 }) + '.sig';
}
const roleRow = [{ email: 'connor@triplehenterprisesllc.biz', role_name: 'Owner', can_manage_roles: true, can_access_dev_tools: true, can_access_dev_tools_full: true, can_manage_site_content: true, can_manage_invoices: true, can_manage_contracts: true, can_view_finance: true, can_view_runway: true, can_manage_reviews: true }];

// Same audit as Phase 2's shoot.js (kept verbatim so the numbers compare).
const TARGET_AUDIT = () => {
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [onclick], summary, label[for]';
  const bad = [];
  const seen = new Set();
  document.querySelectorAll(sel).forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (el.closest('[hidden], [aria-hidden="true"]')) return;
    let p = el; let hiddenAnc = false;
    while (p && p !== document.body) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) { hiddenAnc = true; break; } p = p.parentElement; }
    if (hiddenAnc) return;
    if (r.width <= 1 || r.height <= 1) return;
    const inlineProse = cs.display === 'inline' && el.tagName === 'A' && el.parentElement && /^(P|LI|SPAN|SMALL|DIV)$/.test(el.parentElement.tagName) && (el.parentElement.textContent || '').trim().length > (el.textContent || '').trim().length + 20;
    if (r.width < 44 || r.height < 44) {
      const id = el.id ? '#' + el.id : '';
      const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      const txt = (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const anc = []; let q = el.parentElement;
      while (q && q !== document.body && anc.length < 4) { if (q.id || (typeof q.className === 'string' && q.className)) anc.push(q.id ? '#' + q.id : '.' + q.className.trim().split(/\s+/)[0]); q = q.parentElement; }
      bad.push({ tag: el.tagName.toLowerCase() + id + cls, w: Math.round(r.width), h: Math.round(r.height), txt, inlineProse, type: el.type || '', anc: anc.join(' < ') });
    }
  });
  return bad;
};

// Phase 3: the chrome checklist, measured. Header rows and buttons, the
// Money segmented control (width vs. its container, segment widths), any
// visible text drawn in all caps by CSS (the casing rule), the status dot,
// and the shared sync banner.
const CHROME_AUDIT = () => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const hdr = document.querySelector('.hub-header');
  const hr = hdr && hdr.getBoundingClientRect();
  const title = document.querySelector('.hub-header .hub-title');
  const btns = hdr ? [...hdr.querySelectorAll('a, button')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }) : [];
  const seg = document.getElementById('moneySeg');
  let segInfo = null;
  if (seg && vis(seg)) {
    const sr = seg.getBoundingClientRect();
    const parent = seg.parentElement; const ps = getComputedStyle(parent);
    const inner = parent.getBoundingClientRect().width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
    const card = document.querySelector('.fin-spent, #invoiceSummary, .inv-summary, .form-section');
    segInfo = { w: Math.round(sr.width), h: Math.round(sr.height), parentInner: Math.round(inner), cardW: card && vis(card) ? Math.round(card.getBoundingClientRect().width) : null,
      segs: [...seg.children].filter(vis).map((c) => ({ t: c.textContent.trim(), w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) })) };
  }
  const caps = [];
  document.querySelectorAll('h1,h2,h3,h4,button,a,.tab-btn,label,summary,th,.th-chip,[class*="title"],[class*="label"]').forEach((el) => {
    if (!vis(el) || el.closest('.th-bottom-nav, .th-desktop-sidebar, [hidden]')) return;
    const s = getComputedStyle(el);
    if (s.textTransform !== 'uppercase') return;
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!t) return;
    caps.push({ tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''), t: t.slice(0, 30), fs: s.fontSize });
  });
  const dot = document.getElementById('realtimeDot');
  const note = document.getElementById('thSyncNote') || document.getElementById('syncStatusText');
  return {
    header: hdr && { h: Math.round(hr.height), top: Math.round(hr.top), title: title && { text: title.textContent.trim(), clipped: title.scrollWidth > title.clientWidth, w: Math.round(title.getBoundingClientRect().width) }, btns },
    seg: segInfo,
    caps: caps.slice(0, 40),
    dot: dot ? { cls: dot.className, inHeader: !!dot.closest('.hub-header'), bg: getComputedStyle(dot).backgroundColor } : null,
    syncNote: note ? { id: note.id, shown: vis(note) } : null,
  };
};

const OVERFLOW = () => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth });

const STATES = [
  { name: 'invoices', url: '/tools/invoice-generator.html' },
  { name: 'new-invoice', url: '/tools/invoice-generator.html#invoice' },
  { name: 'new-quote', url: '/tools/invoice-generator.html#quote' },
  { name: 'quick-charge', url: '/tools/invoice-generator.html#pos' },
  { name: 'finance', url: '/tools/finance.html#cost' },
  { name: 'finance-income', url: '/tools/finance.html#income' },
  { name: 'finance-expenses', url: '/tools/finance.html#expenses' },
  { name: 'finance-profit', url: '/tools/finance.html#profitability' },
  { name: 'finance-inventory', url: '/tools/finance.html#inventory' },
];

async function newCtx(browser, { width, height, theme, touch }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: touch ? 2 : 1, colorScheme: theme, isMobile: !!touch, hasTouch: !!touch, serviceWorkers: 'block' });
  await ctx.addInitScript(({ seed, jwt, theme }) => {
    try {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      const sess = { access_token: jwt, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400, email: 'connor@triplehenterprisesllc.biz', remember_until: Date.now() + 864e5 };
      localStorage.setItem('th_auth_session', JSON.stringify(sess));
      Object.keys(seed).forEach((k) => localStorage.setItem(k, JSON.stringify(seed[k])));
      localStorage.setItem('th_tools_theme', theme);
      localStorage.setItem('th_onboarding_v1_seen_connor@triplehenterprisesllc.biz', '1');
      localStorage.setItem('th_onboarding_v1_seen', '1');
      sessionStorage.setItem('th_mfa_nag_dismissed', '1');
      localStorage.setItem('th_onboarding_dismissed', '1');
      localStorage.setItem('th_install_dismissed', String(Date.now()));
    } catch (e) { /* ignore */ }
  }, { seed: { th_tracker_jobs: jobs, th_invoices: invoices, th_quotes: quotes, th_income_log: income, th_expense_log: expenses, th_inventory: inventory }, jwt: fakeJwt(), theme });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (REAL_FONTS && /fonts\.googleapis\.com\/css/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', headers: { 'access-control-allow-origin': '*' }, body: FONT_CSS });
    if (REAL_FONTS && /fonts\.gstatic\.com\/th\//.test(u)) return route.fulfill({ status: 200, contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(FONT_DIR + FONT_FILES[u.split('/').pop()]) });
    if (/supabase\.co/.test(u)) {
      if (/account_roles/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roleRow) });
      if (/rpc\/internal_mfa_session_status/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"blocked":false}' });
      // The invoice list reads the relational `invoices` table first
      // (sync.js getInvoicesForRead); answer it with the seeded rows.
      if (/\/rest\/v1\/invoices\?/.test(u) && route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invoiceRows) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.abort();
  });
  await installLiveStub(ctx);
  return ctx;
}

async function open(ctx, url) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelectorAll('.th-install-banner, .th-update-card, .onboarding-card, .th-tour, .th-tour-card').forEach((e) => e.remove()); });
  return { page, errs };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const report = { empty: EMPTY, states: {}, overflow: {} };
  const suffix = EMPTY ? '-empty' : '';

  // 390x844 dark, touch: the review shots + audits.
  const ctx = await newCtx(browser, { width: 390, height: 844, theme: 'dark', touch: true });
  for (const s of STATES) {
    const { page, errs } = await open(ctx, s.url);
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    if (!coarse) throw new Error('pointer: coarse not emulated');
    const bad = await page.evaluate(TARGET_AUDIT);
    const chrome = await page.evaluate(CHROME_AUDIT);
    await page.screenshot({ path: path.join(out, s.name + suffix + '-390-dark.png') });
    await page.screenshot({ path: path.join(out, s.name + suffix + '-390-dark-full.png'), fullPage: true });
    report.states[s.name] = { chrome, bad, errs };
    await page.close();
  }
  // Sync trouble on both pages, through the shell's own status event.
  for (const [name, url] of [['invoices', '/tools/invoice-generator.html'], ['finance', '/tools/finance.html#cost']]) {
    const { page } = await open(ctx, url);
    await page.evaluate(() => { localStorage.setItem('th_sync_last', JSON.stringify({ ok: false, type: 'push', error: 'http-503', time: Date.now() })); window.dispatchEvent(new CustomEvent('th-sync-status')); });
    await page.waitForTimeout(300);
    report.states[name].trouble = await page.evaluate(CHROME_AUDIT);
    await page.screenshot({ path: path.join(out, name + suffix + '-sync-trouble-390-dark.png') });
    await page.evaluate(() => { localStorage.setItem('th_sync_last', JSON.stringify({ ok: true, type: 'push', error: null, time: Date.now() })); window.dispatchEvent(new CustomEvent('th-sync-status')); });
    await page.close();
  }
  // Round 2: Finance's tab track scrolled to its end (the fade, Inventory
  // clear of it), and the New invoice fields with their captions.
  if (!EMPTY) {
    let { page } = await open(ctx, '/tools/finance.html#cost');
    await page.evaluate(() => { const t = document.querySelector('.tabs.tabs-sticky'); window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 300); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, 'finance-tabs-390-dark.png') });
    await page.evaluate(() => { document.querySelector('.tabs.tabs-sticky').scrollLeft = 99999; });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, 'finance-tabs-end-390-dark.png') });
    await page.close();
    ({ page } = await open(ctx, '/tools/invoice-generator.html#invoice'));
    await page.evaluate(() => { const e = document.getElementById('clientEmail'); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 360); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, 'new-invoice-fields-390-dark.png') });
    await page.close();
  }
  await ctx.close();

  // No horizontal scroll: 390 / 820 / 1280, light and dark.
  for (const theme of ['dark', 'light']) {
    for (const [w, h] of [[390, 844], [820, 1180], [1280, 800]]) {
      const c = await newCtx(browser, { width: w, height: h, theme, touch: w < 1024 });
      for (const s of STATES) {
        const { page, errs } = await open(c, s.url);
        const o = await page.evaluate(OVERFLOW);
        report.overflow[s.name + '@' + w + '-' + theme] = { over: o.scrollW - o.clientW, errs: errs.length };
        if (w !== 390 && (s.name === 'invoices' || s.name === 'finance')) await page.screenshot({ path: path.join(out, s.name + suffix + '-' + w + '-' + theme + '.png') });
        await page.close();
      }
      await c.close();
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
