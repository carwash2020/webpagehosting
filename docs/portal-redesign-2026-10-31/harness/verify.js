// verify.js -- the client portal redesign checklist (2026-10-31). Dev-only.
//
//   SUPABASE_UMD=/path/to/supabase.js JSPDF_UMD=/path/to/jspdf.umd.min.js \
//   MAIN_ROOT=/path/to/a/checkout/of/main \
//     node docs/portal-redesign-2026-10-31/harness/verify.js
//
// Three parts, all in a real browser against common.js's stubs:
//   1. The chrome checklist on this branch: the one-row sticky header, the
//      status dot and its banner (healthy, failed + Try again, offline), the
//      installed-app safe area, sentence case, flat primaries, 44px targets,
//      the Request badge, same initials on every page, Contracts' title, the
//      manifest, every old deep link, and no sideways scroll at 390 / 820 /
//      1280 in light and dark.
//   2. Every client action, driven through the real UI on main AND on this
//      branch: pay one invoice, pay all, approve / decline / ask about an
//      estimate, three PDF downloads, send a work request, cancel one,
//      message on a request and on a visit, sign a contract, save profile
//      details, change an email preference, report a problem, sign out, and
//      the tab bar. Each flow's trace (every write and edge-function body,
//      every Stripe.js call, the result the client sees) must be identical.
//   3. The data/wiring fingerprint: every amount and count each page shows
//      a client must be byte-identical to main; the only wiring change
//      allowed is the two new status elements.
// Exit code 1 on any failure.
const fs = require('fs');
const path = require('path');
const C = require('./common');

const BRANCH = path.join(__dirname, '../../..');
const MAIN = process.env.MAIN_ROOT;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : '  -- ' + JSON.stringify(detail).slice(0, 400)));
}

async function open(browser, base, url, opts) {
  const env = await C.newContext(browser, opts || {});
  const page = await env.ctx.newPage();
  env.errors = [];
  page.on('pageerror', (e) => env.errors.push(String(e.message || e).slice(0, 200)));
  page.on('dialog', (d) => d.accept());
  await page.goto(base + url);
  await C.settle(page, (opts && opts.wait) || 1800);
  env.page = page;
  return env;
}

async function draw(page, sel) {
  const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + 30, box.y + 40);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 30 + i * 25, box.y + 40 + (i % 2) * 50, { steps: 3 });
  await page.mouse.up();
}

// textContent, not innerText: the trace compares what the page says, not how
// CSS cases it (sentence case is this PR's change, on purpose).
const text = (page, sel) => page.locator(sel).first().textContent().then((t) => t.trim().replace(/\s+/g, ' ')).catch(() => null);

