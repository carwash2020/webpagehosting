// A real countdown to the client's nearest scheduled visit (2026-09-07),
// added to portal/home.html. Reads the exact same `requests` rows and
// scheduled_at field the attention row below it already lists -- not a
// second, separately-computed figure. Omitted entirely when nothing is
// scheduled, since the attention row already covers that case.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HOME = fs.readFileSync(repo('portal', 'home.html'), 'utf8');
const SERVICE_WORKER = fs.readFileSync(repo('portal', 'service-worker.js'), 'utf8');

function extractFn(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `expected to find function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}

function makeEl() {
  let value = '';
  return { get innerHTML() { return value; }, set innerHTML(v) { value = v; } };
}

function runBanner(requests, todayIso) {
  const daysUntilFn = extractFn(HOME, 'daysUntil');
  const bannerFn = extractFn(HOME, 'renderNextAppointmentBanner');
  const el = makeEl();
  const ctx = {
    console,
    document: { getElementById: (id) => (id === 'nextAppointmentArea' ? el : null) },
    escapeHtml: (s) => String(s),
    formatScheduledAt: (iso) => new Date(iso).toISOString(),
    Date: todayIso ? class extends Date {
      constructor(...args) { if (args.length === 0) super(todayIso); else super(...args); }
    } : Date,
  };
  vm.createContext(ctx);
  vm.runInContext(`${daysUntilFn}\n${bannerFn}\nthis.renderNextAppointmentBanner = renderNextAppointmentBanner;`, ctx);
  ctx.renderNextAppointmentBanner({ requests });
  return el.innerHTML;
}

test('the nearest of multiple scheduled requests is chosen, not just the first in the array', () => {
  const html = runBanner([
    { title: 'Later job', status: 'scheduled', scheduled_at: '2026-09-20T10:00:00Z' },
    { title: 'Sooner job', status: 'scheduled', scheduled_at: '2026-09-09T10:00:00Z' },
  ], '2026-09-07T00:00:00Z');
  assert.match(html, /Sooner job/);
  assert.doesNotMatch(html, /Later job/);
});

test('non-scheduled and undated requests are ignored', () => {
  const html = runBanner([
    { title: 'Just submitted', status: 'submitted', scheduled_at: null },
    { title: 'Reviewing', status: 'reviewing', scheduled_at: null },
  ], '2026-09-07T00:00:00Z');
  assert.equal(html, '');
});

test('nothing scheduled at all renders nothing, not an empty-state message (the attention row already covers that)', () => {
  assert.equal(runBanner([], '2026-09-07T00:00:00Z'), '');
});

test('the countdown says "Today" for a same-day appointment, not "In 0 days"', () => {
  const html = runBanner([{ title: 'Fence repair', status: 'scheduled', scheduled_at: '2026-09-07T14:00:00Z' }], '2026-09-07T00:00:00Z');
  assert.match(html, />Today</);
});

test('the countdown says "Tomorrow" for a next-day appointment', () => {
  const html = runBanner([{ title: 'Washer repair', status: 'scheduled', scheduled_at: '2026-09-08T10:00:00Z' }], '2026-09-07T00:00:00Z');
  assert.match(html, />Tomorrow</);
});

test('the countdown says "In N days" for anything further out', () => {
  const html = runBanner([{ title: 'Washer repair', status: 'scheduled', scheduled_at: '2026-09-12T10:00:00Z' }], '2026-09-07T00:00:00Z');
  assert.match(html, />In 5 days</);
});

test('the banner is rendered before the attention row, every time the page loads', () => {
  const initFn = extractFn(HOME, 'init');
  const bannerAt = initFn.indexOf('renderNextAppointmentBanner(summary)');
  const attentionAt = initFn.indexOf('renderAttention(summary)');
  assert.ok(bannerAt >= 0 && attentionAt >= 0 && bannerAt < attentionAt);
});

test('the banner markup sits above the attention area in the page', () => {
  const bannerAreaAt = HOME.indexOf('id="nextAppointmentArea"');
  const attentionAreaAt = HOME.indexOf('id="attentionArea"');
  assert.ok(bannerAreaAt >= 0 && attentionAreaAt >= 0 && bannerAreaAt < attentionAreaAt);
});

test('the portal service worker cache was bumped for this change', () => {
  const versionMatch = SERVICE_WORKER.match(/const CACHE_NAME = 'th-portal-v(\d+)';/);
  assert.ok(versionMatch, 'expected a th-portal-vN CACHE_NAME');
  assert.ok(Number(versionMatch[1]) >= 24, `expected v24 or later, got v${versionMatch[1]}`);
});
