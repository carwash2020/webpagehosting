// Review request on Mark done (2026-11-04; handoff §2: "Review requests:
// trigger automatically when a job is marked done, not a screen someone
// must remember to visit"; the owner chose "Open it on Mark done").
// Marking a job done -- in Jobs, in Job detail, or from the clock-stopped
// sheet -- opens Review Request Sender prefilled for that client. Nothing
// is sent: the page only builds the message, and you send it from your own
// text or email app (its local-only model). Made-up sample data only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const JT = read('job-tracker.html');
const JD = read('job-detail.html');
const NAV = read('tools-nav-pwa.js');
const RR = read('review-request.html');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'missing function ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

function dl({ perms = {}, role = 'Owner', invoices = [], income = [] } = {}) {
  // The real data-layer.js in a sandbox whose window.location records
  // where Mark done would go (no navigation, no network).
  const store = { th_invoices: JSON.stringify(invoices), th_income_log: JSON.stringify(income) };
  const location = { href: null };
  const ctx = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    URLSearchParams, URL, console, setTimeout, clearTimeout,
    getCurrentUserRole: () => role,
    fetch: () => { throw new Error('nothing is sent'); },
  };
  for (const [k, v] of Object.entries(perms)) ctx[k] = () => v;
  ctx.window = { location, addEventListener() {}, dispatchEvent() {} };
  vm.createContext(ctx);
  vm.runInContext(DL + ';this.api = { thReviewRequestHref, thOpenReviewOnDone, thCanSendReviews };', ctx);
  return { w: ctx.api, went: () => location.href };
}

const JOB = { id: 7, title: 'Dryer vent cleaning', client: 'Sarah Miller', phone: '(435) 555-0123', status: 'done' };

test('the review request opens prefilled: first name, the job, the phone', () => {
  const { w } = dl();
  const href = w.thReviewRequestHref(JOB);
  const u = new URL(href, 'https://example.com');
  assert.equal(u.pathname, '/tools/review-request.html');
  assert.equal(u.searchParams.get('name'), 'Sarah');
  assert.equal(u.searchParams.get('job'), 'Dryer vent cleaning');
  assert.equal(u.searchParams.get('phone'), '(435) 555-0123');
  assert.equal(u.searchParams.get('invoiceJob'), null);
});

test('Mark done goes to it for an account that can send reviews; one that can\'t stays put', () => {
  const ok = dl({ perms: { canManageReviews: true, canManageInvoices: true }, invoices: [{ id: 1, jobRefId: '7', total: 100 }] });
  assert.equal(ok.w.thOpenReviewOnDone(JOB), true);
  assert.match(ok.went(), /^\/tools\/review-request\.html\?name=Sarah&job=Dryer\+vent\+cleaning&phone=/);
  assert.doesNotMatch(ok.went(), /invoiceJob/, 'already invoiced: no invoice nudge');
  const no = dl({ perms: { canManageReviews: false, canManageInvoices: true } });
  assert.equal(no.w.thOpenReviewOnDone(JOB), false);
  assert.equal(no.went(), null);
});

test('while the job is unbilled (and you can bill), the review page is told so it can offer Create the invoice', () => {
  const a = dl({ perms: { canManageReviews: true, canManageInvoices: true } });
  a.w.thOpenReviewOnDone(JOB);
  assert.equal(new URL(a.went(), 'https://example.com').searchParams.get('invoiceJob'), '7');
  const b = dl({ perms: { canManageReviews: true, canManageInvoices: false } });
  b.w.thOpenReviewOnDone(JOB);
  assert.equal(new URL(b.went(), 'https://example.com').searchParams.get('invoiceJob'), null, 'no invoice permission, no nudge');
  const c = dl({ perms: { canManageReviews: true, canManageInvoices: true } });
  c.w.thOpenReviewOnDone(Object.assign({}, JOB, { noInvoice: true }));
  assert.equal(new URL(c.went(), 'https://example.com').searchParams.get('invoiceJob'), null, 'marked no charge');
});

