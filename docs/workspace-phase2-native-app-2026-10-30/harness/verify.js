// Behaviour checks for PR #543 (Home, Jobs, Job detail), same stubs as
// shoot.js. Prints PASS/FAIL lines: add a job, Done, the status dropdown,
// opening a job from its title, Job detail's Call/Text/Directions/Invoice/
// Expense, the back chevron, Mark done, the lit Jobs tab, the View sheet,
// the one-time tip, Home's Today/Insights switch, and page errors.
//
//   node docs/workspace-phase2-native-app-2026-10-30/harness/verify.js http://localhost:8543
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
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
  const results = [];
  const ok = (name, cond, extra) => results.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + JSON.stringify(extra) : ''));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));

  // ---- Jobs: hit areas ----
  await p.goto(base + '/tools/job-tracker.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const helpHit = await p.evaluate(() => {
    const hb = document.querySelector('#templatesFormSection .form-section-header .help-btn');
    hb.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = hb.getBoundingClientRect();
    return ['top', 'left', 'bottom'].map((s) => { const x = s === 'left' ? r.left - 5 : r.left + r.width / 2; const y = s === 'top' ? r.top - 5 : s === 'bottom' ? r.bottom + 5 : r.top + r.height / 2; const h = document.elementFromPoint(x, y); return s + ':' + !!(h && h.closest('.help-btn')); });
  });
  ok('jobs: templates ? 44px hit area (5px outside, 3 sides)', helpHit.every((x) => x.endsWith('true')), helpHit);
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
  ok('jobs: status dot hit area 4px outside its box', hits.badgeEdge, hits);
  ok('jobs: job title link hit at top/bottom of padded box', hits.titleTop && hits.titleBottom);

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
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const j = JSON.parse(localStorage.getItem('th_tracker_jobs')); j.find((x) => x.id === 101).status = 'in-progress'; localStorage.setItem('th_tracker_jobs', JSON.stringify(j)); });
  await p.reload(); await p.waitForTimeout(1500);
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
  // stepper agrees with the badge; Mark done works
  const st = await p.evaluate(() => ({ badge: document.querySelector('.job-hero .badge-status').textContent.trim(), cur: (document.querySelector('.job-track-step[aria-current="step"] .job-track-label') || {}).textContent, next: (document.querySelector('.job-track-step.is-next .job-track-label') || {}).textContent, btn: !!document.querySelector('[data-mark-done]') }));
  ok('detail: lit step matches the status badge (Working/Working), Done is only "next"', st.badge === 'Working' && st.cur === 'Working' && st.next === 'Done' && st.btn, st);
  await p.click('[data-mark-done]');
  await p.waitForTimeout(700);
  const st2 = await p.evaluate(() => ({ status: JSON.parse(localStorage.getItem('th_tracker_jobs')).find((j) => j.id === 101).status, badge: document.querySelector('.job-hero .badge-status').textContent.trim(), cur: (document.querySelector('.job-track-step[aria-current="step"] .job-track-label') || {}).textContent, next: document.querySelector('.job-next').textContent }));
  ok('detail: Mark done sets Done, re-renders, next step becomes the invoice', st2.status === 'done' && st2.badge === 'Done' && st2.cur === 'Done' && /not invoiced/i.test(st2.next), st2);
  await Promise.all([p.waitForURL(/job-tracker\.html/, { timeout: 8000 }), p.click('.hub-header-back a')]);
  ok('detail: back chevron goes to the Jobs list', /job-tracker\.html$/.test(p.url()));
  await p.waitForTimeout(1200);
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
  await p.goto(base + '/tools/job-detail.html?id=102'); await p.waitForTimeout(1200);
  await Promise.all([p.waitForURL(/job-tracker\.html/, { timeout: 8000 }), p.click('.th-bottom-nav a.is-active')]);
  ok('detail: tapping the lit Jobs tab returns to the list', /job-tracker\.html/.test(p.url()));

  // ---- Home ----
  await p.goto(base + '/tools/workspace.html', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  const h = await p.evaluate(() => [...document.querySelectorAll('.th-bottom-nav a')].map((a) => a.textContent.trim() + ':' + (a.getAttribute('aria-current') || '-')));
  ok('home: Home tab is current page, nothing else', h.filter((x) => !x.endsWith(':-')).join() === 'Home:page', h);
  ok('home: search placeholder not truncated', await p.evaluate(() => { const i = document.getElementById('globalSearch'); return i.placeholder === 'Search clients, jobs, invoices'; }));
  await p.click('a[href="#insights"], .th-v2-seg a:nth-child(2)').catch(() => {});
  await p.waitForTimeout(500);
  ok('home: Insights view switch still works', await p.evaluate(() => document.body.getAttribute('data-dash-view') === 'insights' || location.hash === '#insights'));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));
  console.log(results.join('\n'));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
