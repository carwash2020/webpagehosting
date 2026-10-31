// Screenshot + chrome-audit harness for Workspace Phase 4 (Clients, Client
// detail and every remaining tool page). Dev-only; nothing loads this.
//
// Built on Phase 2's and Phase 3's harnesses (docs/workspace-phase2-native-
// app-2026-10-30/harness/, docs/workspace-phase3-money-2026-10-30/harness/):
// the same stubs (every supabase.co request answered locally, an Owner role
// row, a fake aal2 session), the same live-stub.js (required from Phase 2,
// not copied), the same 390x844 dark touch context, the same tap-target
// audit, Phase 3's REAL_FONTS mode and its overflow sweep at 390 / 820 /
// 1280 in light and dark. EMPTY=1 seeds no clients/jobs/invoices/quotes/
// contracts (the empty states).
//
//   python3 -m http.server 8544            (from the repo root)
//   SUPABASE_UMD=/path/to/supabase.js REAL_FONTS=1 \
//     node docs/workspace-phase4-clients-and-rest-2026-10-31/harness/shoot.js http://localhost:8544 /tmp/shots
//
// Needs Playwright (not a dependency of this repo): PLAYWRIGHT=/path/to/
// node_modules/playwright if it isn't resolvable.
//
// The report's `fingerprint` is the Phase 3 money fingerprint adapted to
// these pages: per state, every id / onclick / href / data-tab in the DOM
// (the wiring), plus every number shown in the page's data regions (client
// totals, stats, Runway figures, stop counts). verify.js compares it with
// the one shot on main: chrome-only work must leave it unchanged.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');
const { installLiveStub } = require('../../workspace-phase2-native-app-2026-10-30/harness/live-stub');

let base = process.argv[2];
const JSPDF_UMD = process.env.JSPDF_UMD; // optional: npm pack jspdf@2.5.1, dist/jspdf.umd.min.js (same bytes, SRI passes)
const out = process.argv[3];
const REAL_FONTS = !!process.env.REAL_FONTS;
const EMPTY = !!process.env.EMPTY;
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const FONT_DIR = path.join(__dirname, '../../../fonts/pdf/');
const FONT_FILES = { 'anton.ttf': 'Anton-Regular.ttf', 'archivo4.ttf': 'Archivo-Regular.ttf', 'archivo6.ttf': 'Archivo-SemiBold.ttf', 'oswald.ttf': 'Oswald-Medium.ttf' };
const FONT_CSS = "@font-face{font-family:'Anton';src:url(https://fonts.gstatic.com/th/anton.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:100 500;src:url(https://fonts.gstatic.com/th/archivo4.ttf)}" +
  "@font-face{font-family:'Archivo';font-weight:501 900;src:url(https://fonts.gstatic.com/th/archivo6.ttf)}" +
  "@font-face{font-family:'Oswald';font-weight:100 900;src:url(https://fonts.gstatic.com/th/oswald.ttf)}";
if (out && require.main === module) fs.mkdirSync(out, { recursive: true });

