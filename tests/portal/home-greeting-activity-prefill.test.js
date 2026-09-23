// Round 3 of the 2026-09-22 portal pass:
//   1. Home's greeting actually uses the client's name. A comment in
//      init() said it did, but nothing ever set #homeGreeting -- every
//      client saw "Welcome" forever.
//   2. Recent activity: the last few real events across every section,
//      built from rows Home already loads.
//   3. Request Work prefills phone/address the client already gave us.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HOME = fs.readFileSync(repo('portal', 'home.html'), 'utf8');
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');

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

function homeCtx() {
  const ctx = { Intl, Date, Math, String, isNaN, escapeHtml: (s) => String(s), escapeAttr: (s) => String(s) };
  vm.createContext(ctx);
  vm.runInContext([
    extractFn(HOME, 'money'),
    extractFn(HOME, 'homeGreetingText'),
    extractConst(HOME, 'ACTIVITY_WINDOW_DAYS'),
    extractConst(HOME, 'ACTIVITY_LIMIT'),
    extractFn(HOME, 'activityWhen'),
    extractFn(HOME, 'activityRelative'),
    extractFn(HOME, 'buildRecentActivity'),
  ].join('\n') + '\nthis.greet = homeGreetingText; this.build = buildRecentActivity; this.rel = activityRelative;', ctx);
  return ctx;
}

// ---- greeting ----

test('the greeting is actually set on load now', () => {
  assert.match(extractFn(HOME, 'init'), /document\.getElementById\('homeGreeting'\)\.textContent = homeGreetingText\(summary, new Date\(\)\);/);
});

test('the saved profile name wins, first name only, with a time-of-day greeting', () => {
  const { greet } = homeCtx();
  const s = { displayName: 'Jane Q. Client', invoices: [{ client_name: 'Someone Else' }], quotes: [] };
  assert.equal(greet(s, new Date(2026, 8, 22, 9, 0)), 'Good morning, Jane');
  assert.equal(greet(s, new Date(2026, 8, 22, 14, 0)), 'Good afternoon, Jane');
  assert.equal(greet(s, new Date(2026, 8, 22, 21, 0)), 'Good evening, Jane');
});

test('falls back to the name on an invoice/quote, then to plain "Welcome" -- never a name guessed from an email', () => {
  const { greet } = homeCtx();
  const at = new Date(2026, 8, 22, 9, 0);
  assert.equal(greet({ displayName: '', invoices: [], quotes: [{ client_name: 'Bob Builder' }] }, at), 'Good morning, Bob');
  assert.equal(greet({ displayName: '', invoices: [], quotes: [] }, at), 'Welcome');
  assert.equal(greet({ displayName: '', invoices: [{ client_name: 'bob@example.com' }], quotes: [] }, at), 'Welcome');
});

test('the profile lookup is filtered to the signed-in email (an internal account can read every profile)', () => {
  const fn = extractFn(HOME, 'loadSummary');
  assert.match(fn, /from\('client_profiles'\)\.select\('display_name'\)\.eq\('client_email', email\)\.maybeSingle\(\)/);
});

// ---- recent activity ----

const NOW = new Date(2026, 8, 22, 12, 0);
const summary = {
  invoices: [
    { id: 1, invoice_number: 'INV-1', invoice_date: '2026-09-10', total: 285, paid: true, paid_at: '2026-09-21T18:00:00Z' },
    { id: 2, invoice_number: 'INV-OLD', invoice_date: '2026-03-01', total: 50, paid: false },
  ],
  quotes: [{ id: 7, quote_number: 'Q-7', quote_date: '2026-09-12', total: 340, status: 'approved', responded_at: '2026-09-13T17:00:00Z' }],
  jobs: [{ id: 21, title: 'Water heater flush', job_date: '2026-09-16' }],
  requests: [{ id: 31, title: 'Dishwasher', created_at: '2026-09-20T15:00:00Z' }],
};

test('events come from every section, newest first, capped at 5', () => {
  const { build } = homeCtx();
  const events = build(summary, NOW);
  assert.equal(events.length, 5);
  assert.deepEqual(Array.from(events, e => e.kind), ['paid', 'request', 'job', 'approved', 'quote']);
  for (let i = 1; i < events.length; i++) assert.ok(events[i - 1].at >= events[i].at);
});

