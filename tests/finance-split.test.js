// Tests for Push 4 of the structural rework: splitting job-tracker.html's
// Cost Lookup, Profitability, Income, and Expenses tabs out into their own
// page (tools/finance.html).
//
// This was the most delicate surgery in the whole project -- 38 functions
// extracted from a file where they were interleaved with Jobs-tab logic,
// not contiguous, and getting the boundary wrong the first time would have
// silently gutted Job Tracker's real functionality. These tests exist so a
// future edit to either file can't quietly reintroduce that same class of
// mistake (a function duplicated in both places, a stale link nobody
// noticed, a redirect that stops working).
//
// Run locally with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const JOB_TRACKER_PATH = path.join(__dirname, '..', 'tools', 'job-tracker.html');
const FINANCE_PATH = path.join(__dirname, '..', 'tools', 'finance.html');

const MOVED_FUNCTIONS = [
  'renderJobProfitability', 'checkClientHistory', 'saveTaxSettings', 'loadTaxSettings',
  'calculateCost', 'loadPriceReferences', 'savePriceReferences', 'savePriceReference',
  'loadPriceReference', 'deletePriceReference', 'renderPriceReferences',
  'loadIncomeEntries', 'saveIncomeEntries', 'populateIncomeJobRefOptions',
  'addIncomeEntry', 'editIncomeEntry', 'cancelIncomeEntryEdit', 'deleteIncomeEntry',
  'clearAllIncome', 'backfillLegacyInvoicesIntoIncomeLog', 'renderIncomeEntries',
  'buildIncomeCSV', 'exportIncomeCSV', 'loadExpenses', 'saveExpenses', 'getMileageRate',
  'saveMileageRate', 'loadMileageRate', 'populateJobRefOptions', 'addExpense',
  'editExpense', 'cancelExpenseEdit', 'deleteExpense', 'clearAllExpenses',
  'renderExpenses', 'buildCSV', 'openSignedReceipt', 'exportCSV',
];

test('every moved function is defined in finance.html', () => {
  const src = fs.readFileSync(FINANCE_PATH, 'utf8');
  const missing = MOVED_FUNCTIONS.filter(name =>
    !new RegExp('function ' + name + '\\(').test(src)
  );
  assert.deepEqual(missing, [], 'these functions should exist in finance.html but do not: ' + missing.join(', '));
});

test('none of the moved functions are defined in job-tracker.html anymore', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const stillPresent = MOVED_FUNCTIONS.filter(name =>
    new RegExp('function ' + name + '\\(').test(src)
  );
  assert.deepEqual(stillPresent, [],
    'these functions should have moved to finance.html but a definition still exists in job-tracker.html: ' + stillPresent.join(', '));
});

test('none of the moved functions are CALLED from job-tracker.html anymore (not just undefined)', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const stillCalled = [];
  for (const name of MOVED_FUNCTIONS) {
    const re = new RegExp(name + '\\(', 'g');
    for (const m of src.matchAll(re)) {
      const lineStart = src.lastIndexOf('\n', m.index) + 1;
      const lineEnd = src.indexOf('\n', m.index);
      const line = src.slice(lineStart, lineEnd).trim();
      if (!line.startsWith('//') && !line.startsWith('*')) {
        stillCalled.push(name);
        break;
      }
    }
  }
  assert.deepEqual(stillCalled, [],
    'these functions are still called from real code in job-tracker.html, which would throw at runtime since the definitions moved: ' + stillCalled.join(', '));
});

test('job-tracker.html\'s Jobs tab still has everything it needs: loadJobs, renderJobs, addJob, computeJobMargin wrapper', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  for (const name of ['loadJobs', 'saveJobs', 'renderJobs', 'addJob', 'editJob', 'deleteJob', 'computeJobMargin', 'renderContacts', 'renderTemplates']) {
    assert.match(src, new RegExp('function (async )?' + name + '\\('), name + ' should still be defined in job-tracker.html');
  }
});

test('the job-card margin badge reads expense/income/invoice data via the shared data layer, not a removed local function', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.match(src, /const marginInvoices = thRead\(TH_KEYS\.invoices, \[\]\)/);
  assert.match(src, /const marginExpenses = thRead\(TH_KEYS\.expenses, \[\]\)/);
  assert.match(src, /const marginManualIncome = thRead\(TH_KEYS\.income, \[\]\)/);
});

test('Contacts\' client-history feature reads income data via the shared data layer, not the removed loadIncomeEntries', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.match(src, /const manualIncomeForClient = thRead\(TH_KEYS\.income, \[\]\)/,
    'toggleClientHistory should read income via thRead now that loadIncomeEntries moved to finance.html');
});

test('old #cost/#income/#expenses/#profitability links on job-tracker.html redirect to finance.html', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.match(src, /MOVED_TAB_HASHES\s*=\s*\{\s*cost:\s*1,\s*income:\s*1,\s*expenses:\s*1,\s*profitability:\s*1\s*\}/);
  assert.match(src, /window\.location\.replace\('\/tools\/finance\.html'/);
});

test('job-tracker.html\'s tab bar only has Jobs, Contacts, and Notes as in-page tabs, plus a link to Finance', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const tabButtons = [...src.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(tabButtons, ['jobs', 'contacts', 'notes']);
  assert.match(src, /href="\/tools\/finance\.html"/, 'should have a real link to the new Finance page');
});