// ---- Seed data -----------------------------------------------------------
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };
const now = Date.now();
const clients = EMPTY ? [] : [
  { id: 'c_maria', name: 'Maria Lopez', phone: '435-555-0101', email: 'maria@example.com', address: '123 Red Cliffs Dr, St. George, UT', createdAt: addDays(-200) + 'T10:00:00Z', source: 'created' },
  { id: 'c_greg', name: 'Greg Hall', phone: '435-555-0104', email: '', address: '410 Telegraph St, Washington, UT', createdAt: addDays(-90) + 'T10:00:00Z', source: 'created' },
  { id: 'c_ppm', name: 'Preferred Property Management', phone: '435-555-0190', email: 'ops@example.com', address: '1 Bluff St, St. George, UT', createdAt: addDays(-300) + 'T10:00:00Z', source: 'created' },
  // Review round (Connor #4): a genuinely long name with an overdue balance,
  // so the row has the name, the due chip, Call and the menu all at once.
  { id: 'c_long', name: 'Red Cliffs Senior Living Community Association', phone: '435-555-0142', email: 'office@example.com', address: '900 S Bluff St, St. George, UT', createdAt: addDays(-150) + 'T10:00:00Z', source: 'created' },
  { id: 'c_lead', name: 'Dana Whitfield', phone: '435-555-0177', email: '', address: '', createdAt: addDays(-2) + 'T10:00:00Z', source: 'created' },
];
const jobs = EMPTY ? [] : [
  { id: 101, title: 'Dryer not heating', client: 'Maria Lopez', phone: '435-555-0101', address: '123 Red Cliffs Dr, St. George, UT', priority: 'high', date: addDays(-1), status: 'done', hoursWorked: 1.5 },
  { id: 104, title: 'Fridge ice maker', client: 'Greg Hall', phone: '435-555-0104', address: '410 Telegraph St, Washington, UT', priority: 'medium', date: addDays(-20), status: 'done', hoursWorked: 2 },
  { id: 105, title: 'Washer drain pump', client: 'Maria Lopez', phone: '435-555-0101', address: '123 Red Cliffs Dr, St. George, UT', priority: 'high', date: addDays(3), status: 'not-started' },
  { id: 106, title: 'Unit turn, 4 appliances', client: 'Preferred Property Management', phone: '435-555-0190', address: '1 Bluff St, St. George, UT', priority: 'low', date: addDays(0), status: 'in-progress' },
];
const items = (d, amt) => [{ description: d, qty: 1, rate: amt, amount: amt }];
const invoices = EMPTY ? [] : [
  { id: now - 1000, invoiceNumber: 'INV-1046', clientName: 'Maria Lopez', clientEmail: 'maria@example.com', total: 312.5, subtotal: 290, tax: 22.5, date: addDays(-1), terms: 'Net 15', paid: false, jobRefId: '101', lineItems: items('Dryer thermal fuse + labor', 290) },
  { id: now - 2000, invoiceNumber: 'INV-1045', clientName: 'Preferred Property Management', clientEmail: 'ops@example.com', total: 1180, subtotal: 1100, tax: 80, date: addDays(-40), terms: 'Net 15', paid: false, lineItems: items('Unit turn: 4 appliances', 1100) },
  { id: now - 2500, invoiceNumber: 'INV-1043', clientName: 'Red Cliffs Senior Living Community Association', clientEmail: 'office@example.com', total: 2465, subtotal: 2300, tax: 165, date: addDays(-35), terms: 'Net 15', paid: false, lineItems: items('Laundry room: 3 commercial dryers', 2300) },
  { id: now - 3000, invoiceNumber: 'INV-1044', clientName: 'Greg Hall', total: 285, subtotal: 265, tax: 20, date: addDays(-20), terms: 'Net 30', paid: true, paidAmount: 285, lineItems: items('Ice maker valve', 265) },
];
const quotes = EMPTY ? [] : [
  { id: now - 1500, quoteNumber: 'Q-2031', clientName: 'Maria Lopez', clientEmail: 'maria@example.com', date: addDays(-2), subtotal: 410, tax: 0, discount: 0, total: 410, jobRefId: '105', status: 'sent' },
];
const contracts = EMPTY ? [] : [
  { id: now - 700, type: 'pwo', createdAt: addDays(-3) + 'T10:00:00Z', fields: { clientName: 'Maria Lopez', clientEmail: 'maria@example.com', jobDescription: 'Washer drain pump', price: '410' }, status: 'signed' },
];
const reviewLog = EMPTY ? [] : [{ id: now - 50, clientName: 'Greg Hall', phone: '435-555-0104', jobTitle: 'Fridge ice maker', sentAt: new Date(now - 5 * 864e5).toISOString(), status: 'sent' }];

function fakeJwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b({ alg: 'HS256' }) + '.' + b({ aal: 'aal2', email: 'connor@triplehenterprisesllc.biz', exp: 9999999999 }) + '.sig';
}
const roleRow = [{ email: 'connor@triplehenterprisesllc.biz', role_name: 'Owner', can_manage_roles: true, can_access_dev_tools: true, can_access_dev_tools_full: true, can_manage_site_content: true, can_manage_invoices: true, can_manage_contracts: true, can_view_finance: true, can_view_runway: true, can_manage_reviews: true }];
const SEED = { th_clients: clients, th_tracker_jobs: jobs, th_invoices: invoices, th_quotes: quotes, th_contracts: contracts, th_review_requests_log: reviewLog };

// ---- Audits (Phase 2/3's, kept verbatim where they overlap) --------------
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

