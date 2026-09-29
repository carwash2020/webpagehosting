// Workspace IA round 4 (2026-09-22): "make it super easy to use, then
// update the tutorial to teach where everything is." The tour became a
// 24-step tutorial (one step per tab, with the tab put on screen first);
// the command palette became a launcher; every tabbed page takes a #tab
// deep link and follows a same-document hash change; Finance remembers
// its tab; the Dashboard strip gained Quick charge and Log expense.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const TOUR = read('tools-tour.js');
const PALETTE = read('tools-command-palette.js');

// First Impressions handoff (2026-09-29): the 25-step, every-tab
// tutorial was replaced by a 6-step tour teaching the one real loop
// (add a job, track it, invoice it, get paid, watch what's owed, and
// where help lives) -- see tools/tools-tour.js's own header comment.
test('the tour is exactly 6 steps, each with a real highlightSelector', () => {
  const steps = [...TOUR.matchAll(/\{ page: '\/tools\/([\w-]+\.html)', highlightSelector: '([^']+)', title: '[^']+', body: '(?:[^'\\]|\\.)*'(?:, onShow: \{ fn: '(\w+)', args: \[([^\]]*)\] \})? \}/g)]
    .map(m => ({ page: m[1], selector: m[2], fn: m[3], args: m[4] }));
  assert.equal(steps.length, 6, 'every step should parse');
  // The one onShow step (Get paid) puts Invoices' Recent tab on screen.
  const getPaidStep = steps.find(s => s.selector.includes('toggleInvoicePaid'));
  assert.ok(getPaidStep);
  assert.equal(getPaidStep.fn, 'activateGenTab');
  assert.equal(getPaidStep.args, "'recent'");
  assert.ok(read(getPaidStep.page).includes('function activateGenTab('), `${getPaidStep.page} defines activateGenTab`);
});

test('the tour engine calls onShow before highlighting, picks the first VISIBLE candidate of a comma list, and shows a step counter', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><head><style>.hidden{display:none}</style></head><body><nav class="th-sidebar-new hidden">side</nav><button class="th-bn-create">+</button><button onclick="toggleInvoicePaid(1)">Mark Paid</button></body></html>', {
    url: 'https://example.com/tools/workspace.html', runScripts: 'dangerously',
  });
  const { window } = dom;
  window.getCurrentUserEmail = () => null;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const calls = [];
  window.activateGenTab = (t) => calls.push(t);
  const s = window.document.createElement('script'); s.textContent = TOUR; window.document.head.appendChild(s);
  // Step 0 ("Add a job"): '.th-sidebar-new, .th-bn-create'.
  window.renderAppTourStep(0);
  assert.ok(window.document.querySelector('.th-bn-create').classList.contains('th-tour-highlight'), 'the visible + button is highlighted');
  assert.ok(!window.document.querySelector('.th-sidebar-new').classList.contains('th-tour-highlight'), 'the hidden sidebar entry is not');
  assert.equal(window.document.querySelector('.onboarding-count').textContent, '1 OF 6');
  // The "Get paid" step calls the page's switch function by name first.
  const getPaidIdx = [...TOUR.matchAll(/highlightSelector: '([^']+)'/g)].findIndex(m => m[1].includes('toggleInvoicePaid'));
  assert.ok(getPaidIdx > 0);
  window.renderAppTourStep(getPaidIdx);
  assert.deepEqual(calls, ['recent']);
  assert.ok(window.document.querySelector('[onclick="toggleInvoicePaid(1)"]').classList.contains('th-tour-highlight'));
});

