// Never miss a reply (2026-09-22). Unread counts were read once, on page
// load, so:
//   - the Request/Jobs tab badge said "reply waiting" but the page
//     opened on a blank form (or the check-up list) with the
//     conversation somewhere below;
//   - a portal left open in a tab, or returned to from the "Triple H
//     replied" email, showed stale badges until a reload;
//   - a reply landing in a conversation the client had open never
//     appeared at all.
// Now: a "Triple H replied" bar at the top of Request and Jobs,
// portalWatchUnread() re-checking on return to the tab and on a timer
// while visible, and an open thread pulling the new reply in place
// without losing a half-typed message.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const read = (...p) => fs.readFileSync(repo(...p), 'utf8');
const PORTAL_APP = read('portal', 'portal-app.js');
const WORK_ORDERS = read('portal', 'work-orders.html');
const JOBS = read('portal', 'jobs.html');
const HOME = read('portal', 'home.html');

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const isAsync = src.slice(Math.max(0, start - 6), start) === 'async ';
  return (isAsync ? 'async ' : '') + src.slice(start, i);
}
function extractConst(src, name) {
  const m = src.match(new RegExp(`const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `expected const ${name}`);
  return m[0];
}

const HELPERS = [
  'portalLoadUnreadCounts', 'portalUnreadSignature', 'portalWatchUnread', 'portalApplyNavUnreadBadges',
  'portalSyncThreadToggle', 'portalReplyNoticeHtml', 'portalThreadEscape', 'portalReplaceThreadKeepingDraft',
  'portalAutosizeComposer', 'portalOpenThreadFromNotice',
].map((n) => extractFn(PORTAL_APP, n)).join('\n') + '\n' +
  ['PORTAL_UNREAD_ACTIVE_MS', 'PORTAL_UNREAD_IDLE_MS', 'PORTAL_NAV_UNREAD_TABS'].map((n) => extractConst(PORTAL_APP, n)).join('');

function win(body = '') {
  const dom = new JSDOM('<!DOCTYPE html><body>' + body + '</body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/portal/x.html' });
  dom.window.console.warn = () => {};
  dom.window.eval(HELPERS + '\nwindow.__h = { portalLoadUnreadCounts, portalUnreadSignature, portalWatchUnread, portalSyncThreadToggle, portalReplyNoticeHtml, portalReplaceThreadKeepingDraft };');
  return dom.window;
}
const row = (type, id, n, at = '2026-09-22T19:00:00Z') => ({ thread_type: type, thread_id: id, unread_count: n, latest_unread_at: at });

// ---- shared helpers ----

test('a background check can tell "could not check" from "nothing unread"', async () => {
  const { __h } = win();
  const erroring = { rpc: async () => ({ data: null, error: { message: 'x' } }) };
  const throwing = { rpc: async () => { throw new Error('offline'); } };
  assert.equal(await __h.portalLoadUnreadCounts(erroring, { nullOnError: true }), null);
  assert.equal(await __h.portalLoadUnreadCounts(throwing, { nullOnError: true }), null);
  assert.equal((await __h.portalLoadUnreadCounts(erroring)).length, 0, 'default callers still get []');
});

test('the signature ignores order and zero counts, and changes on a new reply', () => {
  const { __h } = win();
  const a = [row('job', 2, 1), row('work_order', 1, 2)];
  assert.equal(__h.portalUnreadSignature(a), __h.portalUnreadSignature([a[1], a[0], row('job', 9, 0)]));
  assert.notEqual(__h.portalUnreadSignature(a), __h.portalUnreadSignature([row('job', 2, 1), row('work_order', 1, 3)]));
  assert.equal(__h.portalUnreadSignature([]), '');
});

test('the watcher reports only real changes -- never a failed check, never while the tab is hidden', async () => {
  const w = win();
  let answer = [row('work_order', 1, 2)];
  let fail = false;
  const client = { rpc: async () => (fail ? { data: null, error: { message: 'blip' } } : { data: answer, error: null }) };
  const seen = [];
  const watcher = w.__h.portalWatchUnread(client, (rows) => seen.push(rows), { baseline: answer });
  try {
    await watcher.check();
    assert.equal(seen.length, 0, 'same as the baseline -- nothing to report');
    answer = [row('work_order', 1, 3)];
    fail = true;
    await watcher.check();
    assert.equal(seen.length, 0, 'a failed check must not wipe the badges');
    fail = false;
    Object.defineProperty(w.document, 'visibilityState', { value: 'hidden', configurable: true });
    await watcher.check();
    assert.equal(seen.length, 0, 'no checks while nobody is looking');
    Object.defineProperty(w.document, 'visibilityState', { value: 'visible', configurable: true });
    await watcher.check();
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0].unread_count, 3);
    watcher.setBaseline([]);
    await watcher.check();
    assert.equal(seen.length, 2, 'setBaseline resets what counts as already known');
  } finally {
    watcher.stop();
    w.close();
  }
});

test('the watcher checks more often while a conversation is open, and on return to the tab', () => {
  const fn = extractFn(PORTAL_APP, 'portalWatchUnread');
  assert.match(PORTAL_APP, /const PORTAL_UNREAD_ACTIVE_MS = 20000;/);
  assert.match(PORTAL_APP, /const PORTAL_UNREAD_IDLE_MS = 90000;/);
  assert.match(fn, /const gap = isActive\(\) \? PORTAL_UNREAD_ACTIVE_MS : PORTAL_UNREAD_IDLE_MS;/);
  assert.match(fn, /addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'visible'\) onReturn\(\); \}\)/);
  assert.match(fn, /window\.addEventListener\('focus', onReturn\);/);
  assert.match(fn, /portalLoadUnreadCounts\(supabaseClient, \{ nullOnError: true \}\)/);
});

test('a Messages button gains and loses its pill as the count changes', () => {
  const w = win('<button class="portal-thread-toggle">Messages</button>');
  const btn = w.document.querySelector('button');
  w.__h.portalSyncThreadToggle(btn, 'woUnread-5', 2);
  assert.ok(btn.classList.contains('has-unread'));
  assert.equal(w.document.getElementById('woUnread-5').textContent, '2 new');
  w.__h.portalSyncThreadToggle(btn, 'woUnread-5', 3);
  assert.equal(w.document.querySelectorAll('.portal-unread-pill').length, 1, 'updated in place, not duplicated');
  assert.equal(w.document.getElementById('woUnread-5').textContent, '3 new');
  w.__h.portalSyncThreadToggle(btn, 'woUnread-5', 0);
  assert.ok(!btn.classList.contains('has-unread'));
  assert.equal(w.document.getElementById('woUnread-5'), null);
});

test('the notice: one row per conversation, heading counts messages, capped at three, titles escaped', () => {
  const { __h } = win();
  assert.equal(__h.portalReplyNoticeHtml([]), '');
  assert.equal(__h.portalReplyNoticeHtml([{ title: 'x', count: 0, action: 'f()' }]), '');
  const one = __h.portalReplyNoticeHtml([{ title: 'Leaky faucet', count: 1, action: 'openWoThreadFromNotice(3)' }]);
  assert.match(one, /Triple H replied<\/div>/);
  assert.match(one, /onclick="openWoThreadFromNotice\(3\)"/);
  const many = __h.portalReplyNoticeHtml([1, 2, 3, 4].map((n) => ({ title: 'Job ' + n, count: n, action: 'f(' + n + ')' })));
  assert.match(many, /Triple H replied · 10 new messages/);
  assert.equal((many.match(/portal-reply-notice-item/g) || []).length, 3);
  assert.match(many, /\+ 1 more below/);
  const evil = __h.portalReplyNoticeHtml([{ title: '<img src=x onerror=alert(1)>', count: 1, action: 'f(1)' }]);
  assert.doesNotMatch(evil, /<img/);
  assert.match(evil, /&lt;img/);
});

test('a background re-render keeps the half-typed message and the cursor; it waits out a send in flight', () => {
  const w = win('<div id="panel"><textarea id="msg"></textarea></div>');
  const panel = w.document.getElementById('panel');
  const input = w.document.getElementById('msg');
  input.value = 'Thursday works, but';
  input.focus();
  assert.equal(w.__h.portalReplaceThreadKeepingDraft(panel, 'msg', '<p>new reply</p><textarea id="msg"></textarea>'), true);
  const fresh = w.document.getElementById('msg');
  assert.notEqual(fresh, input, 'the thread really was re-rendered');
  assert.equal(fresh.value, 'Thursday works, but');
  assert.equal(w.document.activeElement, fresh);
  fresh.disabled = true;
  assert.equal(w.__h.portalReplaceThreadKeepingDraft(panel, 'msg', '<p>x</p>'), false);
  assert.ok(w.document.getElementById('msg'), 'left alone while sending');
});

// ---- Request page, driven for real ----

function workOrdersPage() {
  const cards = [31, 32].map((id) =>
    `<div class="wo-card" id="wo-card-${id}"><button class="portal-thread-toggle" aria-expanded="false">Messages</button><div id="woMessages-${id}" style="display:none;"></div></div>`).join('');
  const w = win('<nav class="portal-nav"><a href="/portal/work-orders.html">Request</a><a href="/portal/jobs.html">Jobs</a></nav><div id="replyNotice"></div>' + cards);
  w.Element.prototype.scrollIntoView = function () {};
  w.matchMedia = () => ({ matches: false });
  const fns = ['woThreadIsOpen', 'renderWoReplyNotice', 'openWoThreadFromNotice', 'applyWoUnreadRows', 'clearWoUnread'].map((n) => extractFn(WORK_ORDERS, n)).join('\n');
  w.eval(`
    var woUnreadCounts = {}, unreadRows = [], woUnreadWatcher = null;
    var woRequestTitles = { 31: "Dishwasher won't drain", 32: 'Garage door' };
    var calls = { reload: [], toggle: [] };
    function loadAndRenderThread(id, opts) { calls.reload.push([id, opts]); }
    function toggleMessages(id, btn) { calls.toggle.push(id); document.getElementById('woMessages-' + id).style.display = 'block'; btn.setAttribute('aria-expanded', 'true'); }
    ${fns}
    window.__wo = { get counts() { return woUnreadCounts; }, calls, applyWoUnreadRows, clearWoUnread, renderWoReplyNotice };
  `);
  return w;
}

test('Request: a reply shows at the top of the page, newest first, with the pill on its card and the nav badge', () => {
  const w = workOrdersPage();
  w.__wo.applyWoUnreadRows([row('work_order', 32, 1, '2026-09-22T10:00:00Z'), row('work_order', 31, 2, '2026-09-22T12:00:00Z')]);
  const items = Array.from(w.document.querySelectorAll('#replyNotice .portal-reply-notice-about'), (e) => e.textContent);
  assert.deepEqual(items, ["Dishwasher won't drain", 'Garage door']);
  assert.equal(w.document.getElementById('woUnread-31').textContent, '2 new');
  assert.equal(w.document.querySelector('.portal-nav a[href="/portal/work-orders.html"] .portal-nav-badge').textContent, '3');
  assert.equal(w.__wo.calls.reload.length, 0, 'nothing open, nothing to reload');
});

test('Request: tapping a row opens that conversation, and it leaves the notice once read', () => {
  const w = workOrdersPage();
  w.__wo.applyWoUnreadRows([row('work_order', 31, 2)]);
  // Inline handlers don't run under runScripts: 'outside-only', so run
  // the row's own onclick exactly as the browser would.
  const rowBtn = w.document.querySelector('.portal-reply-notice-item');
  assert.equal(rowBtn.getAttribute('onclick'), 'openWoThreadFromNotice(31)');
  w.eval(rowBtn.getAttribute('onclick'));
  assert.deepEqual(Array.from(w.__wo.calls.toggle), [31]);
  w.__wo.clearWoUnread(31); // what loadAndRenderThread does once it has marked it read
  assert.equal(w.document.getElementById('replyNotice').innerHTML, '');
  assert.equal(w.document.querySelector('.portal-nav-badge'), null);
});

test('Request: a reply to the conversation that is open refreshes it in place, quietly, instead of a pill or notice', () => {
  const w = workOrdersPage();
  w.document.getElementById('woMessages-31').style.display = 'block';
  w.__wo.applyWoUnreadRows([row('work_order', 31, 1)]);
  assert.equal(w.__wo.calls.reload.length, 1);
  assert.equal(w.__wo.calls.reload[0][0], 31);
  assert.equal(w.__wo.calls.reload[0][1].quiet, true);
  assert.equal(w.document.getElementById('woUnread-31'), null, 'no pill on a thread already on screen');
  assert.equal(w.document.getElementById('replyNotice').innerHTML, '', 'and no notice pointing at it');
  assert.equal(w.__wo.counts[31], 1, 'but the count stays so the reload draws the New divider and marks it read');
});

// ---- wiring on both thread pages ----

for (const [name, src, prefix, loadFn, sendFn, listFn, watchFn, noticeFn] of [
  ['work-orders', WORK_ORDERS, 'wo', 'loadAndRenderThread', 'sendMessage', 'renderMyRequests', 'watchWoUnread', 'renderWoReplyNotice'],
  ['jobs', JOBS, 'job', 'loadAndRenderJobThread', 'sendJobMessage', 'renderJobs', 'watchJobUnread', 'renderJobReplyNotice'],
]) {
  test(`${name}: the notice sits above the page's columns, and the list render starts the watcher once`, () => {
    assert.ok(src.indexOf('<div id="replyNotice" aria-live="polite"></div>') < src.indexOf('<div class="page-split'), 'above the page split');
    const list = extractFn(src, listFn);
    assert.match(list, new RegExp(`${watchFn}\\(\\);\\s*${noticeFn}\\(\\);`));
    const watch = extractFn(src, watchFn);
    assert.match(watch, /if \(\w+UnreadWatcher\) \{ \w+UnreadWatcher\.setBaseline\(unreadRows\); return; \}/);
    assert.match(watch, /isActive: \(\) => Object\.keys\(\w+\)\.some\(\w+ThreadIsOpen\)/);
  });

  test(`${name}: a quiet reload skips the skeleton and keeps the draft; a send still reloads normally`, () => {
    const load = extractFn(src, loadFn);
    assert.match(load, /if \(!quiet\) panel\.innerHTML = portalSkeletonLines\(2\);/);
    assert.match(load, /if \(!portalReplaceThreadKeepingDraft\(panel, '\w+MessageInput-' \+ \w+, html\)\) return;/);
    assert.match(extractFn(src, sendFn), new RegExp(`await ${loadFn}\\(\\w+\\);`));
  });

  test(`${name}: marking a thread read clears it from the notice and from what the watcher already knows`, () => {
    const clear = extractFn(src, prefix === 'wo' ? 'clearWoUnread' : 'clearJobUnread');
    assert.match(clear, new RegExp(`${noticeFn}\\(\\);`));
    assert.match(clear, /UnreadWatcher\.setBaseline\(unreadRows\);/);
  });
}

// ---- Home and the badge-only pages ----

test('Home keeps its "New message" item, card counts and badges current while it sits open', () => {
  const fn = extractFn(HOME, 'watchHomeUnread');
  assert.match(fn, /homeSummary\.unread = rows;\s*renderAttention\(homeSummary\);\s*renderCards\(homeSummary\);\s*portalApplyNavUnreadBadges\(rows\);/);
  assert.match(fn, /if \(homeUnreadWatcher\) \{ homeUnreadWatcher\.setBaseline\(summary\.unread\); return; \}/);
  assert.match(extractFn(HOME, 'init'), /watchHomeUnread\(summary\);/);
});

test('Quotes, Invoices, Contracts and Settings keep their nav badges current too, with one shared watcher', () => {
  for (const page of ['quotes', 'dashboard', 'contracts', 'settings']) {
    assert.match(read('portal', page + '.html'), /portalStartUnreadBadges\(client\);/, page);
  }
  const fn = extractFn(PORTAL_APP, 'portalStartUnreadBadges');
  assert.match(fn, /if \(!portalNavUnreadWatcher\) portalNavUnreadWatcher = portalWatchUnread\(supabaseClient, portalApplyNavUnreadBadges, \{ baseline: rows \}\);/);
});