// The chrome checklist, measured: the header (rows, top, height, title
// clipping, its buttons), every segmented control / tab track on screen
// (width vs. its container, segment widths), every chip, any visible text
// drawn in all caps by CSS, primary buttons' lip/weight, the status dot and
// the shared sync banner, and zero-looking placeholder text.
const CHROME_AUDIT = () => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const hdr = document.querySelector('.hub-header');
  const hr = hdr && hdr.getBoundingClientRect();
  const title = document.querySelector('.hub-header .hub-title');
  const btns = hdr ? [...hdr.querySelectorAll('a, button')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }) : [];
  const segs = [...document.querySelectorAll('.tabs, .th-v2-seg, .dev-tabs, [role="tablist"]')].filter(vis).filter((s, i, a) => !a.some((o) => o !== s && o.contains(s))).map((seg) => {
    const sr = seg.getBoundingClientRect();
    const parent = seg.parentElement; const ps = getComputedStyle(parent);
    const inner = parent.getBoundingClientRect().width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
    return { cls: seg.className, w: Math.round(sr.width), parentInner: Math.round(inner), scrolls: seg.scrollWidth > seg.clientWidth + 1,
      segs: [...seg.children].filter(vis).map((c) => ({ t: c.textContent.trim().replace(/\s+/g, ' ').slice(0, 24), w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height), tt: getComputedStyle(c).textTransform })) };
  });
  const chips = [...document.querySelectorAll('.th-chip, .th-v2-chip, .sort-btn, .chip, [class*="-chip"]')].filter(vis).filter((c) => c.matches('button, a, [role="button"], [onclick]')).slice(0, 12).map((c) => { const s = getComputedStyle(c); const r = c.getBoundingClientRect(); return { t: c.textContent.trim().replace(/\s+/g, ' ').slice(0, 20), cls: c.className, h: Math.round(r.height), font: s.fontFamily.split(',')[0] + ' ' + s.fontSize + '/' + s.fontWeight, pad: s.paddingLeft, radius: s.borderTopLeftRadius, bg: s.backgroundColor, tt: s.textTransform }; });
  const caps = [];
  document.querySelectorAll('h1,h2,h3,h4,button,a,.tab-btn,label,summary,th,.th-chip,[class*="title"],[class*="label"],[class*="kicker"],[class*="head"]').forEach((el) => {
    if (!vis(el) || el.closest('.th-bottom-nav, .th-desktop-sidebar, [hidden]')) return;
    const s = getComputedStyle(el);
    if (s.textTransform !== 'uppercase') return;
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (!t) return;
    caps.push({ tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''), t: t.slice(0, 30), fs: s.fontSize });
  });
  const prim = [...document.querySelectorAll('.primary-btn, .btn-primary, button.primary')].filter(vis).map((b) => { const s = getComputedStyle(b); return { t: b.textContent.trim().replace(/\s+/g, ' ').slice(0, 24), shadow: s.boxShadow, weight: s.fontWeight, border: s.borderTopWidth, tt: s.textTransform }; });
  const dot = document.getElementById('realtimeDot');
  const note = document.getElementById('thSyncNote') || document.getElementById('syncStatusText');
  const zeroText = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) { const t = n.textContent.trim(); if (/\$0(\.00)? (of|\/) \$0|\b0 of 0\b|NaN|undefined|\bnull\b|Infinity/.test(t) && n.parentElement && vis(n.parentElement)) zeroText.push(t.slice(0, 60)); }
  return {
    header: hdr && { h: Math.round(hr.height), top: Math.round(hr.top), bodyPadTop: getComputedStyle(document.body).paddingTop, title: title && { text: title.textContent.trim().slice(0, 40), clipped: title.scrollWidth > title.clientWidth + 1, w: Math.round(title.getBoundingClientRect().width) }, btns, rows: [...new Set(btns.map((b) => b.top))].length },
    segs, chips, caps: caps.slice(0, 60), prim,
    dot: dot ? { cls: dot.className, inHeader: !!dot.closest('.hub-header'), bg: getComputedStyle(dot).backgroundColor, trouble: !!dot.closest('.th-status.is-trouble') } : null,
    syncNote: note ? { id: note.id, shown: vis(note), text: note.textContent.trim().slice(0, 80) } : null,
    zeroText: zeroText.slice(0, 10),
  };
};

