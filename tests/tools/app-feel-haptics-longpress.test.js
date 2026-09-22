// "Make it feel like an app" push (2026-09-22), direct request: "heavily
// focus tool improvements... as much like a physical phone app as
// possible." An audit found the underlying systems (haptic(), the
// shared long-press quick-action sheet) were already built and
// well-designed but under-used -- wired into only 1-2 of the ~19 tool
// pages. This closes the coverage gap by reusing those exact shared
// utilities at each page's own real success/secondary-action moments,
// rather than inventing new patterns.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const jobTrackerHtml = fs.readFileSync(repo('tools', 'job-tracker.html'), 'utf8');
const invoiceGenHtml = fs.readFileSync(repo('tools', 'invoice-generator.html'), 'utf8');
const workspaceHtml = fs.readFileSync(repo('tools', 'workspace.html'), 'utf8');
const financeHtml = fs.readFileSync(repo('tools', 'finance.html'), 'utf8');
const contractGenHtml = fs.readFileSync(repo('tools', 'contract-generator.html'), 'utf8');
const reviewRequestHtml = fs.readFileSync(repo('tools', 'review-request.html'), 'utf8');
const toolsEffectsJs = fs.readFileSync(repo('tools', 'tools-effects.js'), 'utf8');

// --- haptic() coverage --------------------------------------------------

