// Screenshot harness for docs/workspace-phase2-native-app-2026-10-30/after/
// (PR #543 and its review revision). Dev-only; nothing loads this file.
//
// Renders Home, Jobs and Job detail at 390x844 (dark, touch, 2x) against a
// local static server, with Supabase stubbed (every supabase.co request is
// answered locally, an Owner role row, no real data) and six seeded jobs
// plus one invoice in localStorage. Live sync can't connect here, so the
// header dot is red in these shots. Also writes report.json: tap targets
// under 44px, horizontal overflow, the lit tab, page errors.
//
//   python3 -m http.server 8543            (from the repo root)
//   node docs/workspace-phase2-native-app-2026-10-30/harness/shoot.js http://localhost:8543 /tmp/shots
//
// Needs Playwright (not a dependency of this repo): npm i -g playwright, or
// PLAYWRIGHT=/path/to/node_modules/playwright.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');

const base = process.argv[2];
const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };

const jobs = [
  { id: 101, title: 'Dryer not heating', client: 'Maria Lopez', phone: '435-555-0101', address: '123 Red Cliffs Dr, St. George, UT', priority: 'high', date: addDays(0), status: 'in-progress', notes: 'Whirlpool WED4815EW, likely thermal fuse', hoursWorked: 1.5, showOnCalendar: true },
  { id: 102, title: 'Dishwasher leak', client: 'Dan Ortiz', phone: '435-555-0102', address: '88 Bluff St, St. George, UT', priority: 'medium', date: addDays(0), status: 'not-started', notes: '', showOnCalendar: true },
  { id: 103, title: 'Hang 3 shelves + TV mount', client: 'Kim Reyes', phone: '435-555-0103', address: '9 Snow Canyon Pkwy, Ivins, UT', priority: 'low', date: addDays(1), status: 'not-started', notes: '', showOnCalendar: true },
  { id: 104, title: 'Fridge ice maker', client: 'Greg Hall', phone: '435-555-0104', address: '410 Telegraph St, Washington, UT', priority: 'medium', date: addDays(-2), status: 'done', notes: '', hoursWorked: 2, showOnCalendar: true },
  { id: 105, title: 'Washer drain pump', client: 'Ana Smith', phone: '435-555-0105', address: '77 Dixie Dr, St. George, UT', priority: 'high', date: addDays(3), status: 'not-started', notes: '', showOnCalendar: true },
  { id: 106, title: 'Garbage disposal swap', client: 'Tom Ruiz', phone: '435-555-0106', address: '12 Main St, Hurricane, UT', priority: 'medium', date: addDays(-1), status: 'not-started', notes: '', showOnCalendar: true },
];
const invoices = [
  { invoiceNumber: 'INV-1042', clientName: 'Greg Hall', total: 285, date: addDays(-2), status: 'unpaid', jobId: 104 },
];

function fakeJwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b({ alg: 'HS256' }) + '.' + b({ aal: 'aal2', email: 'connor@triplehenterprisesllc.biz', exp: 9999999999 }) + '.sig';
}