// The wiring + data fingerprint (see the header comment).
const FINGERPRINT = () => {
  const wiring = [...document.querySelectorAll('[id], [onclick], a[href], [data-tab]')]
    .filter((el) => !el.closest('.th-bottom-nav, .th-desktop-sidebar, .th-more-sheet, .th-create-sheet, svg, #thSyncNote, .th-toast, .th-sheet-root'))
    .map((el) => [el.tagName.toLowerCase(), el.id || '', el.getAttribute('onclick') || '', el.tagName === 'A' ? (el.getAttribute('href') || '').replace(/^sms:\?body=.*/, 'sms:?body=<random message>') : '', el.getAttribute('data-tab') || ''].join('|'));
  const nums = [];
  document.querySelectorAll('main, #mainContent, .container, body').forEach(() => {});
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) {
    const p = n.parentElement; if (!p || p.closest('script, style, .th-bottom-nav, .th-desktop-sidebar, .hub-header, .th-toast, [class*="preview"], [id*="Preview"], [class*="bubble"]')) continue;
    // Clock times, ages and latencies change from one load to the next
    // (Dev Tools' checks, the message preview's time); they aren't data.
    if (/\d{1,2}:\d{2}|\d\s?ms\b|\bago\b|\bsec(ond)?s?\b|\bmin(ute)?s?\b/i.test(p.textContent)) continue;
    const m = n.textContent.match(/\$?-?\d[\d,]*(\.\d+)?%?/g); if (m) nums.push(...m.filter((x) => !/^\d{4}$/.test(x)));
  }
  return { wiring: wiring.sort(), nums };
};

const OVERFLOW = () => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth });

// ---- States --------------------------------------------------------------
const STATES = [
  { name: 'clients', url: '/tools/clients.html' },
  { name: 'clients-portal', url: '/tools/clients.html', click: '.tabs [data-tab="portal"]' },
  { name: 'client-detail', url: '/tools/client-detail.html?id=c_maria' },
  { name: 'client-detail-lead', url: '/tools/client-detail.html?id=c_lead' },
  { name: 'contract-generator', url: '/tools/contract-generator.html' },
  { name: 'route-planner', url: '/tools/route-planner.html' },
  { name: 'review-request', url: '/tools/review-request.html' },
  { name: 'review-request-google', url: '/tools/review-request.html', click: '.tabs [data-tab="google"]' },
  { name: 'parts-reference', url: '/tools/parts-reference.html' },
  { name: 'runway-dashboard', url: '/tools/runway-dashboard.html' },
  { name: 'settings', url: '/tools/settings.html' },
  { name: 'site-content', url: '/tools/site-content.html' },
  { name: 'dev-tools', url: '/tools/dev-tools.html' },
  { name: 'dev-tools-sync', url: '/tools/dev-tools.html', click: '[data-tab="sync"]' },
  { name: 'login', url: '/tools/login.html', noSession: true },
  { name: 'reset-password', url: '/tools/reset-password.html', noSession: true },
].filter((s) => !ONLY || ONLY.includes(s.name));
const TROUBLE_PAGES = ['clients', 'client-detail', 'contract-generator', 'route-planner', 'review-request', 'parts-reference', 'runway-dashboard'];

async function newCtx(browser, { width, height, theme, touch, noSession }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: touch ? 2 : 1, colorScheme: theme, isMobile: !!touch, hasTouch: !!touch, serviceWorkers: 'block' });
  await ctx.addInitScript(({ seed, jwt, theme, noSession }) => {
    try {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      if (!noSession) {
        const sess = { access_token: jwt, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400, email: 'connor@triplehenterprisesllc.biz', remember_until: Date.now() + 864e5 };
        localStorage.setItem('th_auth_session', JSON.stringify(sess));
        localStorage.setItem('th_sync_code', 'HARNESS');
      }
      Object.keys(seed).forEach((k) => localStorage.setItem(k, JSON.stringify(seed[k])));
      localStorage.setItem('th_tools_theme', theme);
      localStorage.setItem('th_onboarding_v1_seen_connor@triplehenterprisesllc.biz', '1');
      localStorage.setItem('th_onboarding_v1_seen', '1');
      sessionStorage.setItem('th_mfa_nag_dismissed', '1');
      localStorage.setItem('th_onboarding_dismissed', '1');
      localStorage.setItem('th_install_dismissed', String(Date.now()));
    } catch (e) { /* ignore */ }
  }, { seed: SEED, jwt: fakeJwt(), theme, noSession: !!noSession });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (JSPDF_UMD && /cdn\.jsdelivr\.net\/npm\/jspdf@2\.5\.1\/dist\/jspdf\.umd\.min\.js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(JSPDF_UMD) });
    if (REAL_FONTS && /fonts\.googleapis\.com\/css/.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', headers: { 'access-control-allow-origin': '*' }, body: FONT_CSS });
    if (REAL_FONTS && /fonts\.gstatic\.com\/th\//.test(u)) return route.fulfill({ status: 200, contentType: 'font/ttf', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(FONT_DIR + FONT_FILES[u.split('/').pop()]) });
    if (/supabase\.co/.test(u)) {
      if (/account_roles/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roleRow) });
      if (/rpc\/internal_mfa_session_status/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"blocked":false}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.abort();
  });
  await installLiveStub(ctx);
  return ctx;
}