test('invoice-generator.html: toggleInvoicePaid fires a success haptic when marking paid (not when marking unpaid -- undoing isn\'t a success moment)', () => {
  const fn = invoiceGenHtml.match(/function toggleInvoicePaid\(id\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(entry\.paid && typeof haptic === 'function'\) haptic\('success'\);/);
});

test('invoice-generator.html: both generatePDF (invoice) and generateQuotePDF (estimate) fire a success haptic once the record is actually saved, before the Download-vs-Send branch', () => {
  assert.match(invoiceGenHtml, /storeInvoicePdf\(doc, newEntry\.invoiceNumber\);[\s\S]{0,400}if \(typeof haptic === 'function'\) haptic\('success'\);/, 'invoice path');
  assert.match(invoiceGenHtml, /const newEntry = logQuote\(\{ subtotal, tax, discount, total \}\);\s*\n\s*if \(typeof haptic === 'function'\) haptic\('success'\);/, 'estimate path');
});

test('workspace.html: convertBookingToJob fires a success haptic right before the "Added to Jobs." toast', () => {
  assert.match(workspaceHtml, /if \(typeof haptic === 'function'\) haptic\('success'\);\s*\n\s*showToast\('Added to Jobs\.'\);/);
});

test('finance.html: both saveIncomeEntry and saveExpense fire a success haptic right before their own log toast', () => {
  assert.match(financeHtml, /if \(typeof haptic === 'function'\) haptic\('success'\);\s*\n\s*showToast\(wasEditing \? 'Income entry updated\.' : 'Income logged\.'\);/);
  assert.match(financeHtml, /if \(typeof haptic === 'function'\) haptic\('success'\);\s*\n\s*showToast\(wasEditing \? 'Entry updated\.' : \(type === 'mileage' \? 'Mileage logged\.' : 'Expense logged\.'\)\);/);
});

test('job-tracker.html: saveJob fires a success haptic for both a new job and an edit', () => {
  assert.match(jobTrackerHtml, /if \(typeof haptic === 'function'\) haptic\('success'\);\s*\n\s*if \(!wasEditing && fields\.client/);
});

test('tools-effects.js: celebrateCompletion() fires a success haptic unconditionally, ahead of the prefers-reduced-motion early return (vibration is not the kind of motion that preference is about)', () => {
  const fn = toolsEffectsJs.match(/function celebrateCompletion\(\)[\s\S]*?\n\}/)[0];
  const hapticIdx = fn.indexOf("haptic('success')");
  const reducedMotionCheckIdx = fn.indexOf("window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)')");
  assert.ok(hapticIdx > -1, 'celebrateCompletion should call haptic(\'success\')');
  assert.ok(reducedMotionCheckIdx > -1, 'celebrateCompletion should still check prefers-reduced-motion for the confetti');
  assert.ok(hapticIdx < reducedMotionCheckIdx, 'the haptic call must run before the reduced-motion early return, not be skipped by it');
});

test('job-tracker.html: marking a job Done (setJobStatus -> celebrateCompletion) gets both the existing confetti AND the haptic added to celebrateCompletion above -- no separate haptic call needed at this site', () => {
  const fn = jobTrackerHtml.match(/async function setJobStatus\(id, newStatus\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(typeof celebrateCompletion === 'function'\) celebrateCompletion\(\);/);
});

// --- long-press quick-action sheet coverage -----------------------------

test('finance.html: income and expense rows each get a long-press init function wired to their real container id and row selector', () => {
  assert.match(financeHtml, /function initIncomeRowLongPress\(\)[\s\S]*?getElementById\('incomeTable'\)[\s\S]*?attachLongPress\(container, 'tr\[data-income-id\]'/);
  assert.match(financeHtml, /function initExpenseRowLongPress\(\)[\s\S]*?getElementById\('entriesTable'\)[\s\S]*?attachLongPress\(container, 'tr\[data-expense-id\]'/);
  assert.match(financeHtml, /initExpenseRowLongPress\(\);\s*\n\s*initIncomeRowLongPress\(\);/, 'both should be wired at page init');
});

test('finance.html: the income row long-press sheet omits Edit for an invoice-originated entry (mirroring the row\'s own real Edit button, which is hidden for the same reason)', () => {
  const fn = financeHtml.match(/function initIncomeRowLongPress\(\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(entry\.origin !== 'invoice'\) actions\.push\(\{ label: 'Edit'/);
  assert.match(fn, /actions\.push\(\{ label: 'Delete', isDanger: true/);
});

test('job-tracker.html: contact cards get a long-press init function offering History/Edit/Delete, wired at page init', () => {
  assert.match(jobTrackerHtml, /function initContactCardLongPress\(\)[\s\S]*?getElementById\('contactsList'\)[\s\S]*?attachLongPress\(container, '\.contact-card'/);
  const fn = jobTrackerHtml.match(/function initContactCardLongPress\(\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /label: 'History'/);
  assert.match(fn, /label: 'Edit'/);
  assert.match(fn, /label: 'Delete', isDanger: true/);
  assert.match(jobTrackerHtml, /renderContacts\(\);\s*\n\s*initContactCardLongPress\(\);/);
});

test('job-tracker.html: initContactCardLongPress is not a duplicate renderContacts() call site -- exactly one renderContacts() call sits right before it', () => {
  assert.match(jobTrackerHtml, /renderContacts\(\);\s*\n\s*initContactCardLongPress\(\);/);
  const idx = jobTrackerHtml.indexOf('initContactCardLongPress();');
  const nearby = jobTrackerHtml.slice(idx - 200, idx + 30);
  const renderContactsCalls = (nearby.match(/\brenderContacts\(\);/g) || []).length;
  assert.equal(renderContactsCalls, 1, 'exactly one renderContacts() call should immediately precede initContactCardLongPress(), not a leftover duplicate');
});

test('contract-generator.html: contract log items get a long-press init function offering Re-download/Delete, wired after the initial sync resolves', () => {
  assert.match(contractGenHtml, /function initContractLogLongPress\(\)[\s\S]*?getElementById\('contractLogList'\)[\s\S]*?attachLongPress\(container, '\.contract-log-item'/);
  const fn = contractGenHtml.match(/function initContractLogLongPress\(\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /label: 'Re-download'/);
  assert.match(fn, /label: 'Delete', isDanger: true/);
  assert.match(contractGenHtml, /populateContactPickers\(\); renderContractLog\(\);\s*\n\s*initContractLogLongPress\(\);/);
});

test('every new long-press init function guards against double-wiring the same container (dataset.longPressWired), same convention as the existing initJobCardLongPress()', () => {
  for (const [html, fnName] of [
    [financeHtml, 'initIncomeRowLongPress'],
    [financeHtml, 'initExpenseRowLongPress'],
    [jobTrackerHtml, 'initContactCardLongPress'],
    [contractGenHtml, 'initContractLogLongPress'],
  ]) {
    const fn = html.match(new RegExp('function ' + fnName + '\\(\\)[\\s\\S]*?\\n  \\}'))[0];
    assert.match(fn, /if \(!container \|\| container\.dataset\.longPressWired\) return;/, fnName);
    assert.match(fn, /container\.dataset\.longPressWired = '1';/, fnName);
  }
});

// --- behavioral: the long-press callback actually builds the right sheet ---

const { JSDOM } = require('jsdom');

test('finance.html: initExpenseRowLongPress, invoked end-to-end with a real long-press, opens a quick-action sheet for the right entry with working Edit/Delete callbacks', () => {
  const dom = new JSDOM(financeHtml, {
    runScripts: 'dangerously', url: 'https://example.com/tools/finance.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canViewFinance = () => true;
      w.localStorage.setItem('th_expense_log', JSON.stringify([{ id: 7, vendor: 'Home Depot', desc: 'Screws', amount: 12.5, date: '2026-09-20', type: 'expense' }]));
    },
  });
  const { window } = dom;

  let capturedOnLongPress = null;
  window.attachLongPress = (container, selector, onLongPress) => { capturedOnLongPress = onLongPress; };
  let sheetTitle = null, sheetActions = null;
  window.showQuickActionSheet = (title, actions) => { sheetTitle = title; sheetActions = actions; };
  let editedId = null, deletedId = null;
  window.editExpense = (id) => { editedId = id; };
  window.deleteExpense = (id) => { deletedId = id; };

  window.initExpenseRowLongPress();
  assert.ok(capturedOnLongPress, 'attachLongPress should have been called with a real callback');

  const row = window.document.createElement('tr');
  row.dataset.expenseId = '7';
  capturedOnLongPress(row);

  assert.equal(sheetTitle, 'Home Depot');
  assert.equal(sheetActions.length, 2);
  sheetActions[0].onClick();
  assert.equal(editedId, 7);
  sheetActions[1].onClick();
  assert.equal(deletedId, 7);
});

// --- round 2 (2026-09-22, same day): app badge delta + invoice log long-press ---

const toolsEffectsJsFull = fs.readFileSync(repo('tools', 'tools-effects.js'), 'utf8');

test('workspace.html: updateActionItemsBadge caches its computed total to th_app_badge_total every time it runs, right after setting the real OS badge', () => {
  const fn = workspaceHtml.match(/function updateActionItemsBadge\(\)[\s\S]*?\n  \}/)[0];
  const badgeSetIdx = fn.indexOf("navigator.clearAppBadge()");
  const cacheIdx = fn.indexOf("localStorage.setItem('th_app_badge_total', String(Math.max(0, total)));");
  assert.ok(badgeSetIdx > -1, 'should still set/clear the real OS badge');
  assert.ok(cacheIdx > -1, 'should cache the computed total to th_app_badge_total');
  assert.ok(badgeSetIdx < cacheIdx, 'the cache write should come after the real badge is set, not before');
});

test('tools-effects.js: setAppBadgeDelta reads the cached total, clamps at 0, writes the new total back, and sets/clears the real OS badge accordingly', () => {
  const fn = toolsEffectsJsFull.match(/function setAppBadgeDelta\(delta\)[\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(typeof navigator === 'undefined' \|\| !\('setAppBadge' in navigator\)\) return;/);
  assert.match(fn, /localStorage\.getItem\('th_app_badge_total'/);
  assert.match(fn, /Math\.max\(0, cached \+ delta\)/);
  assert.match(fn, /localStorage\.setItem\('th_app_badge_total', String\(next\)\)/);
  assert.match(fn, /if \(next > 0\) navigator\.setAppBadge\(next\)/);
  assert.match(fn, /else if \('clearAppBadge' in navigator\) navigator\.clearAppBadge\(\)/);
});

test('setAppBadgeDelta, invoked directly: nudges the cached total down on -1, up on +1, and never goes negative', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'dangerously', url: 'https://example.com/' });
  const { window } = dom;
  window.eval(toolsEffectsJsFull.match(/function setAppBadgeDelta\(delta\)[\s\S]*?\n\}/)[0]);
  let lastSetTo = null, cleared = false;
  window.navigator.setAppBadge = (n) => { lastSetTo = n; return Promise.resolve(); };
  window.navigator.clearAppBadge = () => { cleared = true; return Promise.resolve(); };

  window.localStorage.setItem('th_app_badge_total', '3');
  window.setAppBadgeDelta(-1);
  assert.equal(window.localStorage.getItem('th_app_badge_total'), '2');
  assert.equal(lastSetTo, 2);

  window.setAppBadgeDelta(-5); // would go negative -- must clamp at 0 and clear, not set a negative badge
  assert.equal(window.localStorage.getItem('th_app_badge_total'), '0');
  assert.equal(cleared, true);

  window.setAppBadgeDelta(1);
  assert.equal(window.localStorage.getItem('th_app_badge_total'), '1');
  assert.equal(lastSetTo, 1);
});

test('invoice-generator.html: toggleInvoicePaid nudges the badge down when marking paid, up when marking unpaid again', () => {
  const fn = invoiceGenHtml.match(/function toggleInvoicePaid\(id\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(typeof setAppBadgeDelta === 'function'\) setAppBadgeDelta\(entry\.paid \? -1 : 1\);/);
});

// 2026-09-22 (Workspace rework part 4): the sheet is openInvoiceActions(),
// which a tap on the row opens too; initInvoiceLogLongPress() wires the
// hold on both the invoice and the quote list to the same sheets.
test('invoice-generator.html: the invoice log gets a long-press init function opening the invoice sheet (Mark Paid or Unpaid / Resend / Delete), guarded against a missing attachLongPress and wired right after the initial render', () => {
  assert.match(invoiceGenHtml, /function initInvoiceLogLongPress\(\)[\s\S]*?if \(typeof attachLongPress !== 'function'\) return;[\s\S]*?\['invoiceLogList', 'quoteLogList'\][\s\S]*?attachLongPress\(container, '\.inv-item\[data-invoice-id\]', \(itemEl\) => openInvoiceActions\(Number\(itemEl\.dataset\.invoiceId\)\)\)/);
  const fn = invoiceGenHtml.match(/function openInvoiceActions\(id\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(inv\.clientEmail\) actions\.push\(\{ label: 'Resend to client'/);
  assert.match(fn, /label: st\.status === 'paid' \? 'Mark Unpaid' : 'Mark Paid'/);
  assert.match(fn, /label: 'Delete', isDanger: true/);
  assert.match(fn, /showQuickActionSheet\(escapeHtml\(title\), actions\)/, 'the sheet renders its title as HTML');
  assert.match(invoiceGenHtml, /if \(typeof renderQuoteLog === 'function'\) renderQuoteLog\(\);\s*\n\s*if \(typeof initInvoiceLogLongPress === 'function'\) initInvoiceLogLongPress\(\);/);
});

test('invoice-generator.html: the invoice sheet, invoked end-to-end through the long-press, is for the right invoice, escapes its title, and has working Mark Paid / Resend / Delete callbacks', () => {
  const dom = new JSDOM(invoiceGenHtml, {
    runScripts: 'dangerously', url: 'https://example.com/tools/invoice-generator.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.canManageInvoices = () => true;
      w.localStorage.setItem('th_invoices', JSON.stringify([
        { id: 42, clientName: 'Jane <b>Doe</b>', clientEmail: 'jane@example.com', invoiceNumber: '1042', paid: false, total: 150 },
      ]));
    },
  });
  const { window } = dom;

  let capturedOnLongPress = null;
  window.attachLongPress = (container, selector, onLongPress) => { if (container.id === 'invoiceLogList') capturedOnLongPress = onLongPress; };
  let sheetTitle = null, sheetActions = null;
  window.showQuickActionSheet = (title, actions) => { sheetTitle = title; sheetActions = actions; };
  window.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  window.money = (n) => '$' + Number(n).toFixed(2);
  let resendId = null, toggledId = null, deletedId = null;
  window.resendInvoiceToClient = (id) => { resendId = id; };
  window.toggleInvoicePaid = (id) => { toggledId = id; };
  window.deleteInvoiceLogEntry = (id) => { deletedId = id; };

  window.initInvoiceLogLongPress();
  assert.ok(capturedOnLongPress, 'attachLongPress should have been called with a real callback');

  const row = window.document.createElement('div');
  row.dataset.invoiceId = '42';
  capturedOnLongPress(row);

  assert.equal(sheetTitle, 'Jane &lt;b&gt;Doe&lt;/b&gt; \u00b7 #1042 \u00b7 $150.00');
  assert.deepEqual(Array.from(sheetActions, a => a.label), ['Mark Paid', 'Resend to client', 'Delete'], 'no client in the registry and no job: no Open client / Open job');
  sheetActions[0].onClick();
  assert.equal(toggledId, 42);
  sheetActions[1].onClick();
  assert.equal(resendId, 42);
  sheetActions[2].onClick();
  assert.equal(deletedId, 42);
});

// --- round 3 (2026-09-22, same day): the remaining real haptic gaps + voice dictation ---

test('invoice-generator.html: showSuccess (Quick Charge) fires a success haptic -- the highest-frequency "money in hand" moment in the suite was silent even though its siblings (mark paid, invoice/estimate logged) already fire one', () => {
  const fn = invoiceGenHtml.match(/function showSuccess\(amount\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(typeof haptic === 'function'\) haptic\('success'\);/);
  // Both real callers (chargeSavedCard's success path and the Stripe
  // confirmPayment success branch) go through this one function, so a
  // single call here covers both without touching either call site.
  assert.match(invoiceGenHtml, /showSuccess\(fields\.amount\);/);
  assert.match(invoiceGenHtml, /showSuccess\(parseFloat\(document\.getElementById\('posAmount'\)\.value\)\);/);
});

test('review-request.html: logSentRequest fires a success haptic once, covering both the SMS and Copy Message send paths that funnel through it', () => {
  const fn = reviewRequestHtml.match(/function logSentRequest\(method\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(typeof haptic === 'function'\) haptic\('success'\);/);
});

test('review-request.html: setRequestStatus fires a success haptic only for the positive outcome (received/left a review), not for the neutral no_response update', () => {
  const fn = reviewRequestHtml.match(/function setRequestStatus\(id, status\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(status === 'received' && typeof haptic === 'function'\) haptic\('success'\);/);
});

test('review-request.html: setRequestStatus behavioral check -- haptic fires for \'received\', not for \'no_response\' or \'sent\'', () => {
  const dom = new JSDOM(reviewRequestHtml, {
    runScripts: 'dangerously', url: 'https://example.com/tools/review-request.html',
    beforeParse(w) {
      w.requireAuth = () => {};
      w.localStorage.setItem('th_review_requests_log', JSON.stringify([
        { id: 1, name: 'Jane', phone: '555-1111', status: 'sent' },
      ]));
    },
  });
  const { window } = dom;
  let hapticCalls = [];
  window.haptic = (type) => hapticCalls.push(type);
  window.renderSentLog = () => {};

  window.setRequestStatus(1, 'no_response');
  assert.deepEqual(hapticCalls, [], 'no_response should not fire a haptic');

  window.setRequestStatus(1, 'received');
  assert.deepEqual(hapticCalls, ['success'], 'received should fire exactly one success haptic');
});

// --- voice dictation coverage (attachVoiceDictation, tools-media-sharing.js) ---

test('contract-generator.html: all 3 long-form scope-description textareas (PWO/STPA/LTSA) get their own mic button markup, mirroring job-tracker.html\'s existing jobNotes pattern', () => {
  for (const [fieldId, btnId] of [
    ['pwo_description', 'pwoDescriptionMicBtn'],
    ['stpa_description', 'stpaDescriptionMicBtn'],
    ['ltsa_description', 'ltsaDescriptionMicBtn'],
  ]) {
    assert.match(contractGenHtml, new RegExp(`<textarea id="${fieldId}"></textarea>`), fieldId + ' textarea');
    const btnRe = new RegExp(`<button type="button" id="${btnId}" class="voice-dictation-btn" style="display:none;"`);
    assert.match(contractGenHtml, btnRe, btnId + ' button markup');
  }
});

test('contract-generator.html: attachVoiceDictation is called for all 3 fields inside afterInitialSync, right after the existing contract-log setup', () => {
  const fn = contractGenHtml.match(/function afterInitialSync\(\)[\s\S]*?\n    \}/)[0];
  assert.match(fn, /attachVoiceDictation\('pwo_description', 'pwoDescriptionMicBtn'\);/);
  assert.match(fn, /attachVoiceDictation\('stpa_description', 'stpaDescriptionMicBtn'\);/);
  assert.match(fn, /attachVoiceDictation\('ltsa_description', 'ltsaDescriptionMicBtn'\);/);
});