test('the command palette lists every action before you type, filters them by title or keyword, and gates the finance-domain ones the way the nav does', () => {
  assert.match(PALETTE, /var ACTIONS = \[/);
  for (const href of ['/tools/job-tracker.html#add-job', '/tools/job-tracker.html#calendar', '/tools/job-tracker.html#contacts', '/tools/invoice-generator.html#quote', '/tools/invoice-generator.html#pos', '/tools/invoice-generator.html#recent', '/tools/finance.html#expenses', '/tools/finance.html#income', '/tools/finance.html#profitability', '/tools/finance.html#cost', '/tools/route-planner.html', '/tools/contract-generator.html', '/tools/review-request.html', '/tools/parts-reference.html', '/tools/runway-dashboard.html#runway', '/tools/settings.html', '/tools/workspace.html?tour=1']) {
    assert.ok(PALETTE.includes("href: '" + href + "'"), `palette should link to ${href}`);
  }
  for (const [href, perm] of [['/tools/finance.html#expenses', 'canViewFinance'], ['/tools/invoice-generator.html#pos', 'canManageInvoices'], ['/tools/contract-generator.html', 'canManageContracts'], ['/tools/review-request.html', 'canManageReviews'], ['/tools/runway-dashboard.html#runway', 'canViewRunway']]) {
    assert.match(PALETTE, new RegExp("href: '" + href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'[^\\n]*perm: '" + perm + "'"), `${href} gated by ${perm}`);
  }
  // Live: an Employee-style account (no finance permissions) never sees a Finance action.
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/tools/job-tracker.html', runScripts: 'dangerously' });
  const { window } = dom;
  window.canViewFinance = () => false; window.canManageInvoices = () => false; window.canManageContracts = () => true; window.canManageReviews = () => true; window.canViewRunway = () => false;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const s = window.document.createElement('script'); s.textContent = PALETTE; window.document.head.appendChild(s);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.openCommandPalette();
  const hrefs = () => [...window.document.querySelectorAll('#thCmdkResults a')].map(a => a.getAttribute('href'));
  assert.ok(hrefs().includes('/tools/job-tracker.html#add-job'), 'New job listed before typing');
  assert.ok(hrefs().includes('/tools/contract-generator.html'));
  assert.ok(!hrefs().some(h => /finance\.html|invoice-generator\.html|runway/.test(h)), 'gated actions hidden: ' + hrefs().join(','));
  const input = window.document.getElementById('thCmdkInput');
  input.value = 'rout'; input.dispatchEvent(new window.Event('input'));
  assert.deepEqual(hrefs(), ['/tools/route-planner.html'], 'typing filters to the matching action');
});

test('tabbed pages take a #tab deep link and follow a same-document hash change (the palette and the tour link straight to tabs)', () => {
  const ig = read('invoice-generator.html');
  assert.match(ig, /function applyGenTabFromHash\(\)/);
  assert.match(ig, /window\.addEventListener\('hashchange', applyGenTabFromHash\)/);
  assert.match(ig, /if \(tab === 'pos'\) \{\s*const posEmail = document\.getElementById\('posClientEmail'\);\s*if \(posEmail\) posEmail\.focus\(\);/);
  const fin = read('finance.html');
  assert.match(fin, /window\.addEventListener\('hashchange', \(\) => \{\s*const h = \(location\.hash \|\| ''\)\.replace\('#', ''\);\s*if \(TAB_HASHES\[h\]\) activateTab\(h\);/);
  const jt = read('job-tracker.html');
  assert.match(jt, /window\.addEventListener\('hashchange', \(\) => \{[\s\S]*?if \(TAB_HASHES\[h\]\) \{ activateTab\(h\); return; \}[\s\S]*?setJobViewMode\('calendar'\);[\s\S]*?toggleFormSection\('jobFormSection', true\)/);
});

test('Finance reopens on the last tab used on this device: hash > memory > Cost Lookup', () => {
  const fin = read('finance.html');
  assert.match(fin, /const FINANCE_TAB_KEY = 'th_finance_tab';/);
  assert.match(fin, /try \{ localStorage\.setItem\(FINANCE_TAB_KEY, tabName\); \}/);
  assert.match(fin, /activateTab\(TAB_HASHES\[initialHash\] \? initialHash : \(TAB_HASHES\[rememberedTab\] \? rememberedTab : 'cost'\)\);/);
});

test('the Dashboard strip has six daily actions, the two new ones deep-linked to their tab and gated like their pages', () => {
  const ws = read('workspace.html');
  const strip = ws.match(/<nav class="dash-primary-strip"[\s\S]*?<\/nav>/)[0];
  assert.equal((strip.match(/class="dash-primary-action"/g) || []).length, 6);
  assert.match(strip, /href="\/tools\/invoice-generator\.html#pos" data-tile-perm="can_manage_invoices">Quick charge</);
  assert.match(strip, /href="\/tools\/finance\.html#expenses" data-tile-perm="can_view_finance">Log expense</);
  assert.match(ws, /\.dash-primary-strip \{[^}]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(ws, /@media \(max-width: 720px\) \{\s*\.dash-primary-strip \{ grid-template-columns: 1fr 1fr 1fr;/);
  const help = ws.match(/<div class="help-modal-body">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<script>/)[1];
  assert.match(help, /Search anywhere/);
  assert.match(help, /Quick charge/);
});

test('the Settings copy describes the tutorial honestly (every page and tab, about two minutes)', () => {
  assert.match(read('settings.html'), /where everything is and how to use it, tab by tab/);
});
