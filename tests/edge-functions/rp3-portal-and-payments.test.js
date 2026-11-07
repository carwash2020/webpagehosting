// Fix plan Round-2 Phase 3 (2026-11-07): client-facing actions and money
// paths. Runs each real handler with a stubbed Deno, database, Stripe,
// Resend and Send-Push; made-up clients and amounts only, nothing leaves the
// process. Proves:
//   RP3.1  respond-to-quote tells staff (email + push) on approve AND
//          decline (with the reason), and a failed notice never blocks the
//          client's answer;
//   RP3.8  schedule-checkup-visit: booked marker + conditional write + undo;
//   RP3.11 schedule-quote-job: a failing quote PATCH is retried once, then
//          502 with the booking undone (never ok:true);
//   RP3.16 create-pos-charge refuses an unknown mode;
//   RP3.27 create-pos-charge 'check' needs can_manage_invoices (D29);
//   RP3.19 POS income-log writes are version-checked and de-duplicated, in
//          create-pos-charge and stripe-webhook alike;
//   RP3.29 delete-portal-invoice cancels an open PaymentIntent first, refuses
//          while one is going through, and deletes nothing if Stripe can't be
//          asked; stripe-webhook alerts staff to a payment matching no invoice;
//   RP3.31 send-booking-email reports ok with a breakdown once the guest's
//          confirmation went.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const SRK = 'service-role-key-for-tests';
const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const jwt = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';
const CLIENT = 'pat@example.com';
const STAFF = 'office@example.com';
const clientToken = jwt({ role: 'authenticated', email: CLIENT, sub: 'u-pat' });
const staffToken = (email = STAFF) => jwt({ role: 'authenticated', email, sub: `u-${email}`, aal: 'aal2' });

class FakeStripe {
  constructor() {
    this.webhooks = { constructEventAsync: async (body, sig) => { if (sig !== 'good') throw new Error('bad sig'); return JSON.parse(body); } };
  }
  static createFetchHttpClient() { return {}; }
  static createSubtleCryptoProvider() { return {}; }
}

function load(name, route, envOver = {}) {
  let src = stripTypeScriptTypes(fs.readFileSync(repo('edge-functions', `${name}-index.ts`), 'utf8'));
  src = src.replace(/^import Stripe from "npm:stripe@latest";$/m, '');
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    let body = null;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } } else if (init.body) body = String(init.body);
    calls.push({ url: u, method, body, headers: init.headers || {} });
    const r = await route(u, method, body, new URL(u));
    if (r) return r;
    throw new Error(`unexpected fetch: ${method} ${u}`);
  };
  let handler = null;
  const env = {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SRK, RESEND_API_KEY: 're_test',
    LEAD_EMAIL_FROM: 'office@example.com', LEAD_EMAIL_TO: 'office@example.com', STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_POS_SECRET_KEY: 'rk_test_pos', STRIPE_WEBHOOK_SIGNING_SECRET: 'whsec_x', ...envOver,
  };
  vm.runInContext(src, vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    Stripe: FakeStripe, fetch, Response, Request, Headers, URL, URLSearchParams, atob, btoa,
    console: { log() {}, error() {}, warn() {} },
    Intl, Date, JSON, Math, Promise, Set, Map, Number, String, Array, Object, parseInt, isNaN, encodeURIComponent, decodeURIComponent,
    crypto: globalThis.crypto, TextEncoder, Uint8Array, setTimeout,
  }), { filename: `${name}-index.ts` });
  const call = async (payload, bearer, extraHeaders = {}) => {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const res = await handler(new Request('https://example.supabase.co/functions/v1/x', { method: 'POST', headers, body: JSON.stringify(payload) }));
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };
  return { call, calls };
}

// ------------------------------------------------------------ respond-to-quote

function quoteRoutes(st) {
  return async (u, method, body, p) => {
    if (p.pathname === '/rest/v1/client_email_aliases') return j([]);
    if (p.pathname === '/rest/v1/client_portal_quotes' && method === 'GET') return j([st.quote]);
    if (p.pathname === '/rest/v1/client_portal_quotes' && method === 'PATCH') {
      if (st.patchFails) return j({ message: 'column "decline_reason" violates check constraint quotes_ck' }, 400);
      Object.assign(st.quote, body);
      return new Response(null, { status: 204 });
    }
    if (u === 'https://api.resend.com/emails') { (st.emails = st.emails || []).push(body); if (st.emailThrows) throw new Error('resend down'); return st.emailFails ? j({}, 500) : j({ id: 'e' }); }
    if (p.pathname === '/functions/v1/Send-Push') { (st.pushes = st.pushes || []).push(body); if (st.pushThrows) throw new Error('push down'); return j({ ok: true }); }
    return null;
  };
}
const pendingQuote = () => ({ id: 12, client_email: CLIENT, client_name: 'Pat Sample', quote_number: 'Q-2026-0012', description: 'Fence repair', total: 640, status: 'pending' });

