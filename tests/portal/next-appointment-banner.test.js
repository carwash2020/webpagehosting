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

const PORTAL_APP = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');

function extractConst(src, name) {
  const m = src.match(new RegExp(`const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `expected to find const ${name}`);
  return m[0];
}

// 2026-09-22: the hero now renders from buildUpcomingVisits(), which
// merges scheduled work requests with booked visits
// (get_my_portal_visits) -- so the harness loads those helpers, plus
// the shared visit helpers from portal-app.js, alongside the banner.
function runBanner(requests, todayIso, visits) {
  const src = [
    extractFn(PORTAL_APP, 'portalUpcomingConfirmedVisits'),
    extractFn(PORTAL_APP, 'portalManageVisitUrl'),
    extractFn(PORTAL_APP, 'portalFormatVisitTime'),
    extractFn(PORTAL_APP, 'portalVisitDateParts'),
    extractFn(HOME, 'daysUntil'),
    extractFn(HOME, 'escapeAttr'),
    extractFn(HOME, 'safeVisitUid'),
    extractConst(HOME, 'VISIT_SOURCE_LABELS'),
    extractConst(HOME, 'CAL_ICON'),
    'let homeVisitsByUid = {};',
    extractFn(HOME, 'buildUpcomingVisits'),
    extractFn(HOME, 'renderNextAppointmentBanner'),
  ].join('\n');
  const el = makeEl();
  const FakeDate = todayIso ? class extends Date {
    constructor(...args) { if (args.length === 0) super(todayIso); else super(...args); }
  } : Date;
  const ctx = {
    console,
    Intl,
    document: { getElementById: (id) => (id === 'nextAppointmentArea' ? el : null) },
    escapeHtml: (s) => String(s),
    formatScheduledAt: (iso) => new Date(iso).toISOString(),
    Date: FakeDate,
  };
  vm.createContext(ctx);
  vm.runInContext(`${src}\nthis.renderNextAppointmentBanner = renderNextAppointmentBanner;`, ctx);
  ctx.renderNextAppointmentBanner({ requests, visits });
  return el.innerHTML;
}

test('the nearest of multiple scheduled requests is chosen, not just the first in the array', () => {
  const html = runBanner([
    { title: 'Later job', status: 'scheduled', scheduled_at: '2026-09-20T10:00:00Z' },
    { title: 'Sooner job', status: 'scheduled', scheduled_at: '2026-09-09T10:00:00Z' },
  ], '2026-09-07T00:00:00Z');
  // The hero is the soonest; since 2026-09-22 the later one is listed
  // under "Also coming up" instead of being dropped entirely.
  const heroEnd = html.indexOf('Also coming up');
  assert.ok(heroEnd > 0, 'expected an "Also coming up" list for the second visit');
  assert.match(html.slice(0, heroEnd), /Sooner job/);
  assert.doesNotMatch(html.slice(0, heroEnd), /Later job/);
  assert.match(html.slice(heroEnd), /Later job/);
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


// ---- 2026-09-22: booked visits (get_my_portal_visits) join the hero ----

const booked = (over) => Object.assign({
  id: 41, service_label: 'Replace disposal', start_at: '2026-09-09T21:00:00Z', end_at: '2026-09-09T23:00:00Z',
  address: '12 Elm St', status: 'confirmed', visit_kind: 'quote', quote_id: 7, checkup_id: null,
  manage_token: '6f1c2a3b-0000-4000-8000-000000000001',
}, over || {});

test('a visit booked from an estimate shows in the hero even with no scheduled work request', () => {
  const html = runBanner([], '2026-09-07T00:00:00Z', [booked()]);
  assert.match(html, /Replace disposal/);
  assert.match(html, /From your estimate/);
  assert.match(html, /12 Elm St/);
});

test('a booked visit offers the real self-service Reschedule or cancel link, from its manage token', () => {
  const html = runBanner([], '2026-09-07T00:00:00Z', [booked()]);
  assert.match(html, /href="\/manage-booking\.html\?token=6f1c2a3b-0000-4000-8000-000000000001"/);
  assert.match(html, /Reschedule or cancel/);
});

test('a work-request visit (only Steve can move it) links to its card instead of a manage page', () => {
  const html = runBanner([{ id: 9, title: 'Gate latch', status: 'scheduled', scheduled_at: '2026-09-10T16:00:00Z' }], '2026-09-07T00:00:00Z', []);
  assert.match(html, /href="\/portal\/work-orders\.html#wo-card-9"/);
  assert.doesNotMatch(html, /manage-booking/);
});

test('every hero offers Add to calendar, wired to a sanitized uid', () => {
  const html = runBanner([], '2026-09-07T00:00:00Z', [booked()]);
  assert.match(html, /onclick="addHomeVisitToCalendar\('th-booking-41'\)"/);
  assert.match(html, /Add to calendar/);
});

test('cancelled and already-finished bookings never reach the hero', () => {
  const html = runBanner([], '2026-09-07T00:00:00Z', [
    booked({ id: 1, status: 'cancelled', manage_token: null }),
    booked({ id: 2, start_at: '2026-09-01T16:00:00Z', end_at: '2026-09-01T18:00:00Z' }),
  ]);
  assert.equal(html, '');
});

test('a booked visit and a scheduled request are merged and ordered by start time', () => {
  const html = runBanner(
    [{ id: 3, title: 'Later request', status: 'scheduled', scheduled_at: '2026-09-15T16:00:00Z' }],
    '2026-09-07T00:00:00Z',
    [booked({ service_label: 'Sooner booking', start_at: '2026-09-08T16:00:00Z', end_at: '2026-09-08T18:00:00Z' })],
  );
  const split = html.indexOf('Also coming up');
  assert.match(html.slice(0, split), /Sooner booking/);
  assert.match(html.slice(split), /Later request/);
});

test('a work request still marked scheduled for a day already past is dropped, not shown as "Today" forever', () => {
  const html = runBanner([{ id: 5, title: 'Stale', status: 'scheduled', scheduled_at: '2026-09-01T16:00:00Z' }], '2026-09-07T00:00:00Z', []);
  assert.equal(html, '');
});

test('a data-derived title can never break out of an attribute in the "Also coming up" list', () => {
  const html = runBanner([], '2026-09-07T00:00:00Z', [
    booked({ id: 1 }),
    booked({ id: 2, service_label: 'x" onmouseover="alert(1)', start_at: '2026-09-12T16:00:00Z', end_at: '2026-09-12T18:00:00Z' }),
  ]);
  assert.doesNotMatch(html, /aria-label="Add x" onmouseover/);
  assert.match(html, /x&quot; onmouseover=&quot;alert\(1\)/);
});

test('Home fetches booked visits through the shared RPC helper, never th_bookings directly', () => {
  const loadFn = extractFn(HOME, 'loadSummary');
  assert.match(loadFn, /portalFetchMyVisits\(client\)/);
  assert.match(loadFn, /visits: visitResult\.visits/);
  assert.doesNotMatch(HOME, /from\(['"]th_bookings['"]\)/);
});

test('a failed contracts lookup now surfaces as a load error instead of "Nothing yet"', () => {
  const loadFn = extractFn(HOME, 'loadSummary');
  assert.match(loadFn, /\[invoices, quotes, jobs, requests, contracts\]\.find\(r => r\.error\)/);
});
