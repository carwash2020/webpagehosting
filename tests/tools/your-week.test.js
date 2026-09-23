// Workspace rework part 11 (2026-09-23): Your week. The Dashboard's
// scoreboard, Monday to Sunday: hours on the clock each day (part 9's
// timeLog, plus a clock still running), jobs finished, and what was billed,
// each beside last week's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOOLS = path.join(__dirname, '..', '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const DL = read('data-layer.js');
const WS = read('workspace.html');

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
function dataLayer(extra) {
  const ctx = Object.assign({
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN,
    localStorage: { getItem: () => null, setItem() {} },
  }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(DL.replace(/^const /gm, 'var '), ctx);
  return ctx;
}
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h || 0, min || 0);
const iso = (d) => d.toISOString();
const WED = at(2026, 9, 23, 15); // Wednesday, 3 PM

test('the week runs Monday to Sunday', () => {
  const { thWeekStart } = dataLayer();
  for (const [d, monday] of [[at(2026, 9, 23), 21], [at(2026, 9, 21), 21], [at(2026, 9, 27), 21], [at(2026, 9, 28), 28]]) {
    assert.equal(thWeekStart(d).getDate(), monday, d.toDateString());
    assert.equal(thWeekStart(d).getDay(), 1);
  }
});

test('hours land on the day they started, a running clock counts toward today, and last week is kept beside it', () => {
  const { thWeekSummary } = dataLayer();
  const jobs = [
    { id: 1, status: 'done', statusChangedAt: iso(at(2026, 9, 22, 17)), timeLog: [
      { start: iso(at(2026, 9, 21, 9)), end: iso(at(2026, 9, 21, 11, 30)), hours: 2.5 },
      { start: iso(at(2026, 9, 22, 8)), end: iso(at(2026, 9, 22, 9, 24)), hours: 1.4 },
    ] },
    { id: 2, status: 'done', statusChangedAt: iso(at(2026, 9, 17, 12)), timeLog: [{ start: iso(at(2026, 9, 16, 9)), hours: 3 }] },
    { id: 3, status: 'in-progress', clockSince: iso(at(2026, 9, 23, 14, 30)) },
    { id: 4, status: 'done', date: '2026-09-10' },
  ];
  const w = thWeekSummary(WED, { jobs, invoices: [], income: [] });
  assert.deepEqual(Array.from(w.days, d => d.hours), [2.5, 1.4, 0.5, 0, 0, 0, 0]);
  assert.deepEqual(Array.from(w.days, d => d.name), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(Array.from(w.days, d => d.isToday), [false, false, true, false, false, false, false]);
  assert.deepEqual(Array.from(w.days, d => d.isFuture), [false, false, false, true, true, true, true]);
  assert.equal(w.hours, 4.4);
  assert.equal(w.prevHours, 3);
  assert.equal(w.running, true);
  assert.equal(w.jobsDone, 1);
  assert.equal(w.prevJobsDone, 1);
  assert.equal(w.days[0].date, '2026-09-21');
});

test('billed is invoices dated this week plus income logged by hand -- not the income log\'s own copy of each invoice', () => {
  const { thWeekSummary } = dataLayer();
  const invoices = [{ date: '2026-09-22', total: 285 }, { date: '2026-09-23', total: 160.5 }, { date: '2026-09-15', total: 400 }, { date: '2026-09-29', total: 999 }];
  const income = [{ date: '2026-09-21', amount: 95 }, { date: '2026-09-22', amount: 285, origin: 'invoice' }, { date: '2026-09-18', amount: 50 }];
  const w = thWeekSummary(WED, { jobs: [], invoices, income });
  assert.equal(w.billed, 540.5);
  assert.equal(w.prevBilled, 450);
  assert.equal(w.running, false);
});

function renderWith(summary, perms) {
  const el = { innerHTML: '' };
  const intervals = [];
  const ctx = dataLayer({
    document: { getElementById: (id) => (id === 'weekCard' ? el : null) },
    escapeAttr: (x) => String(x).replace(/"/g, '&quot;'), money: (n) => '$' + Number(n).toFixed(2),
    setInterval: (f, ms) => { intervals.push(ms); return 1; }, clearInterval() {},
  });
  ctx.thWeekSummary = () => summary;
  if (perms) Object.assign(ctx, perms);
  vm.runInContext('var weekCardTick = null;' + extractFn(WS, 'renderWeekCard') + ';this.f = renderWeekCard;', ctx);
  ctx.f();
  return { html: el.innerHTML, intervals };
}
const sample = () => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name, i) => ({ date: '2026-09-' + (21 + i), name, hours: [2.5, 6, 0.5, 0, 0, 0, 0][i], isToday: i === 2, isFuture: i > 2 }));
  return { start: at(2026, 9, 21), end: at(2026, 9, 27), days, hours: 9, prevHours: 12.4, jobsDone: 3, prevJobsDone: 5, billed: 1240, prevBilled: 2100, running: true };
};