test('respond-to-quote RP3.1: an approval emails Steve and Connor and pushes staff ("ready to schedule")', async () => {
  const st = { quote: pendingQuote() };
  const g = load('respond-to-quote', quoteRoutes(st));
  const r = await g.call({ quote_id: 12, action: 'approve' }, clientToken);
  assert.deepEqual(r.body, { ok: true, status: 'approved' });
  assert.equal(st.emails.length, 1);
  assert.deepEqual(st.emails[0].to, ['steve@triplehenterprisesllc.biz', 'connor@triplehenterprisesllc.biz']);
  assert.match(st.emails[0].subject, /^Approved: quote #Q-2026-0012 \(Pat Sample\)$/);
  assert.match(st.emails[0].text, /ready to schedule/);
  assert.deepEqual(st.pushes, [{ type: 'quote-response', title: 'Quote approved', body: 'Pat Sample approved quote #Q-2026-0012. Ready to schedule.' }]);
});

test('respond-to-quote RP3.1: a decline carries the client\'s reason (escaped in the email) to staff', async () => {
  const st = { quote: pendingQuote() };
  const g = load('respond-to-quote', quoteRoutes(st));
  const r = await g.call({ quote_id: 12, action: 'decline', decline_reason: 'Too pricey <b>sorry</b>' }, clientToken);
  assert.deepEqual(r.body, { ok: true, status: 'declined' });
  assert.match(st.emails[0].subject, /^Declined:/);
  assert.match(st.emails[0].html, /Too pricey &lt;b&gt;sorry&lt;\/b&gt;/);
  assert.match(st.emails[0].text, /Their reason: "Too pricey <b>sorry<\/b>"/);
  assert.equal(st.pushes[0].title, 'Quote declined');
  assert.match(st.pushes[0].body, /Reason: Too pricey/);
  const noReason = { quote: pendingQuote() };
  await load('respond-to-quote', quoteRoutes(noReason)).call({ quote_id: 12, action: 'decline' }, clientToken);
  assert.match(noReason.emails[0].text, /didn't give a reason/);
});

test('respond-to-quote RP3.1: a failed or throwing notice never blocks or undoes the client\'s answer', async () => {
  for (const fail of [{ emailFails: true }, { emailThrows: true, pushThrows: true }]) {
    const st = { quote: pendingQuote(), ...fail };
    const r = await load('respond-to-quote', quoteRoutes(st)).call({ quote_id: 12, action: 'decline', decline_reason: 'no' }, clientToken);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, status: 'declined' });
    assert.equal(st.quote.status, 'declined');
  }
});

test('respond-to-quote: a failed save tells nobody and returns no database text (RP3.22)', async () => {
  const st = { quote: pendingQuote(), patchFails: true };
  const r = await load('respond-to-quote', quoteRoutes(st)).call({ quote_id: 12, action: 'approve' }, clientToken);
  assert.equal(r.status, 502);
  assert.doesNotMatch(JSON.stringify(r.body), /constraint|column/);
  assert.equal((st.emails || []).length + (st.pushes || []).length, 0);
});

// ------------------------------------------------- schedule-checkup-visit (RP3.8)