// ---- Part 2: client actions (run on both trees) ---------------------------
const FLOWS = {
  async payOne(page) {
    await page.evaluate(() => { window.__stripeAmount = 31250; });
    await page.click('#invoice-card-501 button[onclick^="startPayment"]');
    await page.waitForSelector('#paySignerName');
    const sheet = await page.evaluate(() => { const m = document.querySelector('#paymentModal .payment-modal, #paymentModal > div'); const r = (m || document.getElementById('paymentModal')).getBoundingClientRect(); return { inView: r.top >= 0 && r.bottom <= innerHeight + 1 }; });
    await page.fill('#paySignerName', 'Kim Reyes');
    await draw(page, '#paySignatureCanvas');
    await page.click('#payAuthContinueBtn');
    await page.waitForSelector('#paymentSubmitBtn');
    const mounted = await page.evaluate(() => {
      const b = document.getElementById('paymentSubmitBtn').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { stripeBox: !!document.querySelector('#paymentElement [data-stripe-mock]'), payTappable: !!hit && (hit.id === 'paymentSubmitBtn' || !!hit.closest('#paymentSubmitBtn')) };
    });
    await page.click('#paymentSubmitBtn');
    await page.waitForSelector('.pay-done-title');
    return { sheet, mounted, done: await text(page, '.pay-done-title'), sub: await text(page, '.pay-done-sub') };
  },
  async payAll(page) {
    await page.evaluate(() => { window.__stripeAmount = 149250; });
    await page.click('.pay-first-btn');
    await page.waitForSelector('#bulkPaySignerName');
    await page.fill('#bulkPaySignerName', 'Kim Reyes');
    await draw(page, '#bulkPaySignatureCanvas');
    await page.click('#bulkPayAuthContinueBtn');
    await page.waitForSelector('#paymentSubmitBtn');
    await page.click('#paymentSubmitBtn');
    await page.waitForSelector('.pay-done-title');
    return { done: await text(page, '.pay-done-title') };
  },
  async approveQuote(page) {
    await page.click('#quote-card-601 button[onclick*="\'approve\'"]');
    await page.click('#portalConfirmOk');
    await page.waitForTimeout(1200);
    return { toast: await text(page, '.th-toast') };
  },
  async declineQuote(page) {
    await page.click('#quote-card-601 button[onclick*="\'decline\'"]');
    await page.fill('#portalPromptTextarea', 'Went with a plumber this time');
    await page.click('#portalPromptOk');
    await page.waitForTimeout(1200);
    return { toast: await text(page, '.th-toast') };
  },
  async askQuestion(page) {
    await page.click('#quote-card-601 button[onclick^="toggleQuestionForm"]');
    await page.fill('#questionText-601', 'Can you do it on a Saturday?');
    await page.click('#quote-card-601 button[onclick^="submitQuestion"]');
    await page.waitForTimeout(1200);
    return { success: await text(page, '#questionSuccess-601') };
  },
  async invoicePdf(page) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#invoice-card-501 button[onclick^="downloadInvoicePDF"]')]);
    return { file: dl.suggestedFilename() };
  },
  async quotePdf(page) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#quote-card-601 button[onclick^="downloadQuotePDF"]')]);
    return { file: dl.suggestedFilename() };
  },
  async historyPdf(page) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('button[onclick^="downloadServiceHistory"]')]);
    return { file: dl.suggestedFilename() };
  },
  async submitRequest(page) {
    await page.fill('#woTitle', 'Dishwasher will not drain');
    await page.fill('#woDescription', 'Standing water after every cycle since Monday.');
    await page.click('#woUrgencyRow button:nth-child(2)');
    await page.click('#woSubmitBtn');
    await page.waitForTimeout(1600);
    return { success: await text(page, '.wo-success-title'), error: await text(page, '#woError') };
  },
  async cancelRequest(page) {
    await page.click('button[onclick^="cancelWorkOrder(1002"]');
    if (await page.locator('#portalPromptTextarea').count()) { await page.fill('#portalPromptTextarea', 'Fixed it myself'); await page.click('#portalPromptOk'); } else await page.click('#portalConfirmOk');
    await page.waitForTimeout(1200);
    return { toast: await text(page, '.th-toast') };
  },
  async requestMessage(page) {
    await page.click('button[onclick^="toggleMessages(1001"]');
    await page.waitForSelector('#woMessageInput-1001');
    const thread = await text(page, '#wo-card-1001 .portal-msg');
    await page.fill('#woMessageInput-1001', 'Thanks, Tuesday works.');
    await page.click('#woMessageSend-1001');
    await page.waitForTimeout(1200);
    return { thread };
  },
  async visitMessage(page) {
    await page.click('button[onclick^="toggleJobMessages(701"]');
    await page.waitForSelector('[id^="jobMessageInput-701"]');
    await page.fill('[id^="jobMessageInput-701"]', 'Dryer is working great, thanks.');
    await page.click('[id^="jobMessageSend-701"]');
    await page.waitForTimeout(1200);
    return {};
  },
  async signContract(page) {
    await draw(page, '#signatureCanvas-1201');
    await page.click('#contract-card-1201 .contract-sign-btn');
    await page.click('#portalConfirmOk');
    await page.waitForTimeout(1200);
    return { toast: await text(page, '.th-toast') };
  },
  async saveDetails(page) {
    await page.click('.settings-profile');
    await page.waitForSelector('#detailName', { state: 'visible' });
    await page.fill('#detailName', 'Kim A. Reyes');
    await page.click('#saveDetailsBtn');
    await page.waitForTimeout(1200);
    return { msg: await text(page, '#detailsMsg, .set-msg.is-ok') };
  },
  async emailPrefs(page) {
    await page.goto(page.url().split('#')[0] + '#notifications');
    await page.waitForTimeout(1200);
    await page.click('label:has(#notifyMessages)');
    await page.waitForTimeout(1200);
    return { checked: await page.isChecked('#notifyMessages') };
  },
  async reportProblem(page) {
    await page.click('#reportBugLink');
    await page.fill('#reportBugMessage', 'The calendar button did nothing.');
    await page.click('#reportBugSubmit');
    await page.waitForTimeout(1200);
    return { success: await text(page, '#reportBugSuccess') };
  },
  async signOut(page) {
    await page.click('#signOutBtnSettings');
    await page.waitForTimeout(1500);
    return { url: new URL(page.url()).pathname };
  },
  async tabBar(page) {
    const out = [];
    for (const label of ['Invoices', 'Request', 'Estimates', 'Visits', 'Home']) {
      await page.click('.portal-nav a:has-text("' + label + '")');
      await page.waitForTimeout(900);
      out.push(new URL(page.url()).pathname);
    }
    return { out };
  },
};
const FLOW_PAGE = { payOne: 'dashboard', payAll: 'dashboard', approveQuote: 'quotes', declineQuote: 'quotes', askQuestion: 'quotes', invoicePdf: 'dashboard', quotePdf: 'quotes', historyPdf: 'jobs', submitRequest: 'work-orders', cancelRequest: 'work-orders', requestMessage: 'work-orders', visitMessage: 'jobs', signContract: 'contracts', saveDetails: 'settings', emailPrefs: 'settings', reportProblem: 'home', signOut: 'settings', tabBar: 'home' };

