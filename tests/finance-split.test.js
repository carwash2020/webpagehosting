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

test('finance.html loads the shared data layer before the tool-suite shared scripts, matching every other page that needs it', () => {
  const src = fs.readFileSync(FINANCE_PATH, 'utf8');
  const dataLayerPos = src.indexOf('data-layer.js');
  assert.ok(dataLayerPos > 0, 'data-layer.js should be present');
  // tools-common.js was split into 4 files in a later push (structural
  // item #42) -- data-layer.js must load before every one of them.
  for (const name of ['tools-effects.js', 'tools-dialogs.js', 'tools-media-sharing.js', 'tools-nav-pwa.js']) {
    const pos = src.indexOf(name);
    assert.ok(pos > 0, name + ' should be present');
    assert.ok(dataLayerPos < pos, 'data-layer.js must load before ' + name);
  }
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

// Push 7 (2026-08-20, structural item #37/#24): connecting Parts
// Reference to the rest of the app via a safe, link-based lookup rather
// than pulling its dataset into another page directly, plus bringing
// Parts Reference in line with the ?search= deep-link convention every
// other page already supports.

test('Parts Reference now supports the ?search= deep-link convention used everywhere else', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'parts-reference.html'), 'utf8');
  assert.match(src, /new URLSearchParams\(location\.search\)\.get\('search'\)/);
  assert.match(src, /document\.getElementById\('prSearchInput'\)\.value = presetSearch/);
});

test('the search prefill is set before the first render, not after (avoids a flash of the unfiltered list)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'parts-reference.html'), 'utf8');
  const initBlock = src.slice(src.indexOf("document.addEventListener('DOMContentLoaded'"));
  const presetIdx = initBlock.indexOf("get('search')");
  const firstRenderIdx = initBlock.indexOf('renderUnits();');
  assert.ok(presetIdx > 0 && firstRenderIdx > 0, 'both should be present in the init block');
  assert.ok(presetIdx < firstRenderIdx, 'the search value must be set before renderUnits() runs the first time');
});

test('openWikiLookup exists and is wired to both the invoice and quote forms', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  assert.match(src, /function openWikiLookup\(descriptionFieldId\)/);
  assert.match(src, /onclick="openWikiLookup\('jobDescription'\)"/);
  assert.match(src, /onclick="openWikiLookup\('quoteJobDescription'\)"/);
});

test('openWikiLookup builds a URL using the same ?search= convention Parts Reference now supports', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  const fnMatch = src.match(/function openWikiLookup\([\s\S]*?\n  \}\n/);
  assert.ok(fnMatch, 'openWikiLookup() not found');
  assert.match(fnMatch[0], /\/tools\/parts-reference\.html/);
  assert.match(fnMatch[0], /\?search=' \+ encodeURIComponent\(query\)/);
});

// Push 8 (2026-08-20, structural item #14, scoped safely): Parts
// Reference's DOMContentLoaded init used to call 34 near-identical data
// migrations as individual sequential lines. Consolidated the CALLING
// SEQUENCE into an ordered array + loop -- deliberately NOT the
// individual migration function bodies, since a deeper check (done
// before touching anything) found two of them (V2, V4) actually inject
// new issues into EXISTING units via a differently-shaped pattern from
// the other ~28's "add new units if not already present" shape, which
// would need Push-4-level exhaustive verification against live wiki
// content to consolidate safely. This test exists so a future edit
// can't silently drop or reorder one of these calls -- execution order
// matters here, since prunePrPhantomBrandsV1IfNeeded sits deliberately
// between V24 and V25 in case a later migration depends on that prune
// having already run.

test('the Parts Reference seed-migration order is preserved exactly, including the interspersed prune call', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'parts-reference.html'), 'utf8');
  const arrayMatch = src.match(/const PR_SEED_MIGRATIONS = \[([\s\S]*?)\];/);
  assert.ok(arrayMatch, 'PR_SEED_MIGRATIONS array not found');
  const names = arrayMatch[1].match(/\b\w+\b/g);

  const expected = [];
  for (let v = 2; v <= 24; v++) expected.push('upgradePrSeedV' + v + 'IfNeeded');
  expected.push('prunePrPhantomBrandsV1IfNeeded');
  for (let v = 25; v <= 31; v++) expected.push('upgradePrSeedV' + v + 'IfNeeded');
  expected.push('prunePrBlankReferencesV2IfNeeded', 'prunePrMergeGenericIssuesV3IfNeeded', 'backfillPrIssueMetadataV1IfNeeded');

  assert.deepEqual(names, expected);
});

test('every function referenced in PR_SEED_MIGRATIONS is actually defined somewhere in the file', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'parts-reference.html'), 'utf8');
  const arrayMatch = src.match(/const PR_SEED_MIGRATIONS = \[([\s\S]*?)\];/);
  const names = [...new Set(arrayMatch[1].match(/\b\w+\b/g))];
  const undefinedFns = names.filter(name => !new RegExp('function ' + name + '\\(').test(src));
  assert.deepEqual(undefinedFns, []);
});

// Push 9 (2026-08-20, structural item #42): splitting tools-common.js
// (1,447 lines mixing dialogs/media/nav/PWA concerns together) into 4
// focused files. Verified lossless before any of the 4 files were
// touched -- concatenating them in order reproduced a byte-for-byte
// exact copy of the original file. These tests guard against the real
// bugs found and fixed while wiring the split in: a stale reference to
// the retired filename in the service worker's precache list, which
// would have broken cache.addAll() ATOMICALLY (failing the entire
// precache, not just that one file, since addAll rejects if any single
// URL in the list 404s) -- and the consistency checker's own hardcoded
// filename list, which would have silently stopped tracking real files.

test('tools-common.js no longer exists -- it was fully replaced, not left behind as dead weight', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'tools', 'tools-common.js')), false);
});

test('all 4 files that replaced it exist and each is syntactically valid on its own', () => {
  const { execFileSync } = require('node:child_process');
  for (const name of ['tools-effects.js', 'tools-dialogs.js', 'tools-media-sharing.js', 'tools-nav-pwa.js']) {
    const p = path.join(__dirname, '..', 'tools', name);
    assert.ok(fs.existsSync(p), name + ' should exist');
    assert.doesNotThrow(() => execFileSync('node', ['--check', p]), name + ' should be valid JS on its own');
  }
});

test('every one of the 15 pages that used to load tools-common.js now loads all 4 replacement files in the correct order', () => {
  const pages = [
    'calendar.html', 'client-detail.html', 'contract-generator.html', 'dev-tools.html',
    'finance.html', 'invoice-generator.html', 'job-detail.html', 'job-tracker.html',
    'login.html', 'parts-reference.html', 'reset-password.html', 'review-request.html',
    'route-planner.html', 'settings.html', 'workspace.html',
  ];
  const order = ['tools-effects.js', 'tools-dialogs.js', 'tools-media-sharing.js', 'tools-nav-pwa.js'];
  for (const page of pages) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tools', page), 'utf8');
    assert.doesNotMatch(src, /tools-common\.js/, page + ' should not reference the retired file');
    let lastPos = -1;
    for (const name of order) {
      const pos = src.indexOf(name);
      assert.ok(pos > lastPos, page + ': ' + name + ' should appear, in order, after the previous replacement file');
      lastPos = pos;
    }
  }
});

test('the service worker\'s offline precache list references the 4 replacement files and data-layer.js, not the retired tools-common.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  // Scoped to the actual PRECACHE_URLS array, not the whole file -- an
  // explanatory comment elsewhere in this file legitimately mentions
  // "tools-common.js" while describing why this fix was needed, which
  // is valuable documentation, not a lingering bug. Only a real entry
  // in the array itself would actually break cache.addAll().
  const arrayMatch = src.match(/const PRECACHE_URLS = \[([\s\S]*?)\n\];/);
  assert.ok(arrayMatch, 'PRECACHE_URLS array not found');
  assert.doesNotMatch(arrayMatch[1], /'\/tools\/tools-common\.js'/, 'precache list itself should not contain an actual entry for the retired file (an explanatory comment mentioning it by name elsewhere in the array is fine)');
  for (const name of ['tools-effects.js', 'tools-dialogs.js', 'tools-media-sharing.js', 'tools-nav-pwa.js', 'data-layer.js']) {
    assert.match(arrayMatch[1], new RegExp("'/tools/" + name.replace('.', '\\.') + "'"), name + ' should be in the precache list');
  }
});

test('the consistency checker tracks the 4 replacement files for version-freshness, not the retired tools-common.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-consistency.js'), 'utf8');
  const versionedMatch = src.match(/const VERSIONED_SCRIPTS = \[([^\]]*)\]/);
  assert.ok(versionedMatch, 'VERSIONED_SCRIPTS not found');
  assert.doesNotMatch(versionedMatch[1], /tools-common\.js/);
  for (const name of ['tools-effects.js', 'tools-dialogs.js', 'tools-media-sharing.js', 'tools-nav-pwa.js']) {
    assert.match(versionedMatch[1], new RegExp("'" + name.replace('.', '\\.') + "'"));
  }
});

test('the 4 replacement files, concatenated in their original split order, still contain every function the original file had', () => {
  // Doesn't re-verify the byte-for-byte reassembly (that was a one-time
  // check done before any headers or fixes were added) -- verifies the
  // more durable property instead: every function this app actually
  // depends on (money, escapeHtml, showToast, showConfirm, etc.) is
  // still defined SOMEWHERE across the 4 files.
  const names = ['tools-effects.js', 'tools-dialogs.js', 'tools-media-sharing.js', 'tools-nav-pwa.js'];
  const combined = names.map(n => fs.readFileSync(path.join(__dirname, '..', 'tools', n), 'utf8')).join('\n');
  const mustExist = [
    'celebrateCompletion', 'personDot', 'toggleIconSearch', 'animateRowExit',
    'ensureDialogModalExists', 'money', 'escapeHtml', 'debouncedCall', 'showAlert', 'showConfirm',
    'wireSearchClear', 'attachLongPress', 'showQuickActionSheet', 'openPhotoLightbox',
    'voiceDictationSupported', 'attachVoiceDictation', 'showToast', 'dismissToast',
    'canShareFiles', 'logClientError', 'attachSwipeToDismiss', 'initSwipeToDismissModals',
    'loadDensityPreference', 'applyDensityPreference', 'toggleDensityPreference',
  ];
  const missing = mustExist.filter(name => !new RegExp('function ' + name + '\\(').test(combined));
  assert.deepEqual(missing, []);
});

// Push 9 continued: a real, live bug found while doing the final sweep
// for stray references to the retired tools-common.js -- JT_TAB_ORDER
// (used by the swipe-between-tabs gesture) still listed all 7 of Job
// Tracker's ORIGINAL tabs, 4 of which moved to finance.html back in
// Push 4. Swiping left on the Jobs tab was silently setting the URL
// hash to #cost (a tab that no longer exists on this page), which on
// the next reload triggered Push 4's own redirect and bounced the
// person to Finance with no warning. Caught by searching for the
// removed tab names as literal DATA, not just as function calls --
// Push 4's own exhaustive scan only checked for calls to moved
// functions and missed this entirely.

test('JT_TAB_ORDER only lists tabs that actually still exist on job-tracker.html', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const m = src.match(/const JT_TAB_ORDER = \[([^\]]*)\]/);
  assert.ok(m, 'JT_TAB_ORDER not found');
  const tabs = m[1].match(/'(\w+)'/g).map(s => s.replace(/'/g, ''));
  assert.deepEqual(tabs, ['jobs', 'contacts', 'notes']);
  // Belt and suspenders: also confirm none of the moved tab names
  // appear anywhere in the array, not just that the array equals the
  // expected value -- catches a future re-introduction even if someone
  // reorders or adds alongside the correct 3.
  for (const removed of ['cost', 'profitability', 'income', 'expenses']) {
    assert.ok(!tabs.includes(removed), removed + ' should not be in JT_TAB_ORDER -- it moved to finance.html');
  }
});

