// Workspace rework part 5 (2026-09-22): nothing slips between "done" and
// "paid". Every job has a money stage worked out from records that already
// exist (thJobMoneyStage in data-layer.js); finished jobs nobody has billed
// surface as Ready to invoice on the Dashboard and To invoice in Jobs;
// marking a job done offers Create invoice first; Job Detail shows the
// whole Booked -> Working -> Done -> Invoiced -> Paid track with the next
// step's button.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const WS = read('workspace.html');
const JT = read('job-tracker.html');
const JD = read('job-detail.html');
const CD = read('client-detail.html');
const FIN = read('finance.html');
const TOUR = read('tools-tour.js');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'expected function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function iso(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysAgoIso(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }

// The whole data layer in a vm with an in-memory localStorage.
function dataLayer(store) {
  const mem = Object.assign({}, store || {});
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN,
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } },
  };
  vm.createContext(ctx);
  vm.runInContext(DL + '\n;this.api = { thJobMoneyStage, thJobSteps, thJobsToInvoice, thJobDoneDate, thSetJobNoInvoice, thGetJobBundle, TH_KEYS };', ctx);
  return { api: ctx.api, mem };
}

test('thJobMoneyStage: the stage follows the money -- invoices by jobRefId, payments logged by hand, then the job status', () => {
  const { thJobMoneyStage } = dataLayer().api;
  const job = { id: 7, status: 'done' };
  const stage = (j, inv, inc) => thJobMoneyStage(j, inv || [], inc || []).stage;
  assert.equal(stage({ id: 1, status: 'not-started' }), 'booked');
  assert.equal(stage({ id: 1, status: 'in-progress' }), 'working');
  assert.equal(stage(job), 'to-invoice', 'done and nothing billed: the one that slips');
  assert.equal(stage({ ...job, noInvoice: true }), 'no-charge');
  assert.equal(stage(job, [{ jobRefId: '7', total: 160, paidAmount: 0, date: iso(-2), terms: 'Net 30' }]), 'invoiced', 'jobRefId is a string on invoices');
  assert.equal(stage(job, [{ jobRefId: '7', total: 285, paidAmount: 0, date: iso(-40), terms: 'Net 15' }]), 'overdue');
  assert.equal(stage(job, [{ jobRefId: '7', total: 95, paidAmount: 95, date: iso(-12) }]), 'paid');
  assert.equal(stage(job, [{ jobRefId: '7', total: 95, paid: true, paidAmount: 0 }]), 'invoiced', 'paidAmount wins over a stale paid flag');
  assert.equal(stage(job, [], [{ jobRefId: '7', amount: 120 }]), 'paid', 'cash logged against the job in Finance counts as paid');
  assert.equal(stage({ id: 7, status: 'in-progress' }, [{ jobRefId: '7', total: 200, paidAmount: 100, date: iso(-1), terms: 'Net 15' }]), 'invoiced', 'a deposit invoice: money stage while the work is still going');
  assert.equal(stage(job, [{ jobRefId: '8', total: 95, paidAmount: 95 }]), 'to-invoice', "another job's invoice doesn't count");
  const m = thJobMoneyStage(job, [{ jobRefId: '7', total: 160, paidAmount: 60, date: iso(-2), terms: 'Net 30' }, { jobRefId: '7', total: 40.1, paidAmount: 0, date: iso(-2), terms: 'Net 30' }], []);
  assert.deepEqual([m.stage, m.balance, m.billed], ['invoiced', 140.1, 200.1]);
});