async function open(ctx, s) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + s.url, { waitUntil: 'load' });
  await page.waitForTimeout(2800);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelectorAll('.th-install-banner, .th-update-card, .onboarding-card, .th-tour, .th-tour-card').forEach((e) => e.remove()); });
  if (s.click) { await page.click(s.click); await page.waitForTimeout(600); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150); }
  return { page, errs };
}

module.exports = { setBase: (b) => { base = b; }, newCtx, open, STATES, TROUBLE_PAGES, CHROME_AUDIT, TARGET_AUDIT, FINGERPRINT, OVERFLOW, SEED };

if (require.main === module) (async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const report = { empty: EMPTY, realFonts: REAL_FONTS, states: {}, overflow: {}, fingerprint: {} };
  const suffix = EMPTY ? '-empty' : '';

  // 390x844 dark, touch: the review shots + audits.
  for (const noSession of [false, true]) {
    const ctx = await newCtx(browser, { width: 390, height: 844, theme: 'dark', touch: true, noSession });
    for (const s of STATES.filter((x) => !!x.noSession === noSession)) {
      const { page, errs } = await open(ctx, s);
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      if (!coarse) throw new Error('pointer: coarse not emulated');
      const bad = await page.evaluate(TARGET_AUDIT);
      const chrome = await page.evaluate(CHROME_AUDIT);
      report.fingerprint[s.name] = await page.evaluate(FINGERPRINT);
      await page.screenshot({ path: path.join(out, s.name + suffix + '-390-dark.png') });
      await page.screenshot({ path: path.join(out, s.name + suffix + '-390-dark-full.png'), fullPage: true });
      report.states[s.name] = { url: page.url(), chrome, bad, errs };
      await page.close();
    }
    await ctx.close();
  }
  // Sync trouble on every page that saves synced data, through the shell's
  // own status event (the same signal the dot and banner read).
  const tctx = await newCtx(browser, { width: 390, height: 844, theme: 'dark', touch: true });
  for (const name of TROUBLE_PAGES) {
    const s = STATES.find((x) => x.name === name); if (!s) continue;
    const { page } = await open(tctx, s);
    await page.evaluate(() => { localStorage.setItem('th_sync_last', JSON.stringify({ ok: false, type: 'push', error: 'http-503', time: Date.now() })); window.dispatchEvent(new CustomEvent('th-sync-status')); });
    await page.waitForTimeout(300);
    report.states[name].trouble = await page.evaluate(CHROME_AUDIT);
    await page.screenshot({ path: path.join(out, name + suffix + '-sync-trouble-390-dark.png') });
    await page.evaluate(() => { localStorage.setItem('th_sync_last', JSON.stringify({ ok: true, type: 'push', error: null, time: Date.now() })); window.dispatchEvent(new CustomEvent('th-sync-status')); });
    await page.waitForTimeout(150);
    report.states[name].recovered = await page.evaluate(CHROME_AUDIT);
    await page.close();
  }
  await tctx.close();

  // No horizontal scroll: 390 / 820 / 1280, light and dark.
  if (!process.env.SKIP_OVERFLOW) {
    for (const theme of ['dark', 'light']) {
      for (const [w, h] of [[390, 844], [820, 1180], [1280, 800]]) {
        for (const noSession of [false, true]) {
          const c = await newCtx(browser, { width: w, height: h, theme, touch: w < 1024, noSession });
          for (const s of STATES.filter((x) => !!x.noSession === noSession)) {
            const { page, errs } = await open(c, s);
            const o = await page.evaluate(OVERFLOW);
            report.overflow[s.name + '@' + w + '-' + theme] = { over: o.scrollW - o.clientW, errs: errs.length };
            if (w !== 390 && ['clients', 'client-detail', 'settings', 'dev-tools'].includes(s.name)) await page.screenshot({ path: path.join(out, s.name + suffix + '-' + w + '-' + theme + '.png') });
            await page.close();
          }
          await c.close();
        }
      }
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