// Push 10 (2026-08-20, structural item #43): splitting styles.css into
// a public-site file (kept at the same filename/URL, so the public
// site's own <link> tag was never touched at all) and a new tools/
// styles-tools.css for the tool suite. Verified lossless before
// touching anything further: the two pieces were confirmed to
// concatenate back into a byte-for-byte exact copy of the original file.

test('the public site pages were not touched at all -- same filename, no new link tag needed', () => {
  const publicPages = ['index.html', 'handyman-cedar-city-ut.html', 'handyman-hurricane-ut.html',
    'handyman-mesquite-nv.html', 'handyman-santa-clara-ivins-ut.html', 'handyman-washington-city-ut.html'];
  for (const page of publicPages) {
    const src = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    assert.doesNotMatch(src, /styles-tools\.css/, page + ' is public-facing and should never load the tool-suite stylesheet');
  }
});

test('every tool page loads styles-tools.css after styles.css, preserving the original cascade order', () => {
  const pages = [
    'calendar.html', 'client-detail.html', 'contract-generator.html', 'dev-tools.html',
    'finance.html', 'invoice-generator.html', 'job-detail.html', 'job-tracker.html',
    'login.html', 'parts-reference.html', 'reset-password.html', 'review-request.html',
    'route-planner.html', 'settings.html', 'workspace.html',
  ];
  for (const page of pages) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tools', page), 'utf8');
    const basePos = src.indexOf('href="/styles.css?v=');
    const toolsPos = src.indexOf('href="/tools/styles-tools.css?v=');
    assert.ok(basePos > 0, page + ' should load the base styles.css');
    assert.ok(toolsPos > 0, page + ' should load styles-tools.css');
    assert.ok(basePos < toolsPos, page + ': styles.css must load before styles-tools.css to preserve the original cascade order');
  }
});

test('styles.css and styles-tools.css both have balanced braces (a mid-rule cut would leave one or both unbalanced)', () => {
  for (const p of [path.join(__dirname, '..', 'styles.css'), path.join(__dirname, '..', 'tools', 'styles-tools.css')]) {
    const css = fs.readFileSync(p, 'utf8');
    let depth = 0;
    for (const ch of css) { if (ch === '{') depth++; if (ch === '}') depth--; }
    assert.equal(depth, 0, p + ' should have balanced braces');
  }
});

test('the shared design tokens (:root) live in styles.css, which every tool page loads before styles-tools.css needs them', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  assert.match(src, /:root\s*\{/);
  assert.match(src, /--orange:/);
  assert.match(src, /--bg:/);
});

test('the service worker precaches styles-tools.css alongside styles.css', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  const arrayMatch = src.match(/const PRECACHE_URLS = \[([\s\S]*?)\n\];/);
  assert.match(arrayMatch[1], /'\/tools\/styles-tools\.css'/);
});

test('the consistency checker tracks styles-tools.css for version-freshness and cross-page matching', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-consistency.js'), 'utf8');
  const versionedMatch = src.match(/const VERSIONED_SCRIPTS = \[([^\]]*)\]/);
  assert.match(versionedMatch[1], /'styles-tools\.css'/);
});

// Push 11 (2026-08-20, structural item #23): breadcrumbs for Parts
// Reference's drill-down navigation, which previously only had a
// single-step "Back" link at each of its 3 levels with no sense of
// where you actually are. Investigated a full Dev Tools page split
// first (item #15) and found the JS functions aren't cleanly separable
// by the page's own visual categories -- deferred that to a future
// session with fresh capacity rather than force through the same class
// of risk Push 4 already proved is real, three major structural pushes
// deep into one session.

test('Level 2 and Level 3 breadcrumb elements exist alongside the existing back-links, not replacing them', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'parts-reference.html'), 'utf8');
  assert.match(src, /id="prBreadcrumbL2"/);
  assert.match(src, /id="prBreadcrumbL2Current"/);
  assert.match(src, /id="prBreadcrumbL3"/);
  assert.match(src, /id="prBreadcrumbL3Brand"/);
  assert.match(src, /id="prBreadcrumbL3Current"/);
  // The single-step back-links must still be there too.
  const backLinkCount = (src.match(/class="pr-back-link"/g) || []).length;
  assert.equal(backLinkCount, 2, 'both existing back-links (Level 2 and Level 3) should be untouched');
});

test('Level 3\'s "All Brands" breadcrumb chains closeTypeDetail() then closeBrandDetail(), since calling closeBrandDetail() alone from Level 3 would leave it visibly stuck open', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'parts-reference.html'), 'utf8');
  assert.match(src, /onclick="closeTypeDetail\(\); closeBrandDetail\(\);"/,
    'the All Brands link inside Level 3 must close Level 3 before closing Level 2, in that order');
});

test('renderBrandTypeList (Level 2) and renderBrandDetail (Level 3) both populate their breadcrumb text on every render, so it can never go stale', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'parts-reference.html'), 'utf8');
  const l2Fn = src.match(/function renderBrandTypeList\(\)[\s\S]*?\n  \}\n/);
  const l3Fn = src.match(/function renderBrandDetail\(\)[\s\S]*?\n  \}\n/);
  assert.ok(l2Fn, 'renderBrandTypeList not found');
  assert.ok(l3Fn, 'renderBrandDetail not found');
  assert.match(l2Fn[0], /getElementById\('prBreadcrumbL2Current'\)\.textContent = activePrBrand/);
  assert.match(l3Fn[0], /getElementById\('prBreadcrumbL3Brand'\)\.textContent = activePrBrand/);
  assert.match(l3Fn[0], /getElementById\('prBreadcrumbL3Current'\)\.textContent = activePrDetailType/);
});

test('the direct-jump shortcut (openUnitDirectly, used by search results) also renders through renderBrandDetail, so its breadcrumb gets populated without a separate fix', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'parts-reference.html'), 'utf8');
  const fn = src.match(/function openUnitDirectly\(unitId\)[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'openUnitDirectly not found');
  assert.match(fn[0], /renderBrandDetail\(\)/);
});

// Push 12 (2026-08-20): a critical, previously-undiscovered bug found
// while cross-checking element-id references for an unrelated feature
// (item #13's undo-delete work). Dead code left over from Push 4's
// Job Tracker split -- bare, unnamed top-level statements wiring up
// the Expenses tab's entryType/entryReceipt fields, which moved to
// finance.html -- was throwing an uncaught exception at TOP-LEVEL
// script execution on every single Job Tracker page load. Confirmed
// empirically via jsdom (not just reasoned about) that this halted ALL
// subsequent top-level code in the same <script> tag, including the
// DOMContentLoaded listener registration itself -- meaning renderJobs()
// and every other piece of this page's init likely never actually ran
// on a fresh load since Push 4 shipped. This test actually LOADS the
// real page and dispatches DOMContentLoaded, rather than just grepping
// for the dead code textually, specifically so this exact class of "the
// script never gets far enough to do anything" bug can never silently
// reappear undetected.

test('job-tracker.html\'s DOMContentLoaded init actually runs end-to-end without an uncaught top-level exception blocking it', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    // requireAuth() is called unconditionally by an inline <script> at
    // the very top of this page, before external auth.js (which
    // defines it) has a chance to load -- and external <script src>
    // tags never resolve in this sandbox anyway. beforeParse injects it
    // onto the window before ANY script runs, which a plain post-
    // construction assignment can't do (the page's own top-of-file
    // script already ran and threw by the time the constructor returns).
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  // data-layer.js (real file, real <script src>) doesn't resolve in
  // this sandbox either -- renderJobs() calls thRead()/TH_KEYS
  // unconditionally for the margin badge, so both need a real-shaped
  // stub rather than being left undefined.
  window.TH_KEYS = { invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => fallback;
  window.attachLongPress = () => {};
  window.wireSearchClear = () => {};
  window.attachVoiceDictation = () => {};

  let uncaughtDuringInit = null;
  window.addEventListener('error', (e) => { uncaughtDuringInit = e.error; });

  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  // Lets any already-scheduled microtasks/promise continuations from the
  // page's own async init IIFE settle before this test function returns
  // -- otherwise anything still pending surfaces as a dangling
  // unhandled rejection attributed to a test that already finished,
  // rather than a clear assertion failure right here.
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(uncaughtDuringInit, null, 'DOMContentLoaded handler should not throw synchronously');
  assert.equal(typeof window.renderJobs, 'function', 'renderJobs should be defined (hoisting works regardless)');
  // The real regression check: renderJobs() must have actually been
  // CALLED during init, not just defined. An empty jobsList div is
  // exactly what the page looked like the whole time this bug was live.
  const jobsList = window.document.getElementById('jobsList');
  assert.ok(jobsList, 'jobsList element should exist');
  assert.ok(jobsList.innerHTML.length > 0, 'renderJobs() should have populated jobsList during init -- an empty div here is the exact symptom this bug caused');
});

test('the dead entryType/entryReceipt wiring code that caused the above bug is gone, and PAYMENT_LABEL (which nothing referenced) went with it', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.doesNotMatch(src, /getElementById\('entryType'\)/);
  assert.doesNotMatch(src, /getElementById\('entryReceipt'\)/);
  assert.doesNotMatch(src, /PAYMENT_LABEL/);
});

// Push 12 continued: item #13, soft-delete/undo. Scoped safely to jobs
// specifically rather than a comprehensive all-entity data-model change
// -- the real deletion (including the Supabase photo cleanup, which is
// genuinely irreversible once it runs) is deferred behind a real undo
// window instead of happening immediately and permanently on
// confirmation.

test('showUndoToast exists as its own function, not grafted onto showToast (which dozens of other callers use and shouldn\'t be affected)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tools-media-sharing.js'), 'utf8');
  assert.match(src, /function showUndoToast\(message, onUndo, options\)/);
});

test('deleteJob defers the real deletion behind a timer rather than executing immediately on confirmation', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const fn = src.match(/async function deleteJob\(id\)[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'deleteJob not found');
  assert.match(fn[0], /setTimeout\(async \(\) => \{/, 'the real deletion logic should be deferred inside a setTimeout');
  assert.match(fn[0], /showUndoToast\(/, 'should show an undo toast rather than a plain toast');
  assert.match(fn[0], /pendingDeleteJobIds\.set\(id, timer\)/, 'the pending job id must be tracked so renderJobs() can filter it out of view');
});

test('renderJobs filters out jobs with a pending deletion, without touching underlying storage', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const fn = src.match(/function renderJobs\(\)[\s\S]*?(?=\n  function |\n  async function )/);
  assert.ok(fn, 'renderJobs not found');
  assert.match(fn[0], /pendingDeleteJobIds\.size > 0.*jobs = jobs\.filter/, 'should filter jobs currently pending deletion out of the rendered list');
});

test('bulkDeleteJobs now cleans up Supabase photos, a gap found while adding undo (it never did this before)', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const fn = src.match(/async function bulkDeleteJobs\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'bulkDeleteJobs not found');
  assert.match(fn[0], /fetchJobPhotos/, 'should fetch each deleted job\'s photos');
  assert.match(fn[0], /deleteJobPhoto/, 'should actually delete them from Supabase storage');
  assert.match(fn[0], /showUndoToast\(/, 'should give the same undo protection as single-job delete');
});

test('undoing a bulk delete cancels the ONE shared timer and restores every job in the batch, not just one', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const fn = src.match(/async function bulkDeleteJobs\(\)[\s\S]*?\n  \}\n/);
  const undoCallback = fn[0].match(/showUndoToast\([^,]+,\s*\(\) => \{([\s\S]*?)\}\);/);
  assert.ok(undoCallback, 'undo callback not found');
  assert.match(undoCallback[1], /clearTimeout\(timer\)/);
  assert.match(undoCallback[1], /idsToDelete\.forEach\(id => pendingDeleteJobIds\.delete\(id\)\)/);
});

