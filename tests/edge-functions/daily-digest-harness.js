// Loads edge-functions/daily-digest-index.ts in a vm with a stubbed clock,
// Deno, fetch (fake Supabase REST + Stripe + Resend). Shared by
// daily-digest.test.js and scripts/render-daily-digest-sample.js.
// All data here is SAMPLE data -- no real clients.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripTypeScriptTypes } = require('module');

const SERVICE_KEY = 'service-role-key-for-tests';
// Sat 2026-10-31 20:05 MDT. Tomorrow (Sun 11-01) is the 25-hour DST-end day.
const DEFAULT_NOW = Date.parse('2026-11-01T02:05:00Z');

function j(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function sampleState() {
  return {
    now: DEFAULT_NOW,
    settings: { id: 1, tenant_id: null, enabled: true, recipients: ['owner1@example.com', 'owner2@example.com'], send_hour_local: 20, timezone: 'America/Denver', send_on_empty_day: true, from_address: 'digest@example.com' },
    runs: [],
    alerts: [],
    resend: { status: 200, calls: [] },
    stripeFail: false,
    tables: {
      jobs: [
        { id: 1, title: 'Dishwasher install', client: 'Maria Gonzales', job_date: '2026-10-31', client_id: 'c1', status: 'scheduled' },
        { id: 2, title: 'Fence repair', client: 'Tom Alvarez', job_date: '2026-10-31', client_id: null, status: 'scheduled' },
        { id: 3, title: 'Drywall patch', client: 'Priya Nair', job_date: '11/1/2026', client_id: 'c3', status: 'scheduled' },
        { id: 4, title: 'Faucet swap', client: 'Lee Chen', job_date: '2026-11-01', client_id: 'c4', status: 'scheduled', reschedule_requested_at: '2026-10-30T15:00:00Z' },
        { id: 5, title: 'Messy date', client: 'Bad Date', job_date: 'next tuesday', client_id: 'c5' },
      ],
      client_portal_work_orders: [
        { id: 1, title: 'Ice maker not cooling', status: 'scheduled', scheduled_at: '2026-10-31T21:00:00Z', linked_job_id: null },
        { id: 2, title: 'Dishwasher install', status: 'scheduled', scheduled_at: '2026-10-31T16:00:00Z', linked_job_id: 1 },
        { id: 3, title: 'Gate latch', status: 'submitted', scheduled_at: null, linked_job_id: null },
      ],
      client_portal_quotes: [
        { id: 1, quote_number: 'Q-1042', client_name: 'Ana Brooks', total: 640, status: 'pending', created_at: '2026-10-31T17:00:00Z', responded_at: null },
        { id: 2, quote_number: 'Q-1039', client_name: 'Sam Ortiz', total: 1250, status: 'approved', created_at: '2026-10-29T17:00:00Z', responded_at: '2026-10-31T19:00:00Z' },
        { id: 3, quote_number: 'Q-1035', client_name: 'Jo Park', total: 310, status: 'declined', created_at: '2026-10-28T17:00:00Z', responded_at: '2026-10-31T22:00:00Z' },
      ],
      client_portal_invoices: [
        { invoice_number: 'INV-2210', client_name: 'Maria Gonzales', total: 185, created_at: '2026-10-31T22:30:00Z', paid_at: null },
        { invoice_number: 'INV-2201', client_name: 'Dee Walker', total: 420, created_at: '2026-10-20T22:30:00Z', paid_at: '2026-10-31T18:00:00Z' },
      ],
      invoices: [
        { invoice_number: 'INV-2150', client_name: 'Rob Hill', invoice_date: '2026-09-01', terms: 'Net 30', total: 900, paid_amount: 0 },
        { invoice_number: 'INV-2188', client_name: 'Kim Soto', invoice_date: '2026-10-01', terms: 'Net 15', total: 350, paid_amount: 100 },
        { invoice_number: 'INV-2205', client_name: 'Not Due', invoice_date: '2026-10-30', terms: 'Net 30', total: 100, paid_amount: 0 },
      ],
      stripe_pos_charges_logged: [{ payment_intent_id: 'pi_2' }],
    },
    stripe: {
      livemode: true,
      payment_intents: [
        { id: 'pi_1', status: 'succeeded', amount: 18500, amount_received: 18500 },
        { id: 'pi_2', status: 'succeeded', amount: 42000, amount_received: 42000 },
        { id: 'pi_3', status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } },
      ],
      refunds: [{ id: 're_1', amount: 2500 }],
      disputes: [],
      balance: { available: [{ currency: 'usd', amount: 128450 }], pending: [{ currency: 'usd', amount: 60500 }] },
      payouts: { pending: [{ id: 'po_1', amount: 128450, arrival_date: Date.parse('2026-11-02T12:00:00Z') / 1000, status: 'pending' }], in_transit: [], paid: [] },
    },
  };
}

