// Cross-surface consistency harness (2026-10-31). Dev-only; nothing on the
// site loads this. Renders Workspace tool pages (via the redundancy pass's
// stubs, docs/workspace-redundancy-2026-10-31/harness/common.js) and client
// portal pages (via the portal redesign's stubs,
// docs/portal-redesign-2026-10-31/harness/common.js) from ONE checkout, and
// measures the computed styles of corresponding chrome on both: the app
// bar, title, kicker, back chevron, primary buttons, pills, count badges,
// empty states, cards and the page gutter. Prints a per-category table of
// distinct "signatures" per surface so mismatches stand out, and writes
// <out>/measure.json.
//
//   PLAYWRIGHT=/opt/node-tools/node_modules/playwright SUPABASE_UMD=/path/supabase.js REAL_FONTS=1 \
//     node docs/cross-surface-consistency-2026-10-31/harness/measure.js <checkout root> <out dir>
//
// SHOTS=1 also writes <out>/<surface>-<page>.png at 390x844 dark.
process.env.PLAYWRIGHT = process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright';
const fs = require('fs');
const path = require('path');
const P = require('../../portal-redesign-2026-10-31/harness/common');
const W = require('../../workspace-redundancy-2026-10-31/harness/common');

const root = path.resolve(process.argv[2] || path.join(__dirname, '../../..'));
const out = path.resolve(process.argv[3] || '/tmp/cross-surface');
fs.mkdirSync(out, { recursive: true });

const TOOLS = [
  ['workspace', '/tools/workspace.html'],
  ['job-tracker', '/tools/job-tracker.html'],
  ['job-detail', '/tools/job-detail.html?id=101'],
  ['invoices', '/tools/invoice-generator.html'],
  ['clients', '/tools/clients.html'],
  ['client-detail', '/tools/client-detail.html?name=Maria%20Lopez'],
  ['settings', '/tools/settings.html'],
  // Scrolled states for the shots (SHOTS=1): Home's Your week (Start my
  // day) and Secure documents (Upload) primaries.
  ['workspace-week', '/tools/workspace.html', '[data-shift-open]'],
  ['workspace-upload', '/tools/workspace.html', '#secureDocUploadBtn'],
  // Round 2: just under Next Job, where Today's route (and Route all) sat
  // on main; the daily actions exist on both, so both shots line up. And
  // Route Planner, now the one place the whole day's route lives.
  ['workspace-below-hero', '/tools/workspace.html', '#dashPrimaryStrip'],
  ['route-planner', '/tools/route-planner.html'],
];
const PORTAL = ['home', 'dashboard', 'jobs', 'quotes', 'work-orders', 'contracts', 'settings', 'home-attention', 'jobs-history'];
const PORTAL_SCROLL = { 'home-attention': ['home', '.attention-title'], 'jobs-history': ['jobs', '.job-status-pill'] };

// Selectors per category, per surface. Only visible elements are measured.
const CATS = {
  appbar: { tools: 'body.th-tool-page .hub-header', portal: '.portal-header' },
  title: { tools: '.hub-header .hub-title', portal: '.portal-header .portal-title' },
  kicker: { tools: '.hub-header .th-kicker', portal: '.portal-header .portal-kicker' },
  back: { tools: '.hub-header-back', portal: '.portal-back-btn, .settings-back, .th-step-back' },
  headerBtn: { tools: '.hub-header .th-hdr-actions > :is(a,button), .hub-header .th-hdr-overflow', portal: '.portal-header .portal-icon-btn:not(.portal-back-btn)' },
  primary: { tools: '.primary-btn', portal: ':is(.btn.orange, .btn.blue, .btn-primary)' },
  pill: { tools: ':is(.th-v2-pill, .th-pill, .badge-status)', portal: ':is(.job-status-pill, .status-pill, .portal-unread-pill, [class*="status-badge"], .quote-status, .invoice-status, .wo-status, .contract-status, .pill)' },
  navBadge: { tools: '.th-bottom-nav :is(.th-bn-badge, .th-badge, [class*="badge"])', portal: '.portal-nav :is(.portal-nav-dot, [class*="badge"])' },
  empty: { tools: ':is(.empty-state, .empty-state-small)', portal: '.empty-state' },
  emptyIcon: { tools: ':is(.empty-state, .empty-state-small) :is(svg, .empty-state-icon)', portal: '.empty-state :is(.empty-state-icon, svg)' },
  card: { tools: ':is(.th-v2-card, .hub-card, .card)', portal: ':is(.invoice-card, .quote-card, .job-card, .wo-card, .set-card, .card, .portal-card)' },
  nav: { tools: '.th-bottom-nav, nav.th-bn', portal: '.portal-nav' },
};