// Push 13 (2026-08-20, structural item #15): splitting Dev Tools'
// Site Content/FAQ/Terms editor (83% of the file's 2,692 lines) into
// its own page, site-content.html. Investigated this once before
// (Push 11) and deferred it after an automated call-graph propagation
// flooded almost every function with "belongs to all 5 categories" --
// one ubiquitous shared helper (openDevInfo, called from every
// panel's "?" button) acted as a hub connecting everything to
// everything once labels propagated bidirectionally through it. Redid
// the analysis this time using the raw (un-propagated) call graph as
// evidence for manual classification instead of trusting automated
// propagation, which correctly separated 9 genuinely shared utilities
// (the password-gate system, fetchWithTimeout, openDevInfo, the
// collapsible-panel mechanism) from 20 Content-only and 50 Dev-Core-
// only functions.

const DEV_TOOLS_PATH = path.join(__dirname, '..', 'tools', 'dev-tools.html');
const SITE_CONTENT_PATH = path.join(__dirname, '..', 'tools', 'site-content.html');
const DEV_SHARED_PATH = path.join(__dirname, '..', 'tools', 'dev-tools-shared.js');

const DEV_TOOLS_SHARED_FNS = ['sha256Hex', 'showDevPasswordPrompt', 'devPasswordSubmit',
  'devPasswordCancel', 'confirmDevPassword', 'fetchWithTimeout', 'openDevInfo',
  'toggleDevPanel', 'initCollapsiblePanels'];
const CONTENT_ONLY_FNS = ['openFieldInfo', 'renderSiteContentForm', 'saveSiteContent',
  'exportContentBackup', 'renderContentHistory', 'restoreHistoryEntry', 'renderFaqEditor',
  'renderFaqEditorRows', 'updateFaqField', 'moveFaqItem', 'deleteFaqItem', 'addFaqItem',
  'saveFaqList', 'renderTermsEditor', 'renderTermsEditorRows', 'updateTermsField',
  'moveTermsItem', 'deleteTermsItem', 'addTermsItem', 'saveTermsList'];

test('all 9 shared functions are defined in dev-tools-shared.js, and nowhere else', () => {
  const sharedSrc = fs.readFileSync(DEV_SHARED_PATH, 'utf8');
  const devSrc = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const contentSrc = fs.readFileSync(SITE_CONTENT_PATH, 'utf8');
  for (const name of DEV_TOOLS_SHARED_FNS) {
    assert.match(sharedSrc, new RegExp('function ' + name + '\\('), name + ' should be in dev-tools-shared.js');
    assert.doesNotMatch(devSrc, new RegExp('function ' + name + '\\('), name + ' should NOT be redefined in dev-tools.html');
    assert.doesNotMatch(contentSrc, new RegExp('function ' + name + '\\('), name + ' should NOT be redefined in site-content.html');
  }
});

test('all 20 Content-only functions are defined in site-content.html, and nowhere else', () => {
  const contentSrc = fs.readFileSync(SITE_CONTENT_PATH, 'utf8');
  const devSrc = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  for (const name of CONTENT_ONLY_FNS) {
    assert.match(contentSrc, new RegExp('function ' + name + '\\('), name + ' should be in site-content.html');
    assert.doesNotMatch(devSrc, new RegExp('function ' + name + '\\('), name + ' should have moved out of dev-tools.html');
  }
});

test('none of the 20 Content-only functions are CALLED from dev-tools.html (not just undefined)', () => {
  const devSrc = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const stillCalled = CONTENT_ONLY_FNS.filter(name => {
    const re = new RegExp(name + '\\(', 'g');
    for (const m of devSrc.matchAll(re)) {
      const lineStart = devSrc.lastIndexOf('\n', m.index) + 1;
      const lineEnd = devSrc.indexOf('\n', m.index);
      const line = devSrc.slice(lineStart, lineEnd).trim();
      if (!line.startsWith('//') && !line.startsWith('*')) return true;
    }
    return false;
  });
  assert.deepEqual(stillCalled, [], 'these would throw at runtime since their definitions moved: ' + stillCalled.join(', '));
});

test('the two large data objects (DEV_INFO, FIELD_INFO) and the two module-level state arrays (faqItems, termsItems) moved with the functions that need them', () => {
  const sharedSrc = fs.readFileSync(DEV_SHARED_PATH, 'utf8');
  const contentSrc = fs.readFileSync(SITE_CONTENT_PATH, 'utf8');
  const devSrc = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  assert.match(sharedSrc, /const DEV_INFO = \{/, 'DEV_INFO must be in the shared file (openDevInfo reads from it)');
  assert.match(contentSrc, /const FIELD_INFO = \{/, 'FIELD_INFO must be in site-content.html (openFieldInfo reads from it)');
  assert.match(contentSrc, /const SITE_CONTENT_FIELDS = \[/);
  assert.match(contentSrc, /let faqItems = \[\];/);
  assert.match(contentSrc, /let termsItems = \[\];/);
  assert.doesNotMatch(devSrc, /const DEV_INFO = \{/);
  assert.doesNotMatch(devSrc, /const FIELD_INFO = \{/);
});

test('dev-tools.html loads dev-tools-shared.js before its own script needs it', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  const sharedPos = src.indexOf('dev-tools-shared.js');
  const dataLayerPos = src.indexOf('data-layer.js');
  assert.ok(sharedPos > 0, 'dev-tools-shared.js should be loaded');
  assert.ok(dataLayerPos < sharedPos, 'data-layer.js should load first, matching every other page');
});

test('site-content.html loads dev-tools-shared.js too, and has the standard access-gating wrapper', () => {
  const src = fs.readFileSync(SITE_CONTENT_PATH, 'utf8');
  assert.match(src, /dev-tools-shared\.js/);
  assert.match(src, /id="contentBlockedView"/);
  assert.match(src, /id="contentMainView"/);
  assert.match(src, /hasDevToolsAccess/);
});

test('dev-tools.html\'s jump-nav Content pill now links to the new page instead of an in-page anchor', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  assert.match(src, /href="\/tools\/site-content\.html"/);
  assert.doesNotMatch(src, /href="#nav-content"/);
});

test('old #nav-content bookmarks on dev-tools.html redirect to site-content.html', () => {
  const src = fs.readFileSync(DEV_TOOLS_PATH, 'utf8');
  assert.match(src, /location\.hash === '#nav-content'/);
  assert.match(src, /window\.location\.replace\('\/tools\/site-content\.html'\)/);
});

test('every getElementById call in site-content.html has a matching element defined on the page', () => {
  const src = fs.readFileSync(SITE_CONTENT_PATH, 'utf8');
  const referenced = new Set([...src.matchAll(/getElementById\(['"]([\w-]+)['"]\)/g)].map(m => m[1]));
  const defined = new Set([...src.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
  const missing = [...referenced].filter(id => !defined.has(id));
  assert.deepEqual(missing, []);
});

test('the service worker precaches both new files, and the consistency checker tracks dev-tools-shared.js', () => {
  const swSrc = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  const arrayMatch = swSrc.match(/const PRECACHE_URLS = \[([\s\S]*?)\n\];/);
  assert.match(arrayMatch[1], /'\/tools\/site-content\.html'/);
  assert.match(arrayMatch[1], /'\/tools\/dev-tools-shared\.js'/);

  const checkerSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-consistency.js'), 'utf8');
  const versionedMatch = checkerSrc.match(/const VERSIONED_SCRIPTS = \[([^\]]*)\]/);
  assert.match(versionedMatch[1], /'dev-tools-shared\.js'/);
});

// Push 14 (2026-08-20, structural item #10): quote/invoice linkage.
// The two record shapes were already very similar -- merging them into
// one storage array with a type discriminator would have been invasive
// for uncertain benefit. The real gap was narrower: converting a quote
// into an invoice copied form fields but created no linkage at all --
// no way to tell later which invoices came from quotes, or which
// quotes were still open vs. already converted.

test('logQuote stamps every new quote with a pending status', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  const fn = src.match(/function logQuote\(totals\)[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'logQuote not found');
  assert.match(fn[0], /status:\s*'pending'/);
});

test('convertQuoteToInvoice finds the matching saved quote by quote number, without requiring one to exist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  const fn = src.match(/async function convertQuoteToInvoice\(\)[\s\S]*?showToast/);
  assert.ok(fn, 'convertQuoteToInvoice not found');
  assert.match(fn[0], /loadQuoteLog\(\)\.find\(q => q\.quoteNumber === currentQuoteNumber\)/);
  assert.match(fn[0], /pendingSourceQuoteId = matchingQuote \? matchingQuote\.id : null/,
    'must handle the case where no saved quote matches -- clicking Convert without ever saving a quote first is a valid workflow');
});

test('logInvoice only marks the source quote converted at the moment the invoice is actually saved, not earlier', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  const fn = src.match(/function logInvoice\(totals\)[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'logInvoice not found');
  assert.match(fn[0], /sourceQuoteId: pendingSourceQuoteId \|\| undefined/);
  assert.match(fn[0], /quote\.status = 'converted'/);
  assert.match(fn[0], /quote\.convertedToInvoiceId = newEntry\.id/);
  assert.match(fn[0], /pendingSourceQuoteId = null/, 'must clear the pending link after consuming it, so a later unrelated invoice save never inherits a stale reference');
});

test('the quote log UI shows converted status, defaulting old entries (no status field) to pending rather than showing undefined', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  const fn = src.match(/function renderQuoteLog\(\)[\s\S]*?\n  \}\n/);
  assert.match(fn[0], /const status = q\.status \|\| 'pending'/);
  assert.match(fn[0], /Converted to invoice/);
});

test('the invoice log UI shows which quote an invoice was converted from, when applicable', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  const fn = src.match(/function renderInvoiceLog\(\)[\s\S]*?\n  \}\n/);
  assert.match(fn[0], /Converted from quote #/);
});

// Push 15 (2026-08-20, structural item #8 investigation): went looking
// for how to namespace the ~36 flat localStorage keys and found two
// real bugs instead, which turned out to be far more valuable to fix
// than the namespacing idea itself would have been.

test('th_clients is in sync.js\'s SYNC_DATA_KEYS -- the client registry from Push 1/2 must actually sync across devices', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sync.js'), 'utf8');
  const arrayMatch = src.match(/const SYNC_DATA_KEYS = \[([\s\S]*?)\n\];/);
  assert.ok(arrayMatch, 'SYNC_DATA_KEYS not found');
  assert.match(arrayMatch[1], /'th_clients'/);
});

test('th_clients has a MERGE_KEY_FIELD entry of "id" -- without this, adding it to SYNC_DATA_KEYS alone would cause a plain overwrite instead of a real merge, which is a worse bug than not syncing at all (silent data loss vs. just staying local)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sync.js'), 'utf8');
  const objMatch = src.match(/const MERGE_KEY_FIELD = \{([\s\S]*?)\n\};/);
  assert.ok(objMatch, 'MERGE_KEY_FIELD not found');
  assert.match(objMatch[1], /th_clients:\s*'id'/);
});

test('TH_KEYS.notes points at the real current notes key (th_tracker_notes_v2), not the legacy migration-only key', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'data-layer.js'), 'utf8');
  assert.match(src, /notes:\s*'th_tracker_notes_v2'/);
  assert.doesNotMatch(src, /notes:\s*'th_tracker_notes'(?!_v2)/);
});