function loadDigest(state) {
  const src = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', '..', 'edge-functions', 'daily-digest-index.ts'), 'utf8'));
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: String(url), method, headers: init.headers, body: init.body });
    if (u.hostname === 'api.resend.com') {
      state.resend.calls.push({ headers: init.headers, body: JSON.parse(init.body) });
      return state.resend.status === 200 ? j({ id: 'email_sample_1' }) : j({ message: 'nope' }, state.resend.status);
    }
    if (u.hostname === 'api.stripe.com') {
      if (state.stripeFail) return j({ error: 'x' }, 500);
      const p = u.pathname.replace('/v1/', '');
      if (p === 'balance') return j({ livemode: state.stripe.livemode, ...state.stripe.balance });
      if (p === 'payment_intents') return j({ data: state.stripe.payment_intents, has_more: false });
      if (p === 'refunds') return j({ data: state.stripe.refunds, has_more: false });
      if (p === 'disputes') return j({ data: state.stripe.disputes, has_more: false });
      if (p === 'payouts') return j({ data: state.stripe.payouts[u.searchParams.get('status')] || [] });
      return j({}, 404);
    }
    const table = u.pathname.replace('/rest/v1/', '');
    if (table === 'digest_settings') return j([state.settings]);
    if (table === 'cron_alerts' && method === 'POST') { state.alerts.push(JSON.parse(init.body)); return j([]); }
    if (table === 'digest_runs') {
      if (method === 'POST') {
        const b = JSON.parse(init.body);
        if (state.runs.some((r) => r.digest_date === b.digest_date)) return j([]);
        const row = { id: state.runs.length + 1, status: 'pending', attempts: 0, created_at: new Date(state.now).toISOString(), ...b };
        state.runs.push(row);
        return j([row]);
      }
      if (method === 'PATCH') {
        const id = Number(u.searchParams.get('id').replace('eq.', ''));
        Object.assign(state.runs.find((r) => r.id === id), JSON.parse(init.body));
        return j([]);
      }
      const d = u.searchParams.get('digest_date')?.replace('eq.', '');
      return j(state.runs.filter((r) => !d || r.digest_date === d));
    }
    if (state.failTables?.includes(table)) return j({ message: 'boom' }, 500);
    return j(state.tables[table] || []);
  };

  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(state.now); }
    static now() { return state.now; }
  }
  let handler = null;
  const env = {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    STRIPE_SECRET_KEY: 'sk_test_x', RESEND_API_KEY: 're_test_x', LEAD_EMAIL_FROM: 'fallback@example.com',
  };
  const logs = [];
  const context = vm.createContext({
    Deno: { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } },
    fetch: fetchStub, Response, Request, Headers, URL, URLSearchParams, AbortSignal, Intl,
    Date: FakeDate, console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')), warn() {} },
    JSON, Promise, Map, Set, String, Array, Object, Number, Math, parseInt, isNaN, RegExp, Error, TextEncoder,
  });
  vm.runInContext(src, context, { filename: 'daily-digest-index.ts' });
  const call = async (body = {}, token = SERVICE_KEY) => {
    const res = await handler(new Request('https://example.supabase.co/functions/v1/daily-digest', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    }));
    const text = await res.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { /* 204 */ }
    return { status: res.status, body: parsed };
  };
  return { call, calls, logs };
}

module.exports = { loadDigest, sampleState, SERVICE_KEY };
