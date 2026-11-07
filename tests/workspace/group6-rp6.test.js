// Fix plan Group 6, RP6 (2026-11-07): Workspace polish. Warranty counted from
// when a job was marked done, a supplier's History from real Expenses, one
// row per client on the Dashboard, Due-soon rows that open the job, Search
// that hides what it can't check, the calendar's day panel following the
// month, review "Sent" per job instead of per phone, a deactivated person
// you can still look at, and plain words where an action reaches someone.
// Runs the real code from the pages where behavior matters (made-up
// records only; nothing is sent anywhere).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const fnSrc = (src, name, prefix = '') => {
  const start = src.indexOf(prefix + 'function ' + name + '(');
  assert.ok(start >= 0, name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
  return src.slice(start, i);
};
const DAY = 24 * 60 * 60 * 1000;
const dateStr = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const daysAgo = (n) => dateStr(new Date(Date.now() - n * DAY));
const escapers = ['escapeHtml', 'escapeAttr'].map((n) => read('tools', 'tools-dialogs.js').match(new RegExp('function ' + n + '\\([\\s\\S]*?\\n\\}\\n'))[0]).join('\n');

// ---- RP6.1 ------------------------------------------------------------------

test('RP6.1: Job detail\'s warranty counts 30 days from when the job was marked done, not its scheduled date', () => {
  const JD = read('tools', 'job-detail.html');
  const fn = fnSrc(JD, 'warrantyBadgeHtml');
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.com/tools/job-detail.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(read('tools', 'data-layer.js') + '\n' + fn + '\nwindow.__w = warrantyBadgeHtml;');
  const badge = (job) => w.__w(job);
  const doneAt = new Date(Date.now() - 5 * DAY); doneAt.setHours(12, 0, 0, 0);
  assert.match(badge({ status: 'done', date: daysAgo(40), statusChangedAt: doneAt.toISOString() }), /Warranty: 25 days left/,
    'scheduled 40 days ago, marked done 5 days ago: 25 days left, not expired');
  assert.match(badge({ status: 'done', date: daysAgo(10) }), /Warranty: 20 days left/, 'no statusChangedAt: falls back to the job\'s date');
  assert.match(badge({ status: 'done', date: daysAgo(10), statusChangedAt: doneAt.toISOString() }), /title="30-day labor warranty, based on when it was marked done"/);
  assert.match(badge({ status: 'done', date: daysAgo(60), statusChangedAt: new Date(Date.now() - 31 * DAY).toISOString() }), /Warranty expired/);
  assert.equal(badge({ status: 'in-progress', date: daysAgo(1) }), '');
  assert.equal(badge({ status: 'done', date: '' }), '', 'no done date at all: no badge');
  assert.match(fn, /thJobDoneDate\(job\)/);
  assert.doesNotMatch(fn, /based on this job\\'s date/);
});

// ---- RP6.2, RP6.9, RP6.12: Job Tracker ----------------------------------------

const JT = read('tools', 'job-tracker.html');
function loadJobTracker(seed) {
  const TOOLS_DIR = repo('tools');
  const dom = new JSDOM(JT, {
    runScripts: 'dangerously', url: 'https://example.com/tools/job-tracker.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, scale(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, fillRect(){}, arc(){}, arcTo(){}, closePath(){}, createLinearGradient(){ return { addColorStop(){} }; }, setLineDash(){},
      });
      for (const [k, v] of Object.entries(seed || {})) w.localStorage.setItem(k, JSON.stringify(v));
    },
  });
  const { window } = dom;
  window.getCurrentUserEmail = () => null;
  window.pullSync = () => Promise.resolve({ ok: false });
  for (const name of ['data-layer.js', 'sync.js', 'tools-dialogs.js', 'tools-effects.js', 'tools-media-sharing.js', 'tools-nav-pwa.js', 'tools-tour.js']) {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(TOOLS_DIR, name), 'utf8');
    window.document.head.appendChild(s);
  }
  window.canManageOthersJobs = () => true;
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.applyJobViewMode();
  window.renderJobs();
  return window;
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('RP6.2 (D22): a supplier\'s History is what was spent with them, from Expenses by vendor, newest first', async () => {
  const w = loadJobTracker({
    th_tracker_contacts: [{ id: 11, name: ' Home Depot ', phone: '' }, { id: 12, name: 'Pat Smith', phone: '' }],
    th_expense_log: [
      { id: 1, type: 'expense', date: '2026-10-02', vendor: 'home depot', desc: 'Drain pump', amount: 42.5 },
      { id: 2, type: 'expense', date: '2026-10-20', vendor: 'Home Depot  ', desc: 'Igniter <b>', amount: 18 },
      { id: 3, type: 'mileage', date: '2026-10-21', vendor: 'Home Depot', desc: 'Drive', amount: 9, miles: 13 },
      { id: 4, type: 'expense', date: '2026-10-22', vendor: 'Lowes', desc: 'Hose', amount: 7 },
    ],
    // A client with the same name as a supplier no longer leaks in.
    th_tracker_jobs: [{ id: 5, title: 'Fridge for Pat', client: 'Pat Smith', status: 'done', date: '2026-10-01' }],
    th_invoices: [{ id: 6, clientName: 'Pat Smith', total: 300, date: '2026-10-01' }],
  });
  w.renderContacts();
  w.toggleClientHistory(11);
  const el = w.document.getElementById('history-11');
  assert.equal(el.style.display, '');
  assert.match(el.textContent, /Spent with them: \$60\.50 across 2 expenses/);
  const rows = [...el.querySelectorAll('.supplier-history-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  assert.equal(rows.length, 2, 'mileage and other vendors are left out');
  assert.match(rows[0], /2026-10-20.*Igniter <b>.*\$18\.00/, 'newest first; the description is escaped text');
  assert.match(rows[1], /2026-10-02.*Drain pump.*\$42\.50/);

  w.toggleClientHistory(12);
  const pat = w.document.getElementById('history-12');
  assert.match(pat.textContent, /No expenses logged with this vendor name yet/);
  assert.doesNotMatch(pat.textContent, /Fridge for Pat|Lifetime spend|\$300/, 'jobs and invoices of a same-named client are not a supplier\'s history');
  const help = JT.slice(JT.indexOf('<li><strong>Suppliers</strong>'), JT.indexOf('<li><strong>Notes</strong>'));
  assert.match(help, /what you've spent with them/);
  assert.doesNotMatch(help, /matched by exact name against Jobs and Invoices/);
  await settle();
});

test('RP6.9: changing month keeps the day panel honest: a day in another month is cleared, a day in the new month is shown', async () => {
  const today = new Date();
  const w = loadJobTracker({ th_tracker_jobs: [{ id: 1, title: 'Fix Fridge', client: 'Alice', status: 'not-started', date: dateStr(today) }] });
  w.setJobViewMode('calendar');
  w.goToToday();
  assert.match(w.document.getElementById('calDetailHeading').textContent, new RegExp(String(today.getFullYear())));
  assert.equal(w.document.querySelectorAll('#calDayJobs .cal-job-title').length, 1);
  w.changeMonth(1);
  assert.equal(w.document.getElementById('calDetailHeading').textContent, 'Select a day', 'the selected day is not in the new month');
  assert.equal(w.document.querySelectorAll('#calDayJobs .cal-job-title').length, 0, 'its jobs no longer show under a month they are not in');
  assert.equal(w.document.querySelectorAll('#calGrid .is-selected').length, 0);
  w.changeMonth(-1);
  assert.equal(w.document.getElementById('calDetailHeading').textContent, 'Select a day', 'stays cleared coming back');

  const fn = fnSrc(JT, 'changeMonth');
  assert.match(fn, /renderDayDetail\(\);/);
  // Same month: the day stays selected and its panel is re-rendered.
  w.selectDay(dateStr(today));
  w.document.getElementById('calDayJobs').innerHTML = '';
  w.changeMonth(0);
  assert.equal(w.document.querySelectorAll('#calDayJobs .cal-job-title').length, 1);
  await settle();
});

test('RP6.12: Log Expense in a job\'s ... menu wears the receipt icon, which the sprite has', () => {
  assert.match(JT, /actions\.push\(\{ label: 'Log Expense', icon: 'receipt', /);
  assert.doesNotMatch(JT, /label: 'Log Expense', icon: 'camera'/);
  assert.match(read('tools', 'tools-nav-pwa.js'), /<symbol id="icon-receipt" /);
});

// ---- RP6.3, RP6.4, RP6.13: Dashboard ------------------------------------------

const WS = read('tools', 'workspace.html');
function dashboard(seed) {
  const dom = new JSDOM('<!doctype html><body><div id="topClients"></div><div id="topVendors"></div><div id="followupsList"></div><div id="upcomingJobs"></div></body>', { url: 'https://example.com/tools/workspace.html', runScripts: 'outside-only' });
  const w = dom.window;
  for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, JSON.stringify(v));
  // One eval: data-layer.js's consts (thJobs, thInvoices...) are scoped to it.
  w.eval(read('tools', 'data-layer.js') + '\n' + escapers + '\nfunction money(v) { return "$" + (v || 0).toFixed(2); }\nvar actionItemCounts = {};\nfunction updateActionItemsBadge() {}\nfunction dashSectionClosed() { return false; }\n' +
    'function getCurrentRange() { return null; }\nfunction inRange() { return true; }\nvar FOLLOWUP_THRESHOLD_DAYS = 182;\n' +
    ['dashClientKeyer', 'renderTopVendors', 'renderTopClients', 'renderFollowups', 'renderUpcoming'].map((n) => fnSrc(WS, n)).join('\n') +
    '\nwindow.__d = { renderTopVendors, renderTopClients, renderFollowups, renderUpcoming };');
  return { w, d: w.__d, $: (id) => w.document.getElementById(id) };
}

test('RP6.3: Top Clients is one row per client: by client ID where the record has one, else the name trimmed, any case, spaces collapsed; it shows the latest spelling', () => {
  const { d, $ } = dashboard({
    th_clients: [{ id: 'c_pat', name: 'Pat Smith' }],
    th_invoices: [
      { id: 1, clientName: 'pat smith', clientId: 'c_pat', total: 100, date: '2026-01-05' },
      { id: 2, clientName: 'Pat  Smith ', total: 50, date: '2026-03-01' }, // unlinked: joins c_pat by name
      { id: 3, clientName: 'Patricia Smith', clientId: 'c_pat', total: 25, date: '2026-06-01' }, // renamed: latest spelling
      { id: 4, clientName: ' bo LEE', total: 40, date: '2026-02-01' },
      { id: 5, clientName: 'Bo Lee', total: 40, date: '2026-04-01' },
    ],
    th_tracker_jobs: [{ id: 9, title: 'Dryer', client: 'PAT SMITH', status: 'done', date: '2026-07-04' }],
  });
  d.renderTopClients();
  const rows = [...$('topClients').querySelectorAll('.vendor-bar-row')];
  assert.equal(rows.length, 2, 'two people, not five spellings');
  assert.equal(rows[0].querySelector('.vendor-bar-label').textContent, 'Patricia Smith');
  assert.match(rows[0].textContent, /\$175\.00.*3 invoices · last Jul 2026/s, 'the unlinked job counts toward last seen');
  assert.equal(rows[0].getAttribute('href'), '/tools/client-detail.html?id=c_pat');
  assert.equal(rows[1].querySelector('.vendor-bar-label').textContent, 'Bo Lee');
  assert.match(rows[1].textContent, /\$80\.00.*2 invoices/s);
  assert.equal(rows[1].tagName, 'DIV', 'not in the registry: a plain row, no broken link');
});

test('RP6.3: Top Vendors groups "home depot" and "Home Depot " and shows the first spelling seen', () => {
  const { d, $ } = dashboard({
    th_expense_log: [
      { id: 1, type: 'expense', date: '2026-05-01', vendor: 'home depot', amount: 10 },
      { id: 2, type: 'expense', date: '2026-01-01', vendor: 'Home Depot ', amount: 30 },
      { id: 3, type: 'expense', date: '2026-02-01', vendor: 'HOME  DEPOT', amount: 5 },
      { id: 4, type: 'expense', date: '2026-02-01', vendor: 'Lowes', amount: 20 },
    ],
  });
  d.renderTopVendors();
  const rows = [...$('topVendors').querySelectorAll('.vendor-bar-row')].map((r) => [r.querySelector('.vendor-bar-label').textContent, r.querySelector('.vendor-bar-count').textContent]);
  assert.deepEqual(rows, [['Home Depot', '$45.00'], ['Lowes', '$20.00']]);
});

test('RP6.3 + RP6.13: Follow-ups is one row per client (latest spelling, latest job) and says "1 month" / "N months"', () => {
  const { w, d, $ } = dashboard({
    th_clients: [{ id: 'c_sam', name: 'Sam Ortiz' }],
    th_tracker_jobs: [
      { id: 1, title: 'Washer', client: 'sam ortiz', clientId: 'c_sam', status: 'done', date: daysAgo(400), phone: '4355550100' },
      { id: 2, title: 'Dryer', client: 'Sam  Ortiz', status: 'done', date: daysAgo(200), phone: '4355550111' },
      { id: 3, title: 'Oven', client: 'Lee Park', status: 'done', date: daysAgo(190) },
      { id: 4, title: 'Oven', client: 'lee park ', status: 'done', date: daysAgo(300) },
    ],
  });
  d.renderFollowups();
  const rows = [...$('followupsList').querySelectorAll('.dash-list-item')];
  assert.equal(rows.length, 2, 'one row each for Sam and Lee');
  const titles = rows.map((r) => r.querySelector('.dash-list-item-title').textContent);
  assert.deepEqual(titles, ['Sam  Ortiz', 'Lee Park']);
  assert.match(rows[0].textContent, new RegExp('Last job: ' + daysAgo(200)));
  assert.match(rows[0].querySelector('a').getAttribute('href'), /phone=4355550111/, 'the latest job\'s phone');

  // The wording, on the real function: 1 month, 7 months.
  assert.match(fnSrc(WS, 'renderFollowups'), /month\$\{months === 1 \? '' : 's'\} ago/);
  w.FOLLOWUP_THRESHOLD_DAYS = 0;
  w.eval('FOLLOWUP_THRESHOLD_DAYS = 0;');
  w.localStorage.setItem('th_tracker_jobs', JSON.stringify([{ id: 1, title: 'Washer', client: 'Ann', status: 'done', date: daysAgo(31) }]));
  d.renderFollowups();
  assert.match($('followupsList').textContent, /· 1 month ago/);
  assert.doesNotMatch($('followupsList').textContent, /1 months/);
});

test('RP6.4: each Due soon row opens its job (a real link, reachable by keyboard)', () => {
  const { d, $ } = dashboard({ th_tracker_jobs: [{ id: 'j 7/x', title: 'Fridge <leak>', client: 'Ann', status: 'not-started', date: daysAgo(-1) }] });
  d.renderUpcoming();
  const a = $('upcomingJobs').querySelector('.dash-list-item a');
  assert.ok(a, 'the row has a link');
  assert.equal(a.getAttribute('href'), '/tools/job-detail.html?id=' + encodeURIComponent('j 7/x'));
  assert.equal(a.textContent, 'Fridge <leak>');
  assert.equal(a.tabIndex, 0);
});

// ---- RP6.8: Search fails closed; D27 portal admin -----------------------------

test('RP6.8: Search hides a gated entry when its check is missing; Client portal admin shows for Invoices or Clients (D27)', () => {
  const PAL = read('tools', 'tools-command-palette.js');
  const hrefsFor = (perms) => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://example.com/tools/job-tracker.html', runScripts: 'dangerously' });
    const w = dom.window;
    for (const [k, v] of Object.entries(perms)) w[k] = () => v;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    const s = w.document.createElement('script'); s.textContent = PAL; w.document.head.appendChild(s);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    w.openCommandPalette();
    const input = w.document.getElementById('thCmdkInput');
    input.value = ''; input.dispatchEvent(new w.Event('input'));
    return [...w.document.querySelectorAll('#thCmdkResults a')].map((a) => a.getAttribute('href'));
  };
  const none = hrefsFor({});
  assert.ok(!none.includes('/tools/finance.html'), 'no canViewFinance on the page: no Money link');
  assert.ok(!none.includes('/tools/clients.html#portal'));
  assert.ok(!none.includes('/tools/dev-tools.html'));
  assert.ok(none.includes('/tools/workspace.html'), 'ungated entries still show');
  assert.ok(hrefsFor({ canManageInvoices: false, canManageClients: true }).includes('/tools/clients.html#portal'));
  assert.ok(hrefsFor({ canManageInvoices: true, canManageClients: false }).includes('/tools/clients.html#portal'));
  assert.ok(!hrefsFor({ canManageInvoices: false, canManageClients: false }).includes('/tools/clients.html#portal'));
  assert.ok(!hrefsFor({ canManageClients: true }).includes('/tools/invoice-generator.html#invoice'), 'Create invoice stays Invoices-only');

  // Every perm the palette names is a real auth.js check.
  const AUTH = read('tools', 'auth.js');
  const names = new Set([...PAL.matchAll(/perm: (\[[^\]]*\]|'[^']+')/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1])));
  assert.ok(names.size >= 8);
  for (const n of names) assert.match(AUTH, new RegExp('^function ' + n + '\\(\\) \\{', 'm'), n);
});

test('RP6.8 (D27): the Clients page\'s Portal tab and duplicate notice accept Invoices or Clients; the row\'s Quote/Invoice stay Invoices-only', async () => {
  const C = read('tools', 'clients.html');
  assert.match(fnSrc(C, 'applyPortalPermission'), /if \(!roleInfo \|\| roleInfo\.canManageInvoices \|\| roleInfo\.canManageClients\) return;/);
  assert.match(fnSrc(C, 'refreshClientDupNotice', 'async '), /if \(!roleInfo \|\| !\(roleInfo\.canManageInvoices \|\| roleInfo\.canManageClients\)\) return;/);
  assert.match(fnSrc(C, 'clientQuickActions'), /if \(typeof canManageInvoices === 'function' && canManageInvoices\(\)\) \{\s*actions\.push\(\{ label: 'Quote'/);

  // Behavior: a Clients-only role keeps the Portal tab.
  const dom = new JSDOM('<!doctype html><body><button id="clientsPortalTabBtn"></button><div id="tab-portal" class="is-active"></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval('var portalTabAllowed = true; var switched = []; function activateClientsTab(t) { switched.push(t); }\n' + fnSrc(C, 'applyPortalPermission') + '\nwindow.__a = applyPortalPermission; window.__s = () => ({ portalTabAllowed, switched });');
  w.__a({ canManageInvoices: false, canManageClients: true });
  assert.equal(w.document.getElementById('clientsPortalTabBtn').hidden, false);
  assert.equal(w.__s().portalTabAllowed, true);
  w.__a({ canManageInvoices: false, canManageClients: false });
  assert.equal(w.document.getElementById('clientsPortalTabBtn').hidden, true);
  assert.equal(w.__s().switched.join(','), 'directory');
});

// ---- RP6.10: review "Sent" per job --------------------------------------------

const RR = read('tools', 'review-request.html');
function reviewPage(log) {
  const dom = new JSDOM('<!doctype html><body><input id="custName"><input id="custPhone"><input id="jobDesc"><select id="recentJobSelect"></select><div id="recentJobsRows"></div><div id="messagePreview"></div></body>', { url: 'https://example.com/tools/review-request.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  if (log) w.localStorage.setItem('th_review_requests_log', JSON.stringify(log));
  w.eval(escapers + '\nvar cachedRecentDoneJobs = [];\nvar reviewPickedJob = null;\nvar SENT_LOG_KEY = "th_review_requests_log";\n' +
    'function updateReadyEmpty() {}\nfunction updatePreviewAndLink() {}\nfunction flashAutofilledFields() {}\nfunction clearMatchingReminder() {}\nfunction renderSentLog() {}\nfunction checkDuplicateWarning() {}\n' +
    ['digitsOnly', 'formatPhoneStatic', 'loadSentLog', 'saveSentLog', 'recentlyAskedCheck', 'reviewInitials', 'renderRecentJobRows', 'applyRecentJobSelection', 'logSentRequest'].map((n) => fnSrc(RR, n)).join('\n') +
    '\nwindow.__r = { renderRecentJobRows, applyRecentJobSelection, logSentRequest, loadSentLog, setJobs: (j) => { cachedRecentDoneJobs = j; w_opts(j); } };\n' +
    'function w_opts(j) { document.getElementById("recentJobSelect").innerHTML = "<option value=\\"\\"></option>" + j.map((x, i) => "<option value=\\"" + i + "\\">" + i + "</option>").join(""); }');
  return { w, r: w.__r, rows: () => [...w.document.querySelectorAll('#recentJobsRows .review-ready-row')].map((row) => row.querySelector('.review-ready-sent') ? 'Sent' : 'Ask') };
}
const PAT = { id: 101, client: 'Pat Lee', clientId: 'c_pat', phone: '4355550100', title: 'Dryer', status: 'done', date: daysAgo(2) };
const SAM = { id: 102, client: 'Sam Lee', clientId: 'c_sam', phone: '(435) 555-0100', title: 'Washer', status: 'done', date: daysAgo(3) };

test('RP6.10: two clients sharing a phone: Sent is per job (and client), logged with IDs; old entries without IDs still count by phone, for that client\'s name only', () => {
  // Logged by this change: carries jobId / clientId.
  let p = reviewPage([]);
  p.r.setJobs([PAT, SAM]);
  p.w.document.getElementById('recentJobSelect').value = '0';
  p.r.applyRecentJobSelection();
  assert.equal(p.w.document.getElementById('custName').value, 'Pat');
  p.r.logSentRequest('sms');
  const entry = p.r.loadSentLog()[0];
  assert.equal(entry.jobId, 101);
  assert.equal(entry.clientId, 'c_pat');
  p.r.renderRecentJobRows();
  assert.deepEqual(p.rows(), ['Sent', 'Ask'], 'Sam shares the number but was not asked');

  // A number typed over the picked job's is someone else: no IDs logged.
  p = reviewPage([]);
  p.r.setJobs([PAT, SAM]);
  p.w.document.getElementById('recentJobSelect').value = '0';
  p.r.applyRecentJobSelection();
  p.w.document.getElementById('custPhone').value = '(435) 555-0199';
  p.r.logSentRequest('sms');
  assert.equal(p.r.loadSentLog()[0].jobId, undefined);

  // Another job for the same client within 30 days reads Sent too.
  p = reviewPage([{ id: 1, name: 'Pat', phone: '(435) 555-0100', jobId: 99, clientId: 'c_pat', sentAt: new Date(Date.now() - 2 * DAY).toISOString(), status: 'sent' }]);
  p.r.setJobs([PAT, SAM]);
  p.r.renderRecentJobRows();
  assert.deepEqual(p.rows(), ['Sent', 'Ask']);

  // Old entries (no IDs): phone + the name on the form (first name or full).
  p = reviewPage([{ id: 1, name: 'pat', phone: '(435) 555-0100', sentAt: new Date(Date.now() - 2 * DAY).toISOString(), status: 'sent' }]);
  p.r.setJobs([PAT, SAM]);
  p.r.renderRecentJobRows();
  assert.deepEqual(p.rows(), ['Sent', 'Ask']);
  p = reviewPage([{ id: 1, name: 'Sam  Lee', phone: '4355550100', sentAt: new Date(Date.now() - 2 * DAY).toISOString(), status: 'sent' }]);
  p.r.setJobs([PAT, SAM]);
  p.r.renderRecentJobRows();
  assert.deepEqual(p.rows(), ['Ask', 'Sent']);
  // Older than 30 days: nobody.
  p = reviewPage([{ id: 1, name: 'Pat', phone: '4355550100', jobId: 101, sentAt: new Date(Date.now() - 31 * DAY).toISOString(), status: 'sent' }]);
  p.r.setJobs([PAT, SAM]);
  p.r.renderRecentJobRows();
  assert.deepEqual(p.rows(), ['Ask', 'Ask']);
  assert.doesNotMatch(RR, /recentlyAskedDigits/, 'the phone-only rule is gone everywhere (stat tiles too)');
});

// ---- RP6.11: a deactivated person opens read-only ------------------------------

const TEAM = read('tools', 'team.html');
const TEAM_BODY = TEAM.slice(TEAM.indexOf('<body data-th-page="team">') + '<body data-th-page="team">'.length, TEAM.indexOf('</body>'));
test('RP6.11: a deactivated person opens read-only: switches and name locked, a note, and only Reactivate', async () => {
  const OFF = { can_manage_roles: false, can_access_dev_tools: false, can_access_dev_tools_full: false, can_manage_site_content: false, can_manage_invoices: false, can_manage_contracts: false, can_view_finance: false, can_view_runway: false, can_manage_reviews: true, can_manage_clients: false, can_manage_others_jobs: false };
  const rows = [
    { email: 'owner@example.com', display_name: 'Pat Owner', status: 'active', ...OFF, can_manage_roles: true, can_manage_site_content: true, can_access_dev_tools: true },
    { email: 'gone@example.com', display_name: 'Gone Person', status: 'deactivated', deactivated_at: '2026-10-01T10:00:00Z', ...OFF },
  ];
  const calls = [];
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + TEAM_BODY + '</body></html>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/team.html',
    beforeParse(w) {
      w.SUPABASE_URL = 'https://example.supabase.co'; w.SUPABASE_ANON_KEY = 'anon'; w.getAuthToken = () => 'tok';
      w.getCurrentUserEmail = () => 'owner@example.com'; w.canManageRoles = () => true;
      w.loadCurrentUserRole = () => { setTimeout(() => w.dispatchEvent(new w.Event('th-role-loaded')), 0); };
      w.confirmDevPassword = async () => true; w.showConfirm = async () => true; w.showToast = () => {};
      w.signOut = () => {}; w.retryRoleCheck = () => {};
      w.escapeHtml = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      w.escapeAttr = w.escapeHtml;
      w.thJobs = { all: () => [] };
      w.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
        const json = (b) => ({ ok: true, status: 200, json: async () => b });
        if (String(url).endsWith('/rest/v1/rpc/team_roster')) return json(rows);
        if (String(url).endsWith('/functions/v1/team-admin')) return json({ ok: true });
        return json([{ email: 'x' }]);
      };
    },
  });
  const w = dom.window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 20));
  const $ = (id) => w.document.getElementById(id);
  const open = $('teamList').querySelector('[data-team-open="gone@example.com"]');
  assert.equal(open.disabled, false, 'the row opens');
  open.click();
  assert.equal($('teamPersonView').hidden, false);
  const sws = [...$('teamCaps').querySelectorAll('[data-team-cap]')];
  assert.equal(sws.length, 6);
  assert.ok(sws.every((s) => s.disabled), 'every switch is locked');
  assert.equal($('teamCaps').querySelector('[data-team-cap="reviews"]').getAttribute('aria-checked'), 'true', 'still shows what they had');
  assert.ok($('teamIdentName').disabled && $('teamIdentTitle').disabled && $('teamIdentSave').disabled);
  assert.match($('teamPersonActions').textContent, /Deactivated\. Reactivate to change what they can do\./);
  assert.equal(w.document.querySelector('.team-danger'), null, 'no Deactivate');
  const acts = [...$('teamPersonActions').querySelectorAll('[data-team-act]')].map((b) => b.getAttribute('data-team-act'));
  assert.deepEqual(acts, ['reactivate']);
  // A locked switch does nothing, even if clicked.
  sws[0].click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
  $('teamPersonActions').querySelector('[data-team-act="reactivate"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls.filter((c) => c.url.endsWith('/functions/v1/team-admin')).map((c) => [c.body.action, c.body.email]), [['reactivate', 'gone@example.com']]);

  // An active person's view is unchanged: switches and fields work.
  $('teamBackBtn').click();
  $('teamList').querySelector('[data-team-open="owner@example.com"]').click();
  assert.ok([...$('teamCaps').querySelectorAll('[data-team-cap]')].every((s) => !s.disabled));
  assert.equal($('teamIdentName').disabled, false);
  assert.equal($('teamIdentSave').disabled, false);
});

// ---- RP6.14, RP6.15: say who else gets the email --------------------------------

test('RP6.14: Send test lead says it also emails Steve and Connor a test lead (the email is not suppressed)', () => {
  const DT = read('tools', 'dev-tools.html');
  const panel = DT.slice(DT.indexOf('data-collapse-key="pushtest"'), DT.indexOf('data-collapse-key="bookingtest"'));
  assert.match(panel, /also emails Steve and Connor a test lead/);
  assert.match(panel, /id="pushTestBtn"[^>]*aria-describedby="pushTestEmailNote"/);
  assert.match(panel, /id="pushTestEmailNote"/);
  const info = read('tools', 'dev-tools-shared.js');
  const pushInfo = info.slice(info.indexOf('pushtest: {'), info.indexOf('pushhistory: {'));
  assert.match(pushInfo, /also emails Steve and Connor a test lead/);
  // Same insert as before: nothing server-side changed.
  assert.match(fnSrc(DT, 'runPushNotificationTest', 'async '), /SUPABASE_URL \+ '\/rest\/v1\/th_leads'/);
});

test('RP6.15: the Email list says it also gets client job-message alerts (documented, not separated)', () => {
  const C = read('tools', 'clients.html');
  const at = C.indexOf('<h2>Email list</h2>');
  const panel = C.slice(at, C.indexOf('id="emailListItems"', at));
  assert.match(panel, /also gets an email when a client sends a message about a job in their portal/);
  const info = read('tools', 'dev-tools-shared.js');
  const emailInfo = info.slice(info.indexOf('emaillist: {'), info.indexOf('emaillist: {') + 1200);
  assert.match(emailInfo, /message about a job/);
  // The function itself is unchanged: it still reads the work_order list.
  assert.match(read('edge-functions', 'notify-job-message-email-index.ts'), /notification_recipients\?select=email&notify_types=cs\.%5B%22work_order%22%5D/);
});

test('RP6.1: Job Tracker\'s card badge and the job sheet PDF count the warranty from the same done date', () => {
  const jt = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-tracker.html'), 'utf8');
  const fn = jt.slice(jt.indexOf('  function warrantyBadgeHtml(job) {'), jt.indexOf('  function warrantyBadgeHtml(job) {') + 900);
  assert.match(fn, /const completionDate = thJobDoneDate\(job\);/);
  assert.doesNotMatch(fn, /new Date\(job\.date \+ 'T00:00:00'\)/);
  const jd = fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'job-detail.html'), 'utf8');
  assert.match(jd, /const completionDate = j\.status === 'done' && typeof thJobDoneDate === 'function'\s*\? thJobDoneDate\(j\)/);
});
