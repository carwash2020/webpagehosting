// ga4-report and ga4-conversion (Phase 5, 2026-11-04): run the real handlers
// with Google, the database and the network stubbed. Nothing reaches Google
// Analytics, and no real invoice or visitor is involved. A throwaway RSA key
// stands in for the service account key.
//
// ga4-report proves:
//   - only the cron's service-role key gets in; without the key or property
//     id it fetches nothing and says what's missing;
//   - it signs in to Google with a JWT signed by the service account key, for
//     read-only analytics, and asks the property for 30 / 90 / 365 days;
//   - it turns GA's rows into the Insights tiles and lists with the same
//     source labels as the database (Google search, Direct, Google Business,
//     Social, a campaign's name), merges a page seen under two titles, and
//     saves one cache row per period;
//   - a period Google fails on is left as yesterday's copy.
// ga4-conversion proves:
//   - only the service-role key gets in; without GA4_MP_API_SECRET nothing is
//     sent and rows stay pending;
//   - it sends one "purchase" with the invoice as transaction id, the amount,
//     USD and the anonymous visit ID; ad consent denied; nothing about the
//     client;
//   - sent rows are never sent again; a Google failure is retried up to five
//     times; rows past GA's 72-hour window expire instead of sending;
//   - the daily retry picks up every pending row.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const { stripTypeScriptTypes } = require('module');

const KEY = 'service-role-key-for-tests';
const src = (n) => stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', n + '-index.ts'), 'utf8'));
const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function load(name, env, fetchImpl) {
  let handler = null;
  const calls = [];
  const ctx = vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch: async (url, init = {}) => { calls.push({ url: String(url), init }); return fetchImpl(String(url), init); },
    Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa,
    console: { log() {}, error() {}, warn() {} }, crypto: globalThis.crypto,
  });
  vm.runInContext(src(name), ctx);
  return { handler, calls };
}
const post = (body, auth = 'Bearer ' + KEY) => new Request('https://x.supabase.co/functions/v1/f', {
  method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth ? { Authorization: auth } : {}), body: JSON.stringify(body),
});

// ---------------------------------------------------------------- ga4-report
const { privateKey, publicKey } = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ type: 'service_account', client_email: 'insights@example-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
const ENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: KEY, GA4_SERVICE_ACCOUNT_JSON: SA, GA4_PROPERTY_ID: '123456789' };

const row = (dims, mets) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((v) => ({ value: String(v) })) });
const GA_REPORTS = [
  { rows: [row([], [420, 300])] },
  { rows: [
    row(['google', 'organic', '(organic)'], [200]),
    row(['(direct)', '(none)', '(direct)'], [90]),
    row(['google', 'organic', 'gbp'], [60]),
    row(['m.facebook.com', 'referral', '(referral)'], [30]),
    row(['facebook', 'paid', 'spring-tuneup'], [25]),
    row(['bing', 'organic', '(organic)'], [15]),
  ] },
  { rows: [
    row(['/', 'Triple H Enterprises | Appliance repair'], [300]),
    row(['/booking.html', 'Book online | Triple H Enterprises'], [80]),
    row(['/', 'Home – Triple H Enterprises'], [20]),
  ] },
  { rows: [row(['phone_click'], [41]), row(['booking_completed'], [9]), row(['lead_form_submitted'], [6])] },
];

function reportFetch(state) {
  return async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(init.body).get('assertion');
      const [h, p, s] = assertion.split('.');
      state.claims = JSON.parse(Buffer.from(p, 'base64url'));
      state.signatureOk = nodeCrypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), publicKey, Buffer.from(s, 'base64url'));
      return j({ access_token: 'ga-token', expires_in: 3600 });
    }
    if (url.startsWith('https://analyticsdata.googleapis.com/')) {
      const reqBody = JSON.parse(init.body);
      state.asked.push(reqBody.requests[0].dateRanges[0].startDate);
      state.auth = init.headers.Authorization;
      if (state.failOn && reqBody.requests[0].dateRanges[0].startDate === state.failOn) return j({ error: 'quota' }, 429);
      return j({ reports: GA_REPORTS });
    }
    if (url.startsWith('https://db.example/rest/v1/ga_report_cache')) {
      state.saved.push(...JSON.parse(init.body));
      state.saveUrl = url;
      return new Response(null, { status: 201 });
    }
    throw new Error('unexpected ' + url);
  };
}