test('thJobSteps: Booked, Working, Done, Invoiced, Paid -- current is the first step not reached; a no-charge job ends at Done', () => {
  const { thJobMoneyStage, thJobSteps } = dataLayer().api;
  const track = (job, inv, inc) => { const t = thJobSteps(job, thJobMoneyStage(job, inv || [], inc || [])); return [Array.from(t.steps, s => s.key + (s.reached ? '+' : '-')).join(' '), t.current]; };
  assert.deepEqual(track({ id: 1, status: 'not-started' }), ['booked+ working- done- invoiced- paid-', 'working']);
  assert.deepEqual(track({ id: 1, status: 'done' }), ['booked+ working+ done+ invoiced- paid-', 'invoiced']);
  assert.deepEqual(track({ id: 1, status: 'done' }, [{ jobRefId: '1', total: 50, paidAmount: 50 }]), ['booked+ working+ done+ invoiced+ paid+', null]);
  assert.deepEqual(track({ id: 1, status: 'done', noInvoice: true }), ['booked+ working+ done+', null]);
  assert.deepEqual(track({ id: 1, status: 'in-progress' }, [{ jobRefId: '1', total: 50, paidAmount: 0, date: iso(0), terms: 'Net 30' }]), ['booked+ working+ done- invoiced+ paid-', 'done'], 'billed ahead of finishing');
});

test('thJobsToInvoice: done in the last 60 days, nothing billed or paid, not marked no charge, oldest first; the done date is when it was marked done', () => {
  const { thJobsToInvoice, thJobDoneDate } = dataLayer().api;
  const jobs = [
    { id: 1, title: 'Fresh', status: 'done', statusChangedAt: daysAgoIso(0), date: iso(-30) },
    { id: 2, title: 'Week old', status: 'done', statusChangedAt: daysAgoIso(8) },
    { id: 3, title: 'Billed', status: 'done', statusChangedAt: daysAgoIso(3) },
    { id: 4, title: 'Cash', status: 'done', statusChangedAt: daysAgoIso(3) },
    { id: 5, title: 'Warranty', status: 'done', statusChangedAt: daysAgoIso(3), noInvoice: true },
    { id: 6, title: 'Ancient', status: 'done', statusChangedAt: daysAgoIso(61) },
    { id: 7, title: 'Open', status: 'in-progress', statusChangedAt: daysAgoIso(1) },
    { id: 8, title: 'Legacy (no statusChangedAt)', status: 'done', date: iso(-20) },
  ];
  const rows = thJobsToInvoice(jobs, [{ jobRefId: '3', total: 100 }], [{ jobRefId: '4', amount: 80 }]);
  assert.deepEqual(Array.from(rows, r => [r.job.id, r.daysAgo]), [[8, 20], [2, 8], [1, 0]]);
  assert.equal(thJobDoneDate({ statusChangedAt: 'garbage', date: iso(-2) }).getTime(), new Date(iso(-2) + 'T00:00:00').getTime());
  assert.equal(thJobsToInvoice(jobs, [], [], undefined, 90).some(r => r.job.id === 6), true, 'the window is a parameter');
});

test('thSetJobNoInvoice writes an explicit false to clear the flag (a deleted field can come back through the per-field sync merge), and thGetJobBundle carries the money stage', () => {
  const { api, mem } = dataLayer({ th_tracker_jobs: JSON.stringify([{ id: 9, status: 'done', title: 'X' }]) });
  assert.equal(api.thSetJobNoInvoice(9, true), true);
  assert.equal(JSON.parse(mem.th_tracker_jobs)[0].noInvoice, true);
  api.thSetJobNoInvoice(9, false);
  assert.equal(JSON.parse(mem.th_tracker_jobs)[0].noInvoice, false);
  assert.equal(api.thSetJobNoInvoice(404, true), false);
  assert.equal(api.thGetJobBundle(9).money.stage, 'to-invoice');
});

