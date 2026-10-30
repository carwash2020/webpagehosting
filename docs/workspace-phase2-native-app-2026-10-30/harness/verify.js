// Behaviour checks for PR #543 (Home, Jobs, Job detail), same stubs as
// shoot.js. Prints PASS/FAIL lines: add a job, Done, the status dropdown,
// opening a job from its title, Job detail's Call/Text/Directions/Invoice/
// Expense, the back chevron, Mark done, the lit Jobs tab, the View sheet,
// the one-time tip, Home's Today/Insights switch, and page errors.
// Review round 3 adds: the status dot's healthy / live-updates-off / trouble
// states on all three pages (and that the dot and the banner agree), Job
// detail's one "⋯" header button and the three actions behind it, the title
// fitting, the bottom bar's New label colour and tap, Mark done's width and
// tap, and Home's Open job / Route today pair.
// Touch-ups after #543 add: Add a job and Templates sharing one row on
// Jobs (and Templates still opening, folding back, "+ New template" and
// its ? still wired), and Mark done being flat (no lip), same type as
// Start the clock, still on markJobDoneHere().
//
//   SUPABASE_UMD=/path/to/supabase.js node docs/workspace-phase2-native-app-2026-10-30/harness/verify.js http://localhost:8543
// (SUPABASE_UMD: see live-stub.js. Without it the "healthy" check expects
// grey instead of green, since live updates can't connect.)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { installLiveStub } = require('./live-stub');
(async () => {
  const base = process.argv[2];
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark', serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1');
    const e = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const d = new Date().toISOString().slice(0, 10);
    localStorage.setItem('th_auth_session', JSON.stringify({ access_token: e({ a: 1 }) + '.' + e({ aal: 'aal2' }) + '.s', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 86400, email: 'connor@triplehenterprisesllc.biz' }));
    localStorage.setItem('th_onboarding_v1_seen_connor@triplehenterprisesllc.biz', '1');
    sessionStorage.setItem('th_mfa_nag_dismissed', '1');
    localStorage.setItem('th_tracker_jobs', JSON.stringify([
      { id: 101, title: 'Dryer not heating', client: 'Maria Lopez', phone: '435-555-0101', address: '1 Main St', priority: 'high', date: d, status: 'in-progress' },
      { id: 102, title: 'Dishwasher leak', client: 'Dan Ortiz', phone: '435-555-0102', address: '2 Main St', priority: 'medium', date: d, status: 'not-started' },
      { id: 104, title: 'Fridge ice maker', client: 'Greg Hall', phone: '435-555-0104', address: '3 Main St', priority: 'low', date: d, status: 'done' }]));
  });
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith(base)) return r.continue(); if (/supabase\.co/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: /account_roles/.test(u) ? '[{"email":"connor@triplehenterprisesllc.biz","role_name":"Owner","can_manage_invoices":true,"can_view_finance":true,"can_manage_reviews":true}]' : '[]' }); return r.abort(); });
  const live = await installLiveStub(ctx);
  const results = [];
  process.on('exit', () => { if (!results.printed) console.log(results.join('\n')); });
  const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + JSON.stringify(extra) : ''));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));

  // ---- Jobs: hit areas ----
  await p.goto(base + '/tools/job-tracker.html', { waitUntil: 'load' }); await p.waitForTimeout(3000);
  // Touch-ups after #543: on a phone the ? shows once the Templates card is
  // open (the collapsed tile is half width), so open it for this check.
  await p.evaluate(() => toggleFormSection('templatesFormSection', true)); await p.waitForTimeout(500);
  const helpHit = await p.evaluate(() => {
    const hb = document.querySelector('#templatesFormSection .form-section-header .help-btn');
    hb.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = hb.getBoundingClientRect();
    return ['top', 'left', 'bottom'].map((s) => { const x = s === 'left' ? r.left - 5 : r.left + r.width / 2; const y = s === 'top' ? r.top - 5 : s === 'bottom' ? r.bottom + 5 : r.top + r.height / 2; const h = document.elementFromPoint(x, y); return s + ':' + !!(h && h.closest('.help-btn')); });
  });
  ok('jobs: templates ? 44px hit area (5px outside, 3 sides)', helpHit.every((x) => x.endsWith('true')), helpHit);
  await p.evaluate(() => toggleFormSection('templatesFormSection')); await p.waitForTimeout(500);
  const hits = await p.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelector('.job-card-title > a').scrollIntoView({ block: 'center', behavior: 'instant' });
    const at = (x, y) => document.elementFromPoint(x, y);
    const out = {};
    const badge = document.querySelector('#realtimeBadge');
    if (badge) { const r = badge.getBoundingClientRect(); const h = at(r.left - 4, r.top + r.height / 2); out.badgeEdge = !!(h && h.closest('#realtimeBadge')); out.badgeRetry = badge.classList.contains('is-retryable'); }
    const hb = document.querySelector('#templatesFormSection .form-section-header .help-btn');
    if (hb) { const r = hb.getBoundingClientRect(); const h = at(r.left + r.width / 2, r.top - 5); out.helpEdge = !!(h && h.closest('.help-btn')); }
    const t = document.querySelector('.job-card-title > a');
    if (t) { const r = t.getBoundingClientRect(); const h = at(r.left + 10, r.top + 3); const h2 = at(r.right - 4, r.bottom - 6); out.titleTop = !!(h && h.closest('.job-card-title > a')); out.titleBottom = !!(h2 && h2.closest('.job-card-title > a, .job-badges')); out.titleH = Math.round(r.height); }
    return out;
  });
  // Round 3: the old red retry dot is only red with trouble now; force the
  // trouble state to check its 44px hit area.
  const troubleHit = await p.evaluate(() => {
    localStorage.setItem('th_sync_last', JSON.stringify({ ok: false, type: 'push', error: 'http-503', time: new Date().toISOString() }));
    window.dispatchEvent(new CustomEvent('th-sync-status'));
    window.scrollTo(0, 0);
    const badge = document.querySelector('#realtimeBadge'); const r = badge.getBoundingClientRect();
    const h = document.elementFromPoint(r.left - 4, r.top + r.height / 2);
    const res = !!(h && h.closest('#realtimeBadge'));
    localStorage.setItem('th_sync_last', JSON.stringify({ ok: true, type: 'push', error: null, time: new Date().toISOString() }));
    window.dispatchEvent(new CustomEvent('th-sync-status'));
    return res;
  });
  ok('jobs: red (trouble) status dot hit area 4px outside its box', troubleHit);
  ok('jobs: job title link hit at top/bottom of padded box', hits.titleTop && hits.titleBottom);

  // ---- Touch-ups after #543: Add a job + Templates share one row ----
  const row = await p.evaluate(() => {
    window.scrollTo(0, 0);
    const t = document.querySelector('#tab-jobs > .th-sheet-trigger').getBoundingClientRect();
    const s = document.getElementById('templatesFormSection'); const r = s.getBoundingClientRect();
    const h3 = s.querySelector('.form-section-header h3');
    const vis = (h3.querySelector('.jt-tpl-word').textContent || '');
    const lead = h3.querySelector('.jt-tpl-lead').getBoundingClientRect();
    const card = document.querySelector('#jobsList .job-card').getBoundingClientRect();
    const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { midTapToggles: !!(mid && mid.closest('.form-section-header')) && !(mid.closest('.help-btn')), trig: [Math.round(t.top), Math.round(t.left), Math.round(t.width), Math.round(t.height)], tpl: [Math.round(r.top), Math.round(r.left), Math.round(r.width), Math.round(r.height)], visWord: vis, leadHidden: lead.width <= 1, a11yName: h3.textContent.replace(/\?/g, '').replace(/\s+/g, ' ').trim(), cardTop: Math.round(card.top), clipped: h3.scrollWidth > h3.clientWidth + 1 };
  });
  ok('jobs: Add a job and Templates share one row (same top/height, side by side), name still "Recurring job templates" for a screen reader',
    row.trig[0] === row.tpl[0] && Math.abs(row.trig[3] - row.tpl[3]) <= 2 && row.tpl[1] > row.trig[1] + row.trig[2] && row.leadHidden && /^Recurring job templates/.test(row.a11yName) && !row.clipped && row.midTapToggles, row);
  await p.click('#templatesFormSection .form-section-header .collapse-chevron'); await p.waitForTimeout(500);
  const open = await p.evaluate(() => { const s = document.getElementById('templatesFormSection'); const r = s.getBoundingClientRect(); const t = document.querySelector('#tab-jobs > .th-sheet-trigger').getBoundingClientRect(); return { collapsed: s.classList.contains('is-collapsed'), w: Math.round(r.width), trigW: Math.round(t.width), below: r.top >= t.bottom - 1, newBtn: !!s.querySelector('button[onclick="addTemplatePrompt()"]').offsetParent, leadShown: s.querySelector('.jt-tpl-lead').getBoundingClientRect().width > 1 }; });
  ok('jobs: tapping Templates opens its card full width under a full-width Add a job (same as before)', !open.collapsed && open.w >= 360 && open.trigW >= 360 && open.below && open.newBtn && open.leadShown, open);
  const newTpl = await p.evaluate(() => { let n = 0; const orig = window.addTemplatePrompt; window.addTemplatePrompt = () => { n++; }; document.querySelector('#templatesFormSection button[onclick="addTemplatePrompt()"]').click(); window.addTemplatePrompt = orig; return n; });
  ok('jobs: "+ New template" still calls addTemplatePrompt()', newTpl === 1);
  await p.click('#templatesFormSection .form-section-header .help-btn'); await p.waitForTimeout(400);
  const info = await p.evaluate(() => { const o = document.getElementById('helpModalOverlay'); const res = { open: !!(o && o.classList.contains('is-open')), text: o ? o.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : null, stillOpen: !document.getElementById('templatesFormSection').classList.contains('is-collapsed') }; if (typeof closeHelpModal === 'function') closeHelpModal(); return res; });
  await p.waitForTimeout(300);
  ok('jobs: the Templates ? (on the open card) opens its info without toggling the card', info.open && /templat/i.test(info.text) && info.stillOpen, info);
  await p.click('#templatesFormSection .form-section-header .collapse-chevron'); await p.waitForTimeout(500);
  ok('jobs: tapping Templates again folds it back into the shared row', await p.evaluate(() => { const s = document.getElementById('templatesFormSection'); const t = document.querySelector('#tab-jobs > .th-sheet-trigger'); return s.classList.contains('is-collapsed') && Math.round(s.getBoundingClientRect().top) === Math.round(t.getBoundingClientRect().top); }));


  // ---- Jobs: behavior smoke ----
  await p.click('.th-sheet-trigger[aria-controls="jobFormSection"]');
  await p.waitForTimeout(400);
  await p.fill('#jobTitle', 'Smoke test job');
  await p.fill('#jobClient', 'Test Client');
  await p.evaluate(() => { const s = document.querySelector('#jobFormSection button[onclick*="addJob"], #addJobBtn'); s.click(); });
  await p.waitForTimeout(800);
  let jobs = await p.evaluate(() => JSON.parse(localStorage.getItem('th_tracker_jobs')));
  ok('jobs: Add a Job sheet saves a new job', jobs.some((j) => j.title === 'Smoke test job'), { n: jobs.length });
  await p.evaluate(() => document.querySelector('.job-card[data-job-id="102"] .job-done-btn').click());
  await p.waitForTimeout(600);
  jobs = await p.evaluate(() => JSON.parse(localStorage.getItem('th_tracker_jobs')));
  ok('jobs: Done button sets status done', (jobs.find((j) => j.id === 102) || {}).status === 'done');
  await p.evaluate(() => { const s = document.querySelector('.job-card[data-job-id="101"] .status-select'); s.value = 'not-started'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(600);
  jobs = await p.evaluate(() => JSON.parse(localStorage.getItem('th_tracker_jobs')));
  ok('jobs: status select changes status', (jobs.find((j) => j.id === 101) || {}).status === 'not-started');
  const sheetOpen = await p.evaluate(() => { const c = document.querySelector('.quick-actions-cancel'); const open = !!(c && c.offsetParent); if (open) c.click(); return open; });
  console.log('(status change left an action sheet open:', sheetOpen, ')');
  await p.waitForTimeout(500);
  await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('.job-card[data-job-id="101"] .job-card-title > a').scrollIntoView({ block: 'center', behavior: 'instant' }); });
  const t = await p.$('.job-card[data-job-id="101"] .job-card-title > a');
  const tb = await t.boundingBox();
  await Promise.all([p.waitForURL(/job-detail\.html\?id=101/, { timeout: 8000 }), p.mouse.click(tb.x + 8, tb.y + 4)]);
  ok('jobs: tapping the top edge of a title opens Job detail', /job-detail\.html\?id=101/.test(p.url()));

  // ---- Job detail ----
  await p.waitForTimeout(2500);
  await p.evaluate(() => { const j = JSON.parse(localStorage.getItem('th_tracker_jobs')); j.find((x) => x.id === 101).status = 'in-progress'; localStorage.setItem('th_tracker_jobs', JSON.stringify(j)); });
  await p.reload(); await p.waitForTimeout(2500);
  ok('detail: header title is the job title', (await p.textContent('#jobHeaderTitle')).trim() === 'Dryer not heating');
  const backPos = await p.evaluate(() => { const a = document.querySelector('.hub-header-back a'); const r = a.getBoundingClientRect(); const right = document.querySelector('.hub-header-right'); return { inRight: !!right.contains(a), left: Math.round(r.left) }; });
  ok('detail: back chevron is top-left, outside the right-hand buttons', !backPos.inRight && backPos.left < 20, backPos);
  const d = await p.evaluate(() => {
    const links = [...document.querySelectorAll('.job-quick-action')].map((a) => (a.textContent.trim() + '=' + (a.getAttribute('href') || a.getAttribute('onclick') || '')).slice(0, 90));
    const a = document.querySelector('.job-hero-contact a[href^="tel:"]');
    const r = a.getBoundingClientRect();
    const h = document.elementFromPoint(r.left + 5, r.top + 3);
    const nav = [...document.querySelectorAll('.th-bottom-nav a.is-active')].map((x) => x.textContent.trim() + ':' + x.getAttribute('aria-current') + ':' + x.getAttribute('href'));
    return { links, telH: Math.round(r.height), telTop: !!(h && h.closest('a[href^="tel:"]')), nav, back: !!document.querySelector('a[href="/tools/job-tracker.html"][aria-label="Back to Job Tracker"]') };
  });
  ok('detail: quick actions intact (Call/Text/Directions/Invoice/Expense)', ['Call', 'Text', 'Directions', 'Invoice', 'Expense'].every((w) => d.links.some((l) => l.toLowerCase().startsWith(w.toLowerCase()))), d.links);
  ok('detail: Invoice action links to invoice generator', d.links.some((l) => /invoice-generator\.html/.test(l)));
  ok('detail: hero phone link hit box >= 44 and hit at top', d.telH >= 44 && d.telTop, { h: d.telH });
  ok('detail: Jobs tab lit, aria-current=true, href job-tracker', d.nav.length === 1 && d.nav[0] === 'Jobs:true:/tools/job-tracker.html', d.nav);
  ok('detail: back to Job Tracker link present', d.back);

  // ---- Round 3, item 1: the status dot and the sync banner agree ----
  const RED = await p.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--status-error)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  const GREEN = await p.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--status-live)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  const dotState = () => p.evaluate(() => {
    const dot = document.getElementById('realtimeDot');
    const note = document.getElementById('syncStatusText') || document.getElementById('thSyncNote');
    const nr = note ? note.getBoundingClientRect() : null;
    return { bg: getComputedStyle(dot).backgroundColor, cls: dot.className, trouble: !!dot.closest('.th-status.is-trouble'),
      banner: !!(note && note.classList.contains('is-issue') && nr.height > 0 && getComputedStyle(note).display !== 'none'), text: note ? note.textContent.trim() : null, label: document.getElementById('realtimeBadge').getAttribute('aria-label') };
  });
  const setSync = (v) => p.evaluate((v) => { localStorage.setItem('th_sync_last', JSON.stringify(Object.assign({ type: 'push', time: new Date().toISOString() }, v))); window.dispatchEvent(new CustomEvent('th-sync-status')); }, v);
  for (const [name, url] of [['home', '/tools/workspace.html'], ['jobs', '/tools/job-tracker.html'], ['detail', '/tools/job-detail.html?id=101']]) {
    await p.goto(base + url, { waitUntil: 'load' }); await p.waitForTimeout(3000);
    let st = await dotState();
    ok(name + ': healthy sync -> ' + (live ? 'green' : 'grey, not red') + ' dot, no banner', (live ? st.bg === GREEN && /is-live/.test(st.cls) : st.bg !== RED) && !st.trouble && !st.banner, st);
    await p.evaluate(() => typeof updateRealtimeBadge === 'function' && updateRealtimeBadge('CHANNEL_ERROR'));
    st = await dotState();
    ok(name + ': live updates dropped alone -> grey dot, not red, no banner', st.bg !== RED && st.bg !== GREEN && !st.trouble && !st.banner, st);
    await setSync({ ok: false, error: 'http-503' });
    st = await dotState();
    ok(name + ': backup failed -> red dot AND banner, in plain words', st.bg === RED && st.trouble && st.banner && /Couldn't back up/.test(st.text) && !/http-503/.test(st.text) && /Sync problem/.test(st.label), st);
    await setSync({ ok: false, error: 'no-data-yet' });
    st = await dotState();
    ok(name + ': "no-data-yet" -> no red, no banner', st.bg !== RED && !st.trouble && !st.banner, st);
    await p.evaluate(() => { localStorage.setItem('th_mirror_failures', JSON.stringify([{ table: 'th_jobs', op: 'upsert', error: 'x', ids: [], time: new Date().toISOString() }])); window.dispatchEvent(new CustomEvent('th-mirror-failure')); });
    st = await dotState();
    ok(name + ': a recent mirror failure -> red dot AND banner', st.bg === RED && st.trouble && st.banner && /1 recent save/.test(st.text), st);
    await p.evaluate(() => { localStorage.setItem('th_mirror_failures', JSON.stringify([{ table: 'th_jobs', op: 'upsert', error: 'x', ids: [], time: new Date(Date.now() - 2 * 864e5).toISOString() }])); window.dispatchEvent(new CustomEvent('th-mirror-failure')); });
    st = await dotState();
    ok(name + ': a 2-day-old mirror failure alone -> no red, no banner', st.bg !== RED && !st.trouble && !st.banner, st);
    await p.evaluate(() => { localStorage.removeItem('th_mirror_failures'); window.dispatchEvent(new CustomEvent('th-mirror-failure')); });
    await setSync({ ok: true, error: null });
    st = await dotState();
    ok(name + ': recovered -> red and banner both clear', st.bg !== RED && !st.trouble && !st.banner, st);
  }
  // Tapping the red dot retries the backup (pushSync) instead of reloading.
  await setSync({ ok: false, error: 'http-503' });
  const retried = await p.evaluate(async () => { let called = 0; const orig = window.pushSync; window.pushSync = () => { called++; return Promise.resolve({ ok: true }); }; document.getElementById('realtimeBadge').click(); await new Promise((r) => setTimeout(r, 50)); window.pushSync = orig; return called; });
  ok('detail: tapping the red dot retries the backup', retried === 1, { retried });
  await setSync({ ok: true, error: null });

  // ---- Round 3, item 2: one ⋯ on Job detail, nothing lost ----
  const hdr = await p.evaluate(() => {
    const vis = [...document.querySelectorAll('.hub-header-right .th-hdr-actions > *')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.className);
    const t = document.getElementById('jobHeaderTitle');
    return { vis, clipped: t.scrollWidth > t.clientWidth, text: t.textContent };
  });
  ok('detail: one header button (the ⋯), title "Dryer not heating" not cut off', hdr.vis.length === 1 && /th-hdr-overflow/.test(hdr.vis[0]) && !hdr.clipped, hdr);
  await p.click('.th-hdr-overflow'); await p.waitForTimeout(400);
  const rows = await p.evaluate(() => [...document.querySelectorAll('.quick-actions-sheet .quick-actions-btn:not(.quick-actions-cancel)')].map((b) => b.textContent.trim()));
  ok('detail: ⋯ lists the shift clock, Search and More tools', rows.length === 3 && /Start my day|On shift|end time/.test(rows[0]) && rows[1] === 'Search' && rows[2] === 'More tools', rows);
  await p.click('.quick-actions-sheet .quick-actions-btn:has-text("Search")'); await p.waitForTimeout(400);
  ok('detail: ⋯ > Search opens the search palette', await p.evaluate(() => { const o = document.getElementById('thCmdkOverlay'); return !!(o && o.classList.contains('is-open')); }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('.th-hdr-overflow'); await p.waitForTimeout(400);
  await p.click('.quick-actions-sheet .quick-actions-btn:has-text("More tools")'); await p.waitForTimeout(400);
  ok('detail: ⋯ > More tools opens the More sheet', await p.evaluate(() => { const s = document.getElementById('thMoreSheet'); return !!(s && !s.hasAttribute('hidden') && document.body.classList.contains('th-more-open')); }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.evaluate(() => { document.body.classList.remove('th-more-open'); const s = document.getElementById('thMoreSheet'); if (s && !s.hasAttribute('hidden') && typeof window.closeAllSheets === 'function') window.closeAllSheets(); });
  await p.click('.th-hdr-overflow'); await p.waitForTimeout(400);
  await p.click('.quick-actions-sheet .quick-actions-btn >> nth=0'); await p.waitForTimeout(500);
  ok('detail: ⋯ > Start my day opens the shift sheet', await p.evaluate(() => !!document.querySelector('.quick-actions-overlay.th-shift')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelectorAll('.quick-actions-overlay').forEach((o) => o.remove()));
  // A longer real title (from the seed list): how much fits.
  const longT = await p.evaluate(() => { const t = document.getElementById('jobHeaderTitle'); const old = t.textContent; const out = {}; for (const s of ['Garbage disposal swap', 'Hang 3 shelves + TV mount']) { t.textContent = s; out[s] = t.scrollWidth > t.clientWidth; } t.textContent = old; out.maxW = Math.round(t.parentElement.getBoundingClientRect().width); return out; });
  ok('detail: normal-length titles fit ("Garbage disposal swap")', longT['Garbage disposal swap'] === false, longT);

  // ---- Round 3, item 5: Mark done is full width ----
  const md = await p.evaluate(() => { const b = document.querySelector('[data-mark-done]'); const card = document.querySelector('.job-next'); const cs = getComputedStyle(card); const r = b.getBoundingClientRect(); const c = card.getBoundingClientRect(); const ck = document.querySelector('.job-clock-btn').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), inner: Math.round(c.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2), clockW: Math.round(ck.width) }; });
  ok('detail: Mark done spans its card (like Start the clock), 48px tall', Math.abs(md.w - md.inner) <= 2 && Math.abs(md.w - md.clockW) <= 6 && md.h >= 44, md);
  // Touch-ups after #543: no orange lip, same type as Start the clock, and
  // still wired to the same handler (data-mark-done -> markJobDoneHere).
  const lip = await p.evaluate(() => { const b = getComputedStyle(document.querySelector('[data-mark-done]')); const c = getComputedStyle(document.querySelector('.job-clock-btn')); return { shadow: b.boxShadow, bb: b.borderBottomWidth, ff: b.fontFamily === c.fontFamily, fs: b.fontSize === c.fontSize, fw: b.fontWeight + '/' + c.fontWeight, h: b.height + '/' + c.height }; });
  ok('detail: Mark done is flat (no lip/bottom border), same font, weight and height as Start the clock', lip.shadow === 'none' && lip.bb === '0px' && lip.ff && lip.fs && lip.fw.split('/')[0] === lip.fw.split('/')[1] && lip.h.split('/')[0] === lip.h.split('/')[1], lip);
  ok('detail: Mark done still handled by markJobDoneHere() via data-mark-done', await p.evaluate(() => typeof markJobDoneHere === 'function' && document.querySelector('[data-mark-done]').getAttribute('data-mark-done') === '101'));

  // ---- Round 3, item 3: the New tab ----
  const nv = await p.evaluate(() => { const c = document.querySelector('.th-bottom-nav .th-bn-create'); const inactive = [...document.querySelectorAll('.th-bottom-nav a:not(.is-active)')].map((a) => getComputedStyle(a).color); return { create: getComputedStyle(c).color, label: getComputedStyle(c.querySelector('.th-bn-create-label')).color, inactive: [...new Set(inactive)], disc: getComputedStyle(c.querySelector('.th-bn-create-disc')).backgroundColor }; });
  ok('nav: New label is the same grey as the inactive tabs (disc stays orange)', nv.inactive.length === 1 && nv.label === nv.inactive[0] && nv.disc !== nv.label, nv);
  await p.click('.th-bottom-nav .th-bn-create'); await p.waitForTimeout(400);
  ok('nav: tapping New still opens the create sheet', await p.evaluate(() => { const s = document.getElementById('thCreateSheet'); return !!(s && !s.hasAttribute('hidden')) && document.querySelector('.th-bn-create').getAttribute('aria-expanded') === 'true'; }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // stepper agrees with the badge; Mark done works
  const st = await p.evaluate(() => ({ badge: document.querySelector('.job-hero .badge-status').textContent.trim(), cur: (document.querySelector('.job-track-step[aria-current="step"] .job-track-label') || {}).textContent, next: (document.querySelector('.job-track-step.is-next .job-track-label') || {}).textContent, btn: !!document.querySelector('[data-mark-done]') }));
  ok('detail: lit step matches the status badge (Working/Working), Done is only "next"', st.badge === 'Working' && st.cur === 'Working' && st.next === 'Done' && st.btn, st);
  await p.click('[data-mark-done]');
  await p.waitForTimeout(700);
  const st2 = await p.evaluate(() => ({ status: JSON.parse(localStorage.getItem('th_tracker_jobs')).find((j) => j.id === 101).status, badge: document.querySelector('.job-hero .badge-status').textContent.trim(), cur: (document.querySelector('.job-track-step[aria-current="step"] .job-track-label') || {}).textContent, next: document.querySelector('.job-next').textContent }));
  ok('detail: Mark done sets Done, re-renders, next step becomes the invoice', st2.status === 'done' && st2.badge === 'Done' && st2.cur === 'Done' && /not invoiced/i.test(st2.next), st2);
  await Promise.all([p.waitForURL(/job-tracker\.html/, { timeout: 8000 }), p.click('.hub-header-back a')]);
  ok('detail: back chevron goes to the Jobs list', /job-tracker\.html$/.test(p.url()));
  await p.waitForTimeout(2500);
  ok('jobs: tip shown once only (gone on the next visit)', await p.evaluate(() => { const prev = document.getElementById('jobsList').previousElementSibling; return !(prev && prev.classList.contains('th-page-tip')) && localStorage.getItem('th_tip_jobs') === '1'; }));
  // View sheet: board, back to list, sort by priority
  await p.click('#jobViewBtn'); await p.waitForTimeout(400);
  const sheet = await p.evaluate(() => [...document.querySelectorAll('.quick-actions-sheet .quick-actions-btn')].map((b) => b.textContent.trim() + (b.dataset.kind === 'current' ? '*' : '')));
  ok('jobs: View sheet lists views + sorts, current ones marked', sheet.join('|') === 'List, current*|Board|Calendar|Sort by date, current*|Sort by priority|Done', sheet);
  await p.click('.quick-actions-sheet .quick-actions-btn:has-text("Board")'); await p.waitForTimeout(500);
  ok('jobs: picking Board shows the board', await p.evaluate(() => getComputedStyle(document.getElementById('jobsBoardWrap')).display !== 'none' && localStorage.getItem('th_tracker_view') === 'board'));
  await p.click('#jobViewBtn'); await p.waitForTimeout(400);
  await p.click('.quick-actions-sheet .quick-actions-btn:has-text("List")'); await p.waitForTimeout(400);
  await p.click('#jobViewBtn'); await p.waitForTimeout(400);
  await p.click('.quick-actions-sheet .quick-actions-btn:has-text("Sort by priority")'); await p.waitForTimeout(500);
  ok('jobs: back to List, sorted by priority (inline control in step)', await p.evaluate(() => getComputedStyle(document.getElementById('jobsList')).display !== 'none' && document.querySelector('.sort-btn[data-sort="priority"]').classList.contains('is-active')));
  // Lit Jobs tab from Job detail returns to the list
  await p.goto(base + '/tools/job-detail.html?id=102'); await p.waitForTimeout(2500);
  await Promise.all([p.waitForURL(/job-tracker\.html/, { timeout: 8000 }), p.click('.th-bottom-nav a.is-active')]);
  ok('detail: tapping the lit Jobs tab returns to the list', /job-tracker\.html/.test(p.url()));

  // ---- Home ----
  // Earlier checks marked today's jobs done; put two back so Home has a
  // Next job card with Open job / Route today (2 stops) to check.
  await p.evaluate(() => { const j = JSON.parse(localStorage.getItem('th_tracker_jobs')); j.filter((x) => x.id === 101 || x.id === 102).forEach((x) => { x.status = x.id === 101 ? 'in-progress' : 'not-started'; }); localStorage.setItem('th_tracker_jobs', JSON.stringify(j)); });
  await p.goto(base + '/tools/workspace.html', { waitUntil: 'load' }); await p.waitForTimeout(3000);
  const h = await p.evaluate(() => [...document.querySelectorAll('.th-bottom-nav a')].map((a) => a.textContent.trim() + ':' + (a.getAttribute('aria-current') || '-')));
  ok('home: Home tab is current page, nothing else', h.filter((x) => !x.endsWith(':-')).join() === 'Home:page', h);
  ok('home: search placeholder not truncated', await p.evaluate(() => { const i = document.getElementById('globalSearch'); return i.placeholder === 'Search clients, jobs, invoices'; }));
  // Round 3, item 4: Open job / Route today are one pair.
  const pair = await p.evaluate(() => [...document.querySelectorAll('.today-next-links > *')].map((a) => { const r = a.getBoundingClientRect(); const l = a.querySelector('.today-next-link-label') || a; return { t: a.textContent.trim(), h: Math.round(r.height), top: Math.round(r.top), oneLine: l.getBoundingClientRect().height < 24, clipped: l.scrollWidth > l.clientWidth, ff: getComputedStyle(a).fontFamily, fs: getComputedStyle(a).fontSize, fw: getComputedStyle(a).fontWeight, shadow: getComputedStyle(a).boxShadow }; }));
  ok('home: Open job and Route today match (height, top, type), one line each', pair.length === 2 && pair[0].h === pair[1].h && pair[0].top === pair[1].top && pair[0].ff === pair[1].ff && pair[0].fs === pair[1].fs && pair[0].fw === pair[1].fw && pair.every((x) => x.oneLine && !x.clipped) && pair[0].shadow === 'none', pair);
  await p.click('a[href="#insights"], .th-v2-seg a:nth-child(2)').catch(() => {});
  await p.waitForTimeout(500);
  ok('home: Insights view switch still works', await p.evaluate(() => document.body.getAttribute('data-dash-view') === 'insights' || location.hash === '#insights'));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  console.log(results.join('\n')); results.printed = true;
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
