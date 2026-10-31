// Screenshot + chrome-audit harness for the client portal redesign
// (2026-10-31). Dev-only; nothing loads this. See common.js for the stubs.
//
//   SUPABASE_UMD=/path/to/supabase.js REAL_FONTS=1 \
//     node docs/portal-redesign-2026-10-31/harness/shoot.js <checkout root> <out dir>
//
// <checkout root> is the repo checkout to serve (this branch, or a main
// worktree for the "before" shots). EMPTY=1 / FAIL=1 as in common.js.
// ONLY=home,dashboard limits the pages. Writes <out>/<page>.png (390x844
// viewport), <out>/<page>-full.png and <out>/report.json (audits, the
// overflow sweep and the data/wiring fingerprint per page).
const fs = require('fs');
const path = require('path');
const C = require('./common');

const root = path.resolve(process.argv[2] || path.join(__dirname, '../../..'));
const out = path.resolve(process.argv[3] || '/tmp/portal-shots');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
fs.mkdirSync(out, { recursive: true });

(async () => {
  const { server, base } = await C.startServer(root);
  const browser = await C.launch();
  const report = {};
  for (const name of C.PAGES) {
    if (ONLY && !ONLY.includes(name)) continue;
    const signedIn = !['login', 'set-password'].includes(name);
    const { ctx } = await C.newContext(browser, { signedIn });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 200)));
    await page.goto(base + '/portal/' + name + '.html');
    await C.settle(page, 1800);
    if (page.url().indexOf('/portal/' + name) === -1) { report[name] = { redirected: page.url() }; await ctx.close(); continue; }
    const targets = await page.evaluate(C.TARGET_AUDIT);
    const chrome = await page.evaluate(C.CHROME_AUDIT);
    const fp = await page.evaluate(C.FINGERPRINT);
    await page.screenshot({ path: path.join(out, name + '.png') });
    await page.screenshot({ path: path.join(out, name + '-full.png'), fullPage: true });
    await ctx.close();

    const overflow = {};
    for (const scheme of ['dark', 'light']) {
      for (const width of [390, 820, 1280]) {
        const { ctx: c2 } = await C.newContext(browser, { signedIn, viewport: { width, height: 900 }, colorScheme: scheme, dpr: 1 });
        const p2 = await c2.newPage();
        await p2.goto(base + '/portal/' + name + '.html');
        await C.settle(p2, 1500);
        overflow[scheme + width] = await p2.evaluate(C.OVERFLOW);
        await c2.close();
      }
    }
    report[name] = { errors, targets, chrome, overflow, fingerprint: fp };
    const over = Object.entries(overflow).filter(([, v]) => v.over).map(([k]) => k);
    console.log(name.padEnd(13), 'small targets:', targets.filter((t) => !t.inlineProse).length, ' caps:', chrome.caps.length, ' overflow:', over.join(',') || 'none', ' errors:', errors.length);
  }
  // STATES=1: the interaction shots (390x844 dark): a failed load with the
  // banner, the pay sheet at step 2 with Stripe's element mounted, and the
  // sticky header mid-scroll.
  if (process.env.STATES) {
    const shot = async (file, url, opts, act) => {
      const { ctx } = await C.newContext(browser, opts || {});
      const page = await ctx.newPage();
      await page.goto(base + url);
      await C.settle(page, (opts && opts.wait) || 1800);
      if (act) await act(page);
      await page.screenshot({ path: path.join(out, file) });
      await ctx.close();
    };
    await shot('state-failed-load.png', '/portal/dashboard.html', { fail: true });
    await shot('state-scrolled.png', '/portal/quotes.html', {}, async (p) => { await p.evaluate(() => window.scrollTo(0, 620)); await p.waitForTimeout(400); });
    await shot('state-pay-sheet.png', '/portal/dashboard.html', { wait: 4200 }, async (p) => {
      await p.click('#invoice-card-501 button[onclick^="startPayment"]');
      await p.waitForSelector('#paySignerName');
      await p.fill('#paySignerName', 'Kim Reyes');
      const bx = await p.locator('#paySignatureCanvas').boundingBox();
      await p.mouse.move(bx.x + 30, bx.y + 40); await p.mouse.down();
      for (let i = 1; i <= 8; i++) await p.mouse.move(bx.x + 30 + i * 25, bx.y + 40 + (i % 2) * 50, { steps: 3 });
      await p.mouse.up();
      await p.click('#payAuthContinueBtn');
      await p.waitForSelector('#paymentSubmitBtn');
      await p.waitForTimeout(500);
    });
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