const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
function checkupRoutes(st) {
  st.bookings = st.bookings || [];
  st.deleted = [];
  return async (u, method, body, p) => {
    if (p.pathname === '/rest/v1/client_email_aliases') return j([]);
    if (p.pathname === '/rest/v1/client_portal_checkups' && method === 'GET') return j([st.checkup]);
    if (p.pathname === '/rest/v1/client_portal_checkups' && method === 'PATCH') {
      st.patches = (st.patches || 0) + 1;
      if (st.patchStatuses && st.patchStatuses.length) { const s = st.patchStatuses.shift(); if (s !== 200) return j({ message: 'boom' }, s); }
      if (st.raceWinner) { st.checkup.scheduled_at = st.raceWinner; return j([]); }
      const want = p.searchParams.get('scheduled_at');
      const matches = want === 'is.null' ? !st.checkup.scheduled_at : want === `eq.${st.checkup.scheduled_at}`;
      if (!matches) return j([]);
      st.checkup.scheduled_at = body.scheduled_at;
      return j([st.checkup]);
    }
    if (p.pathname === '/rest/v1/th_bookings' && method === 'GET') {
      if (st.activeFails) return j({ message: 'boom' }, 500);
      return j(st.bookings.filter((b) => b.status === 'confirmed' && b.checkup_id === st.checkup.id && Date.parse(b.end_at) >= Date.now()).map((b) => ({ id: b.id })));
    }
    if (p.pathname === '/rest/v1/th_bookings' && method === 'POST') {
      const row = { id: 900 + st.bookings.length, status: 'confirmed', ...body[0] };
      st.bookings.push(row);
      return j([row], 201);
    }
    if (p.pathname === '/rest/v1/th_bookings' && method === 'DELETE') {
      const id = Number((p.searchParams.get('id') || '').replace('eq.', ''));
      st.deleted.push(id);
      st.bookings = st.bookings.filter((b) => b.id !== id);
      return new Response(null, { status: 204 });
    }
    return null;
  };
}
const checkup = (over = {}) => ({ id: 3, client_email: CLIENT, client_name: 'Pat Sample', title: 'Gutter check', scheduled_at: null, ...over });
const slot = () => ({ checkup_id: 3, start_at: inHours(48), end_at: inHours(49) });

test('schedule-checkup-visit RP3.8: a booking sets the booked marker with a conditional write (is.null the first time)', async () => {
  const st = { checkup: checkup() };
  const g = load('schedule-checkup-visit', checkupRoutes(st));
  const r = await g.call(slot(), clientToken);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(st.bookings.length, 1);
  assert.ok(st.checkup.scheduled_at, 'marker set');
  const patch = g.calls.find((c) => c.method === 'PATCH');
  assert.match(patch.url, /client_portal_checkups\?id=eq\.3&scheduled_at=is\.null/);
});

test('schedule-checkup-visit RP3.8: a second tap while a visit is still to come is refused before anything is booked', async () => {
  const st = { checkup: checkup() };
  const g = load('schedule-checkup-visit', checkupRoutes(st));
  await g.call(slot(), clientToken);
  const again = await g.call({ ...slot(), start_at: inHours(72), end_at: inHours(73) }, clientToken);
  assert.equal(again.status, 409);
  assert.equal(st.bookings.length, 1, 'no second appointment');
});

test('schedule-checkup-visit RP3.8: losing the race undoes exactly the booking this request made', async () => {
  const st = { checkup: checkup(), raceWinner: '2026-11-07T10:00:00.000Z' };
  const g = load('schedule-checkup-visit', checkupRoutes(st));
  const r = await g.call(slot(), clientToken);
  assert.equal(r.status, 409);
  assert.deepEqual(st.deleted, [900]);
  assert.equal(st.bookings.length, 0);
});

test('schedule-checkup-visit RP3.8: a marker write that fails twice -> 502 and the booking undone; one failure is retried', async () => {
  const twice = { checkup: checkup(), patchStatuses: [500, 500] };
  const r = await load('schedule-checkup-visit', checkupRoutes(twice)).call(slot(), clientToken);
  assert.equal(r.status, 502);
  assert.equal(twice.bookings.length, 0);
  assert.equal(twice.patches, 2);
  const once = { checkup: checkup(), patchStatuses: [503] };
  const r2 = await load('schedule-checkup-visit', checkupRoutes(once)).call(slot(), clientToken);
  assert.deepEqual(r2.body, { ok: true });
  assert.equal(once.bookings.length, 1);
});

test('schedule-checkup-visit RP3.8: the reminder recurs -- a past booking does not block the next one; an unreadable list fails closed', async () => {
  const st = { checkup: checkup({ scheduled_at: '2026-01-02T00:00:00.000Z' }), bookings: [{ id: 700, status: 'confirmed', checkup_id: 3, end_at: '2026-01-10T18:00:00.000Z' }] };
  const r = await load('schedule-checkup-visit', checkupRoutes(st)).call(slot(), clientToken);
  assert.deepEqual(r.body, { ok: true });
  const down = { checkup: checkup(), activeFails: true };
  const r2 = await load('schedule-checkup-visit', checkupRoutes(down)).call(slot(), clientToken);
  assert.equal(r2.status, 502);
  assert.equal(down.bookings.length, 0);
});

