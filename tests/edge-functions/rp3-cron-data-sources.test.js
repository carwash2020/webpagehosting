// Fix plan RP3.2 / RP3.24 / RP3.26 (2026-11-07). Runs the real handlers of
// Send-Push (reminder-check, weekly-digest), send-payment-reminder and
// send-quote-followup with a stubbed Deno, database, Resend and web-push.
// Made-up data only; nothing leaves the process. Proves:
//   - the workspace_sync blob is read BY NAME (code=eq.tripleh-workspace-2026),
//     never the old unfiltered `select=data&limit=1`;
//   - invoices and quotes come from public.invoices / public.quotes;
//   - a read that fails (or finds no blob row) is a non-2xx with the reason,
//     never a quiet ok:true, sent:0;
//   - a preferences lookup that ERRORS skips the email (fails closed); a
//     missing preferences row still means "wants it";
//   - a portal quote with no source_quote_id is skipped, never keyed "null".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SERVICE_KEY = 'service-role-key-for-tests';
const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function load(name, route) {
  let src = stripTypeScriptTypes(fs.readFileSync(repo('edge-functions', `${name}-index.ts`), 'utf8'));
  src = src.replace(/^import webpush from "npm:web-push@[^"]+";$/m, '');
  const calls = [];
  const pushes = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, body: init.body });
    const r = await route(u, method, init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : null);
    if (r) return r;
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };
  let handler = null;
  const env = {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    RESEND_API_KEY: 're_test', LEAD_EMAIL_FROM: 'billing@example.com', LEAD_EMAIL_TO: 'office@example.com',
    REPORTS_EMAIL_FROM: 'reports@example.com', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv',
  };
  const webpush = {
    setVapidDetails() {},
    async sendNotification(sub, payload) { pushes.push(JSON.parse(payload)); },
  };
  vm.runInContext(src, vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    webpush, fetch, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    Intl, Date, JSON, Math, Promise, Set, Map, Number, String, Array, Object, parseInt, isNaN, encodeURIComponent, decodeURIComponent,
    crypto: globalThis.crypto, TextEncoder, Uint8Array, setTimeout, clearTimeout,
  }), { filename: `${name}-index.ts` });
  const call = async (payload) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/x', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` }, body: JSON.stringify(payload),
    }));
    return { status: res.status, body: await res.json() };
  };
  const emails = () => calls.filter((c) => c.url === 'https://api.resend.com/emails').map((c) => JSON.parse(c.body));
  return { call, calls, pushes, emails };
}

// ---------------------------------------------------------------- Send-Push

function pushRoutes(state) {
  return async (u, method) => {
    const p = new URL(u);
    if (p.pathname === '/rest/v1/workspace_sync') {
      if (state.blobFails) return j({ message: 'boom' }, 500);
      const code = p.searchParams.get('code');
      if (code !== 'eq.tripleh-workspace-2026') return j([{ data: { th_tracker_jobs: '[]' }, updated_at: new Date().toISOString() }]); // a scoped row: the wrong one
      return j(state.noBlob ? [] : [{ data: state.blob || { th_tracker_jobs: '[]' }, updated_at: new Date().toISOString() }]);
    }
    if (p.pathname === '/rest/v1/invoices') return state.invoicesFail ? j({ message: 'boom' }, 500) : j(state.invoices || []);
    if (p.pathname === '/rest/v1/quotes') return state.quotesFail ? j({ message: 'boom' }, 500) : j(state.quotes || []);
    if (p.pathname === '/rest/v1/notification_log') return method === 'GET' ? j([]) : j([], 201);
    if (p.pathname === '/rest/v1/rpc/get_internal_push_subscriptions') return j([{ id: 's1', subscription: { endpoint: 'https://push.example/1' } }]);
    if (p.pathname === '/rest/v1/th_leads') return j([]);
    if (p.pathname === '/rest/v1/th_uptime_checks') return j([]);
    if (u === 'https://api.resend.com/emails') return j({ id: 'e1' });
    return null;
  };
}

const overdueInvoiceRow = { id: 1730000000001, invoice_number: 'INV-2026-0901', client_name: 'Pat Sample', client_email: 'pat@example.com', invoice_date: daysAgo(40), terms: 'Net 15', total: 200, paid: false, paid_amount: null, job_id: 55 };

