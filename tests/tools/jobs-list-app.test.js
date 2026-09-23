// Workspace rework part 3 (2026-09-22): the Jobs list reads like an app.
// Cards say when a job is the way a person does ("Today", "Friday"), the
// date-sorted list is grouped (Overdue / Today / Tomorrow / Next 7 days /
// Later / No date), and on a phone or tablet the action row is Done plus
// round Call / Directions / More buttons -- everything else lives in one
// shared sheet (openJobActions) that the More button and a long-press both
// open. Job Detail gets the same kind of one-tap row.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const JT = fs.readFileSync(path.join(TOOLS, 'job-tracker.html'), 'utf8');
const JD = fs.readFileSync(path.join(TOOLS, 'job-detail.html'), 'utf8');
const TOUR = fs.readFileSync(path.join(TOOLS, 'tools-tour.js'), 'utf8');

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
function run(names, extra) {
  const ctx = Object.assign({ console, Date, Math, String, encodeURIComponent }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(names.map(n => extractFn(JT, n)).join('\n') + '\n;this.__fns = {' + names.join(',') + '};', ctx);
  return ctx.__fns;
}
function iso(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test('relativeJobDate says Today / Tomorrow / Yesterday / a weekday this week / a short date after that', () => {
  const { relativeJobDate } = run(['relativeJobDate']);
  assert.equal(relativeJobDate(iso(0)), 'Today');
  assert.equal(relativeJobDate(iso(1)), 'Tomorrow');
  assert.equal(relativeJobDate(iso(-1)), 'Yesterday');
  const inThree = new Date(iso(3) + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  assert.equal(relativeJobDate(iso(3)), inThree);
  assert.match(relativeJobDate(iso(20)), /^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/);
  assert.equal(relativeJobDate(''), 'No date set');
});

test('jobDateGroup buckets a date-sorted list the way a reminders app does; past dates are Overdue only while the job is open and only done jobs are out of view', () => {
  const { jobDateGroup } = run(['jobDateGroup']);
  assert.equal(jobDateGroup({ date: iso(-3), status: 'not-started' }, false), 'Overdue');
  assert.equal(jobDateGroup({ date: iso(-3), status: 'done' }, false), 'Earlier');
  assert.equal(jobDateGroup({ date: iso(-3), status: 'not-started' }, true), 'Earlier', 'with done jobs in view, the past is just the past');
  assert.equal(jobDateGroup({ date: iso(0) }, false), 'Today');
  assert.equal(jobDateGroup({ date: iso(1) }, false), 'Tomorrow');
  assert.equal(jobDateGroup({ date: iso(7) }, false), 'Next 7 days');
  assert.equal(jobDateGroup({ date: iso(8) }, false), 'Later');
  assert.equal(jobDateGroup({}, false), 'No date');
});

function renderCard(job) {
  const { jobCardHtml } = run(['relativeJobDate', 'jobMoneyPillHtml', 'jobClockBadgeHtml', 'jobCardHtml'], {
    computeJobMargin: () => ({ hasInvoice: false }), money: (v) => '$' + v, escapeHtml: esc, escapeAttr: esc,
    escapeForInlineHandler: (s) => s, personDot: () => '', warrantyBadgeHtml: () => '',
    STATUS_LABEL: { 'not-started': 'Not Started', 'in-progress': 'In Progress', done: 'Done' },
    jobSelectionMode: false, selectedJobIds: new Set(), justAddedJobId: null,
  });
  return jobCardHtml(job, {}, { enableSwipe: true, includePhotoToggle: true, showStatusBadge: true });
}

test('a card gets Call and Directions buttons from its phone and address, a More button that opens the shared sheet, and a relative date with the full date kept as a tooltip', () => {
  const html = renderCard({ id: 7, title: 'Fix <sink>', client: 'Sarah', phone: '(435) 555-0101', address: '1 Main St, St. George', priority: 'high', status: 'not-started', date: iso(0) });
  assert.match(html, /<a class="job-quick-btn" href="tel:4355550101" aria-label="Call Sarah">/);
  assert.match(html, /<a class="job-quick-btn" href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=1%20Main%20St%2C%20St\.%20George" target="_blank" rel="noopener"/);
  assert.match(html, /class="job-quick-btn job-more-btn" onclick="openJobActions\(7\)" aria-label="More for Fix &lt;sink&gt;"/);
  assert.match(html, /<span class="jc-when" title="[^"]+">Today<\/span>/);
  assert.match(html, /<span class="jc-phone"> &middot; \(435\) 555-0101<\/span>/);
  assert.match(html, /<span class="jc-addr"><span class="jc-sep"> &middot; <\/span>1 Main St, St\. George<\/span>/);
  // Everything the desktop board card showed is still in the markup.
  for (const bit of ['class="small-btn job-done-btn"', 'class="status-select"', '>Photos</button>', '>Create Invoice</a>', '>Edit</button>', '>Delete</button>']) assert.ok(html.includes(bit), bit);
  const bare = renderCard({ id: 8, title: 'No contact', priority: 'low', status: 'done', date: '' });
  assert.doesNotMatch(bare, /href="tel:|google\.com\/maps/, 'no phone, no address: no Call, no Directions');
  assert.match(bare, /job-more-btn/, 'More is always there');
  assert.match(bare, /No date set/);
});

test('below the sidebar breakpoint the row is Done + Call + Directions + More: the rest hides (the inline display on Create Invoice needs !important), and only the badges that say something unusual stay', () => {
  const block = JT.match(/@media \(max-width: 1023px\) \{\s*\/\* !important: the Create Invoice link carries an inline display\. \*\/([\s\S]*?)\n  \}/);
  assert.ok(block, 'expected the phone/tablet card block');
  assert.match(block[1], /\.job-card-actions > \.status-select,\s*\.job-card-actions > \.small-btn:not\(\.job-done-btn\),\s*\.job-card-actions > a\.small-btn \{ display: none !important; \}/);
  assert.match(block[1], /\.job-badges \.badge-medium, \.job-badges \.badge-low,\s*\.job-badges \.badge-status\.status-not-started \{ display: none; \}/);
  assert.match(block[1], /\.job-card-meta \.jc-phone \{ display: none; \}/);
  assert.match(block[1], /#tab-jobs \[data-density-toggle\] \{ display: none; \}/);
});

test('openJobActions is the one sheet for a job -- More and long-press both open it -- with status moves, open, photos, invoice, confirmation, expense, edit, delete, and an escaped title', () => {
  let shown = null;
  const calls = [];
  const jobs = [{ id: 5, title: '<b>Leak</b>', status: 'not-started', clientEmail: 'a@b.c' }, { id: 6, title: 'Done one', status: 'done' }];
  const { openJobActions } = run(['openJobActions'], {
    loadJobs: () => jobs, escapeHtml: esc,
    showQuickActionSheet: (title, actions) => { shown = { title, labels: Array.from(actions, a => a.label), actions }; },
    setJobStatus: (id, st) => calls.push(['status', id, st]), toggleJobPhotos: () => calls.push(['photos']),
    sendJobConfirmationEmail: (id) => calls.push(['confirm', id]), showQuickExpenseModal: (id) => calls.push(['expense', id]),
    editJob: (id) => calls.push(['edit', id]), deleteJob: (id) => calls.push(['delete', id]),
    document: { getElementById: () => ({}) }, location: {},
  });
  openJobActions(5);
  assert.equal(shown.title, '&lt;b&gt;Leak&lt;/b&gt;', 'the sheet renders its title as HTML, so it is escaped');
  assert.deepEqual(shown.labels, ['Mark Done', 'Start (In Progress)', 'Open job', 'Photos', 'Create invoice', 'Send confirmation email', 'Log Expense', 'Edit', 'Delete']);
  shown.actions.find(a => a.label === 'Start (In Progress)').onClick();
  shown.actions.find(a => a.label === 'Log Expense').onClick();
  assert.deepEqual(calls, [['status', 5, 'in-progress'], ['expense', 5]]);
  openJobActions(6);
  assert.deepEqual(shown.labels, ['Back to Not Started', 'Open job', 'Photos', 'Create invoice', 'Log Expense', 'Edit', 'Delete'], 'a done job: no Mark Done, no confirmation email without an address');
  assert.match(JT, /attachLongPress\(container, '\.job-card', \(cardEl\) => openJobActions\(Number\(cardEl\.dataset\.jobId\)\)\);/);
});

test('the date-sorted list gets section headers between cards; a priority sort does not', () => {
  const fn = extractFn(JT, 'renderJobs');
  assert.match(fn, /const groupByDate = currentSort === 'date';/);
  assert.match(fn, /head = '<h3 class="job-group-head' \+ \(group === 'Overdue' \? ' is-overdue' : ''\) \+ \(group === 'Today' \? ' is-today' : ''\) \+ '">' \+ group \+ '<\/h3>';/);
  assert.match(fn, /return head \+ jobCardHtml\(job, marginData, \{ enableSwipe: true, includePhotoToggle: true, showStatusBadge: true \}\);/);
});

test('Job Detail gets a one-tap row -- Call / Text / Directions from the job, Invoice / Expense behind their permissions', () => {
  const fn = extractFn(JD, 'renderJobDetail');
  assert.match(fn, /quick\.push\(\['tel:' \+ phoneDigits, 'phone', 'Call'\]\);/);
  assert.match(fn, /quick\.push\(\['sms:' \+ phoneDigits, 'message', 'Text'\]\);/);
  assert.match(fn, /'navigate', 'Directions', true\]/);
  assert.match(fn, /if \(allowed\('canManageInvoices'\)\) quick\.push\(\['\/tools\/invoice-generator\.html\?jobRef=' \+ encodeURIComponent\(j\.id\), 'receipt', 'Invoice'\]\);/);
  assert.match(fn, /if \(allowed\('canViewFinance'\)\) quick\.push\(\['\/tools\/finance\.html\?job=' \+ encodeURIComponent\(j\.id\) \+ '#expenses', 'camera', 'Expense'\]\);/);
});

test('the tour and the help text describe the card as it is now', () => {
  assert.match(TOUR, /Each card has <strong>Done<\/strong>, <strong>Call<\/strong>, <strong>Directions<\/strong>/);
  assert.match(JT, /grouped by when \(Overdue, Today, Tomorrow, Next 7 days, Later\)/);
});
