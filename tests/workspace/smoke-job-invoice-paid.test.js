// CI smoke test (code-health pass, 2026-09-08): drives the core business
// write path end-to-end -- add a job, invoice it, mark the invoice paid --
// across the three real tool pages that actually implement it
// (job-tracker.html, invoice-generator.html, workspace.html), calling the
// real functions each page's own UI calls, not a reimplementation of them.
//
// This is deliberately a different kind of test than the hundreds of
// per-function unit tests already in this suite. Both real production
// incidents on record for this project (the invoice-generator TDZ crash
// that silently broke every invoice/quote for an unknown period, and the
// th_leads RLS policy that silently dropped every public lead submission)
// were exactly the class of bug that unit tests of individual functions
// missed, because each individual piece worked fine in isolation -- only
// actually driving the full flow end-to-end would have caught them before
// a live incident did. This test is that regression net, not a replacement
// for the existing focused tests.
//
// "Same device, same localStorage" is simulated by copying the relevant
// synced key's JSON from one page's jsdom window into the next page's
// jsdom window before loading it -- each real tool page is still its own
// separate HTML document/script context (as it is in a real browser too),
// so this is the correct boundary to simulate across, not a shortcut.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const TOOLS_DIR = path.join(__dirname, '..', '..', 'tools');
// window.eval()'d const/function declarations create bindings in the
// realm's global lexical scope, but that's NOT the same as becoming an
// enumerable window property -- generatePDF()'s bare references to these
// names (once it's running as this window's own real parsed <script>,
// not itself eval'd) need the latter. Explicit window.X = X assignments,
// same fix already used elsewhere in this suite (see finance-split.test.js).
const PDF_LAYOUT_SRC = fs.readFileSync(path.join(TOOLS_DIR, 'pdf-layout.js'), 'utf8')
  + '\nwindow.PDF_COLORS = PDF_COLORS; window.pdfLoadImageAsDataURL = pdfLoadImageAsDataURL; window.drawPdfHeader = drawPdfHeader; window.drawPdfLineItemsTable = drawPdfLineItemsTable; window.drawPdfTotalsBlock = drawPdfTotalsBlock; window.drawPdfTotalHighlight = drawPdfTotalHighlight; window.drawPdfFooter = drawPdfFooter; window.pdfWrapAndDraw = pdfWrapAndDraw;';

const SHARED_SCRIPTS = [
  'data-layer.js', 'sync.js', 'tools-dialogs.js', 'tools-effects.js',
  'tools-media-sharing.js', 'tools-nav-pwa.js', 'tools-tour.js',
];

function injectSharedScripts(window) {
  for (const name of SHARED_SCRIPTS) {
    const src = fs.readFileSync(path.join(TOOLS_DIR, name), 'utf8');
    const s = window.document.createElement('script');
    s.textContent = src;
    window.document.head.appendChild(s);
  }
}

function commonStubs(window) {
  // sync.js (loaded on every tool page) references these two globals,
  // normally defined by auth.js -- not loaded here since real auth.js
  // pulls in the real Supabase JS SDK. isSyncConfigured() just checks
  // neither starts with 'PASTE_', so any non-matching string is enough
  // to let scheduleSync()/pushSync() proceed down their normal code path
  // (itself made harmless by the fetch stub below).
  window.SUPABASE_URL = 'https://example-project.supabase.co';
  window.SUPABASE_ANON_KEY = 'fake-anon-key';
  window.requireAuth = () => {};
  window.getCurrentUserEmail = () => 'connor@triplehenterprisesllc.biz';
  window.getAuthToken = () => 'fake-token';
  window.ensureFreshToken = async () => true;
  window.pullSync = () => Promise.resolve({ ok: false });
  window.initSyncOnLoad = () => Promise.resolve();
  // Real supabase-js loads from a CDN <script> tag jsdom never fetches
  // (no `resources` option set) -- startRealtimeSync/startLeadsRealtime
  // would otherwise try a real WebSocket connection/retry loop with
  // timers that outlive the test and hang the process. Each page's own
  // logic being live-synced is exercised by its own dedicated tests
  // elsewhere; this smoke test is about the write path, not realtime.
  window.startRealtimeSync = () => {};
  window.startLeadsRealtime = () => {};
  // scheduleSync()'s 2.5s debounce timer is a real Node timer that
  // window.close() does not cancel (jsdom windows share the process's
  // global timer queue) -- letting it fire would call the real pushSync(),
  // which now (per the sync-merge fix) makes an extra GET plus a POST,
  // each through fetchWithRetry's real (non-stubbed) backoff delays on a
  // failing fetch. Stubbed out entirely: this test is about the write
  // path landing correctly in localStorage, not the debounced push
  // eventually succeeding/retrying, which tests/sync/* already covers.
  window.scheduleSync = () => {};
  window.scheduleWikiSync = () => {};
  window.fetch = async () => ({ ok: false, status: 500, text: async () => '', json: async () => ({}) });
  window.logClientError = () => {};
  window.showToast = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  // workspace.html's Dashboard metrics animate their count-up via
  // requestAnimationFrame, not provided by jsdom -- a synchronous,
  // immediate-callback stub is enough for the write path this test cares
  // about (it doesn't assert anything about the animation itself).
  window.requestAnimationFrame = (cb) => cb();
  window.cancelAnimationFrame = () => {};
}

