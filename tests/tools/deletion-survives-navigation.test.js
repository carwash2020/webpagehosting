// Handoff 2026-11-03 §4B: deletions silently reverted. Every delete in the
// Workspace waits out a 6-second Undo window on a setTimeout before it
// really happens; leaving the page inside that window (pagehide) or the
// app going to the background killed the timer, so the record came back.
// A delete must persist regardless of navigation: leaving now finishes
// every pending delete at once, and syncs it, instead of dropping it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { installDataLayer } = require('../data-layer-harness');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const MEDIA = read('tools-media-sharing.js');

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
const DEFER_SRC = () => {
  const start = MEDIA.indexOf('// ---- Deferred deletes');
  const end = MEDIA.indexOf('// ---- end deferred deletes');
  assert.ok(start >= 0 && end > start, 'tools-media-sharing.js has the deferred-delete block');
  return MEDIA.slice(start, end);
};

function sandbox() {
  const listeners = {};
  const docListeners = {};
  const timers = new Map();
  let nextId = 1;
  const calls = { flushSyncNow: 0, dismissed: 0 };
  const ctx = {
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    console,
    flushSyncNow: () => { calls.flushSyncNow++; },
    dismissToast: () => { calls.dismissed++; },
    window: { addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } },
    document: {
      visibilityState: 'visible',
      addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
      querySelectorAll: () => [{}, {}],
    },
  };
  vm.createContext(ctx);
  vm.runInContext(DEFER_SRC(), ctx);
  return {
    ctx, timers, calls,
    fire: (t) => (listeners[t] || []).forEach((fn) => fn({})),
    hide: () => { ctx.document.visibilityState = 'hidden'; (docListeners.visibilitychange || []).forEach((fn) => fn({})); },
  };
}

test('a pending delete still runs on its own after the Undo window', () => {
  const s = sandbox();
  let ran = 0;
  s.ctx.thDeferDelete(() => { ran++; }, 6000);
  const [[, t]] = [...s.timers];
  assert.equal(t.ms, 6000);
  t.fn();
  assert.equal(ran, 1);
  s.fire('pagehide');
  assert.equal(ran, 1, 'not run a second time');
});

test('leaving the page finishes every pending delete at once, syncs, and clears the Undo toasts', () => {
  const s = sandbox();
  const ran = [];
  s.ctx.thDeferDelete(() => ran.push('a'), 6000);
  s.ctx.thDeferDelete(() => ran.push('b'), 6000);
  s.fire('pagehide');
  assert.deepEqual(ran, ['a', 'b']);
  assert.equal(s.timers.size, 0, 'their timers are gone');
  assert.equal(s.calls.flushSyncNow, 1, 'the deletes are pushed now, not after a sync debounce the page will never reach');
  assert.equal(s.calls.dismissed, 2, 'an Undo button that can no longer undo is not left on screen');
});

test('the app going to the background finishes them too (a phone may never send pagehide)', () => {
  const s = sandbox();
  let ran = 0;
  s.ctx.thDeferDelete(() => { ran++; }, 6000);
  s.hide();
  assert.equal(ran, 1);
});

test('Undo cancels for good: a cancelled delete never runs, not even on leaving', () => {
  const s = sandbox();
  let ran = 0;
  const handle = s.ctx.thDeferDelete(() => { ran++; }, 6000);
  s.ctx.thCancelDeferredDelete(handle);
  s.fire('pagehide');
  assert.equal(ran, 0);
  assert.equal(s.timers.size, 0);
  assert.equal(s.calls.flushSyncNow, 0, 'nothing pending, nothing to push');
});

test('every Workspace delete with an Undo window goes through thDeferDelete, and every Undo through thCancelDeferredDelete', () => {
  for (const f of ['invoice-generator.html', 'job-tracker.html', 'finance.html', 'contract-generator.html', 'workspace.html']) {
    const src = read(f);
    const deferred = (src.match(/thDeferDelete\(/g) || []).length;
    assert.ok(deferred > 0, f + ' uses thDeferDelete');
    assert.doesNotMatch(src, /setTimeout\((async )?\(\) => \{\s*(idsToDelete\.forEach\(id => )?pendingDelete\w+\.delete/, f + ' has no bare setTimeout delete left');
    assert.doesNotMatch(src, /clearTimeout\(pendingDelete\w+\.get\(id\)\)/, f + ' undo cancels through thCancelDeferredDelete');
  }
});

test('finalizers do their local removal before any await, so a delete finished on the way out is not cut short', () => {
  const JT = read('job-tracker.html');
  const FIN = read('finance.html');
  const single = extractFn(JT, 'deleteJob');
  assert.ok(single.indexOf('thJobs.remove(id);') < single.indexOf('await fetchJobPhotos(id)'), 'single job: removed before photo cleanup');
  const bulkStart = JT.indexOf('idsToDelete.forEach(id => pendingDeleteJobIds.delete(id));');
  const bulk = JT.slice(bulkStart, JT.indexOf('}, 6000);', bulkStart));
  assert.ok(bulk.indexOf('saveJobs(allJobs.filter') < bulk.indexOf('await fetchJobPhotos(id)'), 'bulk jobs: removed before photo cleanup');
  const exp = FIN.slice(FIN.indexOf('pendingDeleteExpenseIds.delete(id);'), FIN.indexOf('pendingDeleteExpenseIds.set(id, timer);'));
  assert.ok(exp.indexOf('saveExpenses(entries.filter') < exp.indexOf('await deleteReceipt('), 'expense: removed before receipt cleanup');
  const SYNC = read('sync.js');
  for (const fn of ['deleteLead', 'deleteJobApplication']) {
    assert.match(extractFn(SYNC, fn), /keepalive: true/, fn + ' survives the page closing');
  }
});

test('invoice: delete, then navigate away immediately -- the invoice stays deleted', async () => {
  const INV = read('invoice-generator.html');
  const dom = new JSDOM(INV, {
    runScripts: 'dangerously', url: 'https://example.com/tools/invoice-generator.html',
    beforeParse(w) {
      installDataLayer(w);
      w.requireAuth = () => {};
      w.canManageInvoices = () => true;
      w.localStorage.setItem('th_invoices', JSON.stringify([{ id: 7, invoiceNumber: 'INV-TEST-7', clientName: 'TEST', total: 10, date: '2026-11-03' }]));
      w.localStorage.setItem('th_quotes', '[]');
    },
  });
  const w = dom.window;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  Object.assign(w, {
    escapeHtml: esc, escapeAttr: (s) => esc(s).replace(/"/g, '&quot;'), money: (n) => '$' + (Number(n) || 0).toFixed(2), personDot: () => '',
    showToast: () => {}, haptic: () => {}, scheduleSync: () => {}, todayDateStrBusinessTz: () => '2026-11-03',
    showConfirm: async () => true, animateRowExit: (el, cb) => cb(), showUndoToast: () => {}, dismissToast: () => {},
  });
  await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', r)));
  w.eval(DEFER_SRC());
  await w.deleteInvoiceLogEntry(7);
  assert.equal(JSON.parse(w.localStorage.getItem('th_invoices')).length, 1, 'still inside the Undo window');
  w.dispatchEvent(new w.Event('pagehide'));
  assert.deepEqual(JSON.parse(w.localStorage.getItem('th_invoices')), [], 'navigating away did not bring it back');
  w.close();
});