const roleRow = [{ email: 'connor@triplehenterprisesllc.biz', role_name: 'Owner', can_manage_roles: true, can_access_dev_tools: true, can_access_dev_tools_full: true, can_manage_site_content: true, can_manage_invoices: true, can_manage_contracts: true, can_view_finance: true, can_view_runway: true, can_manage_reviews: true }];

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
    // only things in the rendered document (not clipped-off sheets)
    if (el.closest('[hidden], [aria-hidden="true"]')) return;
    let p = el; let hiddenAnc = false;
    while (p && p !== document.body) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) { hiddenAnc = true; break; } p = p.parentElement; }
    if (hiddenAnc) return;
    // visually-hidden helpers
    if (r.width <= 1 || r.height <= 1) return;
    // an inline text link inside a paragraph of prose is exempt (WCAG 2.5.8 inline exception)
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

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(({ jobs, invoices, jwt }) => {
    try {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      const sess = { access_token: jwt, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400, email: 'connor@triplehenterprisesllc.biz', remember_until: Date.now() + 864e5 };
      localStorage.setItem('th_auth_session', JSON.stringify(sess));
      localStorage.setItem('th_tracker_jobs', JSON.stringify(jobs));
      localStorage.setItem('th_invoices', JSON.stringify(invoices));
      localStorage.setItem('th_tools_theme', 'dark');
      localStorage.setItem('th_onboarding_v1_seen_connor@triplehenterprisesllc.biz', '1');
      localStorage.setItem('th_onboarding_v1_seen', '1');
      sessionStorage.setItem('th_mfa_nag_dismissed', '1');
      localStorage.setItem('th_onboarding_dismissed', '1');
      localStorage.setItem('th_install_dismissed', String(Date.now()));
    } catch (e) { /* ignore */ }
  }, { jobs, invoices, jwt: fakeJwt() });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base)) return route.continue();
    if (/supabase\.co/.test(u)) {
      if (/account_roles/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roleRow) });
      if (/rpc\/internal_mfa_session_status/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"blocked":false}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.abort();
  });

  const pages = [
    { name: 'home', url: '/tools/workspace.html' },
    { name: 'jobs', url: '/tools/job-tracker.html' },
    { name: 'detail', url: '/tools/job-detail.html?id=101' },
  ];
  const report = {};
  for (const p of pages) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(base + p.url, { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    await page.evaluate(() => document.querySelectorAll('.th-install-banner, .th-update-card, .onboarding-card, .th-tour, .th-tour-card').forEach((e) => e.remove()));
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const bad = await page.evaluate(TARGET_AUDIT);
    await page.screenshot({ path: path.join(out, p.name + '-390-dark.png') });
    await page.screenshot({ path: path.join(out, p.name + '-390-dark-full.png'), fullPage: true });
    if (!coarse) throw new Error('pointer: coarse not emulated');
    const meta = await page.evaluate(() => {
      const nav = document.querySelector('.th-bottom-nav');
      const act = nav ? [...nav.querySelectorAll('a.is-active')].map((a) => a.textContent.trim()) : null;
      const over=[];document.querySelectorAll('body *').forEach(el=>{const r=el.getBoundingClientRect();if(r.right>392&&r.width>0){let q=el.parentElement,clip=false;while(q&&q!==document.body){if(/(auto|hidden|scroll|clip)/.test(getComputedStyle(q).overflowX)){clip=true;break}q=q.parentElement}if(!clip)over.push(el.tagName+'#'+el.id+'.'+(typeof el.className==='string'?el.className.slice(0,50):'')+' r='+Math.round(r.right))}});
      return { url: location.pathname, activeTab: act, scrollW: document.documentElement.scrollWidth, over: over.slice(0,10) };
    });
    report[p.name] = { meta, errs, bad };
    await page.close();
  }
  // Extras (Phase 2 revision): the View sheet, a repeat visit (tip already
  // seen), and the sync-trouble banner driven through the page's own handler.
  {
    const page = await ctx.newPage();
    await page.goto(base + '/tools/job-tracker.html', { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    await page.evaluate(() => document.querySelectorAll('.th-install-banner, .th-update-card, .onboarding-card, .th-tour, .th-tour-card').forEach((e) => e.remove()));
    report.jobsRepeat = await page.evaluate(() => { const c = document.querySelector('#jobsList .job-card').getBoundingClientRect(); return { cardTop: Math.round(c.top), cardBottom: Math.round(c.bottom), navTop: Math.round(document.querySelector('.th-bottom-nav').getBoundingClientRect().top), tip: !!(document.getElementById('jobsList').previousElementSibling || {}).classList?.contains('th-page-tip') }; });
    await page.screenshot({ path: path.join(out, 'jobs-repeat-visit-390-dark.png') });
    await page.click('#jobViewBtn'); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, 'jobs-view-sheet-390-dark.png') });
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    await page.evaluate(() => { localStorage.setItem('th_sync_last', JSON.stringify({ ok: false, type: 'push', error: 'http-503', time: Date.now() })); window.dispatchEvent(new CustomEvent('th-sync-status')); });
    await page.waitForTimeout(300);
    report.syncNote = await page.evaluate(() => document.getElementById('syncStatusText').textContent);
    await page.screenshot({ path: path.join(out, 'jobs-sync-trouble-390-dark.png') });
    await page.close();
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