function makeFakeJsPdfInstance() {
  const inst = {
    internal: { pageSize: { getWidth: () => 612, getHeight: () => 792 }, getNumberOfPages: () => 1 },
    setFillColor() { return inst; }, setDrawColor() { return inst; }, setLineWidth() { return inst; },
    setFont() { return inst; }, setFontSize() { return inst; }, setTextColor() { return inst; },
    rect() { return inst; }, line() { return inst; }, roundedRect() { return inst; }, circle() { return inst; },
    text() { return inst; }, addImage() { return inst; }, addPage() { return inst; }, setPage() { return inst; },
    getTextWidth: () => 10,
    splitTextToSize: (t) => [String(t)],
    output: () => new Blob(['fake pdf bytes'], { type: 'application/pdf' }),
    save() {},
  };
  return inst;
}

test('smoke: add a job (job-tracker.html) -> invoice it, linked to that job (invoice-generator.html) -> mark the invoice paid (workspace.html)', async () => {
  // --- Stage 1: add a real job, via the real Add Job form + addJob() ---
  const jobTrackerHtml = fs.readFileSync(path.join(TOOLS_DIR, 'job-tracker.html'), 'utf8');
  const jtDom = new JSDOM(jobTrackerHtml, {
    runScripts: 'dangerously', url: 'https://example.com/tools/job-tracker.html',
    beforeParse(w) {
      commonStubs(w);
      w.HTMLCanvasElement.prototype.getContext = () => ({
        setTransform(){}, scale(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, fillRect(){}, arc(){}, arcTo(){}, closePath(){}, createLinearGradient(){ return { addColorStop(){} }; }, setLineDash(){},
      });
    },
  });
  const jtWindow = jtDom.window;
  injectSharedScripts(jtWindow);
  jtWindow.document.dispatchEvent(new jtWindow.Event('DOMContentLoaded'));
  // Re-stubbed AFTER the shared scripts load -- tools-effects.js defines
  // its own real showToast() (which calls requestAnimationFrame, not
  // available in jsdom), overwriting whatever was set in beforeParse.
  jtWindow.showToast = () => {};
  jtWindow.startRealtimeSync = () => {};
  jtWindow.startLeadsRealtime = () => {};
  jtWindow.scheduleSync = () => {};
  jtWindow.scheduleWikiSync = () => {};

  jtWindow.document.getElementById('jobTitle').value = 'Smoke-test dryer repair';
  jtWindow.document.getElementById('jobClient').value = 'Smoke Test Client';
  jtWindow.document.getElementById('jobPhone').value = '555-000-1234';
  jtWindow.document.getElementById('jobAddress').value = '1 Smoke Test Way';
  await jtWindow.addJob();

  const jobsAfterAdd = JSON.parse(jtWindow.localStorage.getItem('th_tracker_jobs') || '[]');
  assert.equal(jobsAfterAdd.length, 1, 'expected exactly one job after addJob()');
  const job = jobsAfterAdd[0];
  assert.equal(job.title, 'Smoke-test dryer repair');
  assert.equal(job.client, 'Smoke Test Client');
  jtWindow.close();

  // --- Stage 2: invoice that job, via the real invoice form + generatePDF() ---
  const invoiceGenHtml = fs.readFileSync(path.join(TOOLS_DIR, 'invoice-generator.html'), 'utf8');
  const igDom = new JSDOM(invoiceGenHtml, {
    runScripts: 'dangerously', url: 'https://example.com/tools/invoice-generator.html',
    beforeParse(w) {
      commonStubs(w);
      w.eval(PDF_LAYOUT_SRC);
      w.showConfirm = () => Promise.resolve(true);
      w.showAlert = async () => {};
      w.thEnsureClient = () => null;
      w.wireSearchClear = () => {};
      w.attachVoiceDictation = () => {};
      w.money = (n) => '$' + (Number(n) || 0).toFixed(2);
      w.escapeHtml = (s) => String(s == null ? '' : s);
      w.escapeForInlineHandler = (s) => String(s == null ? '' : s);
      w.personDot = () => '';
      w.jspdf = { jsPDF: function FakeJsPdf() { return makeFakeJsPdfInstance(); } };
      // Same device, same localStorage: this is the job Stage 1 just created.
      w.localStorage.setItem('th_tracker_jobs', JSON.stringify(jobsAfterAdd));
    },
  });
  const igWindow = igDom.window;
  injectSharedScripts(igWindow);
  igWindow.document.dispatchEvent(new igWindow.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 100));
  igWindow.showToast = () => {};
  igWindow.startRealtimeSync = () => {};
  igWindow.startLeadsRealtime = () => {};
  igWindow.scheduleSync = () => {};
  igWindow.scheduleWikiSync = () => {};
  igWindow.personDot = () => ''; // re-applied after shared scripts, same reasoning as showToast above

  // Real "link to job" dropdown, populated from th_tracker_jobs -- the
  // exact mechanism the Job Profitability feature depends on, and the
  // reason this test invoices a real linked job rather than a bare one.
  igWindow.populateJobRefOptions();
  igWindow.document.getElementById('invoiceJobRef').value = String(job.id);
  assert.equal(igWindow.document.getElementById('invoiceJobRef').value, String(job.id), 'the job should be a real, selectable option in the dropdown -- not just an unmatched value silently ignored by the <select>');

  igWindow.document.getElementById('clientName').value = 'Smoke Test Client';
  igWindow.document.getElementById('invoiceNumber').value = 'INV-SMOKE-0001';
  // A real, nonzero line item -- a $0 invoice can never resolve to "paid"
  // (invoicePaymentStatus() in workspace.html requires totalCents > 0),
  // and a real invoice always has at least one line item anyway.
  igWindow.addLineItem('Dryer repair labor', '', 1, 150, false, 'labor', false);

  let threw = null;
  try {
    await igWindow.generatePDF({ send: false });
  } catch (e) {
    threw = e;
  }
  assert.equal(threw, null, 'generatePDF() must not throw: ' + (threw && threw.message));

  const invoicesAfterGenerate = JSON.parse(igWindow.localStorage.getItem('th_invoices') || '[]');
  assert.equal(invoicesAfterGenerate.length, 1, 'expected exactly one logged invoice');
  const invoice = invoicesAfterGenerate[0];
  assert.equal(invoice.invoiceNumber, 'INV-SMOKE-0001');
  assert.equal(invoice.jobRefId, String(job.id), 'the invoice should carry the real job link, not an empty/default one');
  assert.equal(invoice.jobRefTitle, job.title);
  assert.equal(invoice.paid, false, 'a freshly generated invoice should start unpaid');
  assert.equal(Number(invoice.total), 150, 'the line item added above should be reflected in the real total');
  await new Promise(resolve => setTimeout(resolve, 150)); // let resetInvoiceForm()'s fire-and-forget assignNextNumber() settle before closing, same as the existing regression test for this exact page
  igWindow.close();

  // --- Stage 3: mark that invoice paid, via the real Dashboard + togglePaid() ---
  const workspaceHtml = fs.readFileSync(path.join(TOOLS_DIR, 'workspace.html'), 'utf8');
  const wsDom = new JSDOM(workspaceHtml, {
    runScripts: 'dangerously', url: 'https://example.com/tools/workspace.html',
    beforeParse(w) {
      commonStubs(w);
      w.showConfirm = () => Promise.resolve(true);
      w.showAlert = async () => {};
      w.escapeHtml = (s) => String(s == null ? '' : s);
      w.money = (n) => '$' + (Number(n) || 0).toFixed(2);
      w.personDot = () => '';
      // Real total from Stage 2 -- prompt() is native and asks for the
      // amount actually paid; answering with the invoice's own total is
      // what a real "mark fully paid" tap does.
      w.prompt = () => String(invoice.total);
      // Same device, same localStorage, one step further along.
      w.localStorage.setItem('th_invoices', JSON.stringify(invoicesAfterGenerate));
    },
  });
  const wsWindow = wsDom.window;
  injectSharedScripts(wsWindow);
  wsWindow.document.dispatchEvent(new wsWindow.Event('DOMContentLoaded'));
  wsWindow.showToast = () => {};
  wsWindow.startRealtimeSync = () => {};
  wsWindow.startLeadsRealtime = () => {};
  wsWindow.scheduleSync = () => {};
  wsWindow.scheduleWikiSync = () => {};
  wsWindow.personDot = () => '';
  wsWindow.prompt = () => String(invoice.total); // re-applied after shared scripts, same reasoning as showToast above

  await wsWindow.togglePaid(invoice.id);

  const invoicesAfterPaid = JSON.parse(wsWindow.localStorage.getItem('th_invoices') || '[]');
  assert.equal(invoicesAfterPaid.length, 1, 'togglePaid() should never add or remove an invoice, only update the one being toggled');
  const paidInvoice = invoicesAfterPaid[0];
  assert.equal(paidInvoice.id, invoice.id);
  assert.equal(paidInvoice.paid, true, 'the invoice should now be marked paid');
  assert.equal(Number(paidInvoice.paidAmount), Number(invoice.total), 'the paid amount should match what was actually entered');
  assert.equal(paidInvoice.jobRefId, String(job.id), 'the job link from Stage 2 should still be intact after Stage 3 -- togglePaid() should only ever touch payment fields');
  wsWindow.close();
});