const MEASURE = (cats) => {
  const pick = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28),
      cls: String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className).slice(0, 60),
      h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10, top: Math.round(r.top), left: Math.round(r.left),
      ff: cs.fontFamily.split(',')[0].replace(/["']/g, ''), fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, ls: cs.letterSpacing, tt: cs.textTransform,
      color: cs.color, bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopStyle, radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow, pad: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft,
      pos: cs.position, backdrop: cs.backdropFilter || cs.webkitBackdropFilter || '', fill: cs.fill,
    };
  };
  const res = {};
  for (const [k, sel] of Object.entries(cats)) {
    if (!sel) continue;
    res[k] = Array.from(document.querySelectorAll(sel)).filter((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    }).slice(0, 12).map(pick);
  }
  const main = document.querySelector('main, #mainContent, .portal-main, .container') || document.body;
  res.gutter = Math.round(main.getBoundingClientRect().left + parseFloat(getComputedStyle(main).paddingLeft || 0));
  const av = document.querySelector('.portal-avatar-initials');
  res.avatar = av ? av.textContent : null;
  res.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  return res;
};

(async () => {
  const { server, base } = await P.startServer(root);
  const browser = await P.launch();
  const data = { tools: {}, portal: {} };
  const surfCats = (s) => Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, v[s]]));
  const scrollTo = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return;
    const det = el.closest('details'); if (det) det.open = true;
    const sec = el.closest('.section-block.collapsed, .section-block.is-collapsed'); if (sec) sec.classList.remove('collapsed', 'is-collapsed');
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 300);
  }, sel);
  for (const [name, url, scrollSel] of TOOLS) {
    const ctx = await W.newContext(browser, base, { theme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.goto(base + url);
    await page.waitForTimeout(3000);
    if (process.env.REAL_FONTS) await page.evaluate(() => document.fonts.ready);
    if (scrollSel) { await scrollTo(page, scrollSel); await page.waitForTimeout(400); }
    data.tools[name] = await page.evaluate(MEASURE, surfCats('tools'));
    data.tools[name].errors = errors;
    if (process.env.SHOTS) await page.screenshot({ path: path.join(out, 'tools-' + name + '.png') });
    await ctx.close();
  }
  for (const name of PORTAL) {
    const { ctx } = await P.newContext(browser, {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    const [file, scrollSel] = PORTAL_SCROLL[name] || [name];
    await page.goto(base + '/portal/' + file + '.html');
    await P.settle(page, 2200);
    if (scrollSel) { await scrollTo(page, scrollSel); await page.waitForTimeout(400); }
    data.portal[name] = await page.evaluate(MEASURE, surfCats('portal'));
    data.portal[name].errors = errors;
    if (process.env.SHOTS) await page.screenshot({ path: path.join(out, 'portal-' + name + '.png') });
    await ctx.close();
  }
  // Empty states need the EMPTY portal seed; tools pages show theirs with no
  // matching data on Clients' search, which is enough for type/colour.
  fs.writeFileSync(path.join(out, 'measure.json'), JSON.stringify(data, null, 1));

  const SIG = { appbar: ['h', 'top', 'pos', 'bg', 'backdrop', 'pad'], title: ['ff', 'fs', 'fw', 'lh', 'ls', 'tt', 'color'], kicker: ['ff', 'fs', 'fw', 'ls', 'tt', 'color'],
    back: ['h', 'w', 'left', 'radius', 'bg', 'border', 'color', 'fs'], headerBtn: ['h', 'w', 'radius', 'bg', 'border', 'color'],
    primary: ['ff', 'fs', 'fw', 'tt', 'ls', 'bg', 'border', 'shadow', 'radius', 'h'], pill: ['ff', 'fs', 'fw', 'tt', 'ls', 'radius', 'pad', 'h'],
    navBadge: ['ff', 'fs', 'fw', 'h', 'w', 'radius', 'bg', 'color'], empty: ['ff', 'fs', 'fw', 'color', 'pad', 'radius', 'bg', 'border'],
    emptyIcon: ['h', 'w', 'color', 'fill', 'bg', 'radius'], card: ['radius', 'bg', 'border', 'shadow', 'pad'], nav: ['h', 'bg', 'backdrop', 'border'] };
  for (const [cat, keys] of Object.entries(SIG)) {
    console.log('\n== ' + cat);
    for (const surf of ['tools', 'portal']) {
      const seen = new Map();
      for (const [pg, m] of Object.entries(data[surf])) {
        for (const e of (m[cat] || [])) {
          const sig = keys.map((k) => k + '=' + e[k]).join(' | ');
          if (!seen.has(sig)) seen.set(sig, []);
          seen.get(sig).push(pg + ':' + (e.text || e.cls).slice(0, 18));
        }
      }
      for (const [sig, where] of seen) console.log('  ' + surf.padEnd(6) + ' ' + sig + '   <- ' + [...new Set(where)].slice(0, 4).join(', ') + (where.length > 4 ? ' (+' + (where.length - 4) + ')' : ''));
    }
  }
  console.log('\n== gutter / overflow / avatar / errors');
  for (const surf of ['tools', 'portal']) for (const [pg, m] of Object.entries(data[surf])) console.log('  ' + surf + ' ' + pg.padEnd(14) + ' gutter=' + m.gutter + ' overflowX=' + m.overflowX + ' avatar=' + m.avatar + ' errors=' + m.errors.length);
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