test('the card: seven bars scaled to the busiest day, today picked out, then On the clock / Jobs done / Billed with last week under each', () => {
  const { html, intervals } = renderWith(sample());
  assert.match(html, /<span class="week-label" id="weekCardLabel">Your week<\/span><span class="week-range">Sep 21 – 27<\/span>/);
  assert.equal((html.match(/class="week-bar[ "]/g) || []).length, 7);
  assert.match(html, /<div class="week-bar"><span class="week-bar-h">6<\/span><span class="week-bar-track"><span class="week-bar-fill" style="height:100%"><\/span><\/span><span class="week-bar-day">T<\/span><\/div>/);
  assert.match(html, /<div class="week-bar is-today"><span class="week-bar-h">0\.5<\/span><span class="week-bar-track"><span class="week-bar-fill" style="height:8%">/);
  assert.match(html, /<div class="week-bar is-future"><span class="week-bar-h"><\/span>/);
  assert.match(html, /aria-label="Hours on the clock: Mon 2\.5 h, Tue 6 h, Wed 0\.5 h, Thu none, Fri none, Sat none, Sun none"/);
  assert.match(html, /<div class="week-stat-value">9 h<\/div><div class="week-stat-label"><span class="week-live-dot" aria-hidden="true"><\/span>On the clock<\/div><div class="week-stat-last">Last week 12\.4 h<\/div>/);
  assert.match(html, /<div class="week-stat-value">3<\/div><div class="week-stat-label">Jobs done<\/div><div class="week-stat-last">Last week 5<\/div>/);
  assert.match(html, /<div class="week-stat-value">\$1240\.00<\/div><div class="week-stat-label">Billed<\/div><div class="week-stat-last">Last week \$2100\.00<\/div>/);
  assert.doesNotMatch(html, /week-hint/);
  assert.deepEqual(intervals, [60000], 'a running clock: today\'s bar grows once a minute');
});

test('no finance permission, no Billed; no clock time yet, a hint instead; nothing ticks without a running clock; a quiet day still has a scale', () => {
  const quiet = sample();
  quiet.days.forEach(d => { d.hours = 0; });
  Object.assign(quiet, { hours: 0, prevHours: 0, running: false, jobsDone: 1, prevJobsDone: 0, billed: 0, prevBilled: 0 });
  const { html, intervals } = renderWith(quiet, { canViewFinance: () => false, getCurrentUserRole: () => ({ role: 'tech' }) });
  assert.doesNotMatch(html, /Billed/);
  assert.match(html, /<div class="week-stat-value">1<\/div><div class="week-stat-label">Job done<\/div><\/div>/, 'one job, and no "Last week 0"');
  assert.match(html, /<div class="week-hint">Start the clock on a job and your hours fill in here\.<\/div>/);
  assert.match(html, /style="height:0%"/);
  assert.deepEqual(intervals, []);
});

test('the Dashboard renders it with the rest, re-renders on a clock change, and styles it as one card that stacks on a phone', () => {
  assert.match(WS, /<div class="week-card" id="weekCard" aria-labelledby="weekCardLabel"><\/div>/);
  assert.ok(WS.indexOf('id="dashPrimaryStrip"') < WS.indexOf('id="weekCard"') && WS.indexOf('id="weekCard"') < WS.indexOf('id="section-actionitems"'), 'between the daily actions and Needs attention');
  assert.match(extractFn(WS, 'renderDashboard'), /renderTodayHero\(\);\s*renderWeekCard\(\);/);
  assert.match(WS, /window\.addEventListener\('th-clock-change', \(\) => \{ renderTodayHero\(\); renderWeekCard\(\); \}\);/);
  assert.match(WS, /@media \(max-width: 720px\) \{\s*\.week-card \{ padding: 14px 16px; \}\s*\.week-body \{ flex-direction: column;/);
  assert.match(WS, /@media \(prefers-reduced-motion: reduce\) \{ \.week-live-dot \{ animation: none; \} \}/);
});