function loadDashboard(data) {
  const dom = new JSDOM(WS, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.requestAnimationFrame = (cb) => setTimeout(cb, 0); // renderMetrics animates its numbers
      for (const [k, v] of Object.entries(data)) w.localStorage.setItem(k, JSON.stringify(v));
    },
  });
  const w = dom.window;
  const s = w.document.createElement('script'); s.textContent = DL; w.document.head.appendChild(s);
  Object.assign(w, {
    escapeHtml: (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    escapeAttr: (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    money: (n) => '$' + (Number(n) || 0).toFixed(2),
  });
  return w;
}

test('Dashboard: Ready to invoice lists the unbilled finished jobs with Invoice links, counts toward the Income lane and the badge, and hides itself when empty', () => {
  const w = loadDashboard({
    th_tracker_jobs: [
      { id: 11, title: 'Dishwasher <leak>', client: 'Sarah Miller', status: 'done', statusChangedAt: daysAgoIso(9) },
      { id: 12, title: 'Fan install', client: 'Jen Park', status: 'done', statusChangedAt: daysAgoIso(0) },
      { id: 13, title: 'Billed one', status: 'done', statusChangedAt: daysAgoIso(1) },
    ],
    th_invoices: [{ id: 1, jobRefId: '13', total: 50, paidAmount: 0, clientName: 'Bill', date: iso(0), terms: 'Net 15' }],
    th_income_log: [],
  });
  w.renderInvoicesList(); // counts unpaid, then renders Ready to invoice, then the badge
  const group = w.document.getElementById('readyToInvoiceGroup');
  assert.equal(group.hidden, false);
  const rows = [...w.document.querySelectorAll('#readyToInvoiceList .dash-list-item')];
  assert.deepEqual(rows.map(r => r.dataset.rtiJob), ['11', '12'], 'oldest first');
  assert.match(rows[0].innerHTML, /Dishwasher &lt;leak&gt;/);
  assert.match(rows[0].className, /is-unread/, 'a week or more old is highlighted');
  assert.match(rows[0].textContent, /Sarah Miller · Done 9 days ago/);
  assert.match(rows[1].textContent, /Done today/);
  assert.equal(rows[0].querySelector('.rti-invoice-btn').getAttribute('href'), '/tools/invoice-generator.html?jobRef=11');
  assert.equal(w.document.getElementById('readyToInvoiceCount').textContent, '2');
  assert.equal(w.document.getElementById('laneMoneyCount').textContent, '3', '1 unpaid + 2 to invoice');
  assert.match(w.document.getElementById('actionItemsHeadingBadge').textContent, /2 to invoice/);
  w.close();

  const empty = loadDashboard({ th_tracker_jobs: [{ id: 1, status: 'in-progress' }], th_invoices: [], th_income_log: [] });
  empty.renderReadyToInvoice();
  assert.equal(empty.document.getElementById('readyToInvoiceGroup').hidden, true);
  empty.close();
});

test('Dashboard: the ⋯ sheet offers Create invoice, Paid another way (Finance income for that job), No charge (with undo), and Open job', () => {
  const w = loadDashboard({ th_tracker_jobs: [{ id: 21, title: 'Gate hinge', client: 'Tom', status: 'done', statusChangedAt: daysAgoIso(2) }], th_invoices: [], th_income_log: [] });
  let sheet = null, undo = null;
  w.showQuickActionSheet = (title, actions) => { sheet = { title, actions }; };
  w.showUndoToast = (msg, fn) => { undo = fn; };
  w.openReadyToInvoiceActions(21);
  assert.equal(sheet.title, 'Gate hinge · Tom');
  assert.deepEqual(Array.from(sheet.actions, a => a.label), ['Create invoice', 'Paid another way: log the payment', 'No charge (warranty, favor)', 'Open job']);
  sheet.actions[2].onClick();
  assert.equal(JSON.parse(w.localStorage.getItem('th_tracker_jobs'))[0].noInvoice, true);
  assert.equal(w.document.getElementById('readyToInvoiceGroup').hidden, true);
  undo();
  assert.equal(JSON.parse(w.localStorage.getItem('th_tracker_jobs'))[0].noInvoice, false);
  assert.equal(w.document.getElementById('readyToInvoiceGroup').hidden, false);
  assert.match(extractFn(WS, 'openReadyToInvoiceActions'), /'\/tools\/finance\.html\?job=' \+ encodeURIComponent\(job\.id\) \+ '#income'/);
  w.close();
});

test('Dashboard: the Money Owed card gets a To invoice line that jumps to Ready to invoice; the group is invoice-permission gated', () => {
  const fn = extractFn(WS, 'renderTodayMoney');
  assert.match(fn, /const toInvoiceCount = readyToInvoiceRows\(\)\.length;/);
  assert.match(fn, /<a class="today-money-row today-money-todo" href="#readyToInvoiceGroup">/);
  assert.match(WS, /<div class="ops-group rti-group" id="readyToInvoiceGroup" data-tile-perm="can_manage_invoices" hidden>/);
});

function jtFns(names, extra) {
  const ctx = Object.assign({ console, Date, Math, String, Number, encodeURIComponent, Set }, extra || {});
  vm.createContext(ctx);
  const fnSrc = (n) => (JT.includes('async function ' + n + '(') ? 'async ' : '') + extractFn(JT, n);
  vm.runInContext(DL + '\n' + JT.match(/const JOB_MONEY_PILL = \{[\s\S]*?\n  \};/)[0] + '\n' + names.map(fnSrc).join('\n') + '\n;this.__fns = {' + names.join(',') + '};', ctx);
  return ctx.__fns;
}

test('Jobs: a card wears its money pill -- To invoice links to the invoice form (inside the 60-day window only), then Invoiced / Overdue / Paid / No charge; booked and working jobs wear none', () => {
  const { jobMoneyPillHtml } = jtFns(['jobMoneyPillHtml'], { localStorage: { getItem: () => null } });
  const md = (extra) => Object.assign({ invoices: [], manualIncome: [], toInvoiceIds: new Set([5]) }, extra);
  assert.equal(jobMoneyPillHtml({ id: 5, status: 'done' }, md()), '<a class="badge badge-money is-to-invoice" href="/tools/invoice-generator.html?jobRef=5" title="Done, and nothing billed yet">To invoice</a>');
  assert.equal(jobMoneyPillHtml({ id: 6, status: 'done' }, md()), '', 'outside the window: no alarm on old history');
  assert.match(jobMoneyPillHtml({ id: 5, status: 'done' }, md({ invoices: [{ jobRefId: '5', total: 10, paidAmount: 10 }] })), /is-paid">Paid</);
  assert.match(jobMoneyPillHtml({ id: 5, status: 'done' }, md({ invoices: [{ jobRefId: '5', total: 10, paidAmount: 0, date: iso(-40), terms: 'Net 15' }] })), /is-overdue">Overdue</);
  assert.match(jobMoneyPillHtml({ id: 5, status: 'done', noInvoice: true }, md()), /is-muted">No charge</);
  assert.equal(jobMoneyPillHtml({ id: 5, status: 'not-started' }, md()), '');
  assert.equal(jobMoneyPillHtml({ id: 5, status: 'done' }, {}), '', 'no marginData: no pill (the jobs-list-app harness)');
});

test('Jobs: the To invoice filter and its count come from the same thJobsToInvoice list as the Dashboard; #to-invoice lands on it', () => {
  assert.match(JT, /<button class="sort-btn" data-status-filter="to-invoice" onclick="setStatusFilter\('to-invoice'\)">To invoice <span class="sort-btn-count" id="toInvoiceFilterCount"><\/span><\/button>/);
  const fn = extractFn(JT, 'renderJobs');
  assert.match(fn, /const toInvoiceRows = \(typeof thJobsToInvoice === 'function'\) \? thJobsToInvoice\(loadJobs\(\), marginInvoices, marginManualIncome\) : \[\];/);
  assert.match(fn, /else if \(currentStatusFilter === 'to-invoice'\) jobs = jobs\.filter\(j => marginData\.toInvoiceIds\.has\(j\.id\)\);/);
  assert.match(JT, /if \(initialHash === 'to-invoice'\) setStatusFilter\('to-invoice'\);/);
  assert.match(JT, /if \(h === 'to-invoice'\) \{ activateTab\('jobs'\); setStatusFilter\('to-invoice'\); return; \}/);
});

test('Jobs: marking a job done opens the Job done sheet -- Create invoice first while it is unbilled, then the review request, then No charge; the celebration still fires first', async () => {
  const set = extractFn(JT, 'setJobStatus');
  assert.ok(set.indexOf('celebrateCompletion()') < set.indexOf('await openJobDoneSheet(job);'));
  let shown = null, noCharge = [];
  const { openJobDoneSheet } = jtFns(['openJobDoneSheet', 'reviewRequestHref'], {
    URLSearchParams, localStorage: { getItem: (k) => (k === 'th_invoices' ? JSON.stringify([{ jobRefId: '2', total: 5, paidAmount: 0 }]) : '[]') },
    showQuickActionSheet: (title, actions) => { shown = { title, labels: Array.from(actions, a => a.label), actions }; },
    escapeHtml: (x) => String(x).replace(/</g, '&lt;').replace(/>/g, '&gt;'), setJobNoCharge: (id, v) => noCharge.push([id, v]), window: { location: {} },
  });
  await openJobDoneSheet({ id: 1, title: 'Sink <trap>', client: 'Sarah Miller', status: 'done' });
  assert.equal(shown.title, 'Done: Sink &lt;trap&gt;');
  assert.deepEqual(shown.labels, ['Create invoice', 'Send a review request to Sarah', 'No charge (warranty, favor)']);
  shown.actions[2].onClick();
  assert.deepEqual(noCharge, [[1, true]]);
  await openJobDoneSheet({ id: 2, title: 'Already billed', status: 'done' });
  assert.deepEqual(shown.labels, ['Send a review request'], 'an invoice already exists: just the review');
});

test('Jobs: the job sheet offers No charge on an unbilled done job and puts it back with "Needs an invoice after all"', () => {
  const jobs = [{ id: 3, title: 'T', status: 'done' }, { id: 4, title: 'W', status: 'done', noInvoice: true }];
  let shown = null;
  const { openJobActions } = jtFns(['openJobActions'], {
    loadJobs: () => jobs, localStorage: { getItem: () => '[]' }, escapeHtml: (x) => x,
    showQuickActionSheet: (t, a) => { shown = Array.from(a, x => x.label); }, document: { getElementById: () => null }, location: {},
  });
  openJobActions(3);
  assert.ok(shown.includes('No charge (warranty, favor)'));
  openJobActions(4);
  assert.ok(shown.includes('Needs an invoice after all'));
});

function jdTrack(job, invoices, income, perms) {
  const ctx = {
    console, Date, Math, String, Number, encodeURIComponent, JSON,
    localStorage: { getItem: () => null },
    money: (n) => '$' + Number(n).toFixed(2), escapeHtml: (x) => String(x), escapeAttr: (x) => String(x),
  };
  vm.createContext(ctx);
  vm.runInContext(DL + '\n' + extractFn(JD, 'jobTrackHtml') + ';this.f = jobTrackHtml; this.stage = thJobMoneyStage;', ctx);
  const allowed = (fn) => !perms || perms[fn] !== false;
  return ctx.f({ job, money: ctx.stage(job, invoices || [], income || []) }, allowed);
}

test('Job Detail: the tracker marks each reached step, rings the next one, and says what happens next with the button for it', () => {
  const toInvoice = jdTrack({ id: 5, status: 'done', client: 'Sarah' });
  assert.match(toInvoice, /<li class="job-track-step is-current" aria-current="step"><span class="job-track-dot" aria-hidden="true"><\/span><span class="job-track-label">Invoiced<\/span><\/li>/);
  assert.equal((toInvoice.match(/is-reached/g) || []).length, 3);
  assert.match(toInvoice, /<div class="job-next is-todo">/);
  assert.match(toInvoice, /href="\/tools\/invoice-generator\.html\?jobRef=5">Create invoice<\/a>/);
  assert.match(toInvoice, /href="\/tools\/finance\.html\?job=5#income">Paid another way<\/a>/);
  assert.doesNotMatch(jdTrack({ id: 5, status: 'done' }, [], [], { canManageInvoices: false }), /Create invoice/, 'behind the invoice permission');

  const overdue = jdTrack({ id: 5, status: 'done', client: 'Bill' }, [{ jobRefId: '5', total: 285, paidAmount: 0, date: iso(-40), terms: 'Net 15' }]);
  assert.match(overdue, /<div class="job-next is-late"><div class="job-next-text"><strong>\$285\.00 owed<\/strong> &middot; 25 days overdue\.<\/div>/);
  assert.match(overdue, />Follow up<\/a>/);

  const paid = jdTrack({ id: 5, status: 'done' }, [{ jobRefId: '5', total: 95, paidAmount: 95 }]);
  assert.match(paid, /<ol class="job-track is-complete"/);
  assert.match(paid, /<strong>Paid in full<\/strong> &middot; \$95\.00\./);
  assert.match(jdTrack({ id: 5, status: 'not-started', date: iso(3) }), /Booked for [A-Z][a-z]+day, [A-Z][a-z]{2} \d+\./);
  assert.match(jdTrack({ id: 5, status: 'not-started', date: iso(0) }), /<strong>Booked for today\.<\/strong>/);
  assert.match(jdTrack({ id: 5, status: 'not-started', date: iso(1) }), /Booked for tomorrow\./);
  assert.match(jdTrack({ id: 5, status: 'not-started', date: iso(-4) }), /<div class="job-next is-todo">.*and not started yet\./);
  assert.doesNotMatch(jdTrack({ id: 5, status: 'done', noInvoice: true }), /Invoiced/, 'no charge: the track ends at Done');
});

test('Job Detail: expense rows show what was bought (desc / vendor), and invoice rows use the paidAmount-first status word', () => {
  const fn = extractFn(JD, 'renderJobDetail');
  assert.match(fn, /title: e\.desc \|\| e\.vendor \|\| \(e\.type === 'mileage' \? 'Mileage' : 'Expense'\)/);
  assert.doesNotMatch(fn, /e\.description \|\| e\.category/);
  assert.match(fn, /meta: \(i\.date \|\| ''\) \+ ' \\u00b7 ' \+ invoiceStatusWord\(i\)/);
  const ctx = { Number, Date, Math };
  vm.createContext(ctx);
  vm.runInContext(DL.match(/const TH_TERM_DAYS = [^\n]+/)[0] + '\n' + ['thInvoicePaidAmount', 'thInvoiceBalance', 'thInvoiceDueDate', 'thInvoiceIsOverdue'].map(n => extractFn(DL, n)).join('\n') + '\n' + extractFn(JD, 'invoiceStatusWord') + ';this.f = invoiceStatusWord;', ctx);
  assert.equal(ctx.f({ total: 100, paidAmount: 100 }), 'Paid');
  assert.equal(ctx.f({ total: 100, paid: true, paidAmount: 0, date: iso(-1), terms: 'Net 30' }), 'Unpaid');
  assert.equal(ctx.f({ total: 100, paidAmount: 40, date: iso(-1), terms: 'Net 30' }), 'Part paid');
  assert.equal(ctx.f({ total: 100, paidAmount: 0, date: iso(-40), terms: 'Net 15' }), 'Overdue');
});

test('Client Detail and Finance: the client page lists each job with its money pill; ?job=<id>#income opens the income form filled from the job', () => {
  assert.match(CD, /const stage = \(typeof thJobMoneyStage === 'function'\) \? thJobMoneyStage\(j, bundle\.invoices, handPaid\)\.stage : null;/);
  assert.match(CD, /'to-invoice': '<span class="th-pill">To invoice<\/span>'/);
  assert.match(FIN, /if \(initialHash === 'income'\) \{[\s\S]*?incomeJobRefEl\.value = presetJobId;[\s\S]*?fillIfBlank\('incomeSource', presetJob\.client\);[\s\S]*?fillIfBlank\('incomeDesc', presetJob\.title\);[\s\S]*?toggleFormSection\('incomeFormSection', true\)/);
});

test('the tour and the help say it', () => {
  assert.match(TOUR, /<strong>Ready to invoice<\/strong>: finished jobs nobody has billed yet/);
  assert.match(TOUR, /Marking a job done offers to <strong>invoice it<\/strong> on the spot/);
  assert.match(WS, /<strong>Ready to invoice<\/strong> &mdash; jobs finished in the last 60 days with no invoice and no payment logged/);
  assert.match(JT, /the <strong>To invoice<\/strong> filter lists them all/);
});
