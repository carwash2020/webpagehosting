// Behaviour + chrome checks for Workspace Phase 4. Dev-only.
//
//   node verify.js http://localhost:8544 http://localhost:8545
//     (this branch, then main served from a second checkout)
//
// Env as shoot.js (PLAYWRIGHT, SUPABASE_UMD, REAL_FONTS) plus JSPDF_UMD, so
// Contracts' Generate builds a real PDF with the page's own pinned jsPDF.
//
// Two halves:
//  1. FLOWS: each page's real actions, driven through the real UI and the
//     real dialogs (add a client, delete + undo, add stops and pull today's
//     jobs, generate a contract PDF, open a review text, switch every Dev
//     Tools / Runway tab, the theme switch, a site-content edit to the
//     review overlay, a sign-in attempt, the reset page with no token).
//     Each writes a trace: what the page did, what it stored, what it
//     downloaded. The traces are run on BOTH bases and must be identical:
//     chrome-only work changes none of them.
//  2. CHECKS (this branch): the Phase 2/3 checklist, measured.
// The FINGERPRINT (shoot.js: every id / onclick / href / data-tab, and
// every number shown) is compared too; the only allowed differences are
// listed in ALLOWED_WIRING below, each a deliberate chrome change.
const H = require('./shoot.js');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const BRANCH = process.argv[2];
const MAIN = process.argv[3];
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
const st = (name) => Object.assign({}, H.STATES.find((x) => x.name === name));

async function dialogClick(page, label) {
  await page.waitForSelector('#customDialogButtons button', { state: 'visible', timeout: 4000 });
  await page.click('#customDialogButtons button:text-is("' + label + '")');
  await page.waitForTimeout(400);
}
const ls = (page, k) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return localStorage.getItem(k); } }, k);