// --------------------------------------------------- schedule-quote-job (RP3.11)

function quoteJobRoutes(st) {
  st.bookings = st.bookings || [];
  st.deleted = [];
  return async (u, method, body, p) => {
    if (p.pathname === '/rest/v1/client_email_aliases') return j([]);
    if (p.pathname === '/rest/v1/client_portal_quotes' && method === 'GET') return j([st.quote]);
    if (p.pathname === '/rest/v1/client_portal_quotes' && method === 'PATCH') {
      st.patches = (st.patches || 0) + 1;
      if (st.patchStatuses && st.patchStatuses.length) { const s = st.patchStatuses.shift(); if (s !== 200) return j({ message: 'boom' }, s); }
      if (st.landsThenThrows) { st.landsThenThrows = false; st.quote.scheduled_at = body.scheduled_at; throw new Error('connection reset'); }
      if (st.quote.scheduled_at) return j([]);
      st.quote.scheduled_at = body.scheduled_at;
      return j([st.quote]);
    }
    if (p.pathname === '/rest/v1/th_bookings' && method === 'POST') {
      const row = { id: 800 + st.bookings.length, status: 'confirmed', ...body[0] };
      st.bookings.push(row);
      return j([row], 201);
    }
    if (p.pathname === '/rest/v1/th_bookings' && method === 'DELETE') {
      st.deleted.push(p.searchParams.get('id'));
      st.bookings = [];
      return new Response(null, { status: 204 });
    }
    return null;
  };
}
const approvedQuote = () => ({ id: 21, client_email: CLIENT, client_name: 'Pat Sample', client_address: '1 Main', quote_number: 'Q-21', description: 'Fence', status: 'approved', scheduled_at: null });
const qslot = () => ({ quote_id: 21, start_at: inHours(48), end_at: inHours(50) });

test('schedule-quote-job RP3.11: a quote PATCH that fails twice is a 502 with the booking undone -- never ok:true', async () => {
  for (const statuses of [[500, 500], [400, 503]]) {
    const st = { quote: approvedQuote(), patchStatuses: statuses.slice() };
    const r = await load('schedule-quote-job', quoteJobRoutes(st)).call(qslot(), clientToken);
    assert.equal(r.status, 502);
    assert.equal(r.body.ok, false);
    assert.equal(st.patches, 2, 'retried once');
    assert.deepEqual(st.deleted, ['eq.800'], 'exactly this booking undone');
    assert.equal(st.quote.scheduled_at, null);
  }
});

test('schedule-quote-job RP3.11: one failed PATCH is retried and succeeds', async () => {
  const st = { quote: approvedQuote(), patchStatuses: [500] };
  const r = await load('schedule-quote-job', quoteJobRoutes(st)).call(qslot(), clientToken);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(st.bookings.length, 1);
  assert.ok(st.quote.scheduled_at);
});

test('schedule-quote-job RP3.11: a first PATCH that landed but whose answer was lost is recognised as ours on the retry (not undone)', async () => {
  const st = { quote: approvedQuote(), landsThenThrows: true };
  const route = quoteJobRoutes(st);
  const wrapped = async (u, method, body, p) => {
    if (p.pathname === '/rest/v1/client_portal_quotes' && method === 'GET' && p.searchParams.get('select') === 'scheduled_at') return j([{ scheduled_at: st.quote.scheduled_at }]);
    return route(u, method, body, p);
  };
  const r = await load('schedule-quote-job', wrapped).call(qslot(), clientToken);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(st.bookings.length, 1, 'the booking stands');
  assert.deepEqual(st.deleted, []);
});

test('schedule-quote-job: the race-loss path still undoes the booking (409)', async () => {
  const st = { quote: approvedQuote() };
  const route = quoteJobRoutes(st);
  const racing = async (u, method, body, p) => {
    if (p.pathname === '/rest/v1/client_portal_quotes' && method === 'PATCH') return j([]);
    return route(u, method, body, p);
  };
  const r = await load('schedule-quote-job', racing).call(qslot(), clientToken);
  assert.equal(r.status, 409);
  assert.deepEqual(st.deleted, ['eq.800']);
});