test('the dead clientLinks entry (confirmed zero usages anywhere) is gone from TH_KEYS', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'data-layer.js'), 'utf8');
  assert.doesNotMatch(src, /clientLinks/);
});

// Performance fix (2026-08-20): the service worker was forcing a full
// network round-trip on EVERY request via cache:'reload', including
// versioned JS/CSS assets that are immutable once published. Fine when
// there were fewer files to load, but today's structural splits took
// most tool pages from ~5-6 shared-file requests to 9-10, and every one
// of those was bypassing HTTP cache entirely -- a real, compounding
// slowdown, found while investigating a live report of the app loading
// slowly and pages sometimes not loading at all.

test('the service worker serves versioned (?v=) requests cache-first, not forced through the network every time', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  const fetchHandler = src.match(/self\.addEventListener\('fetch'[\s\S]*?\n\}\);/);
  assert.ok(fetchHandler, 'fetch handler not found');
  assert.match(fetchHandler[0], /url\.searchParams\.has\('v'\)/, 'should branch on the presence of a ?v= param');
  // The cache-first branch must return before reaching the
  // cache:'reload' network-first logic below it.
  const versionedBranchIdx = fetchHandler[0].indexOf("searchParams.has('v')");
  const reloadIdx = fetchHandler[0].indexOf("cache: 'reload'");
  assert.ok(versionedBranchIdx > 0 && reloadIdx > 0, 'both branches should exist');
  assert.ok(versionedBranchIdx < reloadIdx, 'the versioned-asset check must come first, before the network-first fallback');
});

test('unversioned requests (HTML pages) still get the network-first-with-reload behavior, so a deploy is never masked by a stale cache', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  const fetchHandler = src.match(/self\.addEventListener\('fetch'[\s\S]*?\n\}\);/);
  assert.match(fetchHandler[0], /cache:\s*'reload'/);
});

test('every URL in the precache list actually exists as a real file', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  const arrayMatch = src.match(/const PRECACHE_URLS = \[([\s\S]*?)\n\];/);
  const urls = [...arrayMatch[1].matchAll(/'(\/[^']+)'/g)].map(m => m[1]);
  assert.ok(urls.length > 20, 'sanity check that the list was actually parsed');
  const missing = urls.filter(u => !fs.existsSync(path.join(__dirname, '..', u.replace(/^\//, ''))));
  assert.deepEqual(missing, []);
});

// Item #13 extended (2026-08-20): the undo-delete pattern from Push 12
// (jobs only) extended to Income, Expenses, Contracts, and Leads --
// real business records with similar stakes to jobs. Leads are a real
// Supabase table (not localStorage), confirmed in Push 15's
// investigation -- the same deferral pattern still applies, just
// deferring the actual DELETE API call instead of a local save.

test('deleteIncomeEntry and deleteExpense both defer the real deletion behind a timer, matching the jobs pattern', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'finance.html'), 'utf8');
  for (const fn of ['deleteIncomeEntry', 'deleteExpense']) {
    const m = src.match(new RegExp('async function ' + fn + '\\(id\\)[\\s\\S]*?\\n  \\}\\n'));
    assert.ok(m, fn + ' not found');
    assert.match(m[0], /setTimeout\(/);
    assert.match(m[0], /showUndoToast\(/);
  }
});

test('deleteContractLogEntry defers behind a timer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'contract-generator.html'), 'utf8');
  const m = src.match(/async function deleteContractLogEntry\(id\)[\s\S]*?\n  \}\n/);
  assert.ok(m, 'deleteContractLogEntry not found');
  assert.match(m[0], /setTimeout\(/);
  assert.match(m[0], /showUndoToast\(/);
});

test('deleteLeadFromDashboard defers the real Supabase DELETE call, not just a local save', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'workspace.html'), 'utf8');
  const m = src.match(/async function deleteLeadFromDashboard\(id\)[\s\S]*?\n  \}\n/);
  assert.ok(m, 'deleteLeadFromDashboard not found');
  assert.match(m[0], /setTimeout\(async \(\) => \{/);
  assert.match(m[0], /await deleteLead\(id\)/);
  assert.match(m[0], /showUndoToast\(/);
});

test('all 3 render functions filter out entries pending an undoable delete', () => {
  const finSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'finance.html'), 'utf8');
  const contractSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'contract-generator.html'), 'utf8');
  const wsSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'workspace.html'), 'utf8');
  assert.match(finSrc, /pendingDeleteIncomeIds\.has/);
  assert.match(finSrc, /pendingDeleteExpenseIds\.has/);
  assert.match(contractSrc, /pendingDeleteContractIds\.has/);
  assert.match(wsSrc, /pendingDeleteLeadIds\.has/);
});

// Item #28 (shared UI components, 2026-08-20): consolidated table
// styling that was byte-for-byte duplicated in finance.html and
// job-tracker.html into the shared stylesheet both already load.
// Discovered job-tracker.html's copy was already dead CSS (zero
// <table> elements exist on that page, leftover from before Push 4
// moved those tables to Finance) -- confirmed before removing it.

test('the consolidated table styling lives in the shared stylesheet, not duplicated in finance.html or job-tracker.html', () => {
  const sharedSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'styles-tools.css'), 'utf8');
  const finSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'finance.html'), 'utf8');
  const jtSrc = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.match(sharedSrc, /^table \{ width: 100%/m);
  assert.doesNotMatch(finSrc, /^\s*table \{ width: 100%/m);
  assert.doesNotMatch(jtSrc, /^\s*table \{ width: 100%/m);
});

test('invoice-generator.html\'s .line-items-table is untouched -- a genuinely different, more specific style, not the same pattern', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'invoice-generator.html'), 'utf8');
  assert.match(src, /\.line-items-table \{/);
});

// Job Tracker / Finance UX fixes (2026-08-20), following a direct user
// report that the split felt "hard to find" and "loaded weird." Two
// real problems found: the Finance link was styled identically to the
// instant-switching tabs despite being a real page navigation, and
// logging a new expense against a job required a multi-step detour
// through Finance's own job picker instead of a direct path from the
// job itself.

test('Finance is no longer styled as a tab -- it\'s visually distinct from the real instant-switching tabs', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const tabsBlock = src.match(/<div class="tabs[^"]*">[\s\S]*?<\/div>/);
  assert.ok(tabsBlock, 'tabs block not found');
  assert.doesNotMatch(tabsBlock[0], /finance\.html/, 'Finance should not be inside the tabs container styled like Jobs/Contacts/Notes');
  assert.match(src, /Pricing, income, and expenses are on Finance/, 'a clearly-distinct link to Finance should still exist nearby');
});

test('the "Log Expense" quick action opens the instant modal, not a navigation to Finance (2026-08-20 usability fix)', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.match(src, /label: 'Log Expense'/);
  assert.match(src, /onClick: \(\) => showQuickExpenseModal\(jobId, job\.title\)/);
  assert.doesNotMatch(src, /finance\.html\?job=' \+ jobId \+ '#expenses'/, 'this quick action should no longer navigate away at all');
});

test('job-detail.html\'s Expenses section has a "+" link to log a new expense for this specific job, while Invoices/Quotes stay read-only', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'job-detail.html'), 'utf8');
  const fn = src.match(/function renderRecordSection\([\s\S]*?\n  \}\n/);
  assert.ok(fn, 'renderRecordSection not found');
  assert.match(fn[0], /addHref/);
  // Only the Expenses call site should actually pass one.
  const expensesCall = src.match(/renderRecordSection\('Expenses'[\s\S]*?\);/);
  const invoicesCall = src.match(/renderRecordSection\('Invoices'[\s\S]*?\);/);
  assert.match(expensesCall[0], /finance\.html\?job=' \+ j\.id \+ '#expenses'/);
  assert.doesNotMatch(invoicesCall[0], /addHref|,\s*'\/tools\//, 'Invoices should stay read-only, no add-new link');
});

test('finance.html reads ?job= and pre-selects it in the expense entry job dropdown, after the dropdown has real options to select from', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'finance.html'), 'utf8');
  const initBlock = src.slice(src.indexOf("document.addEventListener('DOMContentLoaded'"));
  const populatePos = initBlock.indexOf('populateJobRefOptions();');
  const presetPos = initBlock.indexOf("get('job')");
  assert.ok(populatePos > 0 && presetPos > 0, 'both should be present');
  assert.ok(populatePos < presetPos, 'the job dropdown must be populated with real options before trying to pre-select one');
});

// CRITICAL BUG FIX (2026-08-20), found from a direct user report of a
// blank Cost Lookup tab and a Finance page that "loads weird." finance.html
// has been fundamentally broken since Push 4 created it: 5 module-level
// constants (TAX_RATE_KEY, TAX_LABOR_KEY, TAX_PARTS_KEY, STORAGE_KEYS,
// INCOME_STORAGE_KEY, EXPENSE_STORAGE_KEY, RATE_STORAGE_KEY, PAYMENT_LABEL)
// were used throughout the file but never declared anywhere -- the exact
// same class of bug caught for DEV_INFO/FIELD_INFO in Push 13, just missed
// here at the time of the original Push 4 extraction. Because
// loadTaxSettings() runs early in the async init sequence, throwing on the
// very first of these silently aborted EVERYTHING after it in that same
// function: calculateCost(), populateJobRefOptions(), renderExpenses(),
// renderIncomeEntries(), renderPriceReferences(), and the tab-activation
// logic never ran. That's exactly why every tab rendered its header and
// buttons but no actual content -- confirmed directly against a user
// screenshot showing this exact symptom.
//
// None of this project's existing 116 tests caught it, because they all
// check structural properties (a function exists, a function calls X) via
// source-text matching, never actually loading the page and checking it
// renders. This test actually does that, the same discipline that caught
// the Push 12 bug on job-tracker.html -- applied here for the first time.

test('finance.html has zero undeclared ALL-CAPS constants (the exact class of bug that broke this page since Push 4)', () => {
  const src = fs.readFileSync(FINANCE_PATH, 'utf8');
  const scripts = [...src.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const mainScript = scripts[1];
  const used = new Set([...mainScript.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)].map(m => m[1]));
  const declared = new Set([...mainScript.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\b/g)].map(m => m[1]));
  // Known-legitimate exceptions: JS built-ins, and names that belong to
  // shared external files (data-layer.js/sync.js), never declared here
  // on purpose.
  const knownExternal = new Set(['JSON', 'URL', 'TH_KEYS', 'SYNC_DATA_KEYS', 'NOT']);
  const candidates = [...used].filter(c => !declared.has(c) && !knownExternal.has(c));

  // For each candidate, confirm every real usage is inside an actual
  // comment (// or /* */ line), not live code -- e.g. "DEV_INFO" is
  // only ever mentioned in an explanatory comment about a DIFFERENT
  // file's bug, never referenced as real code here.
  const trulyMissing = candidates.filter(name => {
    const re = new RegExp('\\b' + name + '\\b', 'g');
    for (const m of mainScript.matchAll(re)) {
      const lineStart = mainScript.lastIndexOf('\n', m.index) + 1;
      const lineEnd = mainScript.indexOf('\n', m.index);
      const line = mainScript.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
      if (!line.startsWith('//') && !line.startsWith('*')) return true;
    }
    return false;
  });
  assert.deepEqual(trulyMissing, []);
});

