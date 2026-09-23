// Shift clock, part 3 (2026-09-23): Hours worked on the Dashboard. Where
// your day stands with its one button, seven bars of hours worked this week
// (whole shifts, in the shift clock's green), today and last week; and, for
// an account that can see finance, everyone's week.
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
const today = (h, m) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0).getTime(); };
const timeLabel = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// renderShiftCard() with the real data layer underneath, signed in as Steve.
function render(shifts, extra) {
  const mem = { th_shift_log: JSON.stringify(shifts || []), th_tracker_jobs: '[]' };
  const el = { innerHTML: '', dataset: {}, listeners: [], addEventListener(type, fn) { this.listeners.push({ type, fn }); } };
  const intervals = [];
  const opened = [];
  const ctx = Object.assign({
    console, Date, Math, JSON, Number, String, Object, Array, Set, Map, isNaN, Infinity,
    localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } },
    getStoredSession: () => ({ email: STEVE }),
    document: { getElementById: (id) => (id === 'shiftCard' ? el : null) },
    escapeHtml: (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    escapeAttr: (x) => String(x).replace(/"/g, '&quot;'),
    thClockDuration: (ms) => Math.round(ms / 60000) + ' min',
    thOpenShiftSheet: () => opened.push(1),
    setInterval: (f, ms) => { intervals.push(ms); return 1; }, clearInterval() {},
  }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(DL.replace(/^const /gm, 'var '), ctx);
  vm.runInContext('var shiftCardTick = null;' + extractFn(WS, 'shiftPersonName') + extractFn(WS, 'renderShiftCard') + ';this.f = renderShiftCard;', ctx);
  ctx.f();
  return { html: el.innerHTML, el, intervals, opened, ctx };
}

test('the Dashboard renders it under Your week, with the rest, and again on a shift change or once the role loads', () => {
  assert.match(WS, /<div class="week-card shift-card" id="shiftCard" aria-labelledby="shiftCardLabel"><\/div>/);
  assert.ok(WS.indexOf('id="weekCard"') < WS.indexOf('id="shiftCard"') && WS.indexOf('id="shiftCard"') < WS.indexOf('id="section-actionitems"'), 'after Your week, before Needs attention');
  assert.match(extractFn(WS, 'renderDashboard'), /renderWeekCard\(\);\s*renderShiftCard\(\);/);
  assert.match(WS, /window\.addEventListener\('th-shift-change', renderShiftCard\);/);
  assert.match(WS, /window\.addEventListener\('th-role-loaded', renderShiftCard\);/);
  assert.match(WS, /window\.addEventListener\('th-clock-change', \(\) => \{ renderTodayHero\(\); renderWeekCard\(\); \}\);/, 'the job clock\'s listener is as it was');
});

test('not clocked in: Start my day, seven empty bars, and a hint that says what counts', () => {
  const { html, intervals } = render([]);
  assert.match(html, /<span class="week-label" id="shiftCardLabel">Hours worked<\/span>/);
  assert.match(html, /<div class="shift-now is-off">[\s\S]*?Not clocked in<\/span><button type="button" class="primary-btn" data-shift-open>Start my day<\/button><\/div>/);
  assert.equal((html.match(/class="week-bar[ "]/g) || []).length, 7);
  assert.match(html, /aria-label="Hours worked: Mon none, Tue none/);
  assert.match(html, /class="week-hint">Start my day counts your whole day/);
  assert.doesNotMatch(html, /shift-team/);
  assert.deepEqual(intervals, [], 'nothing ticks while off');
});

test('on shift: since when and how long so far, End my day, and the card grows once a minute', () => {
  const start = Date.now() - 2 * HOUR;
  const { html, intervals } = render([{ id: 's', email: STEVE, start: iso(start), end: null, hours: null }]);
  assert.match(html, new RegExp('<div class="shift-now is-on">[\\s\\S]*?On shift since ' + timeLabel(start) + '<span class="shift-now-sub">120 min so far</span>'));
  assert.match(html, /<button type="button" class="secondary-btn" data-shift-open>End my day<\/button>/);
  assert.match(html, /<div class="week-stat-value">2 h<\/div><div class="week-stat-label">Today<\/div>/);
  assert.doesNotMatch(html, /week-hint/);
  assert.deepEqual(intervals, [60000]);
});

test('a shift left open: "needs an end time" with Fix it, and it counts nothing', () => {
  const { html } = render([{ id: 's', email: STEVE, start: iso(Date.now() - 30 * HOUR), end: null, hours: null }]);
  assert.match(html, /<div class="shift-now is-due">[\s\S]*?needs an end time<span class="shift-now-sub">It isn.t counting until you say when you finished\.<\/span>/);
  assert.match(html, /data-shift-open>Fix it<\/button>/);
  assert.match(html, /<div class="week-stat-value">0 h<\/div><div class="week-stat-label">This week<\/div>/);
});

test('this week and last: hours on the day each shift started, last week under This week', () => {
  const lastWeek = today(9) - 7 * 24 * HOUR;
  const { html } = render([
    { id: 'a', email: STEVE, start: iso(today(7)), end: iso(today(7) + 3.5 * HOUR), hours: 3.5 },
    { id: 'b', email: STEVE, start: iso(lastWeek), end: iso(lastWeek + 8 * HOUR), hours: 8 },
    { id: 'c', email: CONNOR, start: iso(today(8)), end: iso(today(8) + 5 * HOUR), hours: 5 },
  ]);
  assert.match(html, /<div class="week-stat-value">3\.5 h<\/div><div class="week-stat-label">Today<\/div>/);
  assert.match(html, /<div class="week-stat-value">3\.5 h<\/div><div class="week-stat-label">This week<\/div><div class="week-stat-last">Last week 8 h<\/div>/, 'Connor\'s 5 h are his, not Steve\'s');
  assert.match(html, /<div class="week-bar is-today"><span class="week-bar-h">3\.5<\/span>/);
});

test('everyone\'s week shows only to an account that can see finance, and only once someone else has a shift', () => {
  const shifts = [
    { id: 'a', email: STEVE, start: iso(Date.now() - HOUR), end: null, hours: null },
    { id: 'b', email: CONNOR, start: iso(today(1)), end: iso(today(1) + 4 * HOUR), hours: 4 },
    { id: 'c', email: 'mike.helper@example.com', start: iso(Date.now() - 20 * HOUR), end: null, hours: null },
  ];
  const owner = render(shifts, { canViewFinance: () => true, getCurrentUserFirstName: () => 'Steve' }).html;
  assert.match(owner, /<table class="shift-team"><caption>Everyone this week<\/caption>/);
  const names = [...owner.matchAll(/<span class="shift-team-name">([^<]+)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(names, ['Steve (you)', 'Connor', 'Mike'], 'on shift first, then most hours; a name from the email when there\'s no better one');
  assert.match(owner, /<span class="shift-team-state is-on">On shift since /);
  assert.match(owner, /<span class="shift-team-state is-due">Shift needs an end time<\/span>/);
  assert.match(owner, /<th scope="col" class="is-num is-last-week">Last week<\/th>/);

  assert.doesNotMatch(render(shifts, { canViewFinance: () => false }).html, /shift-team/, 'no finance permission, no team hours');
  assert.doesNotMatch(render(shifts).html, /shift-team/, 'role not loaded: fails closed, unlike Billed');
  assert.doesNotMatch(render([shifts[0]], { canViewFinance: () => true }).html, /shift-team/, 'only you so far: no table repeating your own numbers');
});

test('its button opens the shell\'s shift sheet, wired once', () => {
  const r = render([]);
  const clicks = r.el.listeners.filter(l => l.type === 'click');
  assert.equal(clicks.length, 1);
  clicks[0].fn({ target: { closest: (sel) => (sel === '[data-shift-open]' ? {} : null) } });
  assert.equal(r.opened.length, 1);
  r.ctx.f();
  assert.equal(r.el.listeners.filter(l => l.type === 'click').length, 1, 'a re-render doesn\'t wire it twice');
});

test('the look: Your week\'s layout in the shift clock\'s green; the team table drops Last week on a narrow phone; the help says what it is', () => {
  assert.match(WS, /\.shift-card \.week-bar-fill \{ background: linear-gradient\(180deg, #7fd3a2, #4caf78 80%\); \}/);
  assert.match(WS, /@media \(max-width: 480px\) \{ \.shift-team \.is-last-week \{ display: none; \} \}/);
  assert.match(WS, /<li><strong>Hours worked<\/strong> &mdash; your whole day, not just time on jobs\./);
});