// ------------------------------------------------------------ create-pos-charge

function posRoutes(st) {
  st.blobs = st.blobs || { 'tripleh-workspace-2026': { data: { th_income_log: '[]' }, updated_at: '2026-11-07T10:00:00.000001+00:00' } };
  return async (u, method, body, p) => {
    if (p.pathname === '/rest/v1/account_roles') {
      const email = decodeURIComponent((u.match(/email=eq\.([^&]+)/) || [])[1] || '');
      const row = (st.roles || {})[email];
      return j(row ? [{ email, ...row }] : []);
    }
    if (p.pathname === '/rest/v1/rpc/check_internal_mfa_for_edge_function') return j(true);
    if (p.pathname === '/rest/v1/stripe_customers') return j(st.customer ? [{ stripe_customer_id: 'cus_1' }] : []);
    if (p.hostname === 'api.stripe.com' && p.pathname === '/v1/payment_methods') return j({ data: [{ id: 'pm_1', card: { brand: 'visa', last4: '4242' } }] });
    if (p.hostname === 'api.stripe.com' && p.pathname === '/v1/payment_intents' && method === 'POST') return j({ id: 'pi_pos_1', status: 'succeeded', client_secret: 'sec' });
    if (p.hostname === 'api.stripe.com') return j({ id: 'cus_new' });
    if (p.pathname === '/rest/v1/card_authorizations') { st.authorizations = (st.authorizations || 0) + 1; return j([], 201); }
    if (p.pathname === '/rest/v1/stripe_pos_charges_logged') return j([{ payment_intent_id: body.payment_intent_id }], 201);
    if (p.pathname === '/rest/v1/workspace_sync') return blobRoute(st, method, body, p);
    if (u === 'https://api.resend.com/emails') return j({ id: 'e' });
    return null;
  };
}
// One row per code with an updated_at version, like the real table. A
// PATCH filtered on a stale updated_at matches nothing.
function blobRoute(st, method, body, p) {
  const code = (p.searchParams.get('code') || '').replace(/^eq\./, '');
  const row = st.blobs[code];
  if (method === 'GET') return j(row ? [{ data: JSON.parse(JSON.stringify(row.data)), updated_at: row.updated_at }] : []);
  if (method === 'PATCH') {
    st.patchUrls = (st.patchUrls || []).concat(p.href);
    if (st.concurrentWriteOnce && st.concurrentWriteOnce[code]) {
      // Another device writes between our read and our write.
      const other = st.concurrentWriteOnce[code];
      delete st.concurrentWriteOnce[code];
      const log = JSON.parse(row.data.th_income_log || '[]');
      log.push(other);
      row.data.th_income_log = JSON.stringify(log);
      row.updated_at = '2026-11-07T10:00:05.000001+00:00';
    }
    const want = decodeURIComponent((p.searchParams.get('updated_at') || '').replace(/^eq\./, ''));
    if (!row || want !== row.updated_at) return j([]);
    row.data = body.data;
    row.updated_at = body.updated_at;
    return j([{ code }]);
  }
  return null;
}
// The parsed host, not a string prefix (CodeQL js/incomplete-url-substring-sanitization).
const isStripe = (url) => { try { return new URL(url).hostname === 'api.stripe.com'; } catch (e) { return false; } };
const income = (st, code = 'tripleh-workspace-2026') => JSON.parse(st.blobs[code].data.th_income_log || '[]');

test('create-pos-charge RP3.16: an unknown mode is a 400 -- no PaymentIntent, no card authorization', async () => {
  for (const mode of ['new-card', 'refund', undefined, '', 'CHECK']) {
    const st = { roles: { [STAFF]: { can_manage_invoices: true } } };
    const g = load('create-pos-charge', posRoutes(st));
    const r = await g.call({ mode, client_email: 'client@example.com', amount: 50, description: 'x', signer_name: 'Pat', signature_image: 'data:image/png;base64,AA' }, staffToken());
    assert.equal(r.status, 400, String(mode));
    assert.equal(g.calls.filter((c) => isStripe(c.url)).length, 0);
    assert.equal(st.authorizations || 0, 0);
  }
});