// Invoices starts Stripe.js 3s after load (#549), so the pay flows wait for it.
async function runFlow(browser, base, name) {
  const env = await open(browser, base, '/portal/' + FLOW_PAGE[name] + '.html', { wait: FLOW_PAGE[name] === 'dashboard' ? 4200 : 1800 });
  let out;
  try { out = await FLOWS[name](env.page); } catch (e) { out = { threw: String(e.message).split('\n')[0] }; }
  const stripe = await env.page.evaluate(() => window.__stripeCalls || []).catch(() => []);
  // Wall-clock stamps (updated_at's milliseconds) differ between any two runs.
  const trace = JSON.parse(JSON.stringify({ out, log: env.log, stripe, errors: env.errors }).replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>'));
  await env.ctx.close();
  return trace;
}

(async () => {
  const browser = await C.launch();
  const b = await C.startServer(BRANCH);
  const m = MAIN ? await C.startServer(MAIN) : null;
  const SIGNED = ['home', 'dashboard', 'quotes', 'jobs', 'work-orders', 'contracts', 'settings'];

  // ---- Part 1: chrome checklist (this branch) ------------------------------
  // PART=flows skips straight to the main-vs-branch comparison; FLOWS=a,b
  // limits which flows run.
  if (process.env.PART !== 'flows') {
  const CAPS_OK = /portal-kicker|home-kicker|next-appt-kicker|upcoming-more-title|attention-title|section-title|home-card-label|home-glance-label|home-refer-title|pay-first-kicker|invoice-chart-title|invoice-section-title|quote-section-title|quote-kicker|quote-total-label|checkup-kicker|warranty-overview-title|history-download-title|job-status-pill|portal-reply-notice-title|wo-form|^label|wo-section-title|contract-section-title|contract-kicker|contract-fact-label|signature-pad-label|set-card-title|job-date-tile|tile-|pill|status|badge/;
  for (const name of SIGNED) {
    const env = await open(browser, b.base, '/portal/' + name + '.html');
    const { page } = env;
    const a = await page.evaluate(C.CHROME_AUDIT);
    const h = a.header;
    check(name + ': header is one sticky row at the top', h && h.position === 'sticky' && h.top === 0 && h.h <= 64, h && { pos: h.position, top: h.top, h: h.h });
    const rowOk = h && h.buttons.filter((x) => !/portal-status/.test(x.cls)).every((x) => Math.abs(x.cy - h.buttons[0].cy) <= 12);
    check(name + ': title and buttons share the row; title not clipped; sentence case', rowOk && !h.title.clipped && h.title.tt === 'none', h && { title: h.title, btns: h.buttons });
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(300);
    const stuck = await page.evaluate(() => Math.round(document.querySelector('.portal-appbar').getBoundingClientRect().top));
    check(name + ': header stays put after scrolling', stuck === 0, stuck);
    await page.evaluate(() => window.scrollTo(0, 0));
    check(name + ': status dot is green and a plain image when healthy', h.status && /is-ok/.test(h.status.cls) && await page.getAttribute('#portalStatus', 'role') === 'img', h.status);
    check(name + ': no sync banner when healthy', h.note && !h.note.shown, h.note);
    const badCaps = a.caps.filter((c) => !CAPS_OK.test(c.el));
    check(name + ': titles and controls are sentence case (eyebrows/labels keep caps)', badCaps.length === 0, badCaps);
    const lipped = a.primaries.filter((p) => p.shadow !== 'none' || p.weight !== '400' || p.tt !== 'none');
    check(name + ': primaries are flat (no lip), weight 400, not uppercase', lipped.length === 0, lipped);
    const small = (await page.evaluate(C.TARGET_AUDIT)).filter((t) => !t.inlineProse && !/^g /.test(t.el + ' ') && !/^label/.test(t.el));
    check(name + ': every control is at least 44px (coarse pointer)', small.length === 0, small);
    const badge = await page.evaluate(() => { const e = document.querySelector('.portal-nav-request .portal-nav-badge'); return e ? getComputedStyle(e).color : null; });
    check(name + ': Request badge digit is dark on orange', badge === null || badge === 'rgb(10, 10, 10)', badge);
    check(name + ': no page errors', env.errors.length === 0, env.errors);
    await env.ctx.close();
  }

  // Same initials on every page: Home learns the name, Invoices reuses it.
  {
    const env = await open(browser, b.base, '/portal/home.html');
    const home = await text(env.page, '.portal-avatar-initials');
    await env.page.goto(b.base + '/portal/dashboard.html'); await C.settle(env.page, 1500);
    const inv = await text(env.page, '.portal-avatar-initials');
    check('avatar initials match across pages (Home KR = Invoices)', home === 'KR' && inv === 'KR', { home, inv });
    await env.ctx.close();
  }

  // Contracts: the title gets the card's width at 390.
  {
    const env = await open(browser, b.base, '/portal/contracts.html');
    const w = await env.page.evaluate(() => Math.round(document.querySelector('#contract-card-1201 .contract-title').getBoundingClientRect().width));
    check('contracts: pending title spans the card (>= 300px at 390)', w >= 300, w);
    await env.ctx.close();
  }

  // Failure -> red dot + banner -> Try again recovers through the page's own refresh.
  for (const name of ['dashboard', 'home', 'contracts']) {
    const env = await open(browser, b.base, '/portal/' + name + '.html', { fail: true });
    const { page } = env;
    const st = await page.evaluate(() => ({ cls: document.getElementById('portalStatus').className, role: document.getElementById('portalStatus').getAttribute('role'), note: document.getElementById('portalSyncNote').innerText.trim(), noteBelowHeader: document.getElementById('portalSyncNote').getBoundingClientRect().top >= document.querySelector('.portal-appbar').getBoundingClientRect().bottom - 1 }));
    check(name + ': a failed load turns the dot red with a Try again banner under the header', /is-trouble/.test(st.cls) && st.role === 'button' && /Try again/.test(st.note) && st.noteBelowHeader, st);
    const rb = await page.locator('.portal-sync-retry').boundingBox();
    check(name + ': Try again is a 44px target', rb && rb.height >= 44, rb);
    env.control.fail = false;
    const before = env.control.reads;
    await page.click('.portal-sync-retry');
    await page.waitForTimeout(1800);
    const after = await page.evaluate(() => ({ cls: document.getElementById('portalStatus').className, note: document.getElementById('portalSyncNote').innerText.trim(), errorCards: document.querySelectorAll('.empty-state.is-error').length }));
    check(name + ': Try again re-runs the page load (no reload) and clears the banner', env.control.reads > before && /is-ok/.test(after.cls) && after.note === '' && after.errorCards === 0 && /\/portal\/[a-z-]+\.html$/.test(page.url()), { reads: env.control.reads - before, after });
    await env.ctx.close();
  }

  // Offline -> grey dot; the existing offline banner says it in words.
  {
    const env = await open(browser, b.base, '/portal/quotes.html');
    await env.ctx.setOffline(true);
    await env.page.waitForTimeout(500);
    const off = await env.page.evaluate(() => ({ cls: document.getElementById('portalStatus').className, banner: document.getElementById('offlinePortalBanner').className, text: document.getElementById('offlinePortalBanner').textContent }));
    check('offline: dot goes grey and the offline banner shows (no " -- " in its copy)', /is-offline/.test(off.cls) && /is-visible/.test(off.banner) && !/ -- /.test(off.text), off);
    await env.ctx.setOffline(false);
    await env.page.waitForTimeout(500);
    check('back online: dot is green again', /is-ok/.test(await env.page.getAttribute('#portalStatus', 'class')));
    await env.ctx.close();
  }

  // Installed app: force the standalone block on (CDP can't emulate
  // display-mode) and measure the header under a 44px status bar.
  {
    const css = fs.readFileSync(path.join(BRANCH, 'portal/portal-polish.css'), 'utf8');
    const i = css.indexOf('@media (max-width: 1023px) and (display-mode: standalone) {');
    let depth = 0; let j = css.indexOf('{', i);
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (depth === 0) break; } }
    const block = css.slice(css.indexOf('{', i) + 1, j);
    const env = await open(browser, b.base, '/portal/home.html');
    await env.page.addStyleTag({ content: '@media (max-width: 1023px) {' + block + '}' });
    const sa = await env.page.evaluate(() => { const h = document.querySelector('.portal-appbar'); const t = document.querySelector('.portal-appbar .portal-kicker').getBoundingClientRect(); return { padTop: getComputedStyle(h).paddingTop, kickerTop: Math.round(t.top), bodyPad: getComputedStyle(document.body).paddingTop }; });
    check('installed app: header pads under the status bar (44px floor + 6), body adds none', sa.padTop === '50px' && sa.kickerTop >= 50 && sa.bodyPad === '0px', sa);
    await env.ctx.close();
  }

  // Manifest.
  {
    const env = await open(browser, b.base, '/portal/manifest.json', { signedIn: false, wait: 200 });
    const man = JSON.parse(await env.page.evaluate(() => document.body.innerText));
    const urls = (man.shortcuts || []).map((s) => s.url).concat(man.icons.map((i) => i.src));
    const codes = [];
    for (const u of urls) codes.push((await env.page.request.get(b.base + u)).status());
    check('manifest: standalone, id = start_url, maskable icons, shortcuts that resolve', man.display === 'standalone' && man.id === man.start_url && man.icons.filter((i) => i.purpose === 'maskable').length === 2 && (man.shortcuts || []).length === 3 && codes.every((c) => c === 200), { codes });
    await env.ctx.close();
  }

  // Every old deep link still lands, and below the sticky header.
  const LINKS = [
    ['/portal/', '/portal/login.html', null, false],
    ['/portal/index.html', '/portal/login.html', null, false],
    ['/portal/dashboard.html#invoice-card-501', '/portal/dashboard.html', '#invoice-card-501'],
    ['/portal/dashboard.html#payFirst', '/portal/dashboard.html', '#payFirst'],
    ['/portal/dashboard.html?invoice=INV-2026-0121', '/portal/dashboard.html', null],
    ['/portal/quotes.html#quote-card-601', '/portal/quotes.html', '#quote-card-601'],
    ['/portal/work-orders.html#wo-card-1001', '/portal/work-orders.html', '#wo-card-1001'],
    ['/portal/contracts.html#contract-card-1201', '/portal/contracts.html', '#contract-card-1201'],
    // Settings' hashes open a section (a pane), not an element with that id.
    ['/portal/settings.html#payment', '/portal/settings.html', '#pane-payment-title'],
    ['/portal/settings.html#referral', '/portal/settings.html', '#pane-referral-title'],
    ['/portal/settings.html#security', '/portal/settings.html', '#pane-security-title'],
    ['/portal/jobs.html', '/portal/jobs.html', null],
    ['/portal/home.html', '/portal/home.html', null],
  ];
  for (const [url, lands, target, signedIn] of LINKS) {
    const env = await open(browser, b.base, url, { signedIn: signedIn !== false, wait: 2600 });
    const p = new URL(env.page.url()).pathname;
    let pos = null;
    if (target) pos = await env.page.evaluate((sel) => { const el = document.querySelector(sel); const hd = document.querySelector('.portal-appbar'); if (!el) return { missing: true }; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), headerBottom: Math.round(hd.getBoundingClientRect().bottom), visible: r.height > 0 }; }, target);
    const ok = p === lands && (!target || (pos && !pos.missing && pos.visible && pos.top >= pos.headerBottom - 1));
    check('deep link ' + url + ' still works' + (target ? ' (target below the header)' : ''), ok && env.errors.length === 0, { p, pos, errors: env.errors });
    await env.ctx.close();
  }

  // No sideways scroll anywhere.
  const over = [];
  for (const name of C.PAGES) {
    for (const scheme of ['dark', 'light']) {
      for (const width of [390, 820, 1280]) {
        const env = await open(browser, b.base, '/portal/' + name + '.html', { signedIn: !['login', 'set-password'].includes(name), viewport: { width, height: 900 }, colorScheme: scheme, dpr: 1, wait: 1400 });
        const o = await env.page.evaluate(C.OVERFLOW);
        if (o.over) over.push(name + ' ' + scheme + width + ' ' + o.sw);
        await env.ctx.close();
      }
    }
  }
  check('no horizontal scroll: 9 pages x 390/820/1280 x dark/light', over.length === 0, over);

  }

  // ---- Parts 2 and 3: main vs. this branch ---------------------------------
  if (!m) {
    console.log('\nMAIN_ROOT not set: skipping the main-vs-branch flow and fingerprint comparison.');
  } else {
    for (const name of Object.keys(FLOWS).filter((n) => !process.env.FLOWS || process.env.FLOWS.split(',').includes(n))) {
      const t1 = await runFlow(browser, m.base, name);
      const t2 = await runFlow(browser, b.base, name);
      const same = JSON.stringify(t1) === JSON.stringify(t2);
      const sane = !t2.out.threw && t2.errors.length === 0;
      if (!same && process.env.OUT) fs.writeFileSync(path.join(process.env.OUT, 'flow-' + name + '.json'), JSON.stringify({ main: t1, branch: t2 }, null, 1));
      check('flow ' + name + ': identical to main (writes, edge calls, Stripe calls, result)', same && sane, same ? t2 : { main: t1, branch: t2 });
      if (name === 'payOne') check('pay sheet: Stripe Payment Element mounts and Pay is tappable', t2.out.mounted && t2.out.mounted.stripeBox && t2.out.mounted.payTappable && t2.out.sheet && t2.out.sheet.inView, t2.out);
    }
    if (process.env.FLOWS) { /* flow debugging only */ } else {
    const allowedNew = /^(span\|portalStatus|div\|portalSyncNote)\|/;
    const fpLines = [];
    for (const empty of [false, true]) {
      for (const name of SIGNED) {
        const fps = [];
        for (const base of [m.base, b.base]) {
          const env = await C.newContext(browser, {});
          if (empty) await env.ctx.route(/supabase\.co\/rest\/v1\/(?!rpc)/, (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' }, body: '[]' }) : r.fallback());
          const page = await env.ctx.newPage();
          await page.goto(base + '/portal/' + name + '.html');
          await C.settle(page, 1800);
          fps.push(await page.evaluate(C.FINGERPRINT));
          await env.ctx.close();
        }
        const [fm, fb] = fps;
        const moneySame = JSON.stringify(fm.money) === JSON.stringify(fb.money);
        const added = fb.wiring.filter((w) => !fm.wiring.includes(w));
        const removed = fm.wiring.filter((w) => !fb.wiring.includes(w));
        const label = name + (empty ? ' (empty)' : '');
        fpLines.push(label + ': ' + fb.money.length + ' amounts/counts, ' + fb.wiring.length + ' wiring entries');
        check('fingerprint ' + label + ': every amount and count is byte-identical to main', moneySame, { main: fm.money, branch: fb.money });
        check('fingerprint ' + label + ': no wiring removed or changed; only the status dot/banner added', removed.length === 0 && added.every((w) => allowedNew.test(w)), { added, removed });
      }
    }
    fs.writeFileSync(path.join(__dirname, 'fingerprint-summary.txt'), fpLines.join('\n') + '\n');
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  await browser.close();
  b.server.close(); if (m) m.server.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
