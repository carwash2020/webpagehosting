// "Your visits" (2026-09-22): a client can finally see the appointments
// they booked themselves. Every portal self-scheduling path (an
// approved quote, a check-up reminder) and booking.html write a real
// th_bookings row, but th_bookings is internal-only under RLS -- so the
// portal lost sight of a visit the moment it was booked. The fix is a
// SECURITY DEFINER RPC (sql/portal/add_get_my_portal_visits.sql) read
// through shared helpers in portal/portal-app.js by Home (hero, see
// next-appointment-banner.test.js), Quotes and Jobs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const PORTAL_APP = fs.readFileSync(repo('portal', 'portal-app.js'), 'utf8');
const QUOTES = fs.readFileSync(repo('portal', 'quotes.html'), 'utf8');
const JOBS = fs.readFileSync(repo('portal', 'jobs.html'), 'utf8');
const SQL = fs.readFileSync(repo('sql', 'portal', 'add_get_my_portal_visits.sql'), 'utf8');

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

function loadFns(src, names, extra) {
  const ctx = Object.assign({ Intl, Date, console }, extra || {});
  vm.createContext(ctx);
  vm.runInContext(names.map(n => extractFn(src, n)).join('\n') + '\n' + names.map(n => `this.${n} = ${n};`).join('\n'), ctx);
  return ctx;
}

// ---- the RPC itself ----

test('the visits RPC is SECURITY DEFINER with a pinned search_path, returning a fixed client-safe column list', () => {
  assert.match(SQL, /create or replace function public\.get_my_portal_visits\(\)/);
  assert.match(SQL, /security definer/);
  assert.match(SQL, /set search_path = public/);
  const returns = SQL.match(/returns table \(([\s\S]*?)\)\nlanguage/);
  assert.ok(returns, 'expected an explicit returns table (...) column list');
  for (const internalOnly of ['notes', 'utm_', 'referred_by', 'source text', 'phone']) {
    assert.ok(!returns[1].includes(internalOnly), `must not return internal column ${internalOnly}`);
  }
});

test('rows are scoped to the caller\'s own session email, case-insensitively', () => {
  assert.match(SQL, /lower\(b\.email\) = lower\(\(select auth\.email\(\)\)\)/);
  assert.match(SQL, /\(select auth\.email\(\)\) is not null/);
});

test('the manage token is only handed back while the booking is still confirmed', () => {
  assert.match(SQL, /case when b\.status = 'confirmed' then b\.cancel_token else null end as manage_token/);
});

test('anon cannot execute it; authenticated can', () => {
  assert.match(SQL, /revoke all on function public\.get_my_portal_visits\(\) from public;/);
  assert.match(SQL, /revoke all on function public\.get_my_portal_visits\(\) from anon;/);
  assert.match(SQL, /grant execute on function public\.get_my_portal_visits\(\) to authenticated;/);
});