test('create-pos-charge RP3.27 / D29: "check" needs can_manage_invoices; others get 403 and learn nothing', async () => {
  const st = { roles: { 'tech@example.com': { can_manage_invoices: false }, [STAFF]: { can_manage_invoices: true } }, customer: true };
  const g = load('create-pos-charge', posRoutes(st));
  const denied = await g.call({ mode: 'check', client_email: 'client@example.com' }, staffToken('tech@example.com'));
  assert.equal(denied.status, 403);
  assert.doesNotMatch(JSON.stringify(denied.body), /4242|visa|has_saved_card/);
  assert.equal(g.calls.filter((c) => c.url.includes('stripe_customers') || isStripe(c.url)).length, 0);
  const ok = await g.call({ mode: 'check', client_email: 'client@example.com' }, staffToken());
  assert.deepEqual(ok.body, { ok: true, has_saved_card: true, brand: 'visa', last4: '4242' });
});

test('create-pos-charge RP3.19: a sale logged while another device writes the row is not lost -- the write is version-checked and retried', async () => {
  const other = { id: 1, desc: 'Other sale', amount: 10, origin: 'pos', stripePaymentIntentId: 'pi_other' };
  const st = { roles: { [STAFF]: { can_manage_invoices: true } }, customer: true, concurrentWriteOnce: { 'tripleh-workspace-2026': other } };
  const r = await load('create-pos-charge', posRoutes(st)).call({ mode: 'charge_saved', client_email: 'client@example.com', amount: 75, description: 'Faucet', request_id: 'req-0123456789abcdef' }, staffToken());
  assert.equal(r.body.ok, true);
  const log = income(st);
  assert.deepEqual(log.map((e) => e.stripePaymentIntentId).sort(), ['pi_other', 'pi_pos_1'], 'both entries survive');
  assert.ok(st.patchUrls.every((u) => /updated_at=eq\./.test(u)), 'every write carries the version it read');
  assert.equal(st.patchUrls.length, 2);
});

test('create-pos-charge RP3.19: an entry already in the log for this PaymentIntent is never added twice', async () => {
  const st = { roles: { [STAFF]: { can_manage_invoices: true } }, customer: true,
    blobs: { 'tripleh-workspace-2026': { data: { th_income_log: JSON.stringify([{ id: 9, stripePaymentIntentId: 'pi_pos_1' }]) }, updated_at: 'v1' } } };
  await load('create-pos-charge', posRoutes(st)).call({ mode: 'charge_saved', client_email: 'client@example.com', amount: 75, request_id: 'req-0123456789abcdef' }, staffToken());
  assert.equal(income(st).length, 1);
  assert.equal((st.patchUrls || []).length, 0);
});

// --------------------------------------------------------------- stripe-webhook

function webhookRoutes(st) {
  st.blobs = st.blobs || { 'tripleh-workspace-2026': { data: { th_income_log: '[]', th_invoices: '[]' }, updated_at: 'v1' } };
  st.pushes = [];
  return async (u, method, body, p) => {
    if (p.pathname === '/rest/v1/rpc/stripe_record_event') return j(st.result);
    if (p.pathname === '/rest/v1/workspace_sync') return blobRoute(st, method, body, p);
    if (p.pathname === '/functions/v1/Send-Push') { st.pushes.push(body); return j({ ok: true }); }
    if (u === 'https://api.resend.com/emails') return j({ id: 'e' });
    return null;
  };
}
const deliver = (g, pi) => g.call({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: pi } }, null, { 'Stripe-Signature': 'good' });
const posPi = { id: 'pi_wh_pos', amount: 5000, metadata: { pos_charge: 'true', pos_client_email: 'client@example.com', pos_description: 'Tap', pos_amount: '50', internal_account: STAFF } };

test('stripe-webhook RP3.19: logPosIncome re-checks for the PaymentIntent in the log before adding it (not only the RPC claim)', async () => {
  const st = { result: { action: 'pos_charge', pos_first: true },
    blobs: { 'tripleh-workspace-2026': { data: { th_income_log: JSON.stringify([{ id: 1, stripePaymentIntentId: 'pi_wh_pos' }]) }, updated_at: 'v1' } } };
  const r = await deliver(load('stripe-webhook', webhookRoutes(st)), posPi);
  assert.equal(r.status, 200);
  assert.equal(income(st).length, 1);
  assert.equal((st.patchUrls || []).length, 0);
});