test('ga4-report: only the service-role key gets in; missing setup fetches nothing and says what is missing', async () => {
  const st = { asked: [], saved: [] };
  let f = load('ga4-report', ENV, reportFetch(st));
  assert.equal((await f.handler(post({}, 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig'))).status, 401);
  assert.equal((await f.handler(post({}, null))).status, 401);
  assert.equal(f.calls.length, 0);
  f = load('ga4-report', Object.assign({}, ENV, { SUPABASE_SERVICE_ROLE_KEY: '' }), reportFetch(st));
  assert.equal((await f.handler(post({}, 'Bearer '))).status, 401);
  f = load('ga4-report', Object.assign({}, ENV, { GA4_PROPERTY_ID: '' }), reportFetch(st));
  const r = await f.handler(post({}));
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /GA4_PROPERTY_ID/);
  assert.equal(f.calls.length, 0);
});

test('ga4-report: signs in read-only with the service account, asks for 30/90/365 days, and caches the Insights numbers', async () => {
  const st = { asked: [], saved: [] };
  const f = load('ga4-report', ENV, reportFetch(st));
  const res = await f.handler(post({}));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, saved: ['30d', '90d', '365d'], failed: {} });
  assert.equal(st.signatureOk, true, 'JWT signed with the service account key');
  assert.equal(st.claims.iss, 'insights@example-project.iam.gserviceaccount.com');
  assert.equal(st.claims.scope, 'https://www.googleapis.com/auth/analytics.readonly');
  assert.equal(st.claims.aud, 'https://oauth2.googleapis.com/token');
  assert.deepEqual(st.asked, ['30daysAgo', '90daysAgo', '365daysAgo']);
  assert.equal(st.auth, 'Bearer ga-token');
  assert.ok(f.calls.some((c) => c.url === 'https://analyticsdata.googleapis.com/v1beta/properties/123456789:batchRunReports'));
  assert.equal(st.saveUrl, 'https://db.example/rest/v1/ga_report_cache?on_conflict=tenant_id,period');
  assert.deepEqual(st.saved.map((s) => s.period), ['30d', '90d', '365d']);
  const r = st.saved[1].report;
  assert.equal(r.sessions, 420);
  assert.equal(r.users, 300);
  assert.equal(r.calls, 41);
  assert.equal(r.bookings, 9);
  assert.equal(r.lead_forms, 6);
  assert.equal(r.texts, 0);
  assert.deepEqual(Array.from(r.channels, (c) => [c.name, c.sessions]), [
    ['Google search', 200], ['Direct', 90], ['Google Business', 60], ['Social', 30], ['spring-tuneup', 25], ['Other search', 15],
  ]);
  assert.deepEqual(Array.from(r.pages, (p) => [p.path, p.title, p.views]), [
    ['/', 'Appliance repair', 320], ['/booking.html', 'Book online', 80],
  ], 'the home page seen under two titles is one row; the business name is trimmed off');
  for (const call of f.calls) assert.doesNotMatch(String(call.init.body || ''), /BEGIN PRIVATE KEY/, 'the key itself never leaves');
});

test('ga4-report: a period Google refuses keeps yesterday\'s copy; the others still save', async () => {
  const st = { asked: [], saved: [], failOn: '365daysAgo' };
  const f = load('ga4-report', ENV, reportFetch(st));
  const res = await f.handler(post({}));
  assert.deepEqual(await res.json(), { ok: false, saved: ['30d', '90d'], failed: { '365d': 'Google answered 429' } });
  assert.deepEqual(st.saved.map((s) => s.period), ['30d', '90d']);
});

// ------------------------------------------------------------ ga4-conversion
const CENV = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: KEY, GA4_MP_API_SECRET: 'mp-secret' };
function convFetch(state) {
  return async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (url.startsWith('https://db.example/rest/v1/ga_conversions')) {
      const u = new URL(url);
      if (method === 'GET') {
        const id = u.searchParams.get('invoice_id');
        const rows = state.rows.filter((r) => (id ? 'eq.' + r.invoice_id === id : r.status === 'pending'));
        return j(rows);
      }
      if (method === 'PATCH') {
        const id = Number(u.searchParams.get('invoice_id').slice(3));
        Object.assign(state.rows.find((r) => r.invoice_id === id), JSON.parse(init.body));
        return new Response(null, { status: 204 });
      }
    }
    if (url.startsWith('https://www.google-analytics.com/mp/collect')) {
      state.sent.push({ url, body: JSON.parse(init.body) });
      return new Response(null, { status: state.googleStatus || 204 });
    }
    throw new Error('unexpected ' + url);
  };
}
const fresh = (over = {}) => Object.assign({ invoice_id: 5001, ga_client_id: '1234567890.1700000000', value: '240.00', currency: 'USD', queued_at: new Date(Date.now() - 60000).toISOString(), status: 'pending', attempts: 0 }, over);

