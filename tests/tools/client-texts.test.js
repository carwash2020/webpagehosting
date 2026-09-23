// Workspace rework part 12 (2026-09-23): texts that write themselves. The
// job's Text button, the Dashboard's On my way, and the Jobs sheet open one
// sheet with the texts the job calls for -- On my way (with a time),
// Running late, Confirm the visit, Parts run, All done -- to edit and send
// from the phone's own Messages. Each one sent is logged on the job.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const NAV = read('tools-nav-pwa.js');
const WS = read('workspace.html');
const JD = read('job-detail.html');
const JT = read('job-tracker.html');
const CSS = read('styles-tools.css');

function extractFn(src, name) {
  const start = src.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, 'expected function ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function dataLayer(store) {
  const mem = {};
  Object.keys(store || {}).forEach(k => { mem[k] = JSON.stringify(store[k]); });
  const ctx = {
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN,
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } },
  };
  vm.createContext(ctx);
  vm.runInContext(DL.replace(/^const /gm, 'var '), ctx);
  return { ctx, jobs: () => JSON.parse(mem.th_tracker_jobs || '[]') };
}
const NOW = new Date(2026, 8, 23, 10); // Wednesday
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const inDays = (n, base) => ymd(new Date((base || NOW).getFullYear(), (base || NOW).getMonth(), (base || NOW).getDate() + n));

test('when the visit is: today, tomorrow, a named day, or nothing for the past', () => {
  const { thJobVisitWhen } = dataLayer().ctx;
  assert.equal(thJobVisitWhen({ date: inDays(0) }, NOW), 'today');
  assert.equal(thJobVisitWhen({ date: inDays(1) }, NOW), 'tomorrow');
  assert.equal(thJobVisitWhen({ date: inDays(2) }, NOW), 'on Friday, Sep 25');
  assert.equal(thJobVisitWhen({ date: inDays(-1) }, NOW), '');
  assert.equal(thJobVisitWhen({}, NOW), '');
});

test('the texts follow the job: On my way leads today, the confirmation leads for a later day, Running late once under way, All done when done', () => {
  const { thJobTextTemplates } = dataLayer().ctx;
  const keys = (job) => Array.from(thJobTextTemplates(job, { now: NOW }), t => t.key);
  const base = { client: 'Sarah Miller', address: '123 Red Cliffs Dr, St. George, UT' };
  assert.deepEqual(keys({ ...base, status: 'not-started', date: inDays(0) }), ['onmyway', 'late', 'confirm']);
  assert.deepEqual(keys({ ...base, status: 'not-started', date: inDays(1) }), ['confirm', 'onmyway', 'late']);
  assert.deepEqual(keys({ ...base, status: 'not-started' }), ['onmyway', 'late'], 'no date, nothing to confirm');
  assert.deepEqual(keys({ ...base, status: 'in-progress', date: inDays(0) }), ['late', 'parts', 'done']);
  assert.deepEqual(keys({ ...base, status: 'done' }), ['done']);

  const by = (job, eta) => Object.fromEntries(Array.from(thJobTextTemplates(job, { now: NOW, eta }), t => [t.key, t]));
  const today = by({ ...base, status: 'not-started', date: inDays(0) }, 30);
  assert.equal(today.onmyway.body, "Hi Sarah, it's Triple H Enterprises. I'm on my way and should be there in about 30 minutes.");
  assert.equal(today.onmyway.eta, true);
  assert.equal(today.late.body, "Hi Sarah, it's Triple H Enterprises. I'm running about 30 minutes behind. Sorry about that, see you soon.");
  assert.equal(by({ ...base, status: 'not-started', date: inDays(1) }).confirm.body,
    "Hi Sarah, it's Triple H Enterprises. Just confirming your appointment tomorrow at 123 Red Cliffs Dr. Reply here if anything changes.", 'the street, not the whole address');
  assert.equal(by({ ...base, status: 'in-progress' }, 45).parts.body, "Hi Sarah, it's Triple H Enterprises. I need to pick up a part and will be back in about 45 minutes.");
  assert.equal(by({ ...base, status: 'done' }).done.body, "Hi Sarah, it's Triple H Enterprises. All done at 123 Red Cliffs Dr! Your invoice is on its way. Thanks for choosing Triple H.");
  assert.equal(by({ status: 'done' }).done.body, "Hi, it's Triple H Enterprises. All done! Your invoice is on its way. Thanks for choosing Triple H.", 'no name, no address');
  assert.match(by({ ...base, status: 'not-started' }, 99).onmyway.body, /about 20 minutes/, 'an ETA that is not offered falls back to 20');
});