test('stripe-webhook RP3.19: logPosIncome is version-checked, so a concurrent write is kept', async () => {
  const st = { result: { action: 'pos_charge', pos_first: true }, concurrentWriteOnce: { 'tripleh-workspace-2026': { id: 2, stripePaymentIntentId: 'pi_other' } } };
  await deliver(load('stripe-webhook', webhookRoutes(st)), posPi);
  assert.deepEqual(income(st).map((e) => e.stripePaymentIntentId).sort(), ['pi_other', 'pi_wh_pos']);
  assert.ok(st.patchUrls.every((u) => /updated_at=eq\./.test(u)));
});

test('stripe-webhook RP3.29: a payment matching no invoice alerts staff; a matched one and a POS sale do not', async () => {
  const orphan = { result: { action: 'invoice_payment', warning: 'no matching invoice', payment_id: 1 } };
  const r = await deliver(load('stripe-webhook', webhookRoutes(orphan)), { id: 'pi_orphan', amount: 12000, amount_received: 12000, metadata: { client_portal_invoice_id: '77' } });
  assert.equal(r.status, 200);
  assert.equal(orphan.pushes.length, 1);
  assert.equal(orphan.pushes[0].type, 'stripe-reconciliation-alert');
  assert.equal(orphan.pushes[0].title, 'Payment matches no invoice');
  assert.match(orphan.pushes[0].body, /pi_orphan for \$120\.00 .*portal invoice id 77/);

  const matched = { result: { action: 'invoice_payment', invoices_marked_paid: [] } };
  await deliver(load('stripe-webhook', webhookRoutes(matched)), { id: 'pi_ok', amount: 100, metadata: { client_portal_invoice_id: '5' } });
  assert.equal(matched.pushes.length, 0);
  const posLike = { result: { action: 'invoice_payment', warning: 'no matching invoice' } };
  await deliver(load('stripe-webhook', webhookRoutes(posLike)), { id: 'pi_pos_x', amount: 100, metadata: { pos_charge: 'true' } });
  assert.equal(posLike.pushes.length, 0);
});

// ------------------------------------------------------- delete-portal-invoice

function deleteRoutes(st) {
  st.deleted = false; st.canceled = [];
  return async (u, method, body, p) => {
    if (p.pathname === '/rest/v1/account_roles') return j([{ can_manage_invoices: true }]);
    if (p.pathname === '/rest/v1/rpc/check_internal_mfa_for_edge_function') return j(true);
    if (p.pathname === '/rest/v1/client_portal_invoices' && method === 'GET') return j(st.rows);
    if (p.pathname === '/rest/v1/client_portal_invoices' && method === 'DELETE') { st.deleted = true; return j(st.rows); }
    const m = p.hostname === 'api.stripe.com' && p.pathname.match(/^\/v1\/payment_intents\/([^/]+)(\/cancel)?$/);
    if (m) {
      if (st.stripeThrows) throw new Error('stripe unreachable');
      if (m[2]) { st.canceled.push(m[1]); return st.cancelStatus ? j({ error: { code: st.cancelCode || 'x' } }, st.cancelStatus) : j({ id: m[1], status: 'canceled' }); }
      if (st.retrieveStatus) return j({ error: {} }, st.retrieveStatus);
      return st.pi ? j(st.pi) : j({ error: { code: 'resource_missing' } }, 404);
    }
    return null;
  };
}
const unpaidRow = (over = {}) => ({ id: 41, paid: false, invoice_number: 'INV-41', stripe_payment_intent_id: 'pi_open', ...over });

test('delete-portal-invoice RP3.29: an open PaymentIntent is canceled first, then the row is deleted', async () => {
  for (const status of ['requires_payment_method', 'requires_confirmation', 'requires_action']) {
    const st = { rows: [unpaidRow()], pi: { id: 'pi_open', status } };
    const r = await load('delete-portal-invoice', deleteRoutes(st)).call({ source_invoice_id: 1730 }, staffToken());
    assert.equal(r.status, 200, status);
    assert.deepEqual(st.canceled, ['pi_open']);
    assert.equal(st.deleted, true);
  }
});

test('delete-portal-invoice RP3.29: a payment going through (processing / succeeded / requires_capture) -> 409, nothing deleted or canceled', async () => {
  for (const status of ['processing', 'succeeded', 'requires_capture']) {
    const st = { rows: [unpaidRow()], pi: { id: 'pi_open', status } };
    const r = await load('delete-portal-invoice', deleteRoutes(st)).call({ source_invoice_id: 1730 }, staffToken());
    assert.equal(r.status, 409, status);
    assert.equal(r.body.payment_in_progress, true);
    assert.equal(st.deleted, false);
    assert.deepEqual(st.canceled, []);
  }
});

