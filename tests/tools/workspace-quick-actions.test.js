// 2026-09-17: fewer-click daily actions on /tools/ for the owner.
// Mark paid reuses workspace togglePaid(); Mark Done reuses
// setJobStatus(); the dashboard strip is navigation + the existing
// global search. No new APIs, no RLS, no public-site changes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const WORKSPACE = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const JOB_TRACKER = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

test('Action Items unpaid invoice rows offer one-click Mark paid, not an Overdue/Unpaid label that still needs an amount prompt', () => {
  const btnFn = extractFn(WORKSPACE, 'invoiceMarkPaidButtonHtml');
  assert.match(btnFn, />Mark paid</);
  assert.match(btnFn, /onclick="togglePaid\(\$\{inv\.id\}\)"/);
  assert.doesNotMatch(btnFn, />Overdue</);
  assert.doesNotMatch(btnFn, />Unpaid</);

  const listFn = extractFn(WORKSPACE, 'renderInvoicesList');
  assert.match(listFn, /invoiceMarkPaidButtonHtml\(i\)/);
});

test('togglePaid confirms full payment instead of window.prompt for an amount', () => {
  const fn = extractFn(WORKSPACE, 'togglePaid');
  assert.match(fn, /showConfirm\(/);
  assert.match(fn, /confirmText: 'Mark paid'/);
  assert.match(fn, /inv\.paidAmount = total/);
  assert.doesNotMatch(fn, /\bprompt\(/);
  assert.match(fn, /mirrorInvoiceToRelational\(inv\)/);
  assert.match(fn, /mirrorReferralEarnedForJob\(Number\(inv\.jobRefId\)\)/);
});

test('cancelling the Mark paid confirm leaves the invoice unpaid', async () => {
  const html = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.SUPABASE_URL = 'https://example-project.supabase.co';
      w.SUPABASE_ANON_KEY = 'fake-anon-key';
      w.getAuthToken = () => 'fake-token';
      w.showConfirm = () => Promise.resolve(false);
      w.showAlert = async () => {};
      w.money = (n) => '$' + (Number(n) || 0).toFixed(2);
      w.escapeHtml = (s) => String(s == null ? '' : s);
      w.scheduleSync = () => {};
      w.localStorage.setItem('th_invoices', JSON.stringify([{
        id: 41, invoiceNumber: 'INV-41', clientName: 'Test Client',
        total: 80, paid: false, paidAmount: 0, date: '2026-08-01', terms: 'Due on Receipt',
      }]));
    },
  });
  const { window } = dom;
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.showConfirm = () => Promise.resolve(false);
  window.scheduleSync = () => {};
  await window.togglePaid(41);
  const after = JSON.parse(window.localStorage.getItem('th_invoices'));
  assert.equal(after[0].paid, false);
  assert.equal(Number(after[0].paidAmount), 0);
  window.close();
});

test('dashboard overdue Money Owed card lists overdue invoices with the same Mark paid button', () => {
  const fn = extractFn(WORKSPACE, 'renderTodayMoney');
  assert.match(fn, /id="todayOverdueList"/);
  assert.match(fn, /invoiceMarkPaidButtonHtml\(i\)/);
  assert.match(fn, /isOverdue\(i\)/);
});

test('dashboard home pins New job, Create invoice, Find client, and Calendar directly under the Today hero (Calendar replaced Today\'s schedule on 2026-09-21 -- the hero IS the schedule, and Calendar left the bottom bar when it became a Job Tracker view)', () => {
  const strip = WORKSPACE.match(/<nav class="dash-primary-strip"[\s\S]*?<\/nav>/);
  assert.ok(strip, 'expected #dashPrimaryStrip');
  assert.match(strip[0], /href="\/tools\/job-tracker\.html#add-job"/);
  assert.match(strip[0], /href="\/tools\/invoice-generator\.html"/);
  assert.match(strip[0], /onclick="focusFindClient\(\)"/);
  assert.match(strip[0], /href="\/tools\/job-tracker\.html#calendar"/);
  assert.match(strip[0], />New job</);
  assert.match(strip[0], />Create invoice</);
  assert.match(strip[0], />Find client</);
  assert.match(strip[0], />Calendar</);
  assert.doesNotMatch(strip[0], /Today's schedule/);

  const heroAt = WORKSPACE.indexOf('id="todayHero"');
  const stripAt = WORKSPACE.indexOf('id="dashPrimaryStrip"');
  const inboxAt = WORKSPACE.indexOf('id="section-actionitems"');
  assert.ok(heroAt > 0 && stripAt > heroAt && inboxAt > stripAt, 'the daily strip must sit between the hero and Needs attention');
});

test('Create invoice on the strip is still finance-gated; Find client expands the existing global search', () => {
  assert.match(WORKSPACE, /href="\/tools\/invoice-generator\.html" data-tile-perm="can_manage_invoices"/);
  const fn = extractFn(WORKSPACE, 'focusFindClient');
  assert.match(fn, /toggleIconSearch\('globalSearchWrap', true\)/);
  assert.match(fn, /getElementById\('globalSearch'\)/);
});

test('the tile grid is gone (2026-09-21), and every destination it used to link is still in the shared nav lists', () => {
  assert.doesNotMatch(WORKSPACE, /<details class="more-tools-details"/);
  assert.doesNotMatch(WORKSPACE, /class="tools-grid"/);
  const NAV = fs.readFileSync(repo('tools', 'tools-nav-pwa.js'), 'utf8');
  for (const href of [
    '/tools/job-tracker.html',
    '/tools/route-planner.html',
    '/tools/contract-generator.html',
    '/tools/invoice-generator.html',
    '/tools/clients.html',
    '/tools/finance.html',
    '/tools/runway-dashboard.html',
    '/tools/review-request.html',
    '/tools/parts-reference.html',
    '/tools/settings.html',
    '/tools/dev-tools.html',
  ]) {
    assert.ok(NAV.includes("'" + href + "'"), `expected ${href} to remain a nav destination`);
  }
});

test('Job Tracker cards and desktop table rows have an inline Done that calls setJobStatus, not Edit', () => {
  const cardFn = extractFn(JOB_TRACKER, 'jobCardHtml');
  assert.match(cardFn, /class="small-btn job-done-btn" onclick="setJobStatus\(\$\{job\.id\}, 'done'\)">Done</);
  assert.doesNotMatch(cardFn, /setJobStatus\(\$\{job\.id\}, 'done'\)[\s\S]{0,40}hoursWorked/);
  const renderFn = extractFn(JOB_TRACKER, 'renderJobs');
  assert.match(renderFn, /class="small-btn job-done-btn" onclick="setJobStatus\(\$\{job\.id\}, 'done'\)">Done</);
});

test('Job Tracker #add-job opens the collapsed add form so New job is not Edit-first', () => {
  const initChunk = JOB_TRACKER.slice(JOB_TRACKER.indexOf("initialHash === 'add-job'"));
  assert.match(initChunk, /toggleFormSection\('jobFormSection', true\)/);
});