test('Send-Push reminder-check: the blob is read by name, invoices/quotes from their tables, and an overdue relational invoice is pushed', async () => {
  const g = load('send-push', pushRoutes({ invoices: [overdueInvoiceRow], quotes: [] }));
  const r = await g.call({ type: 'reminder-check' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const blobReads = g.calls.filter((c) => c.url.includes('/rest/v1/workspace_sync'));
  assert.ok(blobReads.length >= 1);
  for (const c of blobReads) assert.match(c.url, /code=eq\.tripleh-workspace-2026/, 'never the unfiltered limit=1 read');
  assert.ok(g.calls.some((c) => /\/rest\/v1\/invoices\?select=/.test(c.url)));
  assert.ok(g.calls.some((c) => /\/rest\/v1\/quotes\?select=/.test(c.url)));
  const overdue = g.pushes.find((p) => p.title === 'Invoice Overdue');
  assert.ok(overdue, 'expected the overdue push from the relational invoice');
  assert.match(overdue.body, /Pat Sample's invoice \(#INV-2026-0901\)/);
});

test('Send-Push reminder-check: a paid-in-full relational invoice (paid_amount = total) is not overdue', async () => {
  const g = load('send-push', pushRoutes({ invoices: [{ ...overdueInvoiceRow, paid: false, paid_amount: 200 }] }));
  await g.call({ type: 'reminder-check' });
  assert.equal(g.pushes.filter((p) => p.title === 'Invoice Overdue').length, 0);
});

test('Send-Push reminder-check: an unconverted relational quote linked to a job is pushed; one whose job was invoiced is not', async () => {
  const quotes = [
    { id: 9001, quote_number: 'Q-1', client_name: 'Lee Example', quote_date: daysAgo(20), status: 'approved', job_id: 77 },
    { id: 9002, quote_number: 'Q-2', client_name: 'Done Example', quote_date: daysAgo(20), status: 'approved', job_id: 55 },
  ];
  const g = load('send-push', pushRoutes({ invoices: [{ ...overdueInvoiceRow, paid_amount: 200 }], quotes }));
  await g.call({ type: 'reminder-check' });
  const q = g.pushes.filter((p) => p.title === 'Quote Never Followed Up');
  assert.equal(q.length, 1);
  assert.match(q[0].body, /Lee Example/);
});

for (const [label, state, unread] of [
  ['the blob row is missing (legacy row retired)', { noBlob: true }, 'workspace_sync (tripleh-workspace-2026)'],
  ['the blob read fails', { blobFails: true }, 'workspace_sync (tripleh-workspace-2026)'],
  ['the invoices read fails', { invoicesFail: true }, 'invoices'],
  ['the quotes read fails', { quotesFail: true }, 'quotes'],
]) {
  test(`Send-Push reminder-check: ${label} -> 502 naming it, not a quiet ok`, async () => {
    const g = load('send-push', pushRoutes({ invoices: [overdueInvoiceRow], ...state }));
    const r = await g.call({ type: 'reminder-check' });
    assert.equal(r.status, 502);
    assert.equal(r.body.ok, false);
    assert.ok(r.body.unread.includes(unread), JSON.stringify(r.body));
    if (!state.invoicesFail) assert.ok(g.pushes.some((p) => p.title === 'Invoice Overdue'), 'checks that could run still ran');
  });
}

test('Send-Push weekly-digest: reads the same sources; a failed read is a 502, the digest still goes out with what was read', async () => {
  const ok = load('send-push', pushRoutes({ invoices: [overdueInvoiceRow], quotes: [] }));
  const r = await ok.call({ type: 'weekly-digest' });
  assert.equal(r.status, 200);
  assert.match(ok.pushes.find((p) => p.title === 'Weekly Summary').body, /\$200(\.00)? outstanding/);
  for (const c of ok.calls.filter((x) => x.url.includes('workspace_sync'))) assert.match(c.url, /code=eq\.tripleh-workspace-2026/);
  const bad = load('send-push', pushRoutes({ invoicesFail: true }));
  const r2 = await bad.call({ type: 'weekly-digest' });
  assert.equal(r2.status, 502);
  assert.deepEqual(r2.body.unread, ['invoices']);
  assert.ok(bad.pushes.some((p) => p.title === 'Weekly Summary'));
});

test('Send-Push quote-response (RP3.1): an internal broadcast that lands on Clients', async () => {
  const g = load('send-push', pushRoutes({}));
  const r = await g.call({ type: 'quote-response', title: 'Quote declined', body: 'Pat declined quote #Q-1. Reason: too much' });
  assert.equal(r.status, 200);
  assert.deepEqual(g.pushes, [{ title: 'Quote declined', body: 'Pat declined quote #Q-1. Reason: too much', url: '/tools/clients.html' }]);
  assert.ok(g.calls.some((c) => c.url.endsWith('/rest/v1/rpc/get_internal_push_subscriptions')), 'internal subscriptions only');
});

// ------------------------------------------------------ send-payment-reminder

function reminderRoutes(state) {
  return async (u, method) => {
    const p = new URL(u);
    if (p.pathname === '/rest/v1/workspace_sync') throw new Error('send-payment-reminder must not read the blob any more');
    if (p.pathname === '/rest/v1/invoices') return state.invoicesFail ? j({ message: 'boom' }, 500) : j(state.invoices || []);
    if (p.pathname === '/rest/v1/notification_log') return method === 'GET' ? j([]) : j([], 201);
    if (p.pathname === '/rest/v1/client_notification_preferences') {
      if (state.prefsThrow) throw new Error('db down');
      if (state.prefsStatus) return j({ message: 'boom' }, state.prefsStatus);
      return j(state.prefs || []);
    }
    if (u === 'https://api.resend.com/emails') return j({ id: 'e1' });
    return null;
  };
}

test('send-payment-reminder: reads public.invoices and emails the client of an overdue one', async () => {
  const g = load('send-payment-reminder', reminderRoutes({ invoices: [overdueInvoiceRow] }));
  const r = await g.call({});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, checked: 1, sent: 1, invoices_read: 1 });
  assert.equal(g.emails().length, 1);
  assert.equal(g.emails()[0].to, 'pat@example.com');
  assert.match(g.emails()[0].text, /Invoice #: INV-2026-0901/);
  assert.match(g.emails()[0].text, /Amount due: \$200\.00/);
  const logged = g.calls.find((c) => c.url.includes('notification_log') && c.method === 'POST');
  assert.equal(JSON.parse(logged.body).item_key, '1730000000001', 'same dedupe key as the blob invoice id');
});

test('send-payment-reminder: a failed invoices read is a 502 and nothing is sent; an empty table says so', async () => {
  const bad = load('send-payment-reminder', reminderRoutes({ invoicesFail: true }));
  const r = await bad.call({});
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  assert.equal(bad.emails().length, 0);
  const empty = load('send-payment-reminder', reminderRoutes({ invoices: [] }));
  const r2 = await empty.call({});
  assert.equal(r2.status, 200);
  assert.equal(r2.body.warning, 'no invoices found');
  assert.equal(r2.body.invoices_read, 0);
});

test('send-payment-reminder RP3.26: a preferences lookup that errors fails CLOSED -- no email, nothing marked sent, 502', async () => {
  for (const state of [{ prefsStatus: 500 }, { prefsStatus: 404 }, { prefsThrow: true }]) {
    const g = load('send-payment-reminder', reminderRoutes({ invoices: [overdueInvoiceRow], ...state }));
    const r = await g.call({});
    assert.equal(r.status, 502, JSON.stringify(state));
    assert.equal(r.body.sent, 0);
    assert.match(r.body.error, /preferences couldn't be read/);
    assert.equal(g.emails().length, 0);
    assert.equal(g.calls.filter((c) => c.url.includes('notification_log') && c.method === 'POST').length, 0, 'retried next run');
  }
});

test('send-payment-reminder RP3.26: no preferences row still means "wants it"; an opt-out is respected', async () => {
  const none = load('send-payment-reminder', reminderRoutes({ invoices: [overdueInvoiceRow], prefs: [] }));
  assert.equal((await none.call({})).body.sent, 1);
  const out = load('send-payment-reminder', reminderRoutes({ invoices: [overdueInvoiceRow], prefs: [{ wants_invoice_quote_emails: false }] }));
  const r = await out.call({});
  assert.equal(r.status, 200);
  assert.equal(r.body.sent, 0);
  assert.equal(out.emails().length, 0);
});

// ------------------------------------------------------- send-quote-followup

function followupRoutes(state) {
  return async (u, method) => {
    const p = new URL(u);
    if (p.pathname === '/rest/v1/client_portal_quotes') return state.quotesFail ? j({ message: 'boom' }, 500) : j(state.quotes || []);
    if (p.pathname === '/rest/v1/notification_log') return method === 'GET' ? j([]) : j([], 201);
    if (p.pathname === '/rest/v1/client_notification_preferences') {
      if (state.prefsStatus) return j({ message: 'boom' }, state.prefsStatus);
      return j(state.prefs || []);
    }
    if (u === 'https://api.resend.com/emails') return j({ id: 'e1' });
    return null;
  };
}
const pendingQuote = (over = {}) => ({ id: 31, source_quote_id: 1730000000777, client_email: 'lee@example.com', client_name: 'Lee Example', quote_number: 'Q-2026-0031', quote_date: daysAgo(10), total: 450, ...over });

test('send-quote-followup: a failed quotes read is a 502, not ok:true sent:0', async () => {
  const g = load('send-quote-followup', followupRoutes({ quotesFail: true }));
  const r = await g.call({});
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
  assert.equal(g.emails().length, 0);
});

test('send-quote-followup RP3.24: a quote with no source_quote_id is skipped -- never keyed "null"', async () => {
  const g = load('send-quote-followup', followupRoutes({ quotes: [pendingQuote({ id: 1, source_quote_id: null }), pendingQuote({ id: 2, source_quote_id: null, client_email: 'other@example.com' }), pendingQuote()] }));
  const r = await g.call({});
  assert.deepEqual(r.body, { ok: true, checked: 1, sent: 1 });
  assert.equal(g.emails().length, 1);
  assert.equal(g.emails()[0].to, 'lee@example.com');
  for (const c of g.calls.filter((x) => x.url.includes('notification_log'))) assert.doesNotMatch(c.url + (c.body || ''), /item_key=eq\.null|"item_key":"null"/);
});

test('send-quote-followup RP3.26: a preferences lookup that errors fails closed; a missing row still sends', async () => {
  const bad = load('send-quote-followup', followupRoutes({ quotes: [pendingQuote()], prefsStatus: 503 }));
  const r = await bad.call({});
  assert.equal(r.status, 502);
  assert.equal(bad.emails().length, 0);
  const ok = load('send-quote-followup', followupRoutes({ quotes: [pendingQuote()], prefs: [] }));
  assert.equal((await ok.call({})).body.sent, 1);
});