test('delete-portal-invoice RP3.29: Stripe unreachable, a non-404 error, or a failed cancel -> 502 and nothing deleted', async () => {
  for (const fail of [{ stripeThrows: true }, { retrieveStatus: 500 }, { retrieveStatus: 401 }, { cancelStatus: 500 }]) {
    const st = { rows: [unpaidRow()], pi: { id: 'pi_open', status: 'requires_payment_method' }, ...fail };
    const r = await load('delete-portal-invoice', deleteRoutes(st)).call({ source_invoice_id: 1730 }, staffToken());
    assert.equal(r.status, 502, JSON.stringify(fail));
    assert.equal(st.deleted, false);
  }
  const moved = { rows: [unpaidRow()], pi: { id: 'pi_open', status: 'requires_action' }, cancelStatus: 400, cancelCode: 'payment_intent_unexpected_state' };
  const r = await load('delete-portal-invoice', deleteRoutes(moved)).call({ source_invoice_id: 1730 }, staffToken());
  assert.equal(r.status, 409, 'it moved on while we looked: treated as going through');
  assert.equal(moved.deleted, false);
});

test('delete-portal-invoice RP3.29: no PaymentIntent, one Stripe no longer knows (404), or one already canceled -> deleted as before', async () => {
  for (const st of [{ rows: [unpaidRow({ stripe_payment_intent_id: null })] }, { rows: [unpaidRow()], pi: null }, { rows: [unpaidRow()], pi: { id: 'pi_open', status: 'canceled' } }]) {
    const r = await load('delete-portal-invoice', deleteRoutes(st)).call({ source_invoice_id: 1730 }, staffToken());
    assert.equal(r.status, 200);
    assert.equal(st.deleted, true);
    assert.deepEqual(st.canceled, []);
  }
});

test('delete-portal-invoice RP3.29: without a Stripe key it refuses rather than delete under a possibly open payment', async () => {
  const st = { rows: [unpaidRow()], pi: { id: 'pi_open', status: 'requires_payment_method' } };
  const r = await load('delete-portal-invoice', deleteRoutes(st), { STRIPE_SECRET_KEY: '' }).call({ source_invoice_id: 1730 }, staffToken());
  assert.equal(r.status, 502);
  assert.equal(st.deleted, false);
});

// ---------------------------------------------------------- send-booking-email

function bookingRoutes(st) {
  st.sent = [];
  return async (u, method, body, p) => {
    if (u === 'https://api.resend.com/emails') {
      st.sent.push(body.to);
      const isGuest = body.to === 'guest@example.com';
      if (isGuest ? st.guestFails : st.internalFails) return j({ message: 'nope' }, 500);
      return j({ id: isGuest ? 'em_guest' : 'em_int' });
    }
    if (p.pathname === '/rest/v1/th_bookings') return j([]);
    if (p.pathname === '/functions/v1/Send-Push') return j({ ok: true });
    return null;
  };
}
const booking = { id: 5, name: 'Guest Person', email: 'guest@example.com', phone: '555', service_label: 'Repair', start_at: inHours(30), end_at: inHours(31), status: 'confirmed' };

test('send-booking-email RP3.31: the guest got their confirmation but the staff email failed -> ok:true with the breakdown, not a 502', async () => {
  const st = { internalFails: true };
  const r = await load('send-booking-email', bookingRoutes(st)).call({ type: 'INSERT', table: 'th_bookings', record: booking }, SRK);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, guest_sent: true, internal_sent: false });
});

test('send-booking-email RP3.31: both sent -> the breakdown says so; neither -> still a 502', async () => {
  const both = await load('send-booking-email', bookingRoutes({})).call({ type: 'INSERT', table: 'th_bookings', record: booking }, SRK);
  assert.deepEqual(both.body, { ok: true, guest_sent: true, internal_sent: true });
  const neither = await load('send-booking-email', bookingRoutes({ internalFails: true, guestFails: true })).call({ type: 'INSERT', table: 'th_bookings', record: booking }, SRK);
  assert.equal(neither.status, 502);
  assert.equal(neither.body.guest_sent, false);
});