test('each text sent is logged on the job (the last 20), newest last', () => {
  const dl = dataLayer({ th_tracker_jobs: [{ id: 5, title: 'Sink', texts: Array.from({ length: 20 }, (_, i) => ({ at: new Date(2026, 8, 1 + i).toISOString(), key: 'late' })) }] });
  dl.ctx.thLogJobText(5, 'onmyway', NOW);
  const job = dl.jobs()[0];
  assert.equal(job.texts.length, 20);
  assert.deepEqual(job.texts[19], { at: NOW.toISOString(), key: 'onmyway' });
  assert.equal(dl.ctx.thJobLastText(job).key, 'onmyway');
  assert.equal(dl.ctx.thJobLastText({}), null);
  assert.equal(dl.ctx.thLogJobText(999, 'late'), null);
});

// --- the sheet ---------------------------------------------------------

function page(jobs, { withDL = true } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div class="hub-header"><div class="hub-header-right"></div></div>' +
    '<a id="text" href="sms:14355550101" data-text-job="5">Text</a><a id="omw" href="sms:14355550101" data-text-job="5" data-text-kind="onmyway">On my way</a></body></html>', {
    runScripts: 'dangerously', url: 'https://example.com/tools/job-detail.html?id=5',
    beforeParse(w) {
      w.localStorage.setItem('th_tracker_jobs', JSON.stringify(jobs));
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.requestAnimationFrame = (f) => f();
      w.toasts = [];
      w.showToast = (m) => w.toasts.push(m);
    },
  });
  const w = dom.window;
  for (const src of (withDL ? [DL, NAV] : [NAV])) { const s = w.document.createElement('script'); s.textContent = src; w.document.body.appendChild(s); }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a')) e.preventDefault(); }); // no navigating in jsdom
  return w;
}
const today = () => { const d = new Date(); return ymd(d); };
const sarah = (extra) => Object.assign({ id: 5, title: 'Sink leak', client: 'Sarah Miller', phone: '435-555-0101', address: '123 Red Cliffs Dr, St. George, UT', status: 'not-started', date: today() }, extra || {});

test('Text opens the sheet: the texts for this job as chips, a time where it matters, the message to edit, then Send or Copy', () => {
  const w = page([sarah()]);
  w.document.getElementById('text').click();
  const sheet = w.document.querySelector('.th-text .th-remind-sheet');
  assert.ok(sheet);
  assert.equal(sheet.querySelector('.th-remind-title').textContent, 'Text Sarah Miller');
  assert.equal(sheet.querySelector('.th-remind-meta').textContent, 'Sink leak');
  const chips = Array.from(sheet.querySelectorAll('[data-kind]'), b => [b.textContent, b.getAttribute('aria-pressed')]);
  assert.deepEqual(chips, [['On my way', 'true'], ['Running late', 'false'], ['Confirm the visit', 'false']]);
  assert.equal(sheet.querySelector('.th-text-etas').hidden, false);
  assert.deepEqual(Array.from(sheet.querySelectorAll('[data-eta]'), b => b.getAttribute('aria-pressed')), ['false', 'true', 'false', 'false'], '20 min to start');
  const box = sheet.querySelector('.th-remind-text');
  assert.match(box.value, /about 20 minutes\.$/);
  sheet.querySelector('[data-eta="10"]').click();
  assert.match(box.value, /about 10 minutes\.$/);
  sheet.querySelector('[data-kind="confirm"]').click();
  assert.equal(sheet.querySelector('.th-text-etas').hidden, true, 'no time on a confirmation');
  assert.match(box.value, /confirming your appointment today at 123 Red Cliffs Dr/);
  sheet.querySelector('[data-kind="late"]').click();
  box.value = "Hi Sarah, running 10 behind, sorry!";
  const send = sheet.querySelector('[data-channel="text"]');
  assert.equal(send.textContent, 'Send to Sarah');
  send.click();
  assert.equal(send.getAttribute('href'), 'sms:14355550101?body=' + encodeURIComponent('Hi Sarah, running 10 behind, sorry!'));
  const job = JSON.parse(w.localStorage.getItem('th_tracker_jobs'))[0];
  assert.equal(job.texts.length, 1);
  assert.equal(job.texts[0].key, 'late');
  assert.equal(w.toasts[0], 'Running late is ready in Messages.');
  w.close();
});