test('finance.html\'s DOMContentLoaded init actually runs to completion and renders real content in every major panel', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(FINANCE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  window.hasDevToolsAccess = () => true;
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => fallback;
  window.money = (n) => '$' + (Number(n) || 0).toFixed(2);
  window.escapeHtml = (s) => String(s == null ? '' : s);

  let uncaught = null;
  window.addEventListener('error', (e) => { uncaught = e.error; });
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.equal(uncaught, null, 'DOMContentLoaded init should not throw');
  // The real regression check: each of these must have actually
  // rendered CONTENT, not just exist as empty containers. An empty
  // laborResult/entriesTable/priceRefList is exactly the symptom the
  // user's screenshots showed.
  assert.ok(window.document.getElementById('laborResult').textContent.length > 0, 'Cost Lookup calculator should have computed and displayed a real value');
  assert.ok(window.document.getElementById('entriesTable').innerHTML.length > 0, 'Expenses table should have rendered (even if just an empty-state message)');
  assert.ok(window.document.getElementById('priceRefList').innerHTML.length > 0, 'Price references should have rendered');
});

// Redesign round (2026-08-20): swapped Routes for Finance in the
// bottom nav (explicit direction), and made the 4 real primary-nav tab
// bars sticky (Runway Dashboard's own pattern, adopted more broadly on
// explicit direction) -- deliberately opt-in via a new .tabs-sticky
// modifier rather than changing the base .tabs class, since
// workspace.html's Business Health tabs use that same base class but
// are a small embedded sub-widget partway down the page, not primary
// navigation, and making those sticky-to-viewport while scrolling past
// unrelated page content would be disorienting. Also found and fixed a
// real bug while investigating: finance.html used a different wrapper
// class (tab-row) with zero CSS defined anywhere, meaning its tabs
// rendered as bare floating buttons with no container background --
// exactly matching what the reported screenshots showed.

test('the bottom nav has Finance instead of Routes, and Route Planner is still reachable from the Workspace dashboard', () => {
  const navSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tools-nav-pwa.js'), 'utf8');
  assert.match(navSrc, /href:\s*'\/tools\/finance\.html'.*icon:\s*'dollar'.*label:\s*'Finance'/s);
  assert.doesNotMatch(navSrc, /label:\s*'Routes'/);
  const wsSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'workspace.html'), 'utf8');
  assert.match(wsSrc, /href="\/tools\/route-planner\.html"/, 'Route Planner must still be linked from somewhere, or it becomes unreachable');
});

test('finance.html uses the shared .tabs class (not the old, unstyled tab-row) and gets the sticky modifier', () => {
  const src = fs.readFileSync(FINANCE_PATH, 'utf8');
  assert.doesNotMatch(src, /class="tab-row"/, 'tab-row had zero CSS anywhere -- this was the real bug behind the reported blank-looking tab bar');
  assert.match(src, /class="tabs tabs-sticky"/);
});

test('the 4 real primary-nav tab bars (Finance, Job Tracker, Invoice Generator, Review Request) all have tabs-sticky', () => {
  for (const [file, label] of [
    ['finance.html', 'Finance'], ['job-tracker.html', 'Job Tracker'],
    ['invoice-generator.html', 'Invoice Generator'], ['review-request.html', 'Review Request'],
  ]) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tools', file), 'utf8');
    assert.match(src, /class="tabs tabs-sticky"/, label + ' should have tabs-sticky');
  }
});

test('the old combined "Business Health" sub-tab system is gone -- restructured into independent, honestly-labeled sections (2026-08-20, then Compliance+Documents merged back together shortly after on usability feedback)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'workspace.html'), 'utf8');
  assert.doesNotMatch(src, /businessHealthTabs/);
  assert.doesNotMatch(src, /activateBusinessHealthTab/);
  assert.doesNotMatch(src, /bh-panel-/);
  // "documents" was merged into "compliance" -- it should NOT have its
  // own section anymore, but its real content (the secure-documents
  // list, upload form) must still exist somewhere.
  assert.doesNotMatch(src, /id="section-documents"/);
  assert.doesNotMatch(src, /id="body-documents"/);
  assert.match(src, /id="secureDocsList"/, 'the real Documents content must still exist, just inside the merged Compliance section');
  for (const key of ['gallery', 'compliance', 'analytics', 'backup']) {
    assert.match(src, new RegExp('id="section-' + key + '"'));
    assert.match(src, new RegExp('id="body-' + key + '"'));
  }
});

test('.tabs-sticky positions below the already-sticky header, matching the proven .jump-nav pattern exactly (not top:0, which would overlap the header)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'styles-tools.css'), 'utf8');
  const rule = src.match(/\.tabs\.tabs-sticky\s*\{[^}]*\}/);
  assert.ok(rule, '.tabs-sticky rule not found');
  assert.match(rule[0], /top:\s*calc\(61px \+ env\(safe-area-inset-top, 0px\)\)/, 'must include the safe-area-inset-top fix (added 2026-08-20 after a real notch-overlap report), not just the bare 61px offset');
  assert.match(rule[0], /position:\s*sticky/);
});

// Business Health restructuring (2026-08-20). "Business Health" bundled
// 5 genuinely unrelated concerns (Gallery Queue, Compliance, Documents,
// Analytics, Backup) into one collapsible section with an internal
// sub-tab switcher -- flagged from the very first review of this app.
// Restructured into 5 independent, always-visible, independently-
// collapsible sections using the SAME generic pattern already proven
// throughout this page (toggleSection/applyCollapseState), rather than
// inventing something new. Verified every real content id (form
// fields, buttons, list containers) survived the extraction unchanged
// before this was ever installed -- diffed the id sets between the
// original block and the rebuilt one and confirmed the only ids that
// changed were the wrapper ids themselves.

test('applyCollapseState is fully generic and needs no changes to handle these sections -- it already works by iterating DEFAULT_COLLAPSE\'s own keys', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'workspace.html'), 'utf8');
  const defaultCollapseMatch = src.match(/const DEFAULT_COLLAPSE = \{([^}]*)\}/);
  assert.ok(defaultCollapseMatch, 'DEFAULT_COLLAPSE not found');
  for (const key of ['gallery', 'compliance', 'analytics', 'backup']) {
    assert.match(defaultCollapseMatch[1], new RegExp(key + ':\\s*true'));
  }
});

test('the compliance status badge moved with its own section (same element id, just relocated), so the existing JS that populates it needed zero changes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'workspace.html'), 'utf8');
  const complianceSection = src.match(/<div class="section-block" id="section-compliance">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(complianceSection, 'compliance section not found');
  assert.match(complianceSection[0], /id="complianceHeadingBadge"/);
});

test('the #backup deep-link handler scrolls to the new independent section and forces it open via expandSection, not the old sub-tab activation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'workspace.html'), 'utf8');
  const handler = src.match(/if \(window\.location\.hash === '#backup'\) \{[\s\S]*?\n    \}/);
  assert.ok(handler, '#backup handler not found');
  assert.match(handler[0], /expandSection\('backup'\)/);
  assert.match(handler[0], /getElementById\('section-backup'\)/);
  assert.doesNotMatch(handler[0], /activateBusinessHealthTab/);
});

test('the jump-nav no longer points at the removed combined section', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'workspace.html'), 'utf8');
  assert.doesNotMatch(src, /href="#section-businesshealth"/);
});

// Real usability fix (2026-08-20), responding directly to feedback that
// the app got harder to use after the structural splits. The biggest
// single source of friction: logging an expense against a job used to
// be one tab click before Push 4 split Job Tracker and Finance apart,
// and even with the earlier "Log Expense" quick-action shortcut, it was
// still a real page navigation. This closes that gap for real: a
// standalone modal, built without touching finance.html's own,
// recently-fixed Expenses-tab logic at all, so getting this feature
// right couldn't risk re-breaking what was just fixed there.

test('showQuickExpenseModal, closeQuickExpenseModal, and submitQuickExpense all exist and the quick action calls the right one', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.match(src, /function showQuickExpenseModal\(jobId, jobTitle\)/);
  assert.match(src, /function closeQuickExpenseModal\(\)/);
  assert.match(src, /async function submitQuickExpense\(\)/);
});

test('submitQuickExpense enforces the same receipt-required rule finance.html\'s own Expenses tab uses, not a relaxed version', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const fn = src.match(/async function submitQuickExpense\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'submitQuickExpense not found');
  assert.match(fn[0], /if \(!receiptFile\)/);
  assert.match(fn[0], /required to log an expense/);
});

test('submitQuickExpense builds a record matching finance.html\'s exact field shape (now including type/vendor/partNumber/miles), and reuses the already-shared uploadReceipt/thRead/thWrite rather than duplicating that logic', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const fn = src.match(/async function submitQuickExpense\(\)[\s\S]*?\n  \}\n/);
  for (const field of ['id:', 'date,', 'type,', 'desc,', 'vendor,', 'payment,', 'jobRefId:', 'jobRefTitle:', 'receiptPath,', 'partNumber,', 'amount,', 'miles,', 'createdBy:', 'lastEditedBy:']) {
    assert.match(fn[0], new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'missing field: ' + field);
  }
  assert.match(fn[0], /await uploadReceipt\(receiptFile, entryId\)/);
  assert.match(fn[0], /thRead\(TH_KEYS\.expenses, \[\]\)/);
  assert.match(fn[0], /thWrite\(TH_KEYS\.expenses, entries\)/);
});

test('the end-to-end flow actually works: open the modal, fill it out, submit, and the expense lands in the real storage key finance.html reads from', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  let alertMsg = null;
  window.showAlert = async (msg) => { alertMsg = msg; };
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => 'connor@triplehenterprisesllc.biz';
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => { try { const v = JSON.parse(window.localStorage.getItem(key)); return v === null ? fallback : v; } catch (e) { return fallback; } };
  window.thWrite = (key, val) => { window.localStorage.setItem(key, JSON.stringify(val)); };
  window.attachLongPress = () => {};
  window.wireSearchClear = () => {};
  window.attachVoiceDictation = () => {};
  window.personDot = () => '';
  window.escapeHtml = (s) => String(s == null ? '' : s);
  window.money = (n) => '$' + (Number(n) || 0).toFixed(2);
  window.uploadReceipt = async (file, id) => ({ ok: true, path: 'expense-' + id + '/fake.jpg' });
  window.localStorage.setItem('th_tracker_jobs', JSON.stringify([{ id: 555, title: 'End-to-end Test Job' }]));

  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 50));

  // Case 1: missing receipt should block the save with the right message.
  window.showQuickExpenseModal(555, 'End-to-end Test Job');
  window.document.getElementById('quickExpenseDesc').value = 'Part';
  window.document.getElementById('quickExpenseAmount').value = '25';
  await window.submitQuickExpense();
  assert.match(alertMsg || '', /receipt photo is required/);
  assert.ok(window.document.getElementById('quickExpenseOverlay').classList.contains('is-open'), 'modal should stay open when the save is blocked');

  // Case 2: a real submission should actually save correctly and close the modal.
  Object.defineProperty(window.document.getElementById('quickExpenseReceipt'), 'files', {
    value: [{ type: 'image/jpeg', name: 'receipt.jpg' }], configurable: true,
  });
  await window.submitQuickExpense();

  const saved = JSON.parse(window.localStorage.getItem('th_expense_log') || '[]');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].desc, 'Part');
  assert.equal(saved[0].amount, 25);
  assert.equal(saved[0].jobRefId, '555');
  assert.equal(saved[0].jobRefTitle, 'End-to-end Test Job');
  assert.equal(saved[0].type, 'expense');
  assert.ok(saved[0].receiptPath.length > 0);
  assert.equal(window.document.getElementById('quickExpenseOverlay').classList.contains('is-open'), false, 'modal should close after a successful save');
});