test('no portal page reads th_bookings directly -- only through the RPC helper', () => {
  for (const [name, src] of [['quotes', QUOTES], ['jobs', JOBS]]) {
    assert.doesNotMatch(src, /from\(['"]th_bookings['"]\)/, `${name}.html must not query th_bookings`);
    assert.match(src, /portalFetchMyVisits\(client\)/, `${name}.html should use portalFetchMyVisits()`);
  }
  assert.match(extractFn(PORTAL_APP, 'portalFetchMyVisits'), /rpc\('get_my_portal_visits'\)/);
});

test('a failed visits lookup resolves to an empty list instead of throwing', async () => {
  const ctx = loadFns(PORTAL_APP, ['portalFetchMyVisits']);
  const failing = { rpc: async () => ({ data: null, error: { message: 'boom' } }) };
  const throwing = { rpc: async () => { throw new Error('network'); } };
  const a = await ctx.portalFetchMyVisits(failing);
  const b = await ctx.portalFetchMyVisits(throwing);
  assert.equal(a.visits.length, 0);
  assert.ok(a.error);
  assert.equal(b.visits.length, 0);
  assert.ok(b.error);
});

// ---- shared helpers ----

test('portalUpcomingConfirmedVisits keeps only confirmed, not-yet-ended visits, soonest first', () => {
  const ctx = loadFns(PORTAL_APP, ['portalUpcomingConfirmedVisits']);
  const now = new Date('2026-09-10T12:00:00Z');
  const out = ctx.portalUpcomingConfirmedVisits([
    { id: 1, status: 'confirmed', start_at: '2026-09-20T16:00:00Z', end_at: '2026-09-20T18:00:00Z' },
    { id: 2, status: 'cancelled', start_at: '2026-09-12T16:00:00Z', end_at: '2026-09-12T18:00:00Z' },
    { id: 3, status: 'confirmed', start_at: '2026-09-01T16:00:00Z', end_at: '2026-09-01T18:00:00Z' },
    { id: 4, status: 'confirmed', start_at: '2026-09-11T16:00:00Z', end_at: '2026-09-11T18:00:00Z' },
    // in progress right now still counts until it ends
    { id: 5, status: 'confirmed', start_at: '2026-09-10T11:00:00Z', end_at: '2026-09-10T13:00:00Z' },
  ], now);
  assert.deepEqual(Array.from(out, v => v.id), [5, 4, 1]);
});

test('the manage link points at the existing guest page with the url-encoded token, and is empty without one', () => {
  const ctx = loadFns(PORTAL_APP, ['portalManageVisitUrl']);
  assert.equal(ctx.portalManageVisitUrl({ manage_token: 'abc-123' }), '/manage-booking.html?token=abc-123');
  assert.equal(ctx.portalManageVisitUrl({ manage_token: null }), '');
  assert.equal(ctx.portalManageVisitUrl(null), '');
});

test('date-tile parts use the business timezone, not the viewer\'s', () => {
  const ctx = loadFns(PORTAL_APP, ['portalVisitDateParts']);
  // 03:30 UTC on the 1st is still the evening of Sep 30 in Denver.
  const parts = ctx.portalVisitDateParts('2026-10-01T03:30:00Z');
  assert.equal(parts.month, 'SEP');
  assert.equal(parts.day, '30');
  assert.equal(parts.weekday, 'Wed');
});

// ---- .ics ----

function buildIcs(visit) {
  const ctx = loadFns(PORTAL_APP, ['portalIcsEscape', 'portalIcsFold', 'portalIcsUtc', 'portalBuildVisitIcs']);
  return ctx.portalBuildVisitIcs(visit, new Date('2026-09-22T18:00:00Z'));
}

test('the .ics file is a timed VEVENT in UTC with CRLF line endings', () => {
  const ics = buildIcs({ uid: 'th-booking-7', title: 'Fix sink', start: '2026-09-30T21:00:00Z', end: '2026-09-30T23:00:00Z' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nDTSTART:20260930T210000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20260930T230000Z\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20260922T180000Z\r\n/);
  assert.match(ics, /\r\nUID:th-booking-7@triplehenterprisesllc\.biz\r\n/);
  assert.match(ics, /\r\nSUMMARY:Triple H Enterprises: Fix sink\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /\n/, 'every line break should be CRLF');
});

test('a visit with no end time (a scheduled work request) gets the same 2-hour default every portal flow books with', () => {
  const ics = buildIcs({ uid: 'th-request-3', title: 'Gate', start: '2026-09-30T21:00:00Z', end: null });
  assert.match(ics, /DTEND:20260930T230000Z/);
});

test('TEXT values are escaped per RFC 5545 (backslash, semicolon, comma, newline)', () => {
  const ics = buildIcs({ uid: 'x', title: 'A, B; C\\D', start: '2026-09-30T21:00:00Z', address: '12 Elm St, Apt 4\nSt. George' });
  assert.match(ics, /SUMMARY:Triple H Enterprises: A\\, B\\; C\\\\D/);
  assert.match(ics, /LOCATION:12 Elm St\\, Apt 4\\nSt\. George/);
});

test('long lines are folded to <=75 chars with a leading-space continuation, and unfold back to the original', () => {
  const longAddress = '1234 Very Long Street Name That Keeps Going, Unit 5678, St. George, Utah 84790, United States';
  const ics = buildIcs({ uid: 'x', title: 'T', start: '2026-09-30T21:00:00Z', address: longAddress, manageUrl: '/manage-booking.html?token=6f1c2a3b-0000-4000-8000-000000000001' });
  for (const line of ics.split('\r\n')) assert.ok(line.length <= 75, `line too long (${line.length}): ${line}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /LOCATION:1234 Very Long Street Name That Keeps Going\\, Unit 5678\\, St\. George\\, Utah 84790\\, United States/);
  assert.match(unfolded, /Reschedule or cancel: https:\/\/www\.triplehenterprisesllc\.biz\/manage-booking\.html\?token=6f1c2a3b-0000-4000-8000-000000000001/);
});

test('the event carries a reminder alarm', () => {
  const ics = buildIcs({ uid: 'x', title: 'T', start: '2026-09-30T21:00:00Z' });
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY\r\n[\s\S]*TRIGGER:-PT2H\r\nEND:VALARM/);
});

// ---- Quotes: the booked visit behind an approved quote ----

function loadQuoteState(visitsByQuoteId, now) {
  const ctx = { Intl, console, Date: now ? class extends Date { constructor(...a) { if (a.length === 0) super(now); else super(...a); } } : Date };
  vm.createContext(ctx);
  vm.runInContext([
    extractFn(PORTAL_APP, 'portalUpcomingConfirmedVisits'),
    'let quoteVisitsByQuoteId = ' + JSON.stringify(visitsByQuoteId) + ';',
    extractFn(QUOTES, 'quoteVisitState'),
    'this.quoteVisitState = quoteVisitState;',
  ].join('\n'), ctx);
  return ctx.quoteVisitState;
}

const qv = (over) => Object.assign({ id: 1, quote_id: 7, status: 'confirmed', start_at: '2026-09-30T21:00:00Z', end_at: '2026-09-30T23:00:00Z' }, over || {});

test('an upcoming confirmed booking reads as "upcoming"', () => {
  const state = loadQuoteState({ 7: [qv()] }, '2026-09-22T00:00:00Z')(7);
  assert.equal(state.kind, 'upcoming');
  assert.equal(state.visit.id, 1);
});

test('only cancelled bookings left means "cancelled" -- the case where the client may pick a new time', () => {
  const state = loadQuoteState({ 7: [qv({ status: 'cancelled' })] }, '2026-09-22T00:00:00Z')(7);
  assert.equal(state.kind, 'cancelled');
});

test('a rescheduled-after-cancel quote prefers the live booking over the cancelled one', () => {
  const state = loadQuoteState({ 7: [qv({ id: 1, status: 'cancelled' }), qv({ id: 2, start_at: '2026-10-02T21:00:00Z', end_at: '2026-10-02T23:00:00Z' })] }, '2026-09-22T00:00:00Z')(7);
  assert.equal(state.kind, 'upcoming');
  assert.equal(state.visit.id, 2);
});

test('a confirmed booking already in the past reads as "past"; no booking visible reads as "unknown"', () => {
  const get = loadQuoteState({ 7: [qv({ start_at: '2026-09-01T21:00:00Z', end_at: '2026-09-01T23:00:00Z' })] }, '2026-09-22T00:00:00Z');
  assert.equal(get(7).kind, 'past');
  assert.equal(get(99).kind, 'unknown');
});

test('the quote card keeps the original wording only when no booking is visible at all', () => {
  const fn = extractFn(QUOTES, 'quoteScheduleSectionHtml');
  assert.match(fn, /state\.kind === 'unknown'[\s\S]*Job scheduled\. We'll see you then!/);
});

test('an upcoming quote visit offers Add to calendar and the real Reschedule or cancel link', () => {
  const fn = extractFn(QUOTES, 'quoteVisitCardHtml');
  assert.match(fn, /addQuoteVisitToCalendar\(\$\{Number\(v\.id\)\}\)/);
  assert.match(fn, /portalManageVisitUrl\(v\)/);
  assert.match(fn, /Reschedule or cancel/);
});

test('"Pick a time for this job" is a real primary button now, not a dim underlined text link', () => {
  const fn = extractFn(QUOTES, 'quoteSchedulePanelHtml');
  assert.match(fn, /class="btn blue schedule-cta" onclick="toggleScheduleForm\(\$\{quoteId\}\)"/);
  assert.match(QUOTES, /quoteSchedulePanelHtml\(q\.id, 'Pick a time for this job'\)/);
  assert.match(QUOTES, /quoteSchedulePanelHtml\(q\.id, 'Pick a new time'\)/);
});

test('quote visits are fetched alongside the quotes themselves, in one Promise.all', () => {
  const fn = extractFn(QUOTES, 'renderQuotes');
  assert.match(fn, /Promise\.all\(\[[\s\S]*from\('client_portal_quotes'\)[\s\S]*portalFetchMyVisits\(client\),\s*\]\)/);
});

// ---- Jobs: a check-up visit that's already booked ----

test('a check-up with an upcoming confirmed booking shows it instead of "Schedule this visit"', () => {
  const ctx = loadFns(PORTAL_APP, ['portalUpcomingConfirmedVisits']);
  vm.runInContext(extractFn(JOBS, 'bookedVisitForCheckup') + '\nthis.bookedVisitForCheckup = bookedVisitForCheckup;', ctx);
  const future = new Date(Date.now() + 5 * 86400000).toISOString();
  const futureEnd = new Date(Date.now() + 5 * 86400000 + 7200000).toISOString();
  const visits = [
    { id: 1, checkup_id: 3, status: 'cancelled', start_at: future, end_at: futureEnd },
    { id: 2, checkup_id: 3, status: 'confirmed', start_at: future, end_at: futureEnd },
    { id: 3, checkup_id: 4, status: 'confirmed', start_at: future, end_at: futureEnd },
  ];
  assert.equal(ctx.bookedVisitForCheckup(3, visits).id, 2);
  assert.equal(ctx.bookedVisitForCheckup(5, visits), null);
  const banner = extractFn(JOBS, 'renderCheckupBanner');
  assert.match(banner, /if \(booked\) \{[\s\S]*Visit booked[\s\S]*portalFormatVisitWhen\(booked\.start_at\)[\s\S]*addCheckupVisitToCalendar/);
});

test('booking a check-up re-renders from the server instead of a static "Requested" line', () => {
  const fn = extractFn(JOBS, 'confirmCheckupSchedule');
  assert.match(fn, /await renderCheckups\(\);/);
  assert.doesNotMatch(fn, /Requested\. We\\'ll confirm shortly\./);
});
