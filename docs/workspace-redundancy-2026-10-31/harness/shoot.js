// Screenshot harness for the Workspace redundancy pass (2026-10-31).
// Dev-only; nothing loads this. Shoots every page the 19 items touched at
// 390x844 dark (touch, 2x), one viewport per state, plus report.json (page
// errors and horizontal overflow per state). Run it against main for the
// "before" set and against this branch for "after": every action is
// guarded, so a state whose element only exists on one side just shoots
// the page as it is.
//
//   python3 -m http.server 8543                         (from the repo root)
//   REAL_FONTS=1 node docs/workspace-redundancy-2026-10-31/harness/shoot.js http://localhost:8543 /tmp/after
//   OWNER_LIMITED=1 ... (an Owner without full Dev Tools access; Dev Tools only)
//
// Needs Playwright (not a dependency of this repo): PLAYWRIGHT=/path/to/playwright.
const fs = require('fs');
const path = require('path');
const { launch, newContext } = require('./common');

const base = process.argv[2];
const out = process.argv[3];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
fs.mkdirSync(out, { recursive: true });

const scrollTo = (sel, offset) => (page) => page.evaluate(([s, o]) => {
  const el = document.querySelector(s);
  if (!el) return;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (o || 70));
}, [sel, offset]);

const STATES = [
  // Items 1, 2, 6, 7, 18: the top of Home.
  { name: 'home', url: '/tools/workspace.html' },
  // Item 2 / 7: Today's route + the daily strip.
  { name: 'home-route', url: '/tools/workspace.html', act: scrollTo('#todayRouteCard') },
  // Item 8: Money owed, once.
  { name: 'home-money', url: '/tools/workspace.html', act: scrollTo('#todayMoney') },
  { name: 'home-money-lower', url: '/tools/workspace.html', act: scrollTo('#todayMoney', -420) },
  // Item 8 (before): the Income lane at the bottom of Needs attention.
  { name: 'home-needs', url: '/tools/workspace.html', act: scrollTo('#section-actionitems') },
  // Item 10, 17: Business Snapshot (Insights) and the Business group.
  { name: 'home-insights', url: '/tools/workspace.html#insights', act: async (page) => { await page.evaluate(() => { if (typeof expandSection === 'function') expandSection('snapshot'); }); await page.waitForTimeout(400); await scrollTo('.metrics-grid', 120)(page); } },
  { name: 'home-business', url: '/tools/workspace.html', act: scrollTo('.dash-group-label', 20) },
  // Item 3: the Ctrl+K list before typing.
  { name: 'palette', url: '/tools/workspace.html', act: async (page) => { await page.evaluate(() => window.openCommandPalette && window.openCommandPalette()); await page.waitForTimeout(400); } },
  // Item 3: the More drawer keeps Route Planner.
  { name: 'more-drawer', url: '/tools/workspace.html', act: async (page) => { await page.evaluate(() => { const b = document.querySelector('.th-hdr-menu'); if (b) b.click(); }); await page.waitForTimeout(500); } },
  // Item 4.
  { name: 'route-planner', url: '/tools/route-planner.html' },
  { name: 'route-planner-bottom', url: '/tools/route-planner.html', act: (page) => page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, document.body.scrollHeight); }) },
  // Item 5: a job's ⋯ sheet.
  { name: 'jobs-sheet', url: '/tools/job-tracker.html', act: async (page) => { await page.evaluate(() => window.openJobActions && window.openJobActions(102)); await page.waitForTimeout(500); } },
  // Item 15.
  { name: 'jobs-suppliers', url: '/tools/job-tracker.html#contacts' },
  // Items 11, 16: Finance's tabs and default.
  { name: 'finance', url: '/tools/finance.html' },
  // Item 11: New quote's saved job types picker still reads th_price_reference.
  { name: 'new-quote', url: '/tools/invoice-generator.html#quote', act: scrollTo('#quotePriceRefRow', 200) },
  // Item 13: the Invoices list's Resend.
  { name: 'invoices', url: '/tools/invoice-generator.html' },
  // Items 9, 19: Runway.
  { name: 'runway-business', url: '/tools/runway-dashboard.html', act: async (page) => { await page.evaluate(() => { const b = document.querySelector('.rw-tab-btn[data-tab="business"]'); if (b) b.click(); }); await page.waitForTimeout(400); } },
  { name: 'runway-taxrate', url: '/tools/runway-dashboard.html', act: async (page) => { await page.evaluate(() => { const b = document.querySelector('.rw-tab-btn[data-tab="business"]'); if (b) b.click(); }); await page.waitForTimeout(400); await scrollTo('#taxSetAsideRate', 160)(page); } },
  { name: 'runway-backup', url: '/tools/runway-dashboard.html', act: async (page) => { await page.evaluate(() => { const b = document.querySelector('.rw-tab-btn[data-tab="runway"]'); if (b) b.click(); }); await page.waitForTimeout(400); await scrollTo('#exportBackupBtn', 300)(page); } },
  // Items 12, 13, 14: Clients' Portal tab.
  { name: 'clients-portal', url: '/tools/clients.html#portal', wait: 2500, act: scrollTo('#portalAccounts', 120) },
  { name: 'clients-portal-lower', url: '/tools/clients.html#portal', wait: 2500, act: scrollTo('#portalWorkOrders', 160) },
  // Item 12: Dev Tools -> Health.
  { name: 'devtools-health', url: '/tools/dev-tools.html', wait: 2500, act: scrollTo('#portalBugReports', 260) },
  // Item 17: Site Content's Gallery queue, opened.
  { name: 'site-content-gallery', url: '/tools/site-content.html', wait: 2500, act: async (page) => { await page.evaluate(() => { const p = document.getElementById('section-gallery'); if (p && p.classList.contains('is-collapsed')) toggleDevPanel(p.querySelector('.dev-panel-heading')); }); await page.waitForTimeout(1500); await scrollTo('#section-gallery', 150)(page); } },
];

(async () => {
  const browser = await launch();
  const report = {};
  for (const st of STATES) {
    if (only && !only.includes(st.name)) continue;
    const ctx = await newContext(browser, base);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.goto(base + st.url, { waitUntil: 'load' });
    await page.waitForTimeout(st.wait || 2000);
    if (st.act) { try { await st.act(page); } catch (e) { errors.push('act: ' + e.message); } }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, st.name + '.png') });
    report[st.name] = { errors, overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) };
    await ctx.close();
  }
  // Desktop: the sidebar (item 3), dark, 1280x900.
  if (!only || only.includes('desktop-sidebar')) {
    const ctx = await newContext(browser, base, { width: 1280, height: 900, touch: false });
    const page = await ctx.newPage();
    await page.goto(base + '/tools/workspace.html', { waitUntil: 'load' });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(out, 'desktop-sidebar.png') });
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('shot', Object.keys(report).length + 1, 'states ->', out);
})();