test('finance.html has all 4 tabs and none of the Jobs/Contacts/Notes tabs', () => {
  const src = fs.readFileSync(FINANCE_PATH, 'utf8');
  const tabButtons = [...src.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(tabButtons, ['cost', 'profitability', 'income', 'expenses']);
});

test('the two retired redirect stubs point at finance.html, not the old job-tracker.html location', () => {
  const expenseLogger = fs.readFileSync(path.join(__dirname, '..', 'tools', 'expense-logger.html'), 'utf8');
  const costLookup = fs.readFileSync(path.join(__dirname, '..', 'tools', 'job-cost-lookup.html'), 'utf8');
  assert.match(expenseLogger, /url=\/tools\/finance\.html#expenses/);
  assert.doesNotMatch(expenseLogger, /job-tracker\.html#expenses/);
  assert.match(costLookup, /url=\/tools\/finance\.html#cost/);
  assert.doesNotMatch(costLookup, /job-tracker\.html#cost/);
});

test('job-detail.html\'s Expenses link points at finance.html, not the old job-tracker.html location', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'job-detail.html'), 'utf8');
  assert.match(src, /href:\s*'\/tools\/finance\.html#expenses'/);
  assert.doesNotMatch(src, /job-tracker\.html[^']*#expenses/);
});

test('finance.html loads the shared data layer before tools-common.js, matching every other page that needs it', () => {
  const src = fs.readFileSync(FINANCE_PATH, 'utf8');
  const dataLayerPos = src.indexOf('data-layer.js');
  const toolsCommonPos = src.indexOf('tools-common.js');
  assert.ok(dataLayerPos > 0 && toolsCommonPos > 0, 'both scripts should be present');
  assert.ok(dataLayerPos < toolsCommonPos, 'data-layer.js must load before tools-common.js');
});

test('finance.html\'s Content-Security-Policy exactly matches job-tracker.html\'s (needed for the CDN script and Supabase receipt images that moved here)', () => {
  const jobTrackerSrc = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const financeSrc = fs.readFileSync(FINANCE_PATH, 'utf8');
  const extractCsp = (src) => (src.match(/<meta http-equiv="Content-Security-Policy"[^>]*>/) || [])[0];
  const jobTrackerCsp = extractCsp(jobTrackerSrc);
  const financeCsp = extractCsp(financeSrc);
  assert.ok(jobTrackerCsp && financeCsp, 'both pages should have a CSP meta tag');
  assert.equal(financeCsp, jobTrackerCsp);
});

test('every getElementById call in finance.html has a matching element defined on the page', () => {
  const src = fs.readFileSync(FINANCE_PATH, 'utf8');
  const referenced = new Set([...src.matchAll(/getElementById\(['"]([\w-]+)['"]\)/g)].map(m => m[1]));
  const defined = new Set([...src.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
  const missing = [...referenced].filter(id => !defined.has(id));
  assert.deepEqual(missing, []);
});

// Push 5 (2026-08-20, structural item #36): review-request outcome
// tracking. Previously sending a review request was a one-way action --
// no way to tell later whether it worked, and (a separate real gap found
// while making this change) the sent-request log never called
// scheduleSync() at all, meaning it silently never left whichever single
// device created it. These lock in the fix.

test('saveSentLog in review-request.html now calls scheduleSync (previously it never did)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review-request.html'), 'utf8');
  const fnMatch = src.match(/function saveSentLog\(log\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'saveSentLog() not found');
  assert.match(fnMatch[0], /scheduleSync/, 'saveSentLog should call scheduleSync so this log actually syncs across devices');
});

test('logSentRequest stamps a status field on every new entry', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review-request.html'), 'utf8');
  const fnMatch = src.match(/function logSentRequest\(method\)[\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'logSentRequest() not found');
  assert.match(fnMatch[0], /status:\s*'sent'/);
});

test('setRequestStatus exists and can move an entry to received or no_response', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review-request.html'), 'utf8');
  assert.match(src, /function setRequestStatus\(id, status\)/);
  assert.match(src, /STATUS_LABEL\s*=\s*\{\s*sent:.*received:.*no_response:/s);
});

test('renderSentLog treats entries with no status field (logged before this upgrade) as "sent", not undefined', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'review-request.html'), 'utf8');
  assert.match(src, /const status = entry\.status \|\| 'sent'/,
    'old entries logged before this feature existed have no status field -- must default gracefully, not show "undefined"');
});

// Push 6 (2026-08-20, structural item #35): job-to-invoice/quote
// auto-fill. Selecting a job from the "Link to Job" dropdown previously
// did nothing until save time -- every field still needed manual
// re-entry despite the job record already having that information.

test('autofillFromJobRef exists and is wired to both the invoice and quote job-ref dropdowns', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  assert.match(src, /function autofillFromJobRef\(/);
  assert.match(src, /id="invoiceJobRef" onchange="autofillFromJobRef\('invoiceJobRef', 'jobDescription', 'clientName', 'clientAddress'\)"/);
  assert.match(src, /id="quoteJobRef" onchange="autofillFromJobRef\('quoteJobRef', 'quoteJobDescription', 'quoteClientName', 'quoteClientAddress'\)"/);
});

test('autofillFromJobRef follows the same never-overwrite safety convention as the existing autofillFromContact', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  const fnMatch = src.match(/function autofillFromJobRef\([\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'autofillFromJobRef() not found');
  const body = fnMatch[0];
  // Every field it touches must be gated on the field currently being
  // blank -- this is what prevents it from clobbering something the
  // person already typed if they pick a job after starting to fill
  // the form in by hand.
  assert.match(body, /if \(descEl && !descEl\.value\.trim\(\)\)/);
  assert.match(body, /if \(nameEl && !nameEl\.value\.trim\(\)\)/);
  assert.match(body, /if \(addrEl && !addrEl\.value\.trim\(\)/);
});