test('ga4-conversion: only the service-role key gets in; without the Measurement Protocol secret nothing is sent', async () => {
  const st = { rows: [fresh()], sent: [] };
  let f = load('ga4-conversion', CENV, convFetch(st));
  assert.equal((await f.handler(post({ invoice_id: 5001 }, 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig'))).status, 401);
  assert.equal(f.calls.length, 0);
  f = load('ga4-conversion', Object.assign({}, CENV, { GA4_MP_API_SECRET: '' }), convFetch(st));
  assert.equal((await f.handler(post({ invoice_id: 5001 }))).status, 503);
  assert.equal(f.calls.length, 0);
  assert.equal(st.rows[0].status, 'pending');
});

test('ga4-conversion: one purchase with the invoice as transaction id, the amount, USD and the visit ID; nothing about the client; never twice', async () => {
  const st = { rows: [fresh()], sent: [] };
  const f = load('ga4-conversion', CENV, convFetch(st));
  const res = await f.handler(post({ invoice_id: 5001 }));
  assert.deepEqual(await res.json(), { ok: true, results: { sent: 1 } });
  assert.equal(st.sent.length, 1);
  const { url, body } = st.sent[0];
  assert.equal(url, 'https://www.google-analytics.com/mp/collect?measurement_id=G-TMJJMGY2DQ&api_secret=mp-secret');
  assert.equal(body.client_id, '1234567890.1700000000');
  assert.deepEqual(body.consent, { ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
  assert.equal(body.events.length, 1);
  assert.deepEqual(body.events[0], { name: 'purchase', params: { transaction_id: 'invoice-5001', value: 240, currency: 'USD', source: 'invoice_paid' } });
  assert.deepEqual(Object.keys(body).sort(), ['client_id', 'consent', 'events', 'non_personalized_ads', 'timestamp_micros']);
  assert.equal(st.rows[0].status, 'sent');
  assert.equal(st.rows[0].attempts, 1);
  await f.handler(post({ invoice_id: 5001 }));
  assert.equal(st.sent.length, 1, 'already sent: not again');
  const none = await f.handler(post({ invoice_id: 9999 }));
  assert.deepEqual(await none.json(), { ok: true, skipped: 'nothing queued for this invoice' });
  assert.equal((await f.handler(post({ invoice_id: 'abc' }))).status, 400);
});

test('ga4-conversion: Google failing is retried up to five times; past the 72-hour window it expires instead of sending', async () => {
  const st = { rows: [fresh({ attempts: 3 })], sent: [], googleStatus: 500 };
  const f = load('ga4-conversion', CENV, convFetch(st));
  await f.handler(post({ invoice_id: 5001 }));
  assert.equal(st.rows[0].status, 'pending');
  assert.equal(st.rows[0].attempts, 4);
  assert.equal(st.rows[0].last_error, 'Google answered 500');
  await f.handler(post({ invoice_id: 5001 }));
  assert.equal(st.rows[0].status, 'failed', 'fifth try: give up');

  const old = { rows: [fresh({ queued_at: new Date(Date.now() - 73 * 3600000).toISOString() })], sent: [] };
  const g = load('ga4-conversion', CENV, convFetch(old));
  await g.handler(post({ invoice_id: 5001 }));
  assert.equal(old.sent.length, 0);
  assert.equal(old.rows[0].status, 'expired');
});

test('ga4-conversion: the daily retry sends every pending row and leaves sent ones alone', async () => {
  const st = { rows: [fresh({ invoice_id: 1 }), fresh({ invoice_id: 2, status: 'sent' }), fresh({ invoice_id: 3 })], sent: [] };
  const f = load('ga4-conversion', CENV, convFetch(st));
  const res = await f.handler(post({ retry_pending: true }));
  assert.deepEqual(await res.json(), { ok: true, results: { sent: 2 } });
  assert.deepEqual(st.sent.map((s) => s.body.events[0].params.transaction_id), ['invoice-1', 'invoice-3']);
});

test('ga4-report: keys from Google can never reach an object prototype, and hostile titles stay fast', async () => {
  const st = { asked: [], saved: [] };
  const evil = [
    { rows: [row([], [1, 1])] },
    { rows: [row(['__proto__', 'referral', '(referral)'], [5]), row(['constructor', 'organic', '(organic)'], [3])] },
    { rows: [row(['__proto__', 'x'.repeat(5000) + ' '.repeat(20000) + '!'], [7]), row(['/', 'Home | Triple H Enterprises'], [4])] },
    { rows: [row(['__proto__'], [9]), row(['phone_click'], [2])] },
  ];
  const f = load('ga4-report', ENV, async (url, init) => {
    if (url.startsWith('https://analyticsdata.googleapis.com/')) return j({ reports: evil });
    return reportFetch(st)(url, init);
  });
  const t0 = Date.now();
  await f.handler(post({}));
  assert.ok(Date.now() - t0 < 2000, 'no slow pattern on a long hostile title');
  const r = st.saved[0].report;
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
  assert.equal(r.calls, 2);
  assert.deepEqual(Array.from(r.pages, (p) => p.path), ['__proto__', '/'], 'a page literally named __proto__ is just a row');
  assert.equal(r.pages[1].title, 'Home');
  assert.ok(r.pages[0].title.length <= 80);
});
