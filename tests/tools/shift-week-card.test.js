// The shift clock in Your week (2026-09-23): the Hours worked card folded
// into Your week, since the two were the same week told twice. One card:
// the day's status and button, a bar per day with hours worked (green)
// behind hours on the clock (orange), worked / on the clock / jobs done /
// billed with last week under each, and everyone's week folded away for an
// account that can see finance. your-week.test.js keeps covering the job
// clock's view on its own (signed out, or no shifts).
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

const STEVE = 'steve@triplehenterprisesllc.biz';
const CONNOR = 'connor@triplehenterprisesllc.biz';
const HOUR = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const d0 = new Date();
const sinceMonday = (d0.getDay() + 6) % 7;
const onDay = (i, h, m) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - sinceMonday + i, h, m || 0).getTime(); // i: 0 = this Monday
const timeLabel = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// renderWeekCard() on the real data layer, signed in as Steve.
function render({ shifts, jobs, invoices, extra, openTeam } = {}) {
  const mem = { th_shift_log: JSON.stringify(shifts || []), th_tracker_jobs: JSON.stringify(jobs || []), th_invoices: JSON.stringify(invoices || []), th_income_log: '[]' };
  const cls = new Set();
  const el = {
    innerHTML: '', dataset: {}, listeners: [],
    classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) },
    querySelector: (sel) => (openTeam && sel === '.shift-team-wrap[open]' ? {} : null),
    addEventListener(type, fn) { this.listeners.push({ type, fn }); },
  };
  const intervals = [], opened = [];
  const ctx = Object.assign({
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN, Infinity,
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } },
    getStoredSession: () => ({ email: STEVE }),
    document: { getElementById: (id) => (id === 'weekCard' ? el : null) },
    escapeHtml: (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    escapeAttr: (x) => String(x).replace(/"/g, '&quot;'),
    money: (n) => '$' + Number(n).toFixed(2),
    thClockDuration: (ms) => Math.round(ms / 60000) + ' min',
    thOpenShiftSheet: () => opened.push(1),
    setInterval: (f, ms) => { intervals.push(ms); return 1; }, clearInterval() {},
  }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(DL.replace(/^const /gm, 'var '), ctx);
  vm.runInContext('var weekCardTick = null;' + extractFn(WS, 'shiftPersonName') + extractFn(WS, 'renderWeekCard') + ';this.f = renderWeekCard;', ctx);
  ctx.f();
  return { html: el.innerHTML, el, cls, intervals, opened, ctx };
}