test('anything older than the 90-day window is left out', () => {
  const { build } = homeCtx();
  const events = build({ invoices: [summary.invoices[1]], quotes: [], jobs: [], requests: [] }, NOW);
  assert.equal(events.length, 0);
});

test('each event deep-links to the card it describes', () => {
  const { build } = homeCtx();
  const byKind = {};
  build(summary, NOW).forEach(e => { byKind[e.kind] = e.href; });
  assert.equal(byKind.paid, '/portal/dashboard.html#invoice-card-1');
  assert.equal(byKind.approved, '/portal/quotes.html#quote-card-7');
  assert.equal(byKind.job, '/portal/jobs.html#job-card-21');
  assert.equal(byKind.request, '/portal/work-orders.html#wo-card-31');
});

test('date-only columns are anchored at local noon so they never slide to the previous day', () => {
  const { build } = homeCtx();
  const job = build({ invoices: [], quotes: [], requests: [], jobs: [{ id: 1, title: 'x', job_date: '2026-09-16' }] }, NOW)[0];
  assert.equal(job.at.getDate(), 16);
  assert.equal(job.at.getHours(), 12);
});

test('relative times read naturally', () => {
  const { rel } = homeCtx();
  assert.equal(rel(new Date(2026, 8, 22, 8), NOW), 'Today');
  assert.equal(rel(new Date(2026, 8, 21, 8), NOW), 'Yesterday');
  assert.equal(rel(new Date(2026, 8, 18, 8), NOW), '4 days ago');
  assert.equal(rel(new Date(2026, 8, 1, 8), NOW), 'Sep 1');
});

test('Home loads the extra columns the feed needs, and renders it after the account cards', () => {
  const fn = extractFn(HOME, 'loadSummary');
  assert.match(fn, /select\('id,total,paid,paid_at,invoice_number,invoice_date,client_name'\)/);
  assert.match(fn, /select\('id,status,total,quote_number,quote_date,responded_at,client_name'\)/);
  assert.match(fn, /select\('id,title,job_date'\)/);
  assert.match(extractFn(HOME, 'init'), /renderRecentActivity\(summary, new Date\(\)\);/);
});

test('on a phone the feed still reads after the account cards, even though the desktop layout moved it', () => {
  // The desktop shell (2026-09-22) puts the feed in the main column and
  // the account cards in the side column, so in the DOM the feed now
  // comes FIRST. .home-main/.home-side are display:contents on a phone
  // and flex order puts the cards back above the feed.
  assert.ok(HOME.indexOf('class="home-main"') < HOME.indexOf('id="recentActivity"'));
  assert.ok(HOME.indexOf('class="home-side"') < HOME.indexOf('id="homeCards"'));
  assert.match(HOME, /\.home-main, \.home-side \{ display: contents; \}/);
  const order = (cls) => Number(HOME.match(new RegExp('\\.' + cls + ' \\{ order: (\\d+); \\}'))[1]);
  assert.ok(order('home-account') < order('home-activity'), 'account cards come before the feed on a phone');
  assert.ok(order('home-activity') < order('home-help'), 'and the feed before Need Something');
});

// ---- Request Work prefill ----

test('the request form prefills phone and address, fill-only, from the client\'s own records', () => {
  const fn = extractFn(WORK_ORDERS, 'prefillRequestContact');
  assert.match(fn, /from\('client_profiles'\)\.select\('phone'\)\.eq\('client_email', email\)/);
  assert.match(fn, /from\('client_portal_work_orders'\)\.select\('address'\)/);
  assert.match(fn, /from\('client_portal_quotes'\)\.select\('client_address'\)/);
  assert.match(fn, /if \(phone && !phoneEl\.value\.trim\(\)\)/);
  assert.match(fn, /if \(address && !addressEl\.value\.trim\(\)\)/);
  // explicit column only -- internal_notes must never reach a client
  assert.doesNotMatch(fn, /select\('\*'\)/);
});

test('a prefilled field says where the value came from, and the note goes away on edit', () => {
  const fn = extractFn(WORK_ORDERS, 'markWoPrefilled');
  assert.match(fn, /wo-prefill-note/);
  assert.match(fn, /addEventListener\('input', \(\) => el\.remove\(\), \{ once: true \}\)/);
  assert.match(extractFn(WORK_ORDERS, 'init'), /prefillRequestContact\(session\.user\.email\);/);
  assert.match(extractFn(WORK_ORDERS, 'submitRequest'), /if \(woContactEmail\) prefillRequestContact\(woContactEmail\);/);
});