test('nothing is sent on Mark done: the helper only navigates (no network call)', () => {
  for (const name of ['thOpenReviewOnDone', 'thReviewRequestHref', 'thJobUnbilledForMe', 'thCanSendReviews']) {
    assert.doesNotMatch(extractFn(DL, name), /fetch\(|sendBeacon|XMLHttpRequest|functions\/v1/);
  }
});

test('every single-job Mark done path opens it: Jobs, Job detail, and the clock-stopped sheet\'s Mark it done', async () => {
  // Jobs: after the celebration, before (instead of) the Job done sheet.
  const calls = [];
  const store = [{ id: 5, status: 'in-progress', title: 'T' }];
  const ctx = {
    thJobs: { get: (id) => store.find(j => j.id === id), update: (id, p) => Object.assign(store.find(j => j.id === id), p) },
    renderJobs() {}, celebrateCompletion: () => calls.push('celebrate'),
    thOpenReviewOnDone: (j) => { calls.push('review:' + j.id); return true; },
    openJobDoneSheet: async () => calls.push('sheet'), Date,
  };
  vm.createContext(ctx);
  vm.runInContext('async ' + extractFn(JT, 'setJobStatus') + ';this.setJobStatus = setJobStatus;', ctx);
  await ctx.setJobStatus(5, 'done');
  assert.deepEqual(calls, ['celebrate', 'review:5'], 'the review request opens; no sheet');
  // An account that can't send reviews still gets the Job done sheet.
  calls.length = 0; store[0].status = 'in-progress';
  ctx.thOpenReviewOnDone = () => false;
  await ctx.setJobStatus(5, 'done');
  assert.deepEqual(calls, ['celebrate', 'sheet']);
  // Job detail.
  assert.match(extractFn(JD, 'markJobDoneHere'), /showToast\(\(job\.title \|\| 'Job'\) \+ ' marked done\.'\);\s*\/\/[^\n]*\n\s*if \(typeof thOpenReviewOnDone === 'function' && thOpenReviewOnDone\(job\)\) return;/);
  // The clock-stopped sheet's Mark it done (its "Done -- create the
  // invoice" still goes to the invoice: you chose that).
  const sheet = extractFn(NAV, 'thOpenClockStoppedSheet');
  assert.match(sheet, /label: 'Mark it done', onClick: function \(\) \{[\s\S]*?if \(typeof thOpenReviewOnDone === 'function'\) thOpenReviewOnDone\(done\);/);
  assert.match(sheet, /if \(thFinishJob\(job\.id\)\) window\.location\.href = '\/tools\/invoice-generator\.html\?jobRef=' \+ encodeURIComponent\(job\.id\);/);
});

test('the review page shows "Not billed yet. Create the invoice" only for a real job id in ?invoiceJob=', () => {
  const markup = RR.slice(RR.indexOf('<p class="review-invoice-next" id="reviewInvoiceNext" hidden>'), RR.indexOf('</p>', RR.indexOf('id="reviewInvoiceNext"')) + 4);
  const code = RR.slice(RR.indexOf("  const invoiceJob = params.get('invoiceJob');"), RR.indexOf('  }\n', RR.indexOf("  const invoiceJob = params.get('invoiceJob');")) + 4);
  for (const [search, shown, href] of [
    ['?name=Sarah&invoiceJob=7', true, '/tools/invoice-generator.html?jobRef=7'],
    ['?name=Sarah', false, null],
    ['?invoiceJob=' + encodeURIComponent('"><img src=x onerror=alert(1)>'), false, null],
  ]) {
    const dom = new JSDOM('<!DOCTYPE html><body>' + markup + '</body>', { runScripts: 'outside-only', url: 'https://example.com/tools/review-request.html' + search });
    dom.window.eval('const params = new URLSearchParams(location.search);\n' + code);
    const note = dom.window.document.getElementById('reviewInvoiceNext');
    assert.equal(note.hidden, !shown, search);
    if (href) assert.equal(dom.window.document.getElementById('reviewInvoiceNextLink').getAttribute('href'), href);
    assert.equal(dom.window.document.querySelectorAll('img').length, 0);
  }
});