// CRITICAL BUG FIX (2026-08-20), found from a direct follow-up report
// that Finance "still isn't working right" after the earlier
// undeclared-constants fix. A genuinely different, separate bug: that
// earlier fix resolved a CRASH (nothing rendered at all, including the
// tabs and header). Once fixed, the page's init ran successfully and
// computed everything correctly -- but activateTab() was only ever
// called if the URL happened to have a hash matching a real tab name.
// On a completely normal visit (tapping Finance from the bottom nav, a
// bookmark, or just typing the URL with no #hash), that line did
// nothing, and since the HTML only hardcodes is-active on the tab
// BUTTON (not the panel itself), the panel stayed hidden behind its
// default display:none forever. The page LOOKED like it was still
// broken -- header and tabs visible, nothing underneath -- even though
// every calculation underneath had actually run correctly. Caught by
// checking the ACTUAL is-active state of the default panel after a
// simulated normal page load, not just that nothing throws.
//
// job-tracker.html shares the exact same conditional-activation
// pattern but wasn't actually broken -- its default panel (tab-jobs)
// happens to have is-active hardcoded in the HTML already. Hardened it
// anyway with the same unconditional-with-fallback fix, since relying
// on a button's class and a panel's class staying manually
// synchronized in two separate places is exactly the kind of fragile
// coupling that caused this bug on finance.html in the first place.

test('finance.html shows its default tab (Cost Lookup) on a completely normal, hash-less page load -- not just that nothing throws', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(FINANCE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/', // deliberately no hash
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  window.hasDevToolsAccess = () => true;
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => fallback;
  window.money = (n) => '$' + (Number(n) || 0).toFixed(2);
  window.escapeHtml = (s) => String(s == null ? '' : s);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.ok(window.document.getElementById('tab-cost').classList.contains('is-active'),
    'the default tab panel must actually be visible on a normal visit -- this is the exact bug that made the page look broken even after content was computed correctly');
  for (const id of ['tab-profitability', 'tab-income', 'tab-expenses']) {
    assert.equal(window.document.getElementById(id).classList.contains('is-active'), false, id + ' should NOT be active by default');
  }
});

test('finance.html still correctly activates a DIFFERENT tab when a real hash is present, not just the fallback default', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(FINANCE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/#expenses',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  window.hasDevToolsAccess = () => true;
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => fallback;
  window.money = (n) => '$' + (Number(n) || 0).toFixed(2);
  window.escapeHtml = (s) => String(s == null ? '' : s);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 100));

  assert.ok(window.document.getElementById('tab-expenses').classList.contains('is-active'));
  assert.equal(window.document.getElementById('tab-cost').classList.contains('is-active'), false);
});

test('job-tracker.html shows its default tab (Jobs) on a normal, hash-less load, and still respects a real hash when present', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');

  for (const [url, expectedActive, expectedInactive] of [
    ['https://example.com/', 'tab-jobs', ['tab-contacts', 'tab-notes']],
    ['https://example.com/#contacts', 'tab-contacts', ['tab-jobs', 'tab-notes']],
  ]) {
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', url,
      beforeParse(window) { window.requireAuth = () => {}; },
    });
    const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
    window.showToast = () => {};
    window.showConfirm = () => Promise.resolve(true);
    window.initSyncOnLoad = () => Promise.resolve();
    window.getCurrentUserEmail = () => null;
    window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
    window.thRead = (key, fallback) => fallback;
    window.attachLongPress = () => {};
    window.wireSearchClear = () => {};
    window.attachVoiceDictation = () => {};
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise(resolve => setTimeout(resolve, 100));

    assert.ok(window.document.getElementById(expectedActive).classList.contains('is-active'), url + ' should activate ' + expectedActive);
    for (const id of expectedInactive) {
      assert.equal(window.document.getElementById(id).classList.contains('is-active'), false, url + ': ' + id + ' should not be active');
    }
  }
});

test('both pages use the unconditional activateTab(...) fallback pattern now, not the fragile conditional-only version', () => {
  const finSrc = fs.readFileSync(FINANCE_PATH, 'utf8');
  const jtSrc = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.match(finSrc, /activateTab\(TAB_HASHES\[initialHash\] \? initialHash : 'cost'\)/);
  assert.match(jtSrc, /activateTab\(TAB_HASHES\[initialHash\] \? initialHash : 'jobs'\)/);
  assert.doesNotMatch(finSrc, /if \(TAB_HASHES\[initialHash\]\) activateTab\(initialHash\);/);
  assert.doesNotMatch(jtSrc, /if \(TAB_HASHES\[initialHash\]\) activateTab\(initialHash\);/);
});

// Diagnostic visibility fix (2026-08-20), added after a persisted,
// unexplained report that Finance still showed no tab content even
// after a completely fresh reinstall (ruling out caching entirely).
// Extensively traced the sync/auth network chain (initSyncOnLoad ->
// pullSync -> ensureFreshToken -> refreshSession -> loadCurrentUserRole)
// and confirmed every one already has proper try/catch around its own
// network calls. Rather than keep guessing blindly, wrapped the entire
// init function in both finance.html and job-tracker.html in a
// try/catch that surfaces the real error directly and visibly on the
// page -- previously, ANY throw anywhere in either init function
// failed completely silently, invisible to anyone but someone checking
// the browser console. Verified this actually catches and displays a
// real error, not just that the syntax is valid.

test('finance.html and job-tracker.html both wrap their entire init function in a try/catch that displays the real error visibly', () => {
  for (const path of [FINANCE_PATH, JOB_TRACKER_PATH]) {
    const src = fs.readFileSync(path, 'utf8');
    const initFn = src.match(/\(async function init\(\) \{[\s\S]*?\n    \}\)\(\);/);
    assert.ok(initFn, 'init function not found in ' + path);
    assert.match(initFn[0], /try \{/);
    assert.match(initFn[0], /\} catch \(initError\) \{/);
    assert.match(initFn[0], /failed to load properly/);
    assert.match(initFn[0], /Please screenshot this and share it/);
  }
});

test('the error banner actually appears and shows the real error message when init genuinely throws, verified with jsdom, not just checked for valid syntax', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(FINANCE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  window.hasDevToolsAccess = () => true;
  // Deliberately NOT stubbing money/TH_KEYS/thRead, to force a real throw.
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 100));

  const banner = window.document.body.firstElementChild;
  assert.ok(banner, 'an error banner should have been inserted');
  assert.match(banner.textContent, /Finance page failed to load properly/);
  assert.match(banner.textContent, /Error:/);
});

// CRITICAL BUG FIX (2026-08-20), the third distinct instance of the
// same Push 4 extraction gap. The visible error banner (added in the
// previous fix) caught the FIRST of these (justAddedExpenseId) on a
// real device -- but investigating further with a proper scanner (this
// time checking camelCase assign-without-declare identifiers, not just
// the ALL-CAPS constants the earlier scan was limited to) found 3 MORE
// in the same file: editingIncomeEntryId, justAddedIncomeEntryId,
// expenseSaveInProgress, and editingExpenseId. Critically,
// expenseSaveInProgress isn't touched during page load at all -- only
// the FIRST time someone actually tries to add an expense -- meaning
// fixing just the one caught bug would have led straight into another,
// different-looking crash the moment the page's core purpose (logging
// an expense) was actually attempted. All 4 verified with a real,
// full end-to-end simulation: add -> confirm the highlight animation
// class is applied -> edit -> cancel -> re-render, for both expenses
// and income, with zero throws.
//
// Also found 3 confirmed-orphaned declarations in job-tracker.html
// (editingExpenseId, justAddedExpenseId, expenseSaveInProgress) --
// each had exactly one reference anywhere in that file (its own
// declaration), left over from before Push 4 moved the code that used
// them to finance.html. Removed from there; the real, actually-needed
// versions now live in finance.html instead.

test('all 4 previously-undeclared state variables (editingIncomeEntryId, justAddedIncomeEntryId, editingExpenseId, expenseSaveInProgress) are now properly declared in finance.html', () => {
  const src = fs.readFileSync(FINANCE_PATH, 'utf8');
  assert.match(src, /let editingIncomeEntryId = null;/);
  assert.match(src, /let justAddedIncomeEntryId = null;/);
  assert.match(src, /let editingExpenseId = null;/);
  assert.match(src, /let expenseSaveInProgress = false;/);
});

test('job-tracker.html\'s 3 confirmed-orphaned declarations for the same variables are gone -- the real ones live in finance.html now', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.doesNotMatch(src, /editingExpenseId/);
  assert.doesNotMatch(src, /justAddedExpenseId/);
  assert.doesNotMatch(src, /expenseSaveInProgress/);
});

test('the full expense lifecycle (add, highlight, edit, cancel, re-render) works end to end with zero throws -- not just that init completes', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(FINANCE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.showAlert = async () => {};
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => 'connor@triplehenterprisesllc.biz';
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => fallback;
  window.money = (n) => '$' + (Number(n) || 0).toFixed(2);
  window.escapeHtml = (s) => String(s == null ? '' : s);
  window.uploadReceipt = async () => ({ ok: true, path: 'fake.jpg' });
  window.scheduleSync = () => {};
  window.personDot = () => '';
  window.toggleFormSection = () => {};
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 100));

  window.document.getElementById('entryDate').value = '2026-08-18';
  window.document.getElementById('entryDesc').value = 'Test part';
  Object.defineProperty(window.document.getElementById('entryReceipt'), 'files', {
    value: [{ type: 'image/jpeg', name: 'r.jpg' }], configurable: true,
  });

  await window.addExpense();
  const saved = JSON.parse(window.localStorage.getItem('th_expense_log') || '[]');
  assert.equal(saved.length, 1);
  assert.ok(window.document.getElementById('entriesTable').innerHTML.includes('list-row-enter'), 'the just-added row should get the highlight class');

  // These would throw immediately if editingExpenseId were still undeclared.
  window.editExpense(saved[0].id);
  window.cancelExpenseEdit();
  window.renderExpenses();
});

test('the full income lifecycle (add, highlight, edit, cancel, re-render) also works end to end with zero throws', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(FINANCE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.showAlert = async () => {};
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => fallback;
  window.money = (n) => '$' + (Number(n) || 0).toFixed(2);
  window.escapeHtml = (s) => String(s == null ? '' : s);
  window.scheduleSync = () => {};
  window.personDot = () => '';
  window.toggleFormSection = () => {};
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 100));

  window.document.getElementById('incomeDate').value = '2026-08-18';
  window.document.getElementById('incomeSource').value = 'Test client';
  window.document.getElementById('incomeDesc').value = 'Final payment';
  window.document.getElementById('incomeAmount').value = '200';

  await window.addIncomeEntry();
  const saved = JSON.parse(window.localStorage.getItem('th_income_log') || '[]');
  assert.equal(saved.length, 1);
  assert.ok(window.document.getElementById('incomeTable').innerHTML.includes('list-row-enter'));

  window.editIncomeEntry(saved[0].id);
  window.cancelIncomeEntryEdit();
  window.renderIncomeEntries();
});

// CRITICAL BUG FIX (2026-08-20), found while investigating the Expense
// form structure in preparation for building a fuller quick-add popup.
// entryType's change event was dispatched in editExpense() specifically
// to trigger a field-visibility toggle (Miles field for mileage entries,
// Amount field otherwise) -- but no listener ever existed to respond to
// it. Selecting "Mileage" as the type silently did nothing visually:
// the Amount field stayed visible and the Miles field stayed hidden, so
// every mileage entry logged through the UI would have saved as 0 miles
// and $0, since addExpense's own logic only reads the Amount field for
// type !== 'mileage'.

