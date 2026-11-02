// Screenshot harness for the corrections pack (2026-11-01): the three
// screens this PR actually changed -- the restored Cost Analyzer (item 1),
// the Invoices list's "Never sent to portal" badge (item 2), and the
// confirm dialog before deleting a saved job type (item 3). Dev-only;
// nothing loads this. Reuses the Workspace redundancy pass harness's
// context/mock setup (same seed data, same mocked Supabase, same
// 390x844 dark/touch viewport) rather than duplicating it.
//
//   python3 -m http.server 8543                         (from the repo root)
//   REAL_FONTS=1 node docs/corrections-pack-2026-11-01/harness/shoot.js http://localhost:8543 docs/corrections-pack-2026-11-01
//
// Needs Playwright (not a dependency of this repo): PLAYWRIGHT=/path/to/playwright.
const fs = require('fs');
const path = require('path');
const { launch, newContext } = require('../../workspace-redundancy-2026-10-31/harness/common');

const base = process.argv[2];
const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });

const scrollTo = (sel, offset) => (page) => page.evaluate(([s, o]) => {
  const el = document.querySelector(s);
  if (!el) return;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (o || 70));
}, [sel, offset]);

const STATES = [
  // Item 1: the restored Cost Analyzer, a >15-mile trip typed in so the
  // suggested charge shows the real $25 flat policy fee, not $0.
  {
    name: 'route-planner-cost-analyzer',
    url: '/tools/route-planner.html',
    act: async (page) => {
      await scrollTo('.route-cost-card', 80)(page);
      await page.fill('#tripDistance', '20');
      await page.dispatchEvent('#tripDistance', 'input');
      await page.waitForTimeout(200);
    },
  },
  // Item 2: the Invoices list, showing the "Never sent to portal" badge on
  // every seeded invoice (the mock's internal_read_client_portal_invoices
  // RPC returns no rows, same as a real invoice that was only ever logged
  // locally and never emailed/posted to the client portal).
  {
    name: 'invoices-never-sent-to-portal',
    url: '/tools/invoice-generator.html',
    wait: 2500,
  },
  // Item 3: the confirm dialog that now appears before a saved job type
  // (th_price_reference) is actually deleted.
  {
    name: 'saved-job-type-delete-confirm',
    url: '/tools/invoice-generator.html#quote',
    act: async (page) => {
      await page.evaluate(() => { const b = document.getElementById('quotePriceRefManageToggle'); if (b) b.click(); });
      await page.waitForTimeout(300);
      await scrollTo('#quotePriceRefManager', 160)(page);
      await page.click('#quotePriceRefManager .chip-remove');
      await page.waitForTimeout(300);
    },
  },
];

(async () => {
  const browser = await launch();
  const report = {};
  for (const st of STATES) {
    const ctx = await newContext(browser, base);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.goto(base + st.url, { waitUntil: 'load' });
    await page.waitForTimeout(st.wait || 2000);
    if (st.act) { try { await st.act(page); } catch (e) { errors.push('act: ' + e.message); } }
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, st.name + '-390x844.png') });
    report[st.name] = { errors, overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) };
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('shot', Object.keys(report).length, 'states ->', out);
})();