test('one card: the Hours worked card is gone, and Your week re-renders on a shift change or once the role loads', () => {
  assert.doesNotMatch(WS, /id="shiftCard"|renderShiftCard|shiftCardTick/);
  assert.equal((WS.match(/class="week-card[^"]*" id="weekCard"/g) || []).length, 1);
  assert.match(extractFn(WS, 'renderDashboard'), /renderTodayHero\(\);\s*renderWeekCard\(\);\s*renderMetrics\(\);/);
  assert.match(WS, /window\.addEventListener\('th-shift-change', renderWeekCard\);/);
  assert.match(WS, /window\.addEventListener\('th-role-loaded', renderWeekCard\);/);
  assert.match(WS, /window\.addEventListener\('th-clock-change', \(\) => \{ renderTodayHero\(\); renderWeekCard\(\); \}\);/, 'the job clock\'s listener is as it was');
  assert.equal((WS.match(/<li><strong>Your week<\/strong>/g) || []).length, 1);
  assert.doesNotMatch(WS, /<li><strong>Hours worked<\/strong>/);
});

test('not clocked in, no shifts yet: Start my day at the top, the job clock\'s bars as before, Worked at 0 h', () => {
  const { html, cls, intervals } = render({ jobs: [{ id: 1, status: 'in-progress', timeLog: [{ start: iso(onDay(0, 9)), end: iso(onDay(0, 11)), hours: 2 }] }] });
  assert.match(html, /<span class="week-label" id="weekCardLabel">Your week<\/span>/);
  assert.match(html, /<div class="shift-now is-off">[\s\S]*?Not clocked in<\/span><button type="button" class="primary-btn" data-shift-open>Start my day<\/button><\/div>/);
  assert.doesNotMatch(html, /is-worked"|week-legend/, 'no shifts this week: one fill per bar, no legend');
  assert.equal(cls.has('has-worked'), false);
  assert.match(html, /aria-label="Hours on the clock: Mon 2 h, /);
  assert.match(html, /<div class="week-stat-value">0 h<\/div><div class="week-stat-label">Worked<\/div>/);
  assert.match(html, /<div class="week-stat-value">2 h<\/div><div class="week-stat-label">On the clock<\/div>/);
  assert.doesNotMatch(html, /week-hint/, 'there is time on the clock, so no hint');
  assert.deepEqual(intervals, []);
});

test('an empty week: one hint that names both clocks', () => {
  const { html } = render();
  assert.match(html, /<div class="week-hint">Tap Start my day to count your whole day, and start the clock on a job to time it\.<\/div>/);
});

test('on shift: since when, End my day, and each bar has worked (green) behind on the clock (orange), with a legend', () => {
  const start = Date.now() - 2 * HOUR;
  const { html, cls, intervals } = render({
    shifts: [
      { id: 'a', email: STEVE, start: iso(onDay(0, 7)), end: iso(onDay(0, 16)), hours: 9 },
      { id: 'b', email: STEVE, start: iso(start), end: null, hours: null },
    ],
    jobs: [{ id: 1, status: 'done', timeLog: [{ start: iso(onDay(0, 8)), end: iso(onDay(0, 14)), hours: 6 }] }],
  });
  assert.match(html, new RegExp('<div class="shift-now is-on">[\\s\\S]*?On shift since ' + timeLabel(start) + '<span class="shift-now-sub">120 min so far</span>'));
  assert.match(html, /data-shift-open>End my day<\/button>/);
  assert.equal(cls.has('has-worked'), true);
  if (sinceMonday > 0) {
    assert.match(html, /<div class="week-bar"><span class="week-bar-h">9<\/span><span class="week-bar-track"><span class="week-bar-fill is-worked" style="height:100%"><\/span><span class="week-bar-fill" style="height:67%"><\/span><\/span><span class="week-bar-day">M<\/span><\/div>/, 'Monday: 9 h worked, 6 h of it on the clock');
  }
  assert.match(html, /aria-label="Hours this week: Mon 9 h worked, 6 h on the clock; /);
  assert.match(html, /<div class="week-legend" aria-hidden="true"><span><span class="week-key is-worked"><\/span>Worked<\/span><span><span class="week-key"><\/span>On the clock<\/span><\/div>/);
  assert.match(html, /<div class="week-stat-label"><span class="week-live-dot is-worked" aria-hidden="true"><\/span>Worked<\/div>/);
  assert.match(html, /<div class="week-stat-value">6 h<\/div><div class="week-stat-label">On the clock<\/div>/);
  assert.deepEqual(intervals, [60000], 'the shift you\'re on grows once a minute');
});

test('a shift left open: Fix it, and it counts nothing', () => {
  const { html } = render({ shifts: [{ id: 'a', email: STEVE, start: iso(Date.now() - 30 * HOUR), end: null, hours: null }] });
  assert.match(html, /<div class="shift-now is-due">[\s\S]*?needs an end time<span class="shift-now-sub">It isn.t counting until you say when you finished\.<\/span>/);
  assert.match(html, /data-shift-open>Fix it<\/button>/);
  assert.match(html, /<div class="week-stat-value">0 h<\/div><div class="week-stat-label">Worked<\/div>/);
});

test('four stats with finance (two by two on a phone), three without: no Billed', () => {
  const inv = [{ id: 'i', date: new Date(onDay(0, 12)).toISOString().slice(0, 10), total: 420 }];
  const owner = render({ invoices: inv, extra: { canViewFinance: () => true } }).html;
  assert.match(owner, /<div class="week-stats is-four">/);
  assert.match(owner, /Billed/);
  const tech = render({ invoices: inv, extra: { canViewFinance: () => false, getCurrentUserRole: () => ({ role: 'tech' }) } }).html;
  assert.match(tech, /<div class="week-stats">/);
  assert.doesNotMatch(tech, /Billed/);
  assert.match(WS, /\.week-stats\.is-four \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 12px; \}/);
});

test('everyone\'s week: folded away, finance only (fails closed), only once someone else has a shift, and it stays open across the minute re-render', () => {
  const shifts = [
    { id: 'a', email: STEVE, start: iso(Date.now() - HOUR), end: null, hours: null },
    { id: 'b', email: CONNOR, start: iso(onDay(0, 1)), end: iso(onDay(0, 5)), hours: 4 },
  ];
  const owner = render({ shifts, extra: { canViewFinance: () => true, getCurrentUserFirstName: () => 'Steve' } }).html;
  assert.match(owner, /<details class="shift-team-wrap"><summary>Everyone this week &middot; 2 people<\/summary><table class="shift-team">/);
  const names = [...owner.matchAll(/<span class="shift-team-name">([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(names, ['Steve (you)', 'Connor']);
  assert.match(owner, /<span class="shift-team-state is-on">On shift since /);
  assert.doesNotMatch(render({ shifts, extra: { canViewFinance: () => false } }).html, /shift-team/);
  assert.doesNotMatch(render({ shifts }).html, /shift-team/, 'role not loaded: no team table');
  assert.doesNotMatch(render({ shifts: [shifts[0]], extra: { canViewFinance: () => true } }).html, /shift-team/);
  assert.match(render({ shifts, openTeam: true, extra: { canViewFinance: () => true } }).html, /<details class="shift-team-wrap" open>/);
});

test('its buttons open the shell\'s shift sheet, wired once', () => {
  const r = render();
  const clicks = r.el.listeners.filter(l => l.type === 'click');
  assert.equal(clicks.length, 1);
  clicks[0].fn({ target: { closest: (sel) => (sel === '[data-shift-open]' ? {} : null) } });
  assert.equal(r.opened.length, 1);
  r.ctx.f();
  assert.equal(r.el.listeners.filter(l => l.type === 'click').length, 1);
});

test('the look: worked in the shift clock\'s green, on the clock narrower in orange inside it', () => {
  assert.match(WS, /\.week-bar-fill\.is-worked \{ background: linear-gradient\(180deg, #7fd3a2, #4caf78 80%\); \}/);
  assert.match(WS, /\.week-card\.has-worked \.week-bar-fill:not\(\.is-worked\) \{ left: 27%; right: 27%;/);
  assert.match(WS, /\.week-live-dot\.is-worked \{ background: #4caf78; animation: none; \}/, 'the shift stays still; only the job clock pulses');
});