test('selecting Mileage as the expense type actually shows the Miles field and hides Amount/Part Number, not just internally records the type', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(FINANCE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => fallback;
  window.money = (n) => '$' + (Number(n) || 0).toFixed(2);
  window.escapeHtml = (s) => String(s == null ? '' : s);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 100));

  window.document.getElementById('entryType').value = 'mileage';
  window.document.getElementById('entryType').dispatchEvent(new window.Event('change'));
  assert.notEqual(window.document.getElementById('milesField').style.display, 'none');
  assert.equal(window.document.getElementById('amountField').style.display, 'none');
  assert.equal(window.document.getElementById('partNumberField').style.display, 'none');

  window.document.getElementById('entryType').value = 'expense';
  window.document.getElementById('entryType').dispatchEvent(new window.Event('change'));
  assert.equal(window.document.getElementById('milesField').style.display, 'none');
  assert.notEqual(window.document.getElementById('amountField').style.display, 'none');
});

// Popup fleshed out with full field parity + first-time tutorial
// (2026-08-20), per explicit direction: add the missing fields (vendor,
// part number, mileage) so the popup can fully replace the Finance form
// for this, plus a guided walkthrough on first use.

test('the quick-expense popup has a working type toggle matching finance.html\'s own field-visibility fix (Amount/Miles/Part Number/Receipt)', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const fn = src.match(/function toggleQuickExpenseTypeFields\(\)[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'toggleQuickExpenseTypeFields not found');
  for (const id of ['quickExpenseAmountField', 'quickExpenseMilesField', 'quickExpensePartNumberField', 'quickExpenseReceiptField']) {
    assert.match(fn[0], new RegExp(id));
  }
});

test('the tutorial system exists: 5 steps, a seen-flag key, show/advance/skip functions, and only shows automatically on first open', () => {
  const src = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  assert.match(src, /QUICK_EXPENSE_TUTORIAL_SEEN_KEY = 'th_quickexpense_tutorial_seen'/);
  const stepsMatch = src.match(/QUICK_EXPENSE_TUTORIAL_STEPS = \[([\s\S]*?)\n  \];/);
  assert.ok(stepsMatch, 'tutorial steps array not found');
  const stepCount = [...stepsMatch[1].matchAll(/\{ title:/g)].length;
  assert.equal(stepCount, 5);
  assert.match(src, /function showQuickExpenseTutorial\(\)/);
  assert.match(src, /function advanceQuickExpenseTutorial\(\)/);
  assert.match(src, /function skipQuickExpenseTutorial\(\)/);
  const showModal = src.match(/function showQuickExpenseModal\(jobId, jobTitle\)[\s\S]*?\n  \}\n/);
  assert.match(showModal[0], /localStorage\.getItem\(QUICK_EXPENSE_TUTORIAL_SEEN_KEY\)/, 'must check the seen-flag before deciding whether to show the tutorial');
});

test('the full tutorial lifecycle actually works end to end: shows on first open, completing it sets the seen flag, and it does NOT show again on a second open', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => fallback;
  window.thWrite = () => {};
  window.attachLongPress = () => {};
  window.wireSearchClear = () => {};
  window.attachVoiceDictation = () => {};
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 50));

  window.showQuickExpenseModal(1, 'Job');
  assert.notEqual(window.document.getElementById('quickExpenseTutorial').style.display, 'none', 'tutorial should show on first open');
  assert.equal(window.document.getElementById('quickExpenseFormView').style.display, 'none');

  for (let i = 0; i < 4; i++) window.advanceQuickExpenseTutorial();
  window.advanceQuickExpenseTutorial(); // final "Got it" click
  assert.notEqual(window.document.getElementById('quickExpenseFormView').style.display, 'none', 'form should show after completing the tutorial');
  assert.equal(window.localStorage.getItem('th_quickexpense_tutorial_seen'), '1');

  window.closeQuickExpenseModal();
  window.showQuickExpenseModal(1, 'Job');
  assert.equal(window.document.getElementById('quickExpenseTutorial').style.display, 'none', 'tutorial should NOT show on a second open');
});

test('a real mileage entry saves correctly: no receipt required, amount computed from miles times the stored mileage rate, partNumber blanked', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => { try { const v = JSON.parse(window.localStorage.getItem(key)); return v === null ? fallback : v; } catch (e) { return fallback; } };
  window.thWrite = (key, val) => { window.localStorage.setItem(key, JSON.stringify(val)); };
  window.attachLongPress = () => {};
  window.wireSearchClear = () => {};
  window.attachVoiceDictation = () => {};
  window.localStorage.setItem('th_mileage_rate', '0.67');
  window.localStorage.setItem('th_quickexpense_tutorial_seen', '1');
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 50));

  window.showQuickExpenseModal(1, 'Job');
  window.document.getElementById('quickExpenseType').value = 'mileage';
  window.toggleQuickExpenseTypeFields();
  window.document.getElementById('quickExpenseDesc').value = 'Supplier run';
  window.document.getElementById('quickExpenseMiles').value = '10';
  await window.submitQuickExpense();

  const saved = JSON.parse(window.localStorage.getItem('th_expense_log') || '[]');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].type, 'mileage');
  assert.equal(saved[0].miles, 10);
  assert.equal(saved[0].amount, 6.7);
  assert.equal(saved[0].receiptPath, '');
  assert.equal(saved[0].partNumber, '');
});

test('a real expense entry with vendor and part number saves both correctly', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(JOB_TRACKER_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.com/',
    beforeParse(window) { window.requireAuth = () => {}; },
  });
  const { window } = dom;
  window.initAppTour = () => {}; // real fn lives in the external tools-tour.js, not loaded in this minimal sandbox
  window.showToast = () => {};
  window.showConfirm = () => Promise.resolve(true);
  window.initSyncOnLoad = () => Promise.resolve();
  window.getCurrentUserEmail = () => null;
  window.TH_KEYS = { jobs: 'th_tracker_jobs', invoices: 'th_invoices', expenses: 'th_expense_log', income: 'th_income_log' };
  window.thRead = (key, fallback) => { try { const v = JSON.parse(window.localStorage.getItem(key)); return v === null ? fallback : v; } catch (e) { return fallback; } };
  window.thWrite = (key, val) => { window.localStorage.setItem(key, JSON.stringify(val)); };
  window.attachLongPress = () => {};
  window.wireSearchClear = () => {};
  window.attachVoiceDictation = () => {};
  window.uploadReceipt = async (file, id) => ({ ok: true, path: 'expense-' + id + '/r.jpg' });
  window.localStorage.setItem('th_quickexpense_tutorial_seen', '1');
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 50));

  window.showQuickExpenseModal(1, 'Job');
  window.document.getElementById('quickExpenseDesc').value = 'New capacitor';
  window.document.getElementById('quickExpenseAmount').value = '45.99';
  window.document.getElementById('quickExpenseVendor').value = 'Grainger';
  window.document.getElementById('quickExpensePartNumber').value = 'CAP-4400';
  Object.defineProperty(window.document.getElementById('quickExpenseReceipt'), 'files', {
    value: [{ type: 'image/jpeg', name: 'r.jpg' }], configurable: true,
  });
  await window.submitQuickExpense();

  const saved = JSON.parse(window.localStorage.getItem('th_expense_log') || '[]');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].vendor, 'Grainger');
  assert.equal(saved[0].partNumber, 'CAP-4400');
  assert.equal(saved[0].amount, 45.99);
  assert.ok(saved[0].receiptPath.length > 0);
});

// CRITICAL BUG FIXES (2026-08-20), found from a direct report: "invoices
// won't sync and I can't reach settings to restart the tutorial because
// I'm on iPhone." Two separate real bugs.

// BUG 1: the sticky header positioning added earlier this session
// (top: 0) had zero accounting for the iOS safe-area-inset-top, despite
// this app already using that exact pattern elsewhere (photo lightbox,
// jump-nav) and setting viewport-fit=cover, which means content
// genuinely extends under the notch/Dynamic Island unless explicitly
// pushed clear of it. On a large-notch device, this pushed the header's
// own right-side buttons -- including the Settings link -- up under the
// status bar, unreachable rather than just visually cramped.

test('the sticky header (.hub-header/.tool-header) accounts for the iOS safe-area-inset-top in both its sticky position and its own top padding', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'styles-tools.css'), 'utf8');
  const rule = src.match(/body \.hub-header, body \.tool-header \{[\s\S]*?\n\}/);
  assert.ok(rule, 'header rule not found');
  assert.match(rule[0], /top:\s*env\(safe-area-inset-top, 0px\)/, 'the sticky position itself must clear the notch');
  assert.match(rule[0], /padding:\s*calc\(12px \+ env\(safe-area-inset-top, 0px\)\)/, 'the header\'s own top padding must also clear the notch, since it sits in normal page flow before any scrolling');
});

test('the mobile jump-nav override also accounts for the safe-area-inset-top, not just the desktop-width version', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'styles-tools.css'), 'utf8');
  const mobileRule = src.match(/body \.jump-nav \{ margin-left: -12px[^}]*\}/);
  assert.ok(mobileRule, 'mobile jump-nav override not found');
  assert.match(mobileRule[0], /env\(safe-area-inset-top, 0px\)/);
});

// BUG 2: startRealtimeSync() had no timeout/watchdog at all -- if the
// underlying WebSocket subscription never reaches a terminal state, the
// status callback never fires, and the page's sync indicator stays
// stuck at its initial "connecting..." text forever, with no
// indication anything is wrong and no way to retry.

test('startRealtimeSync fires a \'timeout\' status if the subscription never resolves within 12 seconds, verified with the real function against a genuinely stuck mock subscription', async () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sync.js'), 'utf8');
  const sandbox = {
    console, setTimeout,
    localStorage: { getItem: () => null, setItem: () => {} },
    window: { addEventListener: () => {} },
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'fake-key',
    getAuthToken: () => 'fake-token', logClientError: () => {},
  };
  sandbox.window.supabase = {
    createClient: () => ({ channel: () => ({ on: () => ({ subscribe: () => ({}) }) }) }), // never calls back
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  let received = null;
  sandbox.startRealtimeSync(() => {}, (status) => { received = status; });
  await new Promise(resolve => setTimeout(resolve, 12200));
  assert.equal(received, 'timeout');
});

