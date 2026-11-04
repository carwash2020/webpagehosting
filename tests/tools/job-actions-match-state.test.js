// Handoff 2026-11-03 §2 / §4F: "Actions must match the job's state (no
// 'Mark done' on already-paid jobs, no INVOICE action on INVOICED jobs)."
// The audit saw INVOICE offered on INVOICED-stage jobs ("Repair fridge").
// One rule now lives in data-layer.js, thJobActions(job, money):
//   Invoice   only while the job is done and nothing is billed (to-invoice)
//   Mark done only while not done and nothing is billed yet
// and every Job Tracker / Job Detail action reads it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const JT = read('job-tracker.html');
const JD = read('job-detail.html');

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

test('thJobActions: Invoice only for a done, unbilled job; Mark done never once it is billed or done', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractFn(DL, 'thJobActions') + ';this.f = thJobActions;', ctx);
  const f = (status, stage) => ({ ...ctx.f({ status }, { stage }) });
  assert.deepEqual(f('not-started', 'booked'), { canInvoice: false, canMarkDone: true });
  assert.deepEqual(f('in-progress', 'working'), { canInvoice: false, canMarkDone: true });
  assert.deepEqual(f('done', 'to-invoice'), { canInvoice: true, canMarkDone: false });
  assert.deepEqual(f('done', 'invoiced'), { canInvoice: false, canMarkDone: false }, 'INVOICED: no Invoice action');
  assert.deepEqual(f('done', 'overdue'), { canInvoice: false, canMarkDone: false });
  assert.deepEqual(f('done', 'paid'), { canInvoice: false, canMarkDone: false });
  assert.deepEqual(f('done', 'no-charge'), { canInvoice: false, canMarkDone: false });
  assert.deepEqual(f('in-progress', 'paid'), { canInvoice: false, canMarkDone: false }, 'paid up front: no Mark done');
  assert.deepEqual(f('not-started', 'invoiced'), { canInvoice: false, canMarkDone: false });
});

test('Job Tracker card, swipe, table row and ⋯ menu all ask thJobActions', () => {
  const card = extractFn(JT, 'jobCardHtml');
  assert.match(card, /const jobActs = thJobActions\(job, thJobMoneyStage\(job, marginData\.invoices \|\| \[\], marginData\.manualIncome \|\| \[\]\)\);/);
  assert.match(card, /opts\.enableSwipe && jobActs\.canMarkDone/);
  assert.match(card, /\$\{jobActs\.canMarkDone \? `<button type="button" class="small-btn job-done-btn"/);
  assert.match(card, /\$\{jobActs\.canInvoice \? `<a class="small-btn" href="\/tools\/invoice-generator\.html\?jobRef=/);
  assert.doesNotMatch(card, /\$\{!isDone \? `<button type="button" class="small-btn job-done-btn"/);

  const rows = JT.slice(JT.indexOf('<td class="jt-actions-cell">') - 4000, JT.indexOf('<td class="jt-actions-cell">') + 800);
  assert.match(rows, /const rowActs = thJobActions\(job, thJobMoneyStage\(job, marginData\.invoices \|\| \[\], marginData\.manualIncome \|\| \[\]\)\);/);
  assert.match(rows, /\$\{rowActs\.canMarkDone \?/);
  assert.match(rows, /\$\{rowActs\.canInvoice \?/);

  const menu = extractFn(JT, 'openJobActions');
  assert.match(menu, /const acts = thJobActions\(job, money\);/);
  assert.match(menu, /if \(acts\.canMarkDone\) \{\s*actions\.push\(\{ label: 'Mark Done'/);
  assert.match(menu, /if \(acts\.canInvoice\) actions\.push\(\{ label: 'Create invoice'/);
  assert.equal((JT.match(/href="\/tools\/invoice-generator\.html\?jobRef=\$\{job\.id\}"/g) || []).length, 2, 'only the two gated links remain');
});

test('Job Detail quick bar shows Invoice only when the job is ready to invoice', () => {
  const fn = extractFn(JD, 'renderJobDetail');
  assert.match(fn, /if \(allowed\('canManageInvoices'\) && thJobActions\(j, bundle\.money\)\.canInvoice\) quick\.push\(\['\/tools\/invoice-generator\.html\?jobRef='/);
});
