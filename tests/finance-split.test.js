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