// ---- 1. Flows -----------------------------------------------------------
async function flows(browser, base) {
  H.setBase(base);
  const T = {};
  const ctx = await H.newCtx(browser, { width: 390, height: 844, theme: 'dark', touch: true });
  let page;

  // Clients: add a client through the Add sheet; lands on their detail page.
  ({ page } = await H.open(ctx, st('clients')));
  await page.click('.cd-add-btn');
  await page.fill('#customDialogField0', 'Harness Person');
  await page.fill('#customDialogField1', '435-555-0999');
  await dialogClick(page, 'Add client');
  await page.waitForURL(/client-detail\.html\?id=/, { timeout: 5000 });
  await page.waitForTimeout(1500);
  T.addClient = { url: page.url().replace(base, '').replace(/id=c_[^&]+/, 'id=<new>'), stored: (await ls(page, 'th_clients')).map((c) => [c.name, c.phone]).sort(), name: await page.textContent('.client-hero-name') };
  await page.close();
  // Clients: every filter chip and a search, the rows each shows.
  ({ page } = await H.open(ctx, st('clients')));
  T.filters = {};
  for (const f of ['recent', 'owes', 'az', 'leads']) {
    await page.click('#clientDirFilters [data-filter="' + f + '"]'); await page.waitForTimeout(200);
    T.filters[f] = await page.$$eval('#clientDirList .th-row-title, #clientDirList .cd-empty', (els) => els.map((e) => e.textContent.trim()));
  }
  await page.fill('#clientDirSearch', 'zzz'); await page.waitForTimeout(400);
  T.filters.miss = await page.$$eval('#clientDirList .cd-empty', (els) => els.map((e) => e.textContent.trim()));
  await page.click('.tabs [data-tab="portal"]'); await page.waitForTimeout(300);
  T.portalTab = { hash: new URL(page.url()).hash, panel: await page.$eval('#tab-portal', (e) => e.classList.contains('is-active')) };
  await page.close();

  // Client detail: delete (through the confirm) and Undo.
  ({ page } = await H.open(ctx, st('client-detail-lead')));
  await page.click('#deleteClientBtn');
  await dialogClick(page, 'Delete client');
  T.deleteClient = { stored: (await ls(page, 'th_clients')).map((c) => c.id).sort(), deletedShown: await page.isVisible('#clientDeletedState') };
  await page.click('#undoDeleteClientBtn'); await page.waitForTimeout(1200);
  T.undoClient = { stored: (await ls(page, 'th_clients')).map((c) => c.id).sort() };
  await page.close();
  ({ page } = await H.open(ctx, st('client-detail')));
  T.clientLinks = await page.$$eval('.client-hero a, .client-whats-next a', (as) => as.map((a) => a.textContent.trim() + ' -> ' + a.getAttribute('href')));
  await page.close();

  // Route planner: type two stops, add a stop, pull today's jobs; the Maps link.
  ({ page } = await H.open(ctx, st('route-planner')));
  const inputs = await page.$$('#stopsContainer input');
  await inputs[0].fill('123 Red Cliffs Dr, St. George, UT'); await inputs[1].fill('410 Telegraph St, Washington, UT');
  await page.waitForTimeout(400);
  await page.click('.add-stop-btn'); await page.waitForTimeout(200);
  const afterAdd = await page.$$eval('#stopsContainer input', (i) => i.map((x) => x.value));
  await page.click('button[onclick="pullTodaysJobs()"]'); await page.waitForTimeout(1500);
  T.route = { afterAdd, afterPull: await page.$$eval('#stopsContainer input', (i) => i.map((x) => x.value)), href: await page.getAttribute('#openRouteBtn', 'href'), disabled: await page.$eval('#openRouteBtn', (a) => a.classList.contains('is-disabled')) };
  await page.close();

  // Contracts: generate a work order PDF; the download and the log entry.
  ({ page } = await H.open(ctx, st('contract-generator')));
  await page.fill('#pwo_clientName', 'Maria Lopez');
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.click('button[onclick="generateAndLog(\'pwo\')"]');
  const d = await dl; await page.waitForTimeout(800);
  T.contract = { download: d ? d.suggestedFilename().replace(/\d{4}-\d{2}-\d{2}/, '<date>') : null, log: (await ls(page, 'th_contracts') || []).map((c) => [c.type, c.fields && c.fields.clientName]) };
  for (const t of ['stpa', 'ltsa', 'pwo']) { await page.click('.contract-tab[data-tab="' + t + '"]'); await page.waitForTimeout(150); }
  T.contractTabs = await page.$$eval('.contract-tab', (ts) => ts.map((t) => t.dataset.tab + ':' + t.getAttribute('aria-selected')));
  await page.close();

  // Reviews: fill the phone, open the text; the sms link and the sent log.
  ({ page } = await H.open(ctx, st('review-request')));
  await page.fill('#custName', 'Ana');
  await page.fill('#custPhone', '4355550105');
  await page.waitForTimeout(300);
  const href = await page.getAttribute('#sendLink', 'href');
  await page.evaluate(() => { document.getElementById('sendLink').addEventListener('click', (e) => e.preventDefault(), { once: true }); });
  await page.click('#sendLink'); await page.waitForTimeout(500);
  T.review = { href: (href || '').replace(/body=.*/, 'body=<msg>'), log: (await ls(page, 'th_review_requests_log') || []).length };
  for (const t of ['google', 'yelp', 'send']) { await page.click('.tabs [data-tab="' + t + '"]'); await page.waitForTimeout(150); }
  T.reviewTabs = await page.$$eval('.tab-panel', (p) => p.map((x) => x.id + ':' + x.classList.contains('is-active')));
  await page.close();

  // Appliance Wiki: a search narrows the list.
  ({ page } = await H.open(ctx, st('parts-reference')));
  const before = await page.$$eval('#prUnitsList .pr-unit-card', (c) => c.length);
  await page.fill('#prSearchInput', 'whirlpool'); await page.waitForTimeout(500);
  T.wiki = { before, after: await page.$$eval('#prUnitsList .pr-unit-card', (c) => c.length) };
  await page.close();

  // Runway: every tab.
  ({ page } = await H.open(ctx, st('runway-dashboard')));
  T.runway = [];
  for (const t of ['business', 'networth', 'runway', 'personal']) { await page.click('.rw-tab-btn[data-tab="' + t + '"]'); await page.waitForTimeout(200); T.runway.push(t + ':' + (await page.$$eval('.panel.active, [id^="panel-"].active', (p) => p.map((x) => x.id).join(',')))); }
  await page.close();

  // Settings: the theme switch (and back); the 2FA section's controls.
  ({ page } = await H.open(ctx, st('settings')));
  const themeBtn = await page.$('#toolsThemeToggleBtn');
  T.settings = { mfaControls: await page.$$eval('#settingsMainView [onclick*="fa" i], #settingsMainView [onclick*="Mfa"], #settingsMainView [onclick*="Recovery"]', (b) => b.map((x) => x.getAttribute('onclick'))) };
  if (themeBtn) { await themeBtn.click(); await page.waitForTimeout(200); T.settings.themeAfter = await page.evaluate(() => localStorage.getItem('th_tools_theme')); await themeBtn.click(); await page.waitForTimeout(200); T.settings.themeBack = await page.evaluate(() => localStorage.getItem('th_tools_theme')); }
  await page.close();

  // Site Content: an edit counts as a draft; Publish opens the review.
  ({ page } = await H.open(ctx, st('site-content')));
  const field = page.locator('#siteContent_googleReviewCount');
  T.site = { field: await field.getAttribute('id') };
  await field.fill('123'); await page.waitForTimeout(400);
  T.site.kicker = await page.textContent('#scDraftKicker');
  await page.click('#scDraftPublishBtn').catch(() => {}); await page.waitForTimeout(500);
  T.site.reviewOpen = await page.isVisible('#cmsReviewOverlay').catch(() => null);
  await page.close();

  // Dev Tools: every tab, the panels it shows.
  ({ page } = await H.open(ctx, st('dev-tools')));
  T.dev = [];
  for (const t of ['data', 'sync', 'notifications', 'ops', 'reports', 'access', 'health']) {
    await page.click('#devTabBar [data-tab="' + t + '"]'); await page.waitForTimeout(250);
    T.dev.push(t + ':' + (await page.$$eval('.dev-panel', (ps) => ps.filter((p) => p.offsetParent !== null).length)));
  }
  await page.close();
  await ctx.close();

  // Sign-in (no session): a wrong password; reset password with no token.
  const lctx = await H.newCtx(browser, { width: 390, height: 844, theme: 'dark', touch: true, noSession: true });
  ({ page } = await H.open(lctx, st('login')));
  const authCalls = [];
  page.on('request', (r) => { if (/supabase\.co\/auth/.test(r.url())) authCalls.push(r.method() + ' ' + r.url().replace(/^https:\/\/[^/]+/, '').replace(/\?.*/, '')); });
  await page.fill('#loginEmail', 'connor@triplehenterprisesllc.biz');
  await page.fill('#loginPassword', 'wrong');
  await page.click('#loginBtn'); await page.waitForTimeout(1500);
  const vis = () => page.$$eval('#loginForm, [id$="Step"], [id$="Panel"]', (s) => s.filter((x) => x.offsetParent !== null).map((x) => x.id));
  T.login = { authCalls, btn: await page.textContent('#loginBtn'), err: (await page.textContent('#loginError')).trim(), visible: await vis() };
  await page.click('#forgotPasswordLink'); await page.waitForTimeout(300);
  T.login.afterForgot = await vis();
  await page.close();
  ({ page } = await H.open(lctx, st('reset-password')));
  T.reset = { title: await page.textContent('#resetTitle') };
  await page.close();
  await lctx.close();
  return T;
}