test('On my way opens straight to that text; the sheet says what was sent last; no phone leaves Copy; without the data layer the sms: link just works', () => {
  const w = page([sarah({ status: 'in-progress', texts: [{ at: new Date(Date.now() - 12 * 60000).toISOString(), key: 'late' }] })]);
  w.document.getElementById('omw').click();
  const sheet = w.document.querySelector('.th-remind-sheet');
  assert.equal(sheet.querySelector('.th-remind-meta').textContent, 'Sink leak · Running late sent 12 min ago');
  assert.equal(sheet.querySelector('[aria-pressed="true"][data-kind]').getAttribute('data-kind'), 'late', 'an in-progress job has no On my way, so it opens on the first it has');
  w.close();

  const noPhone = page([sarah({ phone: '' })]);
  noPhone.document.getElementById('omw').click();
  assert.deepEqual(Array.from(noPhone.document.querySelectorAll('.th-text-send'), b => b.textContent), ['Copy']);
  assert.match(noPhone.document.querySelector('.th-remind-note').textContent, /No phone number on this job/);
  noPhone.document.dispatchEvent(new noPhone.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(!noPhone.document.querySelector('.quick-actions-overlay.is-shown'));
  noPhone.close();

  const bare = page([sarah()], { withDL: false });
  bare.document.getElementById('text').click();
  assert.equal(bare.document.querySelector('.th-remind-sheet'), null, 'no sheet without the data layer');
  bare.close();
});

// --- where it opens from ------------------------------------------------

test('job detail\'s Text, the Dashboard\'s On my way, and the Jobs sheet all open it', () => {
  assert.match(JD, /\(label === 'Text' \? ' data-text-job="' \+ attr\(j\.id\) \+ '"' : ''\)/);
  assert.match(JD, /window\.addEventListener\('th-job-texted', onJobRealtimeChange\);/);
  const hero = extractFn(WS, 'renderTodayHero');
  assert.match(hero, /data-text-job="' \+ escapeAttr\(job\.id\) \+ '" data-text-kind="onmyway">[\s\S]*On my way<\/a>/);
  assert.match(hero, /const onMyWayBtn = \(job\.phone && !clockOn && typeof thOpenTextSheet === 'function'\)/, 'not while that job\'s clock is already running');
  assert.match(WS, /window\.addEventListener\('th-job-texted', renderTodayHero\);/);

  let shown = null;
  const ctx = {
    Math, String, Number,
    loadJobs: () => [{ id: 1, title: 'A', client: 'Sarah <b>Miller</b>', phone: '1', status: 'not-started' }],
    escapeHtml: (x) => String(x).replace(/</g, '&lt;').replace(/>/g, '&gt;'), showQuickActionSheet: (t, a) => { shown = a.map(x => x.label); },
    thOpenTextSheet() {}, setJobStatus() {}, document: { getElementById: () => null }, location: {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractFn(JT, 'openJobActions') + ';this.f = openJobActions;', ctx);
  ctx.f(1);
  assert.equal(shown[1], 'Text Sarah', 'right after Mark Done');
  ctx.loadJobs = () => [{ id: 1, title: 'A', client: '<img>', phone: '1', status: 'not-started' }];
  ctx.f(1);
  assert.equal(shown[1], 'Text &lt;img&gt;', 'the sheet renders labels as HTML, so the name is escaped');
});

test('the chips: pressed ones in orange, the time chips smaller and in tabular figures', () => {
  assert.match(CSS, /\.th-text-chip\[aria-pressed="true"\] \{ border-color: var\(--orange-dark\); background: var\(--orange-tint-soft\); color: var\(--orange-light\); \}/);
  assert.match(CSS, /\.th-text-chip\.is-eta \{[^}]*font-variant-numeric: tabular-nums;/);
  assert.match(CSS, /\.th-text-etas\[hidden\] \{ display: none; \}/);
});