test('startRealtimeSync does NOT fire a spurious timeout if the subscription resolves normally and quickly', async () => {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sync.js'), 'utf8');
  const sandbox = {
    console, setTimeout,
    localStorage: { getItem: () => null, setItem: () => {} },
    window: { addEventListener: () => {} },
    SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_ANON_KEY: 'fake-key',
    getAuthToken: () => 'fake-token', logClientError: () => {},
  };
  sandbox.window.supabase = {
    createClient: () => ({ channel: () => ({ on: () => ({ subscribe: (cb) => { setTimeout(() => cb('SUBSCRIBED'), 20); return {}; } }) }) }),
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  const statuses = [];
  sandbox.startRealtimeSync(() => {}, (status) => statuses.push(status));
  await new Promise(resolve => setTimeout(resolve, 12200));
  assert.deepEqual(statuses, ['SUBSCRIBED']);
});

test('every page using the CHANNEL_ERROR/TIMED_OUT/CLOSED disconnected-state check now also treats \'timeout\' the same way, not the generic "still connecting" fallback', () => {
  for (const file of ['contract-generator.html', 'invoice-generator.html', 'job-tracker.html', 'route-planner.html', 'workspace.html', 'runway-dashboard.html']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tools', file), 'utf8');
    assert.match(src, /status === 'CHANNEL_ERROR' \|\| status === 'TIMED_OUT' \|\| status === 'CLOSED' \|\| status === 'timeout'/, file + ' should treat timeout as disconnected, not fall through to the generic connecting message');
  }
});

// Full cross-page app tour (2026-08-20). Expanded from a 3-step,
// dashboard-only onboarding tour into a walkthrough spanning every real
// tool page, per explicit direction: "I want this to become the
// tutorial and take you through each page and explain everything."
// State (which step you're on) lives in localStorage rather than the
// URL, so it survives a real page navigation between steps. Each page
// calls initAppTour() on its own DOMContentLoaded; that function is
// self-correcting -- if the stored step doesn't match the page you're
// actually on (say, you tapped the bottom nav instead of "Next"), it
// finds whichever step DOES belong to this page and shows that one
// instead of showing nothing or the wrong page's content.

function loadTourInWindow(url, email) {
  const { JSDOM } = require('jsdom');
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tools-tour.js'), 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url, runScripts: 'dangerously' });
  const { window } = dom;
  window.getCurrentUserEmail = () => email || null;
  const script = window.document.createElement('script');
  script.textContent = src;
  window.document.head.appendChild(script);
  return window;
}

test('the tour step list covers exactly the intended pages, and excludes redirect stubs, auth pages, dev tools, and detail views on purpose', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tools-tour.js'), 'utf8');
  const pages = [...src.matchAll(/page: '(\/tools\/[\w-]+\.html)'/g)].map(m => m[1]);
  const expectedPages = [
    '/tools/workspace.html', '/tools/job-tracker.html', '/tools/finance.html',
    '/tools/invoice-generator.html', '/tools/calendar.html', '/tools/route-planner.html',
    '/tools/contract-generator.html', '/tools/review-request.html', '/tools/parts-reference.html',
    '/tools/runway-dashboard.html', '/tools/settings.html',
  ];
  const uniquePages = [...new Set(pages)];
  assert.deepEqual(uniquePages, expectedPages);
  // workspace.html should have exactly 4 steps (its own sections); every other page exactly 1.
  assert.equal(pages.filter(p => p === '/tools/workspace.html').length, 4);
  for (const p of expectedPages.slice(1)) {
    assert.equal(pages.filter(x => x === p).length, 1, p + ' should have exactly one step');
  }
  const excluded = ['job-cost-lookup.html', 'expense-logger.html', 'contact-card.html', 'login.html', 'reset-password.html', 'dev-tools.html', 'site-content.html', 'client-detail.html', 'job-detail.html'];
  for (const e of excluded) assert.ok(!pages.some(p => p.includes(e)), e + ' should not appear in the tour');
});

test('every one of tools-tour.js\'s 4 workspace.html section ids actually exists on that page', () => {
  const tourSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'tools-tour.js'), 'utf8');
  const wsSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'workspace.html'), 'utf8');
  const sectionIds = [...tourSrc.matchAll(/sectionId: '([\w-]+)'/g)].map(m => m[1]);
  assert.equal(sectionIds.length, 4);
  for (const id of sectionIds) {
    assert.match(wsSrc, new RegExp('id="' + id + '"'), id + ' referenced by the tour but not found on workspace.html');
  }
});

test('a fresh, never-seen visit to workspace.html auto-starts the tour at step 0', () => {
  const w = loadTourInWindow('https://example.com/tools/workspace.html');
  w.initAppTour();
  assert.equal(w.localStorage.getItem('th_app_tour_step'), '0');
  assert.ok(w.document.getElementById('appTourCard'));
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'Business Snapshot');
});

test('a returning user (seen flag already set) does NOT auto-start the tour', () => {
  const w = loadTourInWindow('https://example.com/tools/workspace.html', 'connor@triplehenterprisesllc.biz');
  w.localStorage.setItem('th_onboarding_v1_seen_connor@triplehenterprisesllc.biz', '1');
  w.initAppTour();
  assert.ok(!w.document.getElementById('appTourCard'));
});

test('the old shared seen-flag key migrates correctly to the new per-user key, without forcing a restart', () => {
  const w = loadTourInWindow('https://example.com/tools/workspace.html', 'steve@triplehenterprisesllc.biz');
  w.localStorage.setItem('th_onboarding_v1_seen', '1');
  w.initAppTour();
  assert.equal(w.localStorage.getItem('th_onboarding_v1_seen_steve@triplehenterprisesllc.biz'), '1');
  assert.ok(!w.document.getElementById('appTourCard'));
});

test('advancing through workspace.html\'s own 4 steps stays on the same page (no navigation), and the Back button correctly reverts', () => {
  const w = loadTourInWindow('https://example.com/tools/workspace.html');
  w.initAppTour();
  assert.ok(!w.document.querySelector('.onboarding-back'), 'no Back button on the very first step');

  w.goToAppTourStep(1);
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'Action Items');
  assert.ok(w.document.querySelector('.onboarding-back'), 'Back button should exist from step 1 onward');

  w.goToAppTourStep(2);
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'More');
  w.goToAppTourStep(3);
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'Tools');
  assert.equal(w.document.querySelector('.onboarding-next').textContent, 'Next', 'step 3 of 14 total is not the last step overall');

  w.document.querySelector('.onboarding-back').click();
  assert.equal(w.localStorage.getItem('th_app_tour_step'), '2');
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'More');
});

test('advancing from workspace.html\'s last step correctly records the next step (job-tracker.html) before attempting to navigate there', () => {
  const w = loadTourInWindow('https://example.com/tools/workspace.html');
  w.initAppTour();
  w.goToAppTourStep(1); w.goToAppTourStep(2); w.goToAppTourStep(3);
  try { w.goToAppTourStep(4); } catch (e) { /* jsdom can't actually navigate cross-page; expected */ }
  assert.equal(w.localStorage.getItem('th_app_tour_step'), '4');
});

test('self-correction: landing on a page that doesn\'t match the stored step shows THAT page\'s real content and fixes the stored step, rather than showing nothing or the wrong page', () => {
  // Stored step 5 points at finance.html, but the person is actually on calendar.html (step 7).
  const w = loadTourInWindow('https://example.com/tools/calendar.html');
  w.localStorage.setItem('th_app_tour_step', '5');
  w.initAppTour();
  assert.ok(w.document.getElementById('appTourCard'));
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'Calendar');
  assert.equal(w.localStorage.getItem('th_app_tour_step'), '7');
});

test('landing on a page that isn\'t part of the tour at all renders no card, even with an active tour in progress', () => {
  const w = loadTourInWindow('https://example.com/tools/login.html');
  w.localStorage.setItem('th_app_tour_step', '2');
  w.initAppTour();
  assert.ok(!w.document.getElementById('appTourCard'));
});

test('dismissing (Skip) clears the active-step flag, sets the per-user seen flag, and removes the card from the DOM', () => {
  const w = loadTourInWindow('https://example.com/tools/workspace.html', 'connor@triplehenterprisesllc.biz');
  w.initAppTour();
  w.dismissAppTour();
  assert.equal(w.localStorage.getItem('th_app_tour_step'), null);
  assert.equal(w.localStorage.getItem('th_onboarding_v1_seen_connor@triplehenterprisesllc.biz'), '1');
  assert.ok(!w.document.getElementById('appTourCard'));
});

test('on the very last step (Settings), the button reads "Got it" and clicking it dismisses cleanly rather than advancing past the end of the array', () => {
  const w = loadTourInWindow('https://example.com/tools/settings.html');
  w.localStorage.setItem('th_app_tour_step', '13');
  w.initAppTour();
  assert.equal(w.document.querySelector('.onboarding-next').textContent, 'Got it');
  w.document.querySelector('.onboarding-next').click();
  assert.equal(w.localStorage.getItem('th_app_tour_step'), null);
});

test('?tour=1 forces a restart from step 0 regardless of the seen flag, and cleans the query param off the URL afterward', () => {
  const w = loadTourInWindow('https://example.com/tools/workspace.html?tour=1', 'connor@triplehenterprisesllc.biz');
  w.localStorage.setItem('th_onboarding_v1_seen_connor@triplehenterprisesllc.biz', '1'); // already seen
  w.initAppTour();
  assert.equal(w.localStorage.getItem('th_app_tour_step'), '0');
  assert.equal(w.document.querySelector('.onboarding-title').textContent, 'Business Snapshot');
  assert.ok(!w.location.search.includes('tour=1'), 'the ?tour=1 param should be cleaned off the URL');
});

test('every one of the 11 target pages actually loads tools-tour.js and calls initAppTour() on its own DOMContentLoaded', () => {
  const pages = ['workspace.html', 'job-tracker.html', 'finance.html', 'invoice-generator.html',
    'calendar.html', 'route-planner.html', 'contract-generator.html', 'review-request.html',
    'parts-reference.html', 'settings.html', 'runway-dashboard.html'];
  for (const file of pages) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tools', file), 'utf8');
    assert.match(src, /<script src="\/tools\/tools-tour\.js/, file + ' should load tools-tour.js');
    assert.match(src, /initAppTour\(\);/, file + ' should call initAppTour()');
  }
});

test('settings.html\'s tour description reflects the real, expanded scope, not the old 3-step Dashboard-only wording', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'settings.html'), 'utf8');
  assert.doesNotMatch(src, /3-step Dashboard walkthrough/);
  assert.match(src, /walkthrough of every page/);
});

// Check-links false-positive fix (2026-08-20), after a real CI failure
// email: 5 legitimate third-party domains (fonts.googleapis.com, cal.com,
// google.com maps links, googletagmanager.com, g.page) were returning
// HTTP 403 to the checker's automated requests specifically -- confirmed
// via a real web search that Google's own crawler has successfully
// indexed the Cal.com booking page's actual content, meaning the block
// targets this kind of automated request pattern, not everyone.
// Deliberately did NOT add the site's own domain to the same allowlist
// even though it returned the identical 403 in the same run -- a
// third-party site blocking bots is a shrug, but the site blocking its
// own link checker is a separate, more worth-knowing thing that
// deserves a distinct, visible flag rather than silent suppression.

test('check-links.py\'s bot-hostile allowlist includes the 5 domains added after the 2026-08-20 false-positive CI failure', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-links.py'), 'utf8');
  const match = src.match(/BOT_HOSTILE_DOMAINS = \(([\s\S]*?)\)/);
  assert.ok(match, 'BOT_HOSTILE_DOMAINS not found');
  for (const domain of ['fonts.googleapis.com', 'cal.com', 'google.com', 'googletagmanager.com', 'g.page']) {
    assert.match(match[1], new RegExp("'" + domain.replace(/\./g, '\\.') + "'"), domain + ' should be in the allowlist');
  }
});

test('the site\'s own domain is deliberately NOT in the bot-hostile allowlist, and instead gets its own distinct, visible flag', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-links.py'), 'utf8');
  const allowlistMatch = src.match(/BOT_HOSTILE_DOMAINS = \(([\s\S]*?)\)/);
  assert.doesNotMatch(allowlistMatch[1], /triplehenterprisesllc/, 'the site\'s own domain should not be silently lumped in with third-party bot-hostile platforms');
  assert.match(src, /SITE_OWN_DOMAIN = 'triplehenterprisesllc\.biz'/);
  assert.match(src, /WORTH CHECKING \(this site's own domain/, 'a 403 from the site\'s own domain should get a distinct, visible message');
});

test('running check-links.py against the real repo actually passes now (not just that the allowlist text looks right)', () => {
  const { execSync } = require('child_process');
  const output = execSync('python3 ' + path.join(__dirname, '..', 'scripts', 'check-links.py'), { encoding: 'utf8' });
  assert.match(output, /Link check passed/);
});
