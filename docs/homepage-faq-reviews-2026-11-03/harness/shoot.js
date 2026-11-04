// Screenshot harness for item 19's two approved sign-off items
// (2026-11-03): the inline FAQ topic-tabs + accordion (#faq, replacing
// #faqModal) and the #reviews "big number". Dev-only; nothing on the
// live site loads this. index.html is a static public page with no
// Supabase auth gate, so this is simpler than the Workspace harnesses
// (docs/workspace-redundancy-2026-10-31/harness/) -- no login seeding,
// just the two live Supabase fetches (site_faq, site_content) stubbed
// so the shots are deterministic and don't depend on network access.
//
//   python3 -m http.server 8543                         (from the repo root)
//   node docs/homepage-faq-reviews-2026-11-03/harness/shoot.js http://localhost:8543 docs/homepage-faq-reviews-2026-11-03
//
// Needs Playwright (not a dependency of this repo): PLAYWRIGHT=/path/to/playwright.
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const base = process.argv[2];
const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });

const scrollTo = (sel, offset) => (page) => page.evaluate(([s, o]) => {
  const el = document.querySelector(s);
  if (!el) return;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (o || 70));
}, [sel, offset]);

async function stubFetches(page) {
  // Static fallback content is already correct (5.0 / 9, the 15
  // static FAQ questions) -- failing these closed keeps the shots
  // deterministic without needing real network access, same
  // fail-silent path the page itself falls back to.
  await page.route('**/supabase.co/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '[]' }));
}

const VIEWPORTS = [
  { label: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true },
  { label: '1440', width: 1440, height: 1000, isMobile: false, hasTouch: false },
];

const STATES = [
  {
    name: 'reviews-big-number',
    act: async (page) => { await scrollTo('#reviews', 20)(page); },
  },
  {
    name: 'faq-first-tab',
    act: async (page) => { await scrollTo('#faq', 20)(page); },
  },
  {
    name: 'faq-second-tab-open-accordion',
    act: async (page) => {
      await scrollTo('#faq', 20)(page);
      await page.click('#faqTab-1');
      await page.click('#faqPanel-1 .faq-item:first-child .faq-question');
      await page.waitForTimeout(350); // grid-template-rows transition
    },
  },
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const report = {};
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.isMobile ? 2 : 1,
      colorScheme: 'dark',
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
      serviceWorkers: 'block',
    });
    for (const st of STATES) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message || e)));
      await stubFetches(page);
      await page.goto(base + '/index.html', { waitUntil: 'load' });
      await page.waitForTimeout(600);
      if (st.act) { try { await st.act(page); } catch (e) { errors.push('act: ' + e.message); } }
      await page.waitForTimeout(400);
      const fileName = `${st.name}-${vp.label}.png`;
      await page.screenshot({ path: path.join(out, fileName) });
      report[fileName] = {
        errors,
        overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
      await page.close();
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('shot', Object.keys(report).length, 'states ->', out);
})();