// ---- 2. Chrome checks (this branch) -----------------------------------------
const HUB = ['clients', 'client-detail', 'contract-generator', 'route-planner', 'review-request', 'parts-reference', 'settings', 'site-content', 'dev-tools'];
async function checks(browser) {
  H.setBase(BRANCH);
  const ctx = await H.newCtx(browser, { width: 390, height: 844, theme: 'dark', touch: true });
  for (const name of HUB.concat(['runway-dashboard'])) {
    const { page, errs } = await H.open(ctx, st(name));
    check(name + ': no page errors', !errs.length, errs.join(' | '));
    const h = await page.evaluate(() => {
      const hdr = document.querySelector('.hub-header, header#mainContent'); const r = hdr.getBoundingClientRect();
      const t = document.querySelector('.hub-header .hub-title, header#mainContent h1'); const tr = t.getBoundingClientRect();
      const btns = [...document.querySelectorAll('.th-hdr-actions .th-hdr-btn, .th-hdr-actions button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
      return { top: Math.round(r.top), h: Math.round(r.height), titleTop: Math.round(tr.top), titleBottom: Math.round(tr.bottom), btnTops: [...new Set(btns.map((b) => Math.round(b.top)))], btnBottom: Math.max(...btns.map((b) => b.bottom)), clipped: t.scrollWidth > t.clientWidth + 1 };
    });
    check(name + ': header is one row at the top (<= 70px, buttons on one line beside the title)', h.top <= 0 && h.h <= 70 && h.btnTops.length === 1 && h.titleTop < h.btnBottom && !h.clipped, JSON.stringify(h));
    const caps = await page.evaluate(() => [...document.querySelectorAll('button, a.primary-btn, a.secondary-btn, .tab-btn, .rw-tab-btn, .ct-type-label, .hub-title, header#mainContent h1')]
      .filter((el) => el.offsetParent && !el.closest('.th-bottom-nav, [hidden]') && getComputedStyle(el).textTransform === 'uppercase' && (el.textContent || '').trim())
      .map((el) => el.textContent.trim().slice(0, 20)));
    check(name + ': no title or control drawn in all caps', !caps.length, caps.join(' | '));
    // (Runway's dashed "+ Add" buttons are the add-row style, not a primary.)
    const lips = await page.evaluate(() => [...document.querySelectorAll('.primary-btn, button.action-btn')].filter((b) => b.offsetParent && getComputedStyle(b).borderTopStyle !== 'dashed').filter((b) => { const s = getComputedStyle(b); return s.boxShadow !== 'none' || +s.fontWeight > 400; }).map((b) => b.textContent.trim().slice(0, 20)));
    check(name + ': every primary is flat, weight 400', !lips.length, lips.join(' | '));
    await page.close();
  }
  // Sticky bars land on the header's bottom edge when scrolled.
  for (const [name, sel] of [['clients', '#clientsTabs'], ['review-request', '#reviewTabs'], ['contract-generator', '.contract-tabs'], ['parts-reference', '.pr-search-filter-row'], ['dev-tools', '#devTabBar'], ['site-content', '#scSectionNav']]) {
    const { page } = await H.open(ctx, st(name));
    // A spacer so even a short page (Clients with four rows) can scroll far enough to stick.
    await page.evaluate(() => { const d = document.createElement('div'); d.style.height = '2000px'; document.body.appendChild(d); window.scrollTo(0, 1200); }); await page.waitForTimeout(250);
    const r = await page.evaluate((sel) => ({ hdr: document.querySelector('.hub-header').getBoundingClientRect().bottom, bar: document.querySelector(sel).getBoundingClientRect().top }), sel);
    check(name + ': sticky bar sits on the header bottom (gap 0, no overlap)', Math.abs(r.bar - r.hdr) < 1, JSON.stringify(r));
    await page.close();
  }
  // Equal, full-width segments.
  for (const [name, sel] of [['clients', '#clientsTabs'], ['review-request', '#reviewTabs'], ['contract-generator', '.contract-tabs']]) {
    const { page } = await H.open(ctx, st(name));
    const r = await page.evaluate((sel) => { const s = document.querySelector(sel); const p = s.parentElement; const ps = getComputedStyle(p); return { w: s.getBoundingClientRect().width, inner: p.getBoundingClientRect().width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight), segs: [...s.children].filter((c) => c.offsetParent).map((c) => Math.round(c.getBoundingClientRect().width)), scrolls: s.scrollWidth > s.clientWidth + 1, h: [...s.children].map((c) => c.getBoundingClientRect().height) }; }, sel);
    check(name + ': segmented control spans the width, equal segments, >=44px', Math.abs(r.w - r.inner) < 2 && Math.max(...r.segs) - Math.min(...r.segs) <= 1 && Math.min(...r.h) >= 44, JSON.stringify(r));
    await page.close();
  }
  // Status dot and banner: trouble -> red + banner; recovery -> clear.
  for (const [name, dot] of [['clients', true], ['client-detail', true], ['contract-generator', true], ['route-planner', true], ['review-request', false], ['parts-reference', false], ['runway-dashboard', true]]) {
    const { page } = await H.open(ctx, st(name));
    const set = (ok) => page.evaluate((ok) => { localStorage.setItem('th_sync_last', JSON.stringify({ ok, type: 'push', error: ok ? null : 'http-503', time: Date.now() })); window.dispatchEvent(new CustomEvent('th-sync-status')); }, ok);
    const read = () => page.evaluate(() => { const n = document.getElementById('thSyncNote'); const s = document.querySelector('.th-status'); return { note: !!n && n.offsetParent !== null && n.classList.contains('is-issue'), noteAfterHeader: !!n && !!n.previousElementSibling && /hub-header|mainContent/.test(n.previousElementSibling.className + ' ' + n.previousElementSibling.id), red: !!s && s.classList.contains('is-trouble'), dotInHeader: !!document.querySelector('.hub-header .th-status, header#mainContent .th-status') }; });
    const healthy = await read(); await set(false); await page.waitForTimeout(150); const bad = await read(); await set(true); await page.waitForTimeout(150); const ok = await read();
    check(name + ': ' + (dot ? 'dot + ' : '') + 'banner show sync trouble and clear on recovery', !healthy.note && bad.note && bad.noteAfterHeader && !ok.note && (!dot || (healthy.dotInHeader && bad.red && !ok.red)), JSON.stringify({ healthy, bad, ok }));
    await page.close();
  }
  // Settings / Site Content / Dev Tools: no dot and no banner (no live data of their own).
  for (const name of ['settings', 'site-content', 'dev-tools']) {
    const { page } = await H.open(ctx, st(name));
    check(name + ': no dot or banner added', !(await page.$('#thSyncNote')) && !(await page.$('.th-status')));
    await page.close();
  }
  // Client detail lights Clients (TAB_PARENT), and its back chevron is top-left.
  {
    const { page } = await H.open(ctx, st('client-detail'));
    const r = await page.evaluate(() => { const a = document.querySelector('.th-bottom-nav a[href="/tools/clients.html"]'); const b = document.querySelector('.hub-header-back a').getBoundingClientRect(); const t = document.querySelector('.hub-title').getBoundingClientRect(); return { active: a.classList.contains('is-active'), cur: a.getAttribute('aria-current'), backLeft: b.left, backRightOfTitle: b.left > t.left, w: b.width, h: b.height }; });
    check('client-detail: Clients tab lit (aria-current=true); back chevron top-left, 44px', r.active && r.cur === 'true' && r.backLeft < 30 && !r.backRightOfTitle && r.w >= 44 && r.h >= 44, JSON.stringify(r));
    await page.close();
  }
  // 44px hit areas drawn by ::after (elementFromPoint just outside the box).
  for (const [name, sel, click] of [['dev-tools', '.dev-info-bubble'], ['site-content', '.dev-info-bubble'], ['clients', '.dev-info-bubble', '.tabs [data-tab="portal"]'], ['route-planner', '.stop-drag'], ['runway-dashboard', '.card-header .help-btn, h3 .help-btn']]) {
    const s = st(name); if (click) s.click = click;
    const { page } = await H.open(ctx, s);
    const r = await page.evaluate((sel) => { const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent && e.getBoundingClientRect().top > 70 && e.getBoundingClientRect().bottom < innerHeight - 100) || [...document.querySelectorAll(sel)].find((e) => e.offsetParent); el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); const cx = b.left + b.width / 2; const cy = b.top + b.height / 2; const hit = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === el || el.contains(e)); }; return { w: b.width, h: b.height, hitX: hit(cx - 21.5, cy) && hit(cx + 21.5, cy), hitY: hit(cx, cy - 21.5) && hit(cx, cy + 21.5) }; }, sel);
    check(name + ': ' + sel + ' answers taps over 44px', r.hitX && r.hitY, JSON.stringify(r));
    await page.close();
  }
  // Sized 44px targets.
  for (const [name, sel, click] of [['client-detail', '.client-whats-next-cta'], ['contract-generator', '.icon-search-toggle'], ['contract-generator', '.voice-dictation-btn'], ['parts-reference', '.pr-fixes-add'], ['dev-tools', '#devStatusSummary'], ['site-content', '.dev-panel.is-collapsible > .dev-panel-heading'], ['clients', 'label:has(> #portalWorkOrderShowClosed)', '.tabs [data-tab="portal"]']]) {
    const s = st(name); if (click) s.click = click;
    const { page } = await H.open(ctx, s);
    const r = await page.evaluate((sel) => { const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent); if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; }, sel);
    check(name + ': ' + sel + ' is >= 44px tall', r && r.h >= 44 && r.w >= 44, JSON.stringify(r));
    await page.close();
  }
  // Client detail's inline phone link: a 44px hit box, the text not moved.
  {
    const { page } = await H.open(ctx, st('client-detail-lead'));
    const r = await page.evaluate(() => { const a = [...document.querySelectorAll('.client-hero a[href^="tel:"]:not(.client-action)')].find((x) => x.offsetParent); const b = a.getBoundingClientRect(); return { h: b.height }; });
    check('client-detail: inline phone link hit box >= 42px', r.h >= 42, JSON.stringify(r));
    await page.close();
  }
  await ctx.close();
  // Empty states.
  {
    const ectx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
    await ectx.close();
    const c = await H.newCtx(browser, { width: 390, height: 844, theme: 'dark', touch: true });
    let { page } = await H.open(c, st('clients'));
    await page.evaluate(() => { localStorage.setItem('th_clients', '[]'); localStorage.setItem('th_tracker_jobs', '[]'); localStorage.setItem('th_invoices', '[]'); localStorage.setItem('th_quotes', '[]'); localStorage.setItem('th_contracts', '[]'); });
    await page.reload(); await page.waitForTimeout(2500);
    const empty = await page.evaluate(() => ({ toolbar: !!document.querySelector('.cd-toolbar').offsetParent, chips: !!document.querySelector('#clientDirFilters').offsetParent, add: !!document.querySelector('.cd-empty button[onclick="openAddClient()"]').offsetParent }));
    check('clients (no clients): search, Add and chips hidden; the empty card keeps Add a client', !empty.toolbar && !empty.chips && empty.add, JSON.stringify(empty));
    await page.close();
    ({ page } = await H.open(c, st('clients')));
    await page.fill('#clientDirSearch', 'zzz'); await page.waitForTimeout(400);
    const miss = await page.evaluate(() => ({ toolbar: !!document.querySelector('.cd-toolbar').offsetParent, chips: !!document.querySelector('#clientDirFilters').offsetParent }));
    check('clients (search miss): search and chips stay, so it can be cleared', miss.toolbar && miss.chips, JSON.stringify(miss));
    await page.close();
    ({ page } = await H.open(c, st('client-detail-lead')));
    const lead = await page.evaluate(() => ({ stats: !!document.querySelector('.client-stat-row').offsetParent, emptyCards: [...document.querySelectorAll('#clientContent > .section-block:not(.client-delete-zone)')].filter((s) => s.offsetParent).length, history: !!document.querySelector('.client-timeline-empty').offsetParent, del: !!document.querySelector('.client-delete-zone').offsetParent }));
    check('client-detail (nothing on file): no $0 stats grid, no empty record cards; History and Delete stay', !lead.stats && lead.emptyCards === 0 && lead.history && lead.del, JSON.stringify(lead));
    await page.close();
    ({ page } = await H.open(c, st('client-detail')));
    const full = await page.evaluate(() => ({ stats: !!document.querySelector('.client-stat-row').offsetParent, cards: [...document.querySelectorAll('#clientContent > .section-block:not(.client-delete-zone)')].filter((s) => s.offsetParent).length }));
    check('client-detail (with history): stats grid and all record cards still show', full.stats && full.cards === 4, JSON.stringify(full));
    await page.close();
    await c.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  await checks(browser);
  if (MAIN) {
    const a = await flows(browser, BRANCH);
    const b = await flows(browser, MAIN);
    for (const k of Object.keys(b)) check('flow "' + k + '" identical on main and this branch', JSON.stringify(a[k]) === JSON.stringify(b[k]), JSON.stringify(a[k]).slice(0, 600) + (JSON.stringify(a[k]) === JSON.stringify(b[k]) ? '' : '  MAIN: ' + JSON.stringify(b[k]).slice(0, 600)));
    // Fingerprint: wiring and numbers.
    const fp = async (base) => { H.setBase(base); const out = {}; for (const noSession of [false, true]) { const c = await H.newCtx(browser, { width: 390, height: 844, theme: 'dark', touch: true, noSession }); for (const s of H.STATES.filter((x) => !!x.noSession === noSession)) { const { page } = await H.open(c, s); out[s.name] = await page.evaluate(H.FINGERPRINT); await page.close(); } await c.close(); } return out; };
    const fa = await fp(BRANCH); const fb = await fp(MAIN); const fb2 = await fp(MAIN);
    // Volatile tokens (Reviews' randomly chosen message wording, clock times
    // and latencies on Dev Tools) differ between two runs of main itself;
    // they are masked, and everything stable on main must match the branch.
    const stableNums = (k) => fb[k].nums.map((v, i) => (fb2[k].nums[i] === v ? v : '*'));
    const maskNums = (k, arr) => arr.map((v, i) => (stableNums(k)[i] === '*' ? '*' : v));
    // Deliberate chrome changes to the wiring (see visual.md).
    const ALLOWED_WIRING = [
      /^span\|syncStatusText\|/, // the empty, never-written span (Clients, Wiki) that blocked the shared banner
      /^(p|span)\|(realtimeBadge|realtimeDot|realtimeText)\|/, // Clients' new status badge
      /^p\|\|\|/, // its hub-sub line
    ];
    for (const k of Object.keys(fb)) {
      const volatile = new Set(fb[k].wiring.filter((x) => !fb2[k].wiring.includes(x)).concat(fb2[k].wiring.filter((x) => !fb[k].wiring.includes(x))));
      const volId = new Set([...volatile].map((x) => x.split('|').slice(0, 2).join('|')));
      const A = new Set(fa[k].wiring.filter((x) => !volId.has(x.split('|').slice(0, 2).join('|')))); const B = new Set(fb[k].wiring.filter((x) => !volId.has(x.split('|').slice(0, 2).join('|'))));
      const added = [...A].filter((x) => !B.has(x) && !ALLOWED_WIRING.some((r) => r.test(x)));
      const removed = [...B].filter((x) => !A.has(x) && !ALLOWED_WIRING.some((r) => r.test(x)));
      check('fingerprint ' + k + ': wiring unchanged (ids, onclick, href, data-tab)', !added.length && !removed.length, JSON.stringify({ added, removed }).slice(0, 500));
      const na = JSON.stringify(maskNums(k, fa[k].nums)); const nb = JSON.stringify(stableNums(k));
      check('fingerprint ' + k + ': every number shown unchanged (' + fb[k].nums.length + ' numbers, ' + stableNums(k).filter((x) => x === '*').length + ' volatile on main)', fa[k].nums.length === fb[k].nums.length && na === nb, na.slice(0, 300) + ' vs ' + nb.slice(0, 300));
    }
  }
  await browser.close();
  const bad = results.filter((r) => !r.ok);
  results.forEach((r) => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok && !process.env.VERBOSE ? '' : '\n     ' + r.detail)));
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' passed');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
